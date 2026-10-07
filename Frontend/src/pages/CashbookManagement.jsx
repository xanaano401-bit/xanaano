import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Wallet,
  Edit2,
  Trash2,
  Search,
  Tags,
  ArrowLeftRight,
  ArrowUpRight,
  ArrowDownLeft,
  Save,
  RotateCcw,
  AlertCircle,
  Lock,
  Unlock,
  Clock,
  ShieldCheck,
  History,
  X
} from 'lucide-react';
import api from '../services/api';
import { useAlert } from '../components/common/alerts/useAlert';
import { digitsOnly, isValidSomaliMobile } from '../utils/somaliPhone';
import { currentCycle, addCycles, cycleShortLabel, cycleKeyForDate, cycleLabel, cycleRangeISO } from '../utils/billingCycle';
import { useLanguage, translate } from '../i18n/LanguageContext.jsx';
import { monthNames } from '../i18n/core.js';

const PAYMENT_METHODS = ['Mobile Money', 'Bank'];

const METHODS_WITH_PARTIES = ['Mobile Money', 'Bank'];

// Per-method phone/account hints.
//  • Bank account number: 6–7 digits.
//  • Mobile Money: 9 or 10 digits numeric value.
const PHONE_RULES = {
  Bank: { labelKey: 'cashbook.phone.bankRule' },
  'Mobile Money': { labelKey: 'cashbook.phone.mobileRule' }
};

// Returns an error string if the value is present but does not match the
// method's rule; empty string means valid (or nothing to validate).
const phoneError = (method, value) => {
  if (!value) return '';
  if (method === 'Bank') {
    const d = digitsOnly(value);
    return d.length >= 6 && d.length <= 7 ? '' : translate(PHONE_RULES.Bank.labelKey);
  }
  return isValidSomaliMobile(value) ? '' : translate('cashbook.phone.mobileRule');
};

const fmtMoney = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const emptyCategoryForm = () => ({
  title: '',
  type: 'Income',
  description: ''
});

// Billing cycle options (25th→24th): previous 6 cycles (arrears), current cycle,
// and next 6 cycles (advance). Each value is a cycle key.
const getMonthOptions = () => {
  const options = [];
  const base = currentCycle();
  const MONTH_NAMES = monthNames();
  for (let i = -6; i <= 6; i++) {
    const key = addCycles(base, i);
    const [y, m] = key.split('-').map(Number);
    const mName = MONTH_NAMES[m - 1];
    let label = translate('cashbook.cycleOption', { month: mName, year: y, range: cycleShortLabel(key) });
    if (i === 0) {
      label += ` (${translate('cashbook.currentMonth')})`;
    } else if (i > 0) {
      label += ` (${translate('cashbook.advance')})`;
    } else {
      label += ` (${translate('cashbook.arrearsTag')})`;
    }
    options.push({ value: key, label, monthName: mName, year: y, isAdvance: i > 0, isPast: i < 0 });
  }
  return options;
};

// Label for a cycle key offset by `offset` cycles.
const getPayerMonthLabel = (baseKey, offset = 0) => {
  const key = addCycles(baseKey || currentCycle(), offset);
  const [y, m] = key.split('-').map(Number);
  return {
    name: monthNames()[m - 1],
    year: y,
    ym: key
  };
};

const emptyTransactionForm = () => ({
  type: 'Income',
  categoryId: '',
  amount: '',
  method: 'Mobile Money',
  walletId: '',
  senderPhone: '',
  senderName: '',
  senderEntityType: '',
  senderEntityId: '',
  receiverPhone: '',
  receiverName: '',
  receiverEntityType: '',
  receiverEntityId: '',
  date: new Date().toISOString().split('T')[0],
  targetMonth: currentCycle(),
  description: '',
  isBackdated: false,
  backdatedReason: ''
});

const CashbookManagement = () => {
  const { showAlert, showConfirm } = useAlert();
  const { t, tv, language, locale } = useLanguage();
  const [activePanel, setActivePanel] = useState('category');

  const [categories, setCategories] = useState([]);
  const [entries, setEntries] = useState([]);
  const [deletedEntries, setDeletedEntries] = useState([]);
  const [wallets, setWallets] = useState([]);
  const [payerOptions, setPayerOptions] = useState([]);
  const [loading, setLoading] = useState(true);

  // Cycle Locks & Backdated adjustments state
  const [cycleLocks, setCycleLocks] = useState([]);
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);
  const [cycleToUnlock, setCycleToUnlock] = useState(null);
  const [unlockReason, setUnlockReason] = useState('');
  const [unlockSubmitting, setUnlockSubmitting] = useState(false);

  const [adjustmentsModalOpen, setAdjustmentsModalOpen] = useState(false);
  const [cycleForAdjustments, setCycleForAdjustments] = useState(null);
  const [adjustmentsData, setAdjustmentsData] = useState(null);
  const [adjustmentsLoading, setAdjustmentsLoading] = useState(false);

  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm());
  const [editingCategory, setEditingCategory] = useState(null);
  const [categorySearch, setCategorySearch] = useState('');

  const [transactionForm, setTransactionForm] = useState(emptyTransactionForm());
  const transactionFormRef = useRef(transactionForm);
  transactionFormRef.current = transactionForm;
  const lastLookedUpSenderRef = useRef('');
  const lastLookedUpReceiverRef = useRef('');
  const [editingEntry, setEditingEntry] = useState(null);
  const editingEntryRef = useRef(null);

  const [filterType, setFilterType] = useState('All');
  const [filterCategory, setFilterCategory] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [senderLocked, setSenderLocked] = useState(false);
  const [receiverLocked, setReceiverLocked] = useState(false);
  const [walletDirection, setWalletDirection] = useState('receiver');
  const [payerInfo, setPayerInfo] = useState(null);
  const [monthsToPay, setMonthsToPay] = useState(1);

  // The most a responsible payer may pay: total owed (previous arrears + current balance),
  // plus any advance months chosen. In edit mode, it allows at least the entry's existing amount.
  const payerTotalOutstanding = Number(payerInfo?.totalDue ?? (Number(payerInfo?.totalBalance || 0) + Number(payerInfo?.previousBalance || 0)));
  const maxPayable = (payerInfo && payerInfo.kind === 'responsible')
    ? (monthsToPay === 1
        ? Math.max(payerTotalOutstanding, editingEntry ? Number(editingEntry.amount || 0) : 0)
        : payerTotalOutstanding + Number(payerInfo.totalMonthlyFee || 0) * (monthsToPay - 1))
    : null;

  const currentMonthStr = currentCycle();
  const monthOptions = getMonthOptions();

  // When the number of pre-paid months changes, re-fill the amount with the target month(s) amount.
  useEffect(() => {
    if (editingEntryRef.current) return;
    if (payerInfo && payerInfo.kind === 'responsible' && monthsToPay > 1) {
      const base = Number(payerInfo.totalDue ?? (Number(payerInfo.totalBalance || 0) + Number(payerInfo.previousBalance || 0)));
      const targetAmount = base + Number(payerInfo.totalMonthlyFee || 0) * (monthsToPay - 1);
      setTransactionForm((prev) => ({ ...prev, amount: targetAmount }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthsToPay]);

  const isInstituteAccount = (phone, list = wallets) =>
    (list || []).some((w) => w.accountNumber && (w.accountNumber === phone || digitsOnly(w.accountNumber) === digitsOnly(phone)));

  const fetchCycleLocks = async () => {
    try {
      const res = await api.get('/cycle-locks', { skipCache: true });
      setCycleLocks(res.data || []);
    } catch (err) {
      console.error('Failed to load cycle locks', err);
    }
  };

  const fetchAll = async () => {
    try {
      setLoading(true);
      const [catRes, entryRes, walletRes, guardRes, studRes, cycleLockRes, deletedRes] = await Promise.all([
        api.get('/cashbook/categories'),
        api.get('/cashbook/entries'),
        api.get('/wallets'),
        api.get('/guardians'),
        api.get('/students'),
        api.get('/cycle-locks', { skipCache: true }).catch(() => ({ data: [] })),
        api.get('/cashbook/deleted-entries', { skipCache: true }).catch(() => ({ data: [] }))
      ]);
      setCategories(catRes.data || []);
      setEntries(entryRes.data || []);
      const walletList = walletRes.data || [];
      setWallets(walletList);
      setCycleLocks(cycleLockRes.data || []);
      setDeletedEntries(deletedRes.data || []);

      // Build the type-and-select payer list (guardians + students' fathers + contacts), unique by number.
      const optMap = new Map();
      (guardRes.data?.guardians || guardRes.data || []).forEach((g) => {
        const ph = digitsOnly(g.phone);
        if (ph && !optMap.has(ph)) optMap.set(ph, g.fullName || g.name || '');
      });
      (studRes.data?.students || studRes.data || []).forEach((s) => {
        const ph = digitsOnly(s.fatherPhone);
        if (ph && !optMap.has(ph)) optMap.set(ph, s.fatherName || '');
      });
      (entryRes.data || []).forEach((e) => {
        const sp = digitsOnly(e.senderPhone);
        if (sp && !optMap.has(sp) && !isInstituteAccount(sp, walletList)) {
          optMap.set(sp, e.senderName || e.payerName || '');
        }
        const rp = digitsOnly(e.receiverPhone);
        if (rp && !optMap.has(rp) && !isInstituteAccount(rp, walletList)) {
          optMap.set(rp, e.receiverName || '');
        }
      });
      setPayerOptions([...optMap.entries()].map(([phone, name]) => ({ phone, name })));
      // Default the form to the first active wallet if none picked yet.
      const firstWallet = walletList.find((w) => w.status !== 'Disabled') || walletList[0];
      if (firstWallet) {
        setTransactionForm((prev) => {
          if (prev.walletId) return prev;
          const isExp = prev.type === 'Expense';
          return {
            ...prev,
            walletId: firstWallet._id,
            senderPhone: isExp ? (firstWallet.accountNumber || '') : prev.senderPhone,
            senderName: isExp ? (firstWallet.name || '') : prev.senderName,
            receiverPhone: !isExp ? (firstWallet.accountNumber || '') : prev.receiverPhone,
            receiverName: !isExp ? (firstWallet.name || '') : prev.receiverName,
            receiverEntityType: !isExp ? 'manual' : prev.receiverEntityType,
            senderEntityType: isExp ? 'manual' : prev.senderEntityType
          };
        });
      }
    } catch (error) {
      console.error('Failed to load cashbook', error);
      showAlert({ type: 'danger', title: t('common.error'), message: t('cashbook.loadFailed') });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  // Synchronize Type and Wallet Direction:
  // Type === 'Expense' <=> Wallet Direction === 'sender'
  // Type === 'Income' <=> Wallet Direction === 'receiver'
  const applyTypeAndDirection = (newType, newDirection, targetWalletId) => {
    const type = newType || (newDirection === 'sender' ? 'Expense' : 'Income');
    const direction = newDirection || (type === 'Expense' ? 'sender' : 'receiver');
    setWalletDirection(direction);

    const wId = targetWalletId !== undefined ? targetWalletId : transactionForm.walletId;
    const selectedWallet = wallets.find((w) => w._id === wId) || wallets.find((w) => w.status !== 'Disabled') || wallets[0];

    setTransactionForm((prev) => {
      const typeChanged = prev.type !== type;
      const nextCategoryId = typeChanged ? '' : prev.categoryId;

      if (direction === 'sender') {
        const clearReceiver = isInstituteAccount(prev.receiverPhone);
        return {
          ...prev,
          type,
          categoryId: nextCategoryId,
          walletId: wId !== undefined ? wId : prev.walletId,
          senderPhone: selectedWallet?.accountNumber || '',
          senderName: selectedWallet?.name || '',
          senderEntityType: 'manual',
          senderEntityId: '',
          receiverPhone: clearReceiver ? '' : prev.receiverPhone,
          receiverName: clearReceiver ? '' : prev.receiverName,
          receiverEntityType: clearReceiver ? '' : prev.receiverEntityType,
          receiverEntityId: clearReceiver ? '' : prev.receiverEntityId
        };
      } else {
        const clearSender = isInstituteAccount(prev.senderPhone);
        return {
          ...prev,
          type,
          categoryId: nextCategoryId,
          walletId: wId !== undefined ? wId : prev.walletId,
          receiverPhone: selectedWallet?.accountNumber || '',
          receiverName: selectedWallet?.name || '',
          receiverEntityType: 'manual',
          receiverEntityId: '',
          senderPhone: clearSender ? '' : prev.senderPhone,
          senderName: clearSender ? '' : prev.senderName,
          senderEntityType: clearSender ? '' : prev.senderEntityType,
          senderEntityId: clearSender ? '' : prev.senderEntityId
        };
      }
    });

    if (direction === 'sender') {
      setSenderLocked(false);
      setPayerInfo(null);
    } else {
      setReceiverLocked(false);
    }
  };

  const handleDirectionChange = (direction) => {
    const targetDirection = direction === 'sender' ? 'sender' : 'receiver';
    const targetType = targetDirection === 'sender' ? 'Expense' : 'Income';
    applyTypeAndDirection(targetType, targetDirection);
  };

  const lookupPhone = useCallback(async (phone, side, overrideMonth = null) => {
    const cleaned = digitsOnly(phone);
    if (cleaned.length < 4) return;

    const currentForm = transactionFormRef.current;
    // Only look up once the number matches the method's digit rule.
    if (phoneError(currentForm.method, cleaned)) {
      return;
    }

    const monthToUse = overrideMonth || currentForm.targetMonth || cycleKeyForDate(currentForm.date || new Date());

    try {
      const res = await api.get('/cashbook/lookup', {
        params: {
          phone: cleaned,
          purpose: side,
          date: currentForm.date,
          month: monthToUse,
          excludeEntryId: editingEntryRef.current?._id || undefined
        }
      });
      const { found, name, entityType, entityId, payerInfo: info } = res.data || {};

      if (side === 'sender') {
        if (found) {
          const hasArrears = Number(info?.previousBalance || 0) > 0;
          const oldestArrears = info?.arrears?.[0]?.month;
          // Auto-fill amount: if arrears exist, capture the full debt totalDue ($50), else current balance ($25).
          const rem = hasArrears && info?.totalDue !== undefined
            ? Number(info.totalDue)
            : info?.remainingBalance !== undefined
            ? Number(info.remainingBalance)
            : info?.totalBalance !== undefined
            ? Number(info.totalBalance)
            : null;

          setTransactionForm((prev) => {
            const isFreshPhoneLookup = !prev.senderEntityId || digitsOnly(prev.senderPhone) !== cleaned;
            const chosenTargetMonth = editingEntryRef.current
              ? prev.targetMonth
              : isFreshPhoneLookup
              ? (hasArrears && oldestArrears ? oldestArrears : currentMonthStr)
              : prev.targetMonth || currentMonthStr;

            const chosenAmount = editingEntryRef.current
              ? prev.amount
              : isFreshPhoneLookup
              ? (rem !== null && !isNaN(rem) ? rem : prev.amount)
              : prev.amount;

            return {
              ...prev,
              senderName: name,
              senderEntityType: entityType === 'teacher' ? 'user' : entityType,
              senderEntityId: entityId || '',
              targetMonth: chosenTargetMonth,
              amount: chosenAmount
            };
          });
          setSenderLocked(true);
          setPayerInfo(info || null);
          if (!editingEntryRef.current) {
            setMonthsToPay(1);
          }
        } else {
          setSenderLocked(false);
          setPayerInfo(null);
        }
      } else {
        if (found) {
          // Auto-fill the amount with the current remaining balance owed/payable only for new transactions.
          const rem = info?.remainingBalance !== undefined
            ? Number(info.remainingBalance)
            : info?.totalBalance !== undefined
            ? Number(info.totalBalance)
            : null;
          setTransactionForm((prev) => ({
            ...prev,
            receiverName: name,
            receiverEntityType: entityType === 'teacher' ? 'teacher' : entityType === 'user' ? 'user' : entityType,
            receiverEntityId: entityId || '',
            amount: editingEntryRef.current ? prev.amount : (rem !== null && !isNaN(rem) ? rem : prev.amount)
          }));
          setReceiverLocked(true);
          setPayerInfo(info || null);
        } else {
          setReceiverLocked(false);
        }
      }
    } catch {
      if (side === 'sender') {
        setSenderLocked(false);
        setPayerInfo(null);
      } else {
        setReceiverLocked(false);
      }
    }
  }, [currentMonthStr]);

  const handleDateChange = (newDate) => {
    const newCycle = newDate ? cycleKeyForDate(newDate) : currentCycle();
    setTransactionForm((prev) => ({
      ...prev,
      date: newDate,
      targetMonth: newCycle
    }));
  };

  const handleTargetMonthChange = (newMonth) => {
    const range = cycleRangeISO(newMonth);
    const today = new Date().toISOString().split('T')[0];
    const newDate = (today >= range.from && today <= range.to) ? today : range.from;

    // Automatically calculate amount remaining for the newly selected month:
    let newAmount = transactionFormRef.current.amount;
    if (payerInfo && payerInfo.kind === 'responsible') {
      if (newMonth < currentMonthStr) {
        // Arrears cycle: set amount to arrears of that specific month
        const arr = payerInfo.arrears?.find((a) => a.month === newMonth);
        newAmount = arr ? arr.balance : (payerInfo.totalMonthlyFee || 0);
      } else if (newMonth === currentMonthStr) {
        // Current cycle: remaining balance for current month
        newAmount = payerInfo.totalBalance ?? (payerInfo.totalMonthlyFee || 0);
      } else {
        // Advance cycle: 1 cycle total fee
        newAmount = payerInfo.totalMonthlyFee ?? 0;
      }
    } else if (payerInfo && payerInfo.kind === 'staff') {
      newAmount = payerInfo.remainingBalance ?? payerInfo.salary ?? transactionFormRef.current.amount;
    }

    setTransactionForm((prev) => ({
      ...prev,
      targetMonth: newMonth,
      date: newDate,
      amount: newAmount !== undefined && newAmount !== null && newAmount !== '' ? newAmount : prev.amount
    }));

    const activePhone = walletDirection === 'sender' ? transactionFormRef.current.receiverPhone : transactionFormRef.current.senderPhone;
    const activeSide = walletDirection === 'sender' ? 'receiver' : 'sender';
    // For staff/teacher/accounts/expense only, look up the target month's budget/salary.
    if (activePhone && activeSide !== 'sender' && payerInfo?.kind !== 'responsible') {
      lookupPhone(activePhone, activeSide, newMonth);
    }
  };

  useEffect(() => {
    const cleaned = digitsOnly(transactionForm.senderPhone);
    if (!cleaned || cleaned.length < 4 || walletDirection === 'sender') {
      lastLookedUpSenderRef.current = '';
      return;
    }
    if (cleaned === lastLookedUpSenderRef.current) return;
    const t = setTimeout(() => {
      lastLookedUpSenderRef.current = cleaned;
      lookupPhone(cleaned, 'sender');
    }, 400);
    return () => clearTimeout(t);
  }, [transactionForm.senderPhone, lookupPhone, walletDirection]);

  useEffect(() => {
    if (walletDirection === 'receiver') return;
    const cleaned = digitsOnly(transactionForm.receiverPhone);
    if (!cleaned || cleaned.length < 4) {
      lastLookedUpReceiverRef.current = '';
      return;
    }
    if (cleaned === lastLookedUpReceiverRef.current) return;
    const t = setTimeout(() => {
      lastLookedUpReceiverRef.current = cleaned;
      lookupPhone(cleaned, 'receiver');
    }, 400);
    return () => clearTimeout(t);
  }, [transactionForm.receiverPhone, lookupPhone, walletDirection]);


  const resetCategoryForm = () => {
    setCategoryForm(emptyCategoryForm());
    setEditingCategory(null);
  };

  const resetTransactionForm = () => {
    const firstWallet = wallets.find((w) => w.status !== 'Disabled') || wallets[0];
    const initialForm = emptyTransactionForm();
    setEditingEntry(null);
    editingEntryRef.current = null;
    setSenderLocked(false);
    setReceiverLocked(false);
    setWalletDirection('receiver');
    setPayerInfo(null);
    setMonthsToPay(1);
    if (firstWallet) {
      initialForm.walletId = firstWallet._id;
      initialForm.receiverPhone = firstWallet.accountNumber || '';
      initialForm.receiverName = firstWallet.name || '';
      initialForm.receiverEntityType = 'manual';
    }
    setTransactionForm(initialForm);
  };

  const handleCategorySubmit = async (e) => {
    e.preventDefault();
    if (!categoryForm.title.trim()) {
      showAlert({ type: 'warning', title: t('exams.manage.validation'), message: t('cashbook.categoryTitleRequired') });
      return;
    }
    try {
      if (editingCategory) {
        const res = await api.put(`/cashbook/categories/${editingCategory._id}`, categoryForm);
        setCategories((prev) => prev.map((c) => (c._id === editingCategory._id ? res.data : c)));
        showAlert({ type: 'success', title: t('finance.updatedTitle'), message: t('cashbook.categoryUpdated') });
      } else {
        const res = await api.post('/cashbook/categories', categoryForm);
        setCategories((prev) => [...prev, res.data].sort((a, b) => a.title.localeCompare(b.title)));
        showAlert({ type: 'success', title: t('exams.marks.savedTitle'), message: t('cashbook.categoryCreated') });
      }
      resetCategoryForm();
    } catch (error) {
      showAlert({
        type: 'danger',
        title: t('common.error'),
        message: error.response?.data?.message || t('cashbook.categorySaveFailed')
      });
    }
  };

  const handleCategoryEdit = (item) => {
    setEditingCategory(item);
    setCategoryForm({
      title: item.title || '',
      type: item.type || 'Income',
      description: item.description || ''
    });
    setActivePanel('category');
  };

  const handleCategoryDelete = async (item) => {
    const ok = await showConfirm({
      type: 'warning',
      title: t('cashbook.deleteCategoryTitle'),
      message: t('cashbook.deleteCategoryMsg'),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      danger: true
    });
    if (!ok) return;
    try {
      await api.delete(`/cashbook/categories/${item._id}`);
      setCategories((prev) => prev.filter((c) => c._id !== item._id));
      showAlert({ type: 'success', title: t('common.deleted'), message: t('cashbook.categoryRemoved') });
    } catch (error) {
      showAlert({
        type: 'danger',
        title: t('common.error'),
        message: error.response?.data?.message || t('cashbook.categoryDeleteFailed')
      });
    }
  };

  const validateTransaction = () => {
    if (!transactionForm.categoryId) {
      showAlert({ type: 'warning', title: t('exams.manage.validation'), message: t('cashbook.selectCategoryRequired') });
      return false;
    }
    if (!transactionForm.amount || Number(transactionForm.amount) <= 0) {
      showAlert({ type: 'warning', title: t('exams.manage.validation'), message: t('cashbook.validAmountRequired') });
      return false;
    }
    // A fee payer may never pay more than they owe (current month + any pre-paid months).
    if (maxPayable !== null && Number(transactionForm.amount) > maxPayable + 0.001) {
      showAlert({
        type: 'warning',
        title: t('cashbook.amountTooHighTitle'),
        message: maxPayable > 0
          ? t('cashbook.amountTooHigh', { amount: fmtMoney(maxPayable), months: monthsToPay })
          : t('cashbook.noOutstanding')
      });
      return false;
    }
    const senderErr = phoneError(transactionForm.method, transactionForm.senderPhone);
    if (senderErr && walletDirection !== 'sender') {
      showAlert({ type: 'warning', title: t('cashbook.senderNumber'), message: senderErr });
      return false;
    }
    // Institute account numbers assigned from the wallet are not held to the
    // mobile digit rules, so only validate when not assigned from wallet.
    if (walletDirection !== 'receiver') {
      const receiverErr = phoneError(transactionForm.method, transactionForm.receiverPhone);
      if (receiverErr) {
        showAlert({ type: 'warning', title: t('cashbook.receiverNumber'), message: receiverErr });
        return false;
      }
    }
    return true;
  };

  const selectedCycleKey = transactionForm.targetMonth || cycleKeyForDate(transactionForm.date || new Date());
  const selectedCycleLock = cycleLocks.find((l) => l.cycleKey === selectedCycleKey);
  const isSelectedCycleLocked = Boolean(selectedCycleLock?.isLocked);

  const handleLockCycle = async (cycleKey) => {
    const ok = await showConfirm({
      type: 'warning',
      title: t('cashbook.confirmLockTitle'),
      message: t('cashbook.confirmLockMsg'),
      confirmText: t('cashbook.lockCycle'),
      cancelText: t('common.cancel'),
      danger: true
    });
    if (!ok) return;

    try {
      await api.post('/cycle-locks/toggle', { cycleKey, action: 'lock' });
      showAlert({ type: 'success', title: t('common.success'), message: t('cashbook.lockSuccess') });
      await fetchCycleLocks();
    } catch (err) {
      showAlert({ type: 'danger', title: t('common.error'), message: err.response?.data?.message || t('cashbook.lockFailed') });
    }
  };

  const handleOpenUnlockModal = (cycleKey) => {
    setCycleToUnlock(cycleKey);
    setUnlockReason('');
    setUnlockModalOpen(true);
  };

  const handleConfirmUnlock = async (e) => {
    e.preventDefault();
    if (!unlockReason.trim()) {
      showAlert({ type: 'warning', title: t('common.warning'), message: t('cashbook.unlockReasonRequired') });
      return;
    }
    setUnlockSubmitting(true);
    try {
      await api.post('/cycle-locks/toggle', {
        cycleKey: cycleToUnlock,
        action: 'unlock',
        reason: unlockReason.trim()
      });
      showAlert({ type: 'success', title: t('common.success'), message: t('cashbook.unlockSuccess') });
      setUnlockModalOpen(false);
      setCycleToUnlock(null);
      setUnlockReason('');
      await fetchCycleLocks();
    } catch (err) {
      showAlert({ type: 'danger', title: t('common.error'), message: err.response?.data?.message || t('cashbook.lockFailed') });
    } finally {
      setUnlockSubmitting(false);
    }
  };

  const handleOpenAdjustments = async (cycleKey) => {
    setCycleForAdjustments(cycleKey);
    setAdjustmentsLoading(true);
    setAdjustmentsModalOpen(true);
    try {
      const res = await api.get(`/cycle-locks/adjustments/${cycleKey}`, { skipCache: true });
      setAdjustmentsData(res.data);
    } catch (err) {
      console.error('Failed to load adjustments', err);
      setAdjustmentsData(null);
    } finally {
      setAdjustmentsLoading(false);
    }
  };

  const handleTransactionSubmit = async (e) => {
    e.preventDefault();
    if (!validateTransaction()) return;

    if (isSelectedCycleLocked && !transactionForm.backdatedReason?.trim()) {
      showAlert({
        type: 'warning',
        title: t('cashbook.cycleLockedError'),
        message: t('cashbook.cycleLockedWarning')
      });
      return;
    }

    const payload = {
      ...transactionForm,
      amount: Number(transactionForm.amount),
      senderPhone: digitsOnly(transactionForm.senderPhone),
      receiverPhone: digitsOnly(transactionForm.receiverPhone),
      isBackdated: Boolean(transactionForm.isBackdated || isSelectedCycleLocked),
      backdatedReason: (transactionForm.backdatedReason || '').trim()
    };

    try {
      if (editingEntry) {
        const res = await api.put(`/cashbook/entries/${editingEntry._id}`, payload);
        setEntries((prev) => prev.map((x) => (x._id === editingEntry._id ? res.data : x)));
        showAlert({ type: 'success', title: t('finance.updatedTitle'), message: t('finance.transactions.updated') });
      } else {
        const res = await api.post('/cashbook/entries', payload);
        setEntries((prev) => [res.data, ...prev]);
        showAlert({ type: 'success', title: t('exams.marks.savedTitle'), message: t('cashbook.transactionRecorded') });
      }
      resetTransactionForm();
      fetchAll();
    } catch (error) {
      showAlert({
        type: 'danger',
        title: t('common.error'),
        message: error.response?.data?.message || t('cashbook.transactionSaveFailed')
      });
    }
  };

  const handleTransactionEdit = (item) => {
    setEditingEntry(item);
    editingEntryRef.current = item;
    const itemWalletId = item.walletId?._id || item.walletId || '';
    const itemWallet = wallets.find((w) => w._id === itemWalletId);

    const itemType = item.categoryId?.type || item.type || (
      itemWallet?.accountNumber && item.senderPhone === itemWallet.accountNumber ? 'Expense' : 'Income'
    );
    const detectedDirection = itemType === 'Expense' ? 'sender' : 'receiver';
    setWalletDirection(detectedDirection);

    setTransactionForm({
      type: itemType,
      categoryId: item.categoryId?._id || item.categoryId || '',
      amount: item.amount ?? '',
      method: item.method || 'Mobile Money',
      walletId: itemWalletId,
      senderPhone: item.senderPhone || '',
      senderName: item.senderName || '',
      senderEntityType: item.senderEntityType || '',
      senderEntityId: item.senderEntityId || '',
      receiverPhone: item.receiverPhone || '',
      receiverName: item.receiverName || '',
      receiverEntityType: item.receiverEntityType || '',
      receiverEntityId: item.receiverEntityId || '',
      date: item.date || new Date().toISOString().split('T')[0],
      targetMonth: item.targetMonth || cycleKeyForDate(item.date || new Date()),
      description: item.description || '',
      isBackdated: Boolean(item.isBackdated),
      backdatedReason: item.backdatedReason || ''
    });
    setSenderLocked(!!item.senderEntityType && item.senderEntityType !== 'manual' && detectedDirection !== 'sender');
    setReceiverLocked(!!item.receiverEntityType && item.receiverEntityType !== 'manual' && detectedDirection !== 'receiver');
    setActivePanel('transaction');
  };

  const handleTransactionDelete = async (item) => {
    const ok = await showConfirm({
      type: 'warning',
      title: t('cashbook.deleteTransactionTitle'),
      message: t('finance.transactions.deleteConfirm'),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      danger: true
    });
    if (!ok) return;
    try {
      const res = await api.delete(`/cashbook/entries/${item._id}`);
      setEntries((prev) => prev.filter((x) => x._id !== item._id));
      if (res.data?.data) {
        setDeletedEntries((prev) => [res.data.data, ...prev]);
      }
      showAlert({ type: 'success', title: t('common.deleted'), message: t('cashbook.transactionRemoved') });
      fetchAll();
    } catch (error) {
      showAlert({ type: 'danger', title: t('common.error'), message: error.response?.data?.message || t('finance.transactions.deleteFailed') });
    }
  };

  const handleTransactionRestore = async (item) => {
    const ok = await showConfirm({
      type: 'info',
      title: t('cashbook.restoreConfirmTitle'),
      message: t('cashbook.restoreConfirmMsg'),
      confirmText: t('cashbook.restore'),
      cancelText: t('common.cancel')
    });
    if (!ok) return;

    try {
      const res = await api.post(`/cashbook/entries/${item._id}/restore`);
      setDeletedEntries((prev) => prev.filter((x) => x._id !== item._id));
      if (res.data?.data) {
        setEntries((prev) => [res.data.data, ...prev]);
      }
      showAlert({ type: 'success', title: t('common.success'), message: t('cashbook.restoredSuccess') });
      fetchAll();
    } catch (error) {
      showAlert({
        type: 'danger',
        title: t('common.error'),
        message: error.response?.data?.message || t('cashbook.restoreFailed')
      });
    }
  };

  const filteredCategories = categories.filter((c) =>
    (c.title || '').toLowerCase().includes(categorySearch.toLowerCase()) ||
    (c.type || '').toLowerCase().includes(categorySearch.toLowerCase())
  );

  const today = new Date().toISOString().split('T')[0];

  const filteredEntries = entries.filter((item) => {
    const cat = item.categoryId;
    const catId = cat?._id || cat;
    if (filterType !== 'All' && cat?.type !== filterType) return false;
    if (filterCategory !== 'All' && String(catId) !== String(filterCategory)) return false;
    const d = item.date || '';
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });

  // Categories offered in the filter dropdown respect the chosen type filter.
  const filterCategoryOptions = categories.filter((c) => filterType === 'All' || c.type === filterType);

  const showReceiverFields = METHODS_WITH_PARTIES.includes(transactionForm.method);
  const categoriesForType = categories.filter((c) => c.type === transactionForm.type);
  const selectedWallet = wallets.find((w) => w._id === transactionForm.walletId);
  const senderPhoneErr = walletDirection === 'sender' ? '' : phoneError(transactionForm.method, transactionForm.senderPhone);
  const receiverPhoneErr = walletDirection === 'receiver' ? '' : phoneError(transactionForm.method, transactionForm.receiverPhone);
  const phoneHint = PHONE_RULES[transactionForm.method] ? t(PHONE_RULES[transactionForm.method].labelKey) : '';

  if (loading) {
    return <div className="p-10 text-center text-slate-500">{t('cashbook.loading')}</div>;
  }

  return (
    <div className="p-6 lg:p-8 space-y-8 max-w-[1800px] mx-auto animate-in fade-in duration-700 pb-24">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 px-2">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 bg-slate-900 dark:bg-slate-800 rounded-[24px] flex items-center justify-center text-brand-400 shadow-2xl border border-slate-700 ring-4 ring-brand-400/10">
            <Wallet size={32} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight uppercase leading-none">
              {t('cashbook.title')}
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-[10px] font-black mt-2 uppercase tracking-[0.2em] opacity-80">
              {t('cashbook.subtitle')}
            </p>
          </div>
        </div>

        <div className="flex rounded-[20px] border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
          <button
            type="button"
            onClick={() => setActivePanel('category')}
            className={`flex items-center gap-2 px-8 py-4 text-[11px] font-black uppercase tracking-[0.15em] transition-all ${
              activePanel === 'category'
                ? 'bg-brand-600 text-white'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Tags size={16} /> {t('common.category')}
          </button>
          <button
            type="button"
            onClick={() => setActivePanel('transaction')}
            className={`flex items-center gap-2 px-8 py-4 text-[11px] font-black uppercase tracking-[0.15em] transition-all ${
              activePanel === 'transaction'
                ? 'bg-brand-600 text-white'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <ArrowLeftRight size={16} /> {t('cashbook.transaction')}
          </button>
          <button
            type="button"
            onClick={() => setActivePanel('cycleLocks')}
            className={`flex items-center gap-2 px-8 py-4 text-[11px] font-black uppercase tracking-[0.15em] transition-all ${
              activePanel === 'cycleLocks'
                ? 'bg-brand-600 text-white'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Lock size={16} /> {t('cashbook.cycleLocks')}
            {cycleLocks.some((l) => l.isLocked) && (
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse ml-0.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActivePanel('trash')}
            className={`flex items-center gap-2 px-8 py-4 text-[11px] font-black uppercase tracking-[0.15em] transition-all ${
              activePanel === 'trash'
                ? 'bg-rose-600 text-white'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <Trash2 size={16} /> {t('cashbook.trash')}
            {deletedEntries.length > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                activePanel === 'trash' ? 'bg-white/20 text-white' : 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
              }`}>
                {deletedEntries.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {activePanel === 'category' && (
        <div className="space-y-8">
          <form
            onSubmit={handleCategorySubmit}
            className="bg-white dark:bg-slate-900 rounded-[32px] border border-slate-100 dark:border-slate-800 shadow-sm p-8 space-y-6"
          >
            <h2 className="text-lg font-black uppercase tracking-wide text-slate-800 dark:text-white">
              {editingCategory ? t('cashbook.editCategory') : t('cashbook.newCategory')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 mb-1">{t('finance.expenses.colTitle')}</label>
                <input
                  type="text"
                  value={categoryForm.title}
                  onChange={(e) => setCategoryForm({ ...categoryForm, title: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder={t('cashbook.categoryPlaceholder')}
                />
              </div>
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 mb-1">{t('common.type')}</label>
                <select
                  value={categoryForm.type}
                  onChange={(e) => setCategoryForm({ ...categoryForm, type: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="Income">{tv('Income')}</option>
                  <option value="Expense">{tv('Expense')}</option>
                </select>
              </div>
              <div className="md:col-span-1">
                <label className="block text-xs font-black uppercase text-slate-500 mb-1">{t('common.description')}</label>
                <input
                  type="text"
                  value={categoryForm.description}
                  onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder={t('cashbook.optionalNotes')}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                className="flex items-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-black text-xs uppercase tracking-wider"
              >
                <Save size={16} /> {editingCategory ? t('cashbook.updateCategory') : t('cashbook.saveCategory')}
              </button>
              {editingCategory && (
                <button
                  type="button"
                  onClick={resetCategoryForm}
                  className="flex items-center gap-2 px-6 py-3 border border-slate-200 dark:border-slate-700 rounded-xl font-black text-xs uppercase text-slate-600 dark:text-slate-300"
                >
                  <RotateCcw size={16} /> {t('cashbook.cancelEdit')}
                </button>
              )}
            </div>
          </form>

          <div className="flex items-center bg-white dark:bg-slate-900 rounded-2xl px-5 py-3 border border-slate-100 dark:border-slate-800 shadow-sm max-w-md">
            <Search size={18} className="text-slate-400 mr-3" />
            <input
              type="text"
              placeholder={t('cashbook.searchCategories')}
              value={categorySearch}
              onChange={(e) => setCategorySearch(e.target.value)}
              className="w-full bg-transparent outline-none text-sm text-slate-900 dark:text-white"
            />
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-[40px] border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50/50 dark:bg-slate-800/30 text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-100 dark:border-slate-800">
                  <th className="px-8 py-5">{t('finance.expenses.colTitle')}</th>
                  <th className="px-8 py-5">{t('common.type')}</th>
                  <th className="px-8 py-5">{t('common.description')}</th>
                  <th className="px-8 py-5 text-right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredCategories.map((item) => (
                  <tr key={item._id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/10">
                    <td className="px-8 py-6 text-sm font-bold text-slate-900 dark:text-white">{item.title}</td>
                    <td className="px-8 py-6">
                      <span
                        className={`px-3 py-1 text-[10px] font-black uppercase rounded-full ${
                          item.type === 'Income'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                        }`}
                      >
                        {tv(item.type)}
                      </span>
                    </td>
                    <td className="px-8 py-6 text-sm text-slate-500">{item.description || '—'}</td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleCategoryEdit(item)}
                          className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded-xl text-slate-600 hover:text-brand-600"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCategoryDelete(item)}
                          className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded-xl text-slate-600 hover:text-rose-500"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredCategories.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-8 py-10 text-center text-slate-400 text-sm">
                      {t('cashbook.noCategories')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activePanel === 'transaction' && (
        <div className="space-y-8">
          {categories.length === 0 && (
            <p className="text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl px-6 py-4 text-sm font-medium">
              {t('cashbook.createCategoryFirst')}
            </p>
          )}

          <form
            onSubmit={handleTransactionSubmit}
            className="bg-white dark:bg-slate-900 rounded-[32px] border border-slate-100 dark:border-slate-800 shadow-sm p-8 space-y-6"
          >
            <h2 className="text-lg font-black uppercase tracking-wide text-slate-800 dark:text-white">
              {editingEntry ? t('cashbook.editTransaction') : t('cashbook.newTransaction')}
            </h2>

            {isSelectedCycleLocked && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 text-xs">
                <Lock className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" size={18} />
                <div className="space-y-1">
                  <span className="font-black text-amber-800 dark:text-amber-300 uppercase tracking-wide block">
                    {t('cashbook.cycleLocked')}: {selectedCycleKey} ({cycleShortLabel(selectedCycleKey)})
                  </span>
                  <p className="text-slate-600 dark:text-slate-300">
                    {t('cashbook.cycleLockedWarning')}
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 mb-1">{t('common.type')}</label>
                <select
                  value={transactionForm.type}
                  onChange={(e) => {
                    const newType = e.target.value;
                    const newDir = newType === 'Expense' ? 'sender' : 'receiver';
                    applyTypeAndDirection(newType, newDir);
                  }}
                  className={`w-full px-4 py-3 rounded-xl border text-sm font-black uppercase tracking-wide outline-none ${
                    transactionForm.type === 'Income'
                      ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                      : 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300'
                  }`}
                >
                  <option value="Income">{tv('Income')}</option>
                  <option value="Expense">{tv('Expense')}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 mb-1">{t('common.category')}</label>
                <select
                  required
                  value={transactionForm.categoryId}
                  onChange={(e) => setTransactionForm({ ...transactionForm, categoryId: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="">
                    {categoriesForType.length === 0
                      ? t('cashbook.noTypeCategories', { type: tv(transactionForm.type) })
                      : t('cashbook.selectTypeCategory', { type: tv(transactionForm.type) })}
                  </option>
                  {categoriesForType.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 mb-1">{t('common.method')}</label>
                <select
                  value={transactionForm.method}
                  onChange={(e) => setTransactionForm({ ...transactionForm, method: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {tv(m)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 mb-1">{t('cashbook.instituteWallet')}</label>
                <select
                  value={transactionForm.walletId}
                  onChange={(e) => {
                    const nextWalletId = e.target.value;
                    applyTypeAndDirection(transactionForm.type, walletDirection, nextWalletId);
                  }}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="">{t('cashbook.autoWallet')}</option>
                  {wallets.map((w) => (
                    <option key={w._id} value={w._id}>
                      {w.name}{w.accountNumber ? ` · ${w.accountNumber}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 mb-1">{t('common.date')}</label>
                <input
                  type="date"
                  value={transactionForm.date}
                  onChange={(e) => setTransactionForm({ ...transactionForm, date: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            {/* Wallet Direction / Role Selector */}
            <div className="p-4 rounded-2xl bg-slate-50/80 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <ArrowLeftRight size={14} className="text-brand-500" />
                    {t('cashbook.direction')}
                  </span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {transactionForm.type === 'Expense'
                      ? t('cashbook.directionExpense')
                      : t('cashbook.directionIncome')}
                  </p>
                </div>
                {selectedWallet && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300 border border-brand-200 dark:border-brand-800/50 self-start sm:self-auto">
                    <Wallet size={12} />
                    {selectedWallet.name}{selectedWallet.accountNumber ? ` · ${selectedWallet.accountNumber}` : ''}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* 1. Wallet as Sender */}
                <button
                  type="button"
                  onClick={() => handleDirectionChange('sender')}
                  className={`px-4 py-2.5 rounded-xl border text-xs font-black uppercase tracking-wide flex items-center justify-center gap-2 transition-all ${
                    walletDirection === 'sender'
                      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-500 text-rose-600 dark:text-rose-300 shadow-sm ring-2 ring-rose-500/20'
                      : 'bg-slate-100/70 dark:bg-slate-800 border-transparent text-slate-600 dark:text-slate-400 hover:bg-rose-50/50 dark:hover:bg-rose-950/20'
                  }`}
                >
                  <ArrowUpRight size={14} className={walletDirection === 'sender' ? 'text-rose-600' : 'text-slate-400'} />
                  {t('cashbook.walletSender')}
                </button>

                {/* 2. Wallet as Receiver */}
                <button
                  type="button"
                  onClick={() => handleDirectionChange('receiver')}
                  className={`px-4 py-2.5 rounded-xl border text-xs font-black uppercase tracking-wide flex items-center justify-center gap-2 transition-all ${
                    walletDirection === 'receiver'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-600 dark:text-emerald-300 shadow-sm ring-2 ring-emerald-500/20'
                      : 'bg-slate-100/70 dark:bg-slate-800 border-transparent text-slate-600 dark:text-slate-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20'
                  }`}
                >
                  <ArrowDownLeft size={14} className={walletDirection === 'receiver' ? 'text-emerald-600' : 'text-slate-400'} />
                  {t('cashbook.walletReceiver')}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">
                      {walletDirection === 'sender' ? t('cashbook.senderInstitute') : t('cashbook.payerSender')}
                    </p>
                    {walletDirection === 'sender' ? (
                      <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-2 py-0.5 rounded-full border border-rose-200 dark:border-rose-800">
                        {t('cashbook.walletAssigned')}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleDirectionChange('sender')}
                        className="text-[10px] font-bold text-slate-500 hover:text-brand-600 dark:text-slate-400 hover:underline"
                      >
                        + {t('cashbook.setSender')}
                      </button>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase text-slate-500 mb-1">
                      {walletDirection === 'sender' ? t('cashbook.instituteAccountNumber') : t('cashbook.payerPhone')}
                    </label>
                    <input
                      type="text"
                      readOnly={walletDirection === 'sender'}
                      list={walletDirection === 'sender' ? undefined : 'payer-phone-options'}
                      autoComplete="off"
                      value={transactionForm.senderPhone}
                      onChange={(e) => {
                        setSenderLocked(false);
                        setPayerInfo(null);
                        setTransactionForm({
                          ...transactionForm,
                          senderPhone: e.target.value,
                          senderEntityType: '',
                          senderEntityId: ''
                        });
                      }}
                      placeholder={walletDirection === 'sender' ? '' : transactionForm.method === 'Bank' ? t('cashbook.payerBankPlaceholder') : t('cashbook.payerMobilePlaceholder')}
                      className={`w-full px-4 py-3 rounded-xl border text-slate-900 dark:text-white ${
                        walletDirection === 'sender'
                          ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 font-mono'
                          : senderPhoneErr
                          ? 'bg-slate-50 dark:bg-slate-800 border-rose-500 dark:border-rose-500 focus:ring-2 focus:ring-rose-500'
                          : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                      }`}
                    />
                    {walletDirection !== 'sender' && (
                      <datalist id="payer-phone-options">
                        {payerOptions.map((o) => (
                          <option key={o.phone} value={o.phone}>
                            {o.name ? `${o.name} — ${o.phone}` : o.phone}
                          </option>
                        ))}
                      </datalist>
                    )}
                    {walletDirection === 'sender' ? (
                      <p className="text-[10px] text-rose-600 dark:text-rose-400 mt-1 font-semibold">
                        {t('cashbook.walletIsSender')}
                      </p>
                    ) : senderPhoneErr ? (
                      <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1 font-bold">{senderPhoneErr}</p>
                    ) : (
                      <p className="text-[10px] text-slate-400 mt-1">{phoneHint}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase text-slate-500 mb-1">
                      {walletDirection === 'sender' ? t('cashbook.instituteAccountName') : t('cashbook.payerName')}
                    </label>
                    <input
                      type="text"
                      readOnly={senderLocked || walletDirection === 'sender'}
                      value={transactionForm.senderName}
                      onChange={(e) =>
                        setTransactionForm({
                          ...transactionForm,
                          senderName: e.target.value,
                          senderEntityType: 'manual',
                          senderEntityId: ''
                        })
                      }
                      placeholder={senderLocked || walletDirection === 'sender' ? '' : t('cashbook.typeName')}
                      className={`w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 ${
                        walletDirection === 'sender'
                          ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-900 dark:text-rose-100'
                          : senderLocked
                          ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white'
                      }`}
                    />
                    {senderLocked && walletDirection !== 'sender' && (
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1 font-semibold">
                        {t('cashbook.matched')}
                      </p>
                    )}
                  </div>
                </div>

                {showReceiverFields && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">
                      {walletDirection === 'receiver' ? t('cashbook.receiverInstitute') : t('cashbook.receiverOther')}
                    </p>
                    {walletDirection === 'receiver' ? (
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                        {t('cashbook.walletAssigned')}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleDirectionChange('receiver')}
                        className="text-[10px] font-bold text-slate-500 hover:text-brand-600 dark:text-slate-400 hover:underline"
                      >
                        + {t('cashbook.setReceiver')}
                      </button>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase text-slate-500 mb-1">
                      {walletDirection === 'receiver' ? t('cashbook.instituteAccountNumber') : t('cashbook.phoneOrAccount')}
                    </label>
                    <input
                      type="text"
                      readOnly={walletDirection === 'receiver'}
                      list={walletDirection === 'receiver' ? undefined : 'payer-phone-options'}
                      autoComplete="off"
                      value={transactionForm.receiverPhone}
                      onChange={(e) => {
                        setReceiverLocked(false);
                        setTransactionForm({
                          ...transactionForm,
                          receiverPhone: e.target.value,
                          receiverEntityType: '',
                          receiverEntityId: ''
                        });
                      }}
                      placeholder={walletDirection === 'receiver' ? '' : transactionForm.method === 'Bank' ? t('cashbook.bankNumberPlaceholder') : t('cashbook.mobileNumberPlaceholder')}
                      className={`w-full px-4 py-3 rounded-xl border text-slate-900 dark:text-white ${
                        walletDirection === 'receiver'
                          ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 font-mono'
                          : receiverPhoneErr
                          ? 'bg-slate-50 dark:bg-slate-800 border-rose-500 dark:border-rose-500 focus:ring-2 focus:ring-rose-500'
                          : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                      }`}
                    />
                    {walletDirection === 'receiver' ? (
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1 font-semibold">
                        {t('cashbook.walletIsReceiver')}
                      </p>
                    ) : receiverPhoneErr ? (
                      <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1 font-bold">{receiverPhoneErr}</p>
                    ) : (
                      <p className="text-[10px] text-slate-400 mt-1">{phoneHint}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase text-slate-500 mb-1">
                      {walletDirection === 'receiver' ? t('cashbook.instituteAccountName') : t('common.name')}
                    </label>
                    <input
                      type="text"
                      readOnly={receiverLocked || walletDirection === 'receiver'}
                      value={transactionForm.receiverName}
                      onChange={(e) =>
                        setTransactionForm({
                          ...transactionForm,
                          receiverName: e.target.value,
                          receiverEntityType: 'manual',
                          receiverEntityId: ''
                        })
                      }
                      placeholder={receiverLocked || walletDirection === 'receiver' ? '' : t('cashbook.typeName')}
                      className={`w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 ${
                        walletDirection === 'receiver' || receiverLocked
                          ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white'
                      }`}
                    />
                    {receiverLocked && walletDirection !== 'receiver' && (
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1 font-semibold">
                        {t('cashbook.matchedTeacher')}
                      </p>
                    )}
                  </div>
                </div>
                )}
              </div>

            {/* Target Billing Cycle — available for all transactions */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-black uppercase text-slate-500">
                  {t('cashbook.targetMonth')}
                </label>
                {(transactionForm.targetMonth || currentMonthStr) > currentMonthStr ? (
                  <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                    {t('cashbook.advance')}
                  </span>
                ) : (transactionForm.targetMonth || currentMonthStr) < currentMonthStr ? (
                  <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800">
                    {t('cashbook.arrearsTag')}
                  </span>
                ) : (
                  <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                    {t('cashbook.currentMonth')}
                  </span>
                )}
              </div>
              <select
                value={transactionForm.targetMonth || currentMonthStr}
                onChange={(e) => handleTargetMonthChange(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-bold"
              >
                {monthOptions.map((opt) => {
                  let extra = '';
                  if (payerInfo && payerInfo.kind === 'responsible') {
                    if (opt.value < currentMonthStr) {
                      const arr = payerInfo.arrears?.find((a) => a.month === opt.value);
                      extra = arr ? ` · ${t('cashbook.arrearsTag')}: ${fmtMoney(arr.balance)}` : ` · ${t('cashbook.fullyPaid')}`;
                    } else if (opt.value === currentMonthStr) {
                      extra = ` · ${t('cashbook.currentMonth')}: ${fmtMoney(payerInfo.totalBalance)}`;
                    } else {
                      extra = ` · ${t('cashbook.advance')}: ${fmtMoney(payerInfo.totalMonthlyFee)}`;
                    }
                  }
                  return (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}{extra}
                    </option>
                  );
                })}
              </select>
              <p className="text-[10px] text-slate-400 mt-1">
                {t('cashbook.targetMonthHint')}
              </p>
            </div>

            {transactionForm.targetMonth && transactionForm.targetMonth < currentMonthStr && (() => {
              const [y, m] = transactionForm.targetMonth.split('-').map(Number);
              const mName = monthNames()[m - 1];
              const curObj = getPayerMonthLabel(currentMonthStr, 0);
              const isPayingTotal = payerInfo?.previousBalance && Number(transactionForm.amount) >= Number(payerInfo.totalDue ?? (payerInfo.totalBalance + payerInfo.previousBalance));
              return (
                <div className="flex items-center justify-between p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                    <span className="font-bold text-rose-700 dark:text-rose-300">
                      {isPayingTotal
                        ? (language === 'so'
                            ? `Bixinta Wadarta Deynta: ${fmtMoney(payerInfo.previousBalance)} (Deyntii ${mName} ${y}) + ${fmtMoney(payerInfo.totalBalance)} (Bishan ${curObj.name})`
                            : `Paying total owed: ${fmtMoney(payerInfo.previousBalance)} (Arrears ${mName} ${y}) + ${fmtMoney(payerInfo.totalBalance)} (Current ${curObj.name})`)
                        : t('cashbook.payingArrearsBanner', { month: mName, year: y })}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleTargetMonthChange(currentMonthStr)}
                    className="text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:text-rose-600 underline"
                  >
                    {t('cashbook.switchToCurrentMonth', { month: `${curObj.name} ${curObj.year}` })}
                  </button>
                </div>
              );
            })()}


            {/* Quick Action buttons for Responsible Payers */}
            {payerInfo && payerInfo.kind === 'responsible' && (Number(payerInfo.previousBalance || 0) > 0 || Number(payerInfo.totalBalance || 0) > 0) && (() => {
              const oldest = payerInfo.arrears?.[0]?.month || currentMonthStr;
              const totalOwed = Number(payerInfo.totalDue ?? (Number(payerInfo.totalBalance || 0) + Number(payerInfo.previousBalance || 0)));
              return (
                <div className="flex flex-wrap gap-2 pt-1">
                  {Number(payerInfo.previousBalance || 0) > 0 && totalOwed > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setTransactionForm((prev) => ({
                          ...prev,
                          amount: totalOwed,
                          targetMonth: oldest
                        }));
                      }}
                      className="px-3.5 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-[11px] font-black uppercase tracking-wider shadow-sm flex items-center gap-1.5 transition-all"
                    >
                      <AlertCircle size={13} />
                      {t('cashbook.payTotalDue', { amount: fmtMoney(totalOwed) })}
                    </button>
                  )}
                  {Number(payerInfo.previousBalance || 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setTransactionForm((prev) => ({
                          ...prev,
                          amount: payerInfo.previousBalance,
                          targetMonth: oldest
                        }));
                      }}
                      className="px-3.5 py-2 rounded-xl bg-rose-100 hover:bg-rose-200 text-rose-800 dark:bg-rose-950/60 dark:hover:bg-rose-900/80 dark:text-rose-200 border border-rose-300 dark:border-rose-800 text-[11px] font-black uppercase tracking-wider transition-all"
                    >
                      {t('cashbook.payArrears', { amount: fmtMoney(payerInfo.previousBalance) })}
                    </button>
                  )}
                  {Number(payerInfo.totalBalance || 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setTransactionForm((prev) => ({
                          ...prev,
                          amount: payerInfo.totalBalance,
                          targetMonth: currentMonthStr
                        }));
                      }}
                      className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-black uppercase tracking-wider shadow-sm transition-all"
                    >
                      {t('cashbook.payFull', { amount: fmtMoney(payerInfo.totalBalance) })}
                    </button>
                  )}
                  {Number(transactionForm.amount || 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => setTransactionForm((prev) => ({ ...prev, amount: '' }))}
                      className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-500 text-[11px] font-black uppercase tracking-wider hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                    >
                      {t('cashbook.clearAmount')}
                    </button>
                  )}
                </div>
              );
            })()}

            <div>
              <label className="block text-xs font-black uppercase text-slate-500 mb-1">{t('common.amount')}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                max={maxPayable !== null ? maxPayable : undefined}
                value={transactionForm.amount}
                onChange={(e) => setTransactionForm({ ...transactionForm, amount: e.target.value })}
                placeholder="0.00"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-lg font-black"
              />
              {payerInfo && payerInfo.kind === 'responsible' && maxPayable !== null && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 font-semibold">
                  {Number(payerInfo.previousBalance || 0) > 0 ? (
                    <>
                      {t('cashbook.totalDueAll')}: <span className="font-black text-rose-600 dark:text-rose-400">{fmtMoney(payerTotalOutstanding)}</span>
                      {' '}({t('cashbook.previousArrearsTotal')}: {fmtMoney(payerInfo.previousBalance)} + {t('cashbook.currentMonth')}: {fmtMoney(payerInfo.totalBalance)})
                    </>
                  ) : (
                    t('cashbook.maxPayable', { count: monthsToPay, amount: fmtMoney(maxPayable) })
                  )}
                </p>
              )}
            </div>

            {payerInfo && payerInfo.kind === 'staff' && (
              <div className="rounded-2xl border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/30 p-5 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-brand-400">
                    {t('cashbook.personRecord')} · {payerInfo.role ? tv(payerInfo.role) : t('cashbook.teacherOrStaff')}
                  </p>
                  <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                    (transactionForm.targetMonth || payerInfo.month) > currentMonthStr
                      ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                      : 'bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300'
                  }`}>
                    {t('common.month')}: {transactionForm.targetMonth || payerInfo.month} {(transactionForm.targetMonth || payerInfo.month) > currentMonthStr ? `· ${t('cashbook.advance')}` : ''}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-[10px] font-black uppercase text-slate-400">{t('cashbook.monthSalary')}</p>
                    <p className="text-xl font-black text-brand-600 dark:text-brand-300">{fmtMoney(payerInfo.salary)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase text-slate-400">{t('cashbook.alreadyPaid', { month: transactionForm.targetMonth || payerInfo.month })}</p>
                    <p className="text-xl font-black text-emerald-600 dark:text-emerald-400">{fmtMoney(payerInfo.totalPaid)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase text-slate-400">{t('cashbook.remainingNow')}</p>
                    <p className={`text-xl font-black ${Number(payerInfo.remainingBalance ?? payerInfo.totalBalance) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {Number(payerInfo.remainingBalance ?? payerInfo.totalBalance) > 0 ? fmtMoney(payerInfo.remainingBalance ?? payerInfo.totalBalance) : t('cashbook.fullyPaid')}
                    </p>
                  </div>
                </div>

                {payerInfo.totalBalance === 0 && Number(payerInfo.salary || 0) > 0 && (transactionForm.targetMonth || payerInfo.month) <= currentMonthStr && (
                  <div className="pt-3 border-t border-brand-200/70 dark:border-brand-800/70 flex items-center justify-between flex-wrap gap-2">
                    <p className="text-xs text-brand-700 dark:text-brand-300 font-semibold">
                      {t('cashbook.currentPaidAskAdvance')}
                    </p>
                    {monthOptions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleTargetMonthChange(monthOptions[1].value)}
                        className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-black tracking-wide shadow-sm"
                      >
                        + {t('cashbook.advanceNextMonth')} ({monthOptions[1].monthName} · {fmtMoney(payerInfo.salary)})
                      </button>
                    )}
                  </div>
                )}

                {payerInfo.lastSalary && (
                  <div className="pt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
                    <span>{t('cashbook.lastSalary')}:</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300">
                      {fmtMoney(payerInfo.lastSalary.amount)} ({payerInfo.lastSalary.month}) · {tv(payerInfo.lastSalary.status)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {payerInfo && (payerInfo.kind === 'account' || payerInfo.kind === 'contact') && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-5 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    {t('cashbook.accountRecord')} · {payerInfo.name}
                  </p>
                  <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                    (transactionForm.targetMonth || payerInfo.month) > currentMonthStr
                      ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                  }`}>
                    {t('common.month')}: {transactionForm.targetMonth || payerInfo.month} {(transactionForm.targetMonth || payerInfo.month) > currentMonthStr ? `· ${t('cashbook.advance')}` : ''}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-[10px] font-black uppercase text-slate-400">{t('cashbook.totalBalance')}</p>
                    <p className="text-xl font-black text-slate-700 dark:text-slate-200">{fmtMoney(payerInfo.baseBalance ?? payerInfo.totalBalance)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase text-slate-400">{t('cashbook.alreadyPaid', { month: transactionForm.targetMonth || payerInfo.month })}</p>
                    <p className="text-xl font-black text-emerald-600 dark:text-emerald-400">{fmtMoney(payerInfo.paidThisMonth || 0)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase text-slate-400">{t('cashbook.remainingNow')}</p>
                    <p className={`text-xl font-black ${Number(payerInfo.remainingBalance ?? payerInfo.totalBalance) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {Number(payerInfo.remainingBalance ?? payerInfo.totalBalance) > 0 ? fmtMoney(payerInfo.remainingBalance ?? payerInfo.totalBalance) : t('cashbook.fullyPaid')}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {payerInfo && payerInfo.kind === 'responsible' && payerInfo.count > 0 && (() => {
              const entered = Number(transactionForm.amount) || 0;
              const isTargetPast = transactionForm.targetMonth && transactionForm.targetMonth < currentMonthStr;
              const targetArr = isTargetPast ? payerInfo.arrears?.find((a) => a.month === transactionForm.targetMonth) : null;
              const targetFee = isTargetPast ? (targetArr ? targetArr.fee : payerInfo.totalMonthlyFee) : payerInfo.totalMonthlyFee;
              const targetPaid = isTargetPast ? (targetArr ? targetArr.paid : 0) : payerInfo.totalPaid;
              const targetBal = isTargetPast ? (targetArr ? targetArr.balance : 0) : payerInfo.totalBalance;
              const activeCycle = transactionForm.targetMonth || payerInfo.month;
              const remainingAfter = Math.max(0, targetBal - entered);
              const isPartial = entered > 0 && entered < targetBal;

              return (
              <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 p-5">
                <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">
                    {transactionForm.senderName ? `${transactionForm.senderName} · ` : ''}{t('cashbook.responsiblePayer')}
                  </p>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    {t('students.studentCount', { count: payerInfo.count })} · {activeCycle} {isTargetPast ? `(${t('cashbook.arrearsTag')})` : ''}
                  </span>
                </div>

                {/* Money summary — total fee, paid, remaining for the chosen cycle. */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl bg-white/70 dark:bg-slate-900/50 border border-emerald-100 dark:border-emerald-900/50 px-4 py-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{t('cashbook.totalFee')}</p>
                    <p className="text-xl font-black text-slate-800 dark:text-slate-100">{fmtMoney(targetFee)}</p>
                  </div>
                  <div className="rounded-xl bg-white/70 dark:bg-slate-900/50 border border-emerald-100 dark:border-emerald-900/50 px-4 py-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{t('common.paid')} ({activeCycle})</p>
                    <p className="text-xl font-black text-emerald-600 dark:text-emerald-400">{fmtMoney(targetPaid)}</p>
                  </div>
                  <div className="rounded-xl bg-white/70 dark:bg-slate-900/50 border border-emerald-100 dark:border-emerald-900/50 px-4 py-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{t('common.remaining')} ({activeCycle})</p>
                    <p className="text-xl font-black text-rose-600 dark:text-rose-400">{fmtMoney(targetBal)}</p>
                  </div>
                </div>

                {/* Progress bar of paid vs. total fee. */}
                {targetFee > 0 && (
                  <div className="mt-4">
                    <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                      <span>{t('cashbook.collectedAmount', { amount: fmtMoney(targetPaid) })}</span>
                      <span>{Math.round((targetPaid / targetFee) * 100)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${Math.min(100, (targetPaid / targetFee) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}


                {/* Arrears carried over from earlier months — shown alongside, never merged into, the current month. */}
                {Number(payerInfo.previousBalance || 0) > 0 && Array.isArray(payerInfo.arrears) && (
                  <div className="mt-4 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/30 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-[10px] font-black uppercase tracking-widest text-rose-600 dark:text-rose-400">
                        {t('cashbook.previousArrears')}
                      </p>
                      <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                        {t('cashbook.arrearsMonths', { count: payerInfo.arrears.length })}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                      {payerInfo.arrears.map((a) => {
                        const mo = getPayerMonthLabel(a.month, 0);
                        const who = (payerInfo.students || [])
                          .filter((s) => (s.arrears || []).some((x) => x.month === a.month))
                          .map((s) => s.name);
                        const isSelected = transactionForm.targetMonth === a.month;
                        return (
                          <button
                            key={a.month}
                            type="button"
                            onClick={() => {
                              setTransactionForm((prev) => ({
                                ...prev,
                                amount: a.balance,
                                targetMonth: a.month
                              }));
                            }}
                            className={`text-left p-3 rounded-xl border transition-all ${
                              isSelected
                                ? 'bg-rose-100 dark:bg-rose-900/60 border-rose-500 ring-2 ring-rose-500/30'
                                : 'bg-white/80 dark:bg-slate-900/60 border-rose-200 dark:border-rose-900/60 hover:border-rose-400 hover:bg-rose-50/50'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-black text-slate-900 dark:text-white text-xs">{mo.name} {mo.year}</span>
                              <span className="text-sm font-black text-rose-600 dark:text-rose-400">{fmtMoney(a.balance)}</span>
                            </div>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {t('cashbook.fee')}: {fmtMoney(a.fee)} · {t('common.paid')}: {fmtMoney(a.paid)}
                            </p>
                            {payerInfo.count > 1 && who.length > 0 && (
                              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{who.join(', ')}</p>
                            )}
                            <div className="mt-2 flex items-center justify-between pt-1.5 border-t border-rose-100 dark:border-rose-900/40 text-[10px] font-bold text-rose-600 dark:text-rose-400">
                              <span>{isSelected ? `✓ ${t('cashbook.selected')}` : t('cashbook.payThisMonth')}</span>
                              <span className="text-xs">→</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="pt-2 border-t border-rose-200/70 dark:border-rose-900/50 space-y-1 text-xs font-black">
                      <div className="flex justify-between text-rose-700 dark:text-rose-300">
                        <span>{t('cashbook.previousArrearsTotal')}</span>
                        <span>{fmtMoney(payerInfo.previousBalance)}</span>
                      </div>
                      <div className="flex justify-between text-slate-900 dark:text-white">
                        <span>{t('cashbook.totalDueAll')}</span>
                        <span>{fmtMoney(payerInfo.totalDue ?? (Number(payerInfo.totalBalance || 0) + Number(payerInfo.previousBalance || 0)))}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Per-student remaining money table. */}
                {Array.isArray(payerInfo.students) && payerInfo.students.length > 0 && (
                  <div className="mt-4 rounded-xl border border-emerald-100 dark:border-emerald-900/50 overflow-hidden bg-white/70 dark:bg-slate-900/50">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-emerald-100 dark:border-emerald-900/50">
                          <th className="px-4 py-2">{t('common.student')}</th>
                          <th className="px-4 py-2 text-right">{t('cashbook.fee')}</th>
                          <th className="px-4 py-2 text-right">{t('common.paid')}</th>
                          <th className="px-4 py-2 text-right">{t('common.remaining')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-emerald-50 dark:divide-emerald-900/30">
                        {payerInfo.students.map((s) => (
                          <tr key={s.studentId}>
                            <td className="px-4 py-2 font-bold text-slate-800 dark:text-slate-100">{s.name}</td>
                            <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-300">{fmtMoney(s.monthlyFee)}</td>
                            <td className="px-4 py-2 text-right text-emerald-600 dark:text-emerald-400">{fmtMoney(s.totalPaid)}</td>
                            <td className={`px-4 py-2 text-right font-black ${s.balance > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}`}>
                              {fmtMoney(s.balance)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-emerald-200 dark:border-emerald-800 font-black text-slate-900 dark:text-white">
                          <td className="px-4 py-2 uppercase text-[10px] text-slate-500">{t('common.total')}</td>
                          <td className="px-4 py-2 text-right">{fmtMoney(payerInfo.totalMonthlyFee)}</td>
                          <td className="px-4 py-2 text-right text-emerald-600 dark:text-emerald-400">{fmtMoney(payerInfo.totalPaid)}</td>
                          <td className="px-4 py-2 text-right text-rose-600 dark:text-rose-400">{fmtMoney(payerInfo.totalBalance)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {isPartial && (
                  <p className="mt-3 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                    {t('cashbook.partialPayment', { amount: fmtMoney(remainingAfter) })}
                  </p>
                )}

                <div className="flex flex-wrap gap-2 mt-4">
                  {Number(payerInfo.previousBalance || 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const oldest = payerInfo.arrears?.[0]?.month || currentMonthStr;
                        setTransactionForm((prev) => ({
                          ...prev,
                          amount: payerInfo.totalDue ?? (Number(payerInfo.totalBalance || 0) + Number(payerInfo.previousBalance || 0)),
                          targetMonth: oldest
                        }));
                      }}
                      className="px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-[11px] font-black uppercase tracking-wider shadow-sm flex items-center gap-1.5"
                    >
                      <AlertCircle size={13} />
                      {t('cashbook.payTotalDue', {
                        amount: fmtMoney(payerInfo.totalDue ?? (Number(payerInfo.totalBalance || 0) + Number(payerInfo.previousBalance || 0)))
                      })}
                    </button>
                  )}
                  {Number(payerInfo.previousBalance || 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const oldest = payerInfo.arrears?.[0]?.month || currentMonthStr;
                        setTransactionForm((prev) => ({
                          ...prev,
                          amount: payerInfo.previousBalance,
                          targetMonth: oldest
                        }));
                      }}
                      className="px-4 py-2 rounded-xl bg-rose-100 hover:bg-rose-200 text-rose-800 dark:bg-rose-950/60 dark:hover:bg-rose-900/80 dark:text-rose-200 border border-rose-300 dark:border-rose-800 text-[11px] font-black uppercase tracking-wider"
                    >
                      {t('cashbook.payArrears', { amount: fmtMoney(payerInfo.previousBalance) })}
                    </button>
                  )}
                  {payerInfo.totalBalance > 0 && (
                    <button
                      type="button"
                      onClick={() => setTransactionForm((prev) => ({ ...prev, amount: payerInfo.totalBalance, targetMonth: currentMonthStr }))}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-black uppercase tracking-wider"
                    >
                      {t('cashbook.payFull', { amount: fmtMoney(payerInfo.totalBalance) })}
                    </button>
                  )}
                  {entered > 0 && (
                    <button
                      type="button"
                      onClick={() => setTransactionForm((prev) => ({ ...prev, amount: '' }))}
                      className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-500 text-[11px] font-black uppercase tracking-wider hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {t('cashbook.clearAmount')}
                    </button>
                  )}
                </div>
              </div>
              );
            })()}

            {/* Backdated Adjustment section */}
            <div className={`p-4 rounded-2xl border transition-all ${
              isSelectedCycleLocked || transactionForm.isBackdated
                ? 'bg-amber-500/5 border-amber-500/30'
                : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700'
            }`}>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-black uppercase text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={transactionForm.isBackdated || isSelectedCycleLocked}
                    disabled={isSelectedCycleLocked}
                    onChange={(e) => setTransactionForm(prev => ({ ...prev, isBackdated: e.target.checked }))}
                    className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-slate-300"
                  />
                  <span className="flex items-center gap-1.5">
                    <Clock size={14} className="text-amber-500" />
                    {t('cashbook.backdatedAdjustment')}
                    {isSelectedCycleLocked && <span className="text-rose-500 font-bold">*</span>}
                  </span>
                </label>
                {isSelectedCycleLocked && (
                  <span className="text-[10px] font-black text-rose-600 dark:text-rose-400 uppercase tracking-wider bg-rose-50 dark:bg-rose-950/60 px-2.5 py-1 rounded-full border border-rose-200 dark:border-rose-800">
                    Wareeggu Wuu Xiran Yahay
                  </span>
                )}
              </div>
              {(transactionForm.isBackdated || isSelectedCycleLocked) && (
                <div className="mt-3">
                  <input
                    type="text"
                    required={isSelectedCycleLocked}
                    value={transactionForm.backdatedReason}
                    onChange={(e) => setTransactionForm(prev => ({ ...prev, backdatedReason: e.target.value }))}
                    placeholder={t('cashbook.backdatedReasonPlaceholder')}
                    className="w-full px-4 py-2.5 rounded-xl border border-amber-300 dark:border-amber-700/60 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-amber-500/30 font-medium"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-black uppercase text-slate-500 mb-1">{t('common.description')}</label>
              <textarea
                rows={2}
                value={transactionForm.description}
                onChange={(e) => setTransactionForm({ ...transactionForm, description: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                placeholder={t('cashbook.notesPlaceholder')}
              />
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={categories.length === 0}
                className="flex items-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-xl font-black text-xs uppercase tracking-wider"
              >
                <Save size={16} /> {editingEntry ? t('cashbook.updateTransaction') : t('cashbook.saveTransaction')}
              </button>
              {editingEntry && (
                <button
                  type="button"
                  onClick={resetTransactionForm}
                  className="flex items-center gap-2 px-6 py-3 border border-slate-200 dark:border-slate-700 rounded-xl font-black text-xs uppercase text-slate-600 dark:text-slate-300"
                >
                  <RotateCcw size={16} /> {t('cashbook.cancelEdit')}
                </button>
              )}
            </div>
          </form>

          <div className="bg-white dark:bg-slate-900 rounded-[28px] border border-slate-100 dark:border-slate-800 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <Search size={16} className="text-slate-400" />
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t('cashbook.filterTransactions')}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">{t('common.type')}</label>
                <select
                  value={filterType}
                  onChange={(e) => {
                    setFilterType(e.target.value);
                    setFilterCategory('All');
                  }}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                >
                  <option value="All">{t('access.logs.allTypes')}</option>
                  <option value="Income">{tv('Income')}</option>
                  <option value="Expense">{tv('Expense')}</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">{t('common.category')}</label>
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                >
                  <option value="All">{t('cashbook.allCategories')}</option>
                  {filterCategoryOptions.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.title} · {tv(c.type)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">{t('cashbook.fromDate')}</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">{t('cashbook.toDate')}</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <button
                type="button"
                onClick={() => {
                  setDateFrom(today);
                  setDateTo(today);
                }}
                className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-[11px] font-black uppercase tracking-wider"
              >
                {t('common.today')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                }}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-[11px] font-black uppercase tracking-wider"
              >
                {t('cashbook.allDates')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setFilterType('All');
                  setFilterCategory('All');
                  setDateFrom('');
                  setDateTo('');
                }}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-[11px] font-black uppercase tracking-wider"
              >
                {t('common.reset')}
              </button>
              <span className="ml-auto text-[11px] font-bold text-slate-400">
                {t('cashbook.results', { count: filteredEntries.length })}
              </span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-[40px] border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-800/30 text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-100 dark:border-slate-800">
                    <th className="px-6 py-5">{t('common.date')}</th>
                    <th className="px-6 py-5">{t('common.category')}</th>
                    <th className="px-6 py-5">{t('common.type')}</th>
                    <th className="px-6 py-5">{t('students.payer')}</th>
                    <th className="px-6 py-5">{t('cashbook.sender')}</th>
                    <th className="px-6 py-5">{t('cashbook.receiver')}</th>
                    <th className="px-6 py-5">{t('common.method')}</th>
                    <th className="px-6 py-5 text-right">{t('common.amount')}</th>
                    <th className="px-6 py-5 text-right">{t('common.remaining')}</th>
                    <th className="px-6 py-5 text-right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredEntries.map((item) => {
                    const cat = item.categoryId;
                    const isIncome = cat?.type === 'Income';
                    return (
                      <tr key={item._id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/10">
                        <td className="px-6 py-5 text-sm text-slate-500 whitespace-nowrap">
                          {item.date ? new Date(item.date).toLocaleDateString(locale) : '—'}
                        </td>
                        <td className="px-6 py-5 text-sm font-bold text-slate-900 dark:text-white">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span>{cat?.title || '—'}</span>
                            {item.isBackdated && (
                              <span
                                title={`${item.backdatedReason ? `Sabab: ${item.backdatedReason}` : ''}${item.adjustedByName ? ` · Saxay: ${item.adjustedByName}` : ''}`}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                              >
                                <Clock size={10} />
                                {t('cashbook.backdatedBadge')}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <span
                            className={`px-3 py-1 text-[10px] font-black uppercase rounded-full ${
                              isIncome
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                            }`}
                          >
                            {tv(cat?.type) || '—'}
                          </span>
                        </td>
                        <td className="px-6 py-5 text-sm font-semibold text-slate-800 dark:text-slate-200">
                          {item.senderName || '—'}
                        </td>
                        <td className="px-6 py-5 text-sm text-slate-500 whitespace-nowrap">{item.senderPhone || '—'}</td>
                        <td className="px-6 py-5 text-sm text-slate-500 whitespace-nowrap">{item.receiverPhone || '—'}</td>
                        <td className="px-6 py-5 text-sm text-slate-500">{tv(item.method)}</td>
                        <td
                          className={`px-6 py-5 text-sm font-black text-right whitespace-nowrap ${
                            isIncome ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {isIncome ? '+' : '−'}{fmtMoney(item.amount)}
                        </td>
                        <td className="px-6 py-5 text-sm font-black text-right whitespace-nowrap">
                          {item.feeRemaining != null ? (
                            <span className={item.feeRemaining > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
                              ${fmtMoney(item.feeRemaining)}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-6 py-5 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleTransactionEdit(item)}
                              className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded-xl text-slate-600 hover:text-brand-600"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleTransactionDelete(item)}
                              className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded-xl text-slate-600 hover:text-rose-500"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredEntries.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-8 py-10 text-center text-slate-400 text-sm">
                        {t('cashbook.noTransactions')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activePanel === 'cycleLocks' && (
        <div className="space-y-8">
          {/* Header stats banner */}
          <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-[32px] p-8 text-white relative overflow-hidden border border-slate-800 shadow-xl">
            <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-3 bg-brand-500/20 rounded-2xl border border-brand-500/30 text-brand-400">
                    <ShieldCheck size={28} />
                  </div>
                  <div>
                    <h2 className="text-xl font-black uppercase tracking-wider">{t('cashbook.cycleLocks')}</h2>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                      {t('cashbook.cycleLockSubtitle')}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                <div className="px-5 py-3 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
                  <span className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-1">
                    {t('cashbook.currentMonth')}
                  </span>
                  <span className="text-base font-black font-mono text-brand-300">
                    {currentMonthStr} ({cycleShortLabel(currentMonthStr)})
                  </span>
                </div>
                <div className="px-5 py-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 backdrop-blur-md">
                  <span className="text-[10px] uppercase font-black tracking-widest text-rose-300 block mb-1">
                    {t('cashbook.cycleLocked')}
                  </span>
                  <span className="text-base font-black font-mono text-rose-400">
                    {cycleLocks.filter(l => l.isLocked).length}
                  </span>
                </div>
                <div className="px-5 py-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 backdrop-blur-md">
                  <span className="text-[10px] uppercase font-black tracking-widest text-emerald-300 block mb-1">
                    {t('cashbook.cycleUnlocked')}
                  </span>
                  <span className="text-base font-black font-mono text-emerald-400">
                    {monthOptions.length - cycleLocks.filter(l => l.isLocked).length}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Cycle Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {monthOptions.map((opt) => {
              const lock = cycleLocks.find((l) => l.cycleKey === opt.value);
              const isLocked = Boolean(lock?.isLocked);
              const isCurrent = opt.value === currentMonthStr;

              return (
                <div
                  key={opt.value}
                  className={`rounded-[28px] border transition-all p-6 relative flex flex-col justify-between ${
                    isLocked
                      ? 'bg-white dark:bg-slate-900 border-rose-200 dark:border-rose-900/60 shadow-sm'
                      : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 shadow-sm hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-black text-slate-900 dark:text-white">
                            {opt.monthName} {opt.year}
                          </h3>
                          {isCurrent && (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-brand-50 dark:bg-brand-950/60 text-brand-600 dark:text-brand-300 border border-brand-200 dark:border-brand-800">
                              {t('cashbook.currentMonth')}
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-mono font-bold text-slate-400 block mt-1">
                          {cycleShortLabel(opt.value)} ({opt.value})
                        </span>
                      </div>

                      <span
                        className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 ${
                          isLocked
                            ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                            : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                        }`}
                      >
                        {isLocked ? <Lock size={12} /> : <Unlock size={12} />}
                        {isLocked ? t('cashbook.cycleLocked') : t('cashbook.cycleUnlocked')}
                      </span>
                    </div>

                    {/* Status details */}
                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 text-xs space-y-1.5 mb-5">
                      {isLocked ? (
                        <>
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span className="font-bold text-[10px] uppercase text-slate-400">{t('cashbook.lockedBy')}:</span>
                            <span className="font-bold">{lock.lockedByName || 'Admin'}</span>
                          </div>
                          {lock.lockedAt && (
                            <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                              <span className="font-bold text-[10px] uppercase text-slate-400">{t('cashbook.lockedAt')}:</span>
                              <span className="font-mono text-[11px]">{new Date(lock.lockedAt).toLocaleDateString(locale)}</span>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-slate-500 dark:text-slate-400 text-xs">
                          Wareeggan waa furan yahay. Isticmaalayaashu waxay geli karaan macaamilada caadiga ah.
                        </div>
                      )}

                      {lock?.unlockHistory?.length > 0 && (
                        <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-700/60 flex items-center justify-between text-[11px]">
                          <span className="text-slate-400 font-bold flex items-center gap-1">
                            <History size={12} /> {t('cashbook.unlockHistory')}:
                          </span>
                          <span className="font-bold text-amber-600 dark:text-amber-400">
                            {lock.unlockHistory.length}x la furay
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    {isLocked ? (
                      <button
                        type="button"
                        onClick={() => handleOpenUnlockModal(opt.value)}
                        className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                      >
                        <Unlock size={14} />
                        {t('cashbook.unlockCycle')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleLockCycle(opt.value)}
                        className="flex-1 py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                      >
                        <Lock size={14} />
                        {t('cashbook.lockCycle')}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleOpenAdjustments(opt.value)}
                      className="py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
                      title={t('cashbook.viewAdjustments')}
                    >
                      <Search size={14} />
                      {t('cashbook.viewAdjustments')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activePanel === 'trash' && (
        <div className="space-y-8 animate-in fade-in duration-300">
          {/* Header Card */}
          <div className="bg-gradient-to-r from-slate-900 via-rose-950 to-slate-900 rounded-[32px] p-8 text-white relative overflow-hidden border border-slate-800 shadow-xl">
            <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div className="flex items-center gap-4">
                <div className="p-3.5 bg-rose-500/20 rounded-2xl border border-rose-500/30 text-rose-400">
                  <Trash2 size={28} />
                </div>
                <div>
                  <h2 className="text-xl font-black uppercase tracking-wider">{t('cashbook.deletedTransactions')}</h2>
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                    {t('cashbook.deletedSubtitle')}
                  </p>
                </div>
              </div>

              <div className="px-5 py-3 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
                <span className="text-[10px] uppercase font-black tracking-widest text-slate-400 block mb-0.5">
                  Wadarta la Tirtiray
                </span>
                <span className="text-base font-black font-mono text-rose-300">
                  {deletedEntries.length} Macaamil
                </span>
              </div>
            </div>
          </div>

          {/* Deleted Transactions Table */}
          <div className="bg-white dark:bg-slate-900 rounded-[40px] border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50/50 dark:bg-slate-800/30 text-slate-400 text-[10px] font-black uppercase tracking-widest border-b border-slate-100 dark:border-slate-800">
                    <th className="px-6 py-5">{t('common.date')}</th>
                    <th className="px-6 py-5">{t('common.category')}</th>
                    <th className="px-6 py-5">{t('common.type')}</th>
                    <th className="px-6 py-5">{t('cashbook.sender')}</th>
                    <th className="px-6 py-5">{t('cashbook.receiver')}</th>
                    <th className="px-6 py-5">{t('common.method')}</th>
                    <th className="px-6 py-5 text-right">{t('common.amount')}</th>
                    <th className="px-6 py-5">{t('cashbook.deletedBy')}</th>
                    <th className="px-6 py-5 text-right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {deletedEntries.map((item) => {
                    const cat = item.categoryId;
                    const isIncome = cat?.type === 'Income';

                    return (
                      <tr key={item._id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/10 transition-colors">
                        <td className="px-6 py-5 text-sm text-slate-500 whitespace-nowrap font-mono">
                          {item.date ? new Date(item.date).toLocaleDateString(locale) : '—'}
                        </td>
                        <td className="px-6 py-5 text-sm font-bold text-slate-900 dark:text-white">
                          {cat?.title || '—'}
                        </td>
                        <td className="px-6 py-5">
                          <span
                            className={`px-3 py-1 text-[10px] font-black uppercase rounded-full ${
                              isIncome
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                            }`}
                          >
                            {tv(cat?.type) || '—'}
                          </span>
                        </td>
                        <td className="px-6 py-5 text-sm font-semibold text-slate-800 dark:text-slate-200">
                          {item.senderName || item.payerName || '—'}
                        </td>
                        <td className="px-6 py-5 text-sm text-slate-500 whitespace-nowrap">
                          {item.receiverName || item.receiverPhone || '—'}
                        </td>
                        <td className="px-6 py-5 text-sm text-slate-500">{tv(item.method)}</td>
                        <td
                          className={`px-6 py-5 text-sm font-black text-right whitespace-nowrap font-mono ${
                            isIncome ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {isIncome ? '+' : '−'}{fmtMoney(item.amount)}
                        </td>
                        <td className="px-6 py-5 text-xs text-slate-500 whitespace-nowrap">
                          <div className="space-y-0.5">
                            <span className="font-bold text-slate-800 dark:text-slate-200 block">
                              {item.deletedByName || 'Admin'}
                            </span>
                            {item.deletedAt && (
                              <span className="font-mono text-[10px] text-slate-400 block">
                                {new Date(item.deletedAt).toLocaleString(locale)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-5 text-right whitespace-nowrap">
                          {/* BADHANKA SOO CELI (RESTORE) HORTIISA KU YAAL */}
                          <button
                            type="button"
                            onClick={() => handleTransactionRestore(item)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
                            title={t('cashbook.restore')}
                          >
                            <RotateCcw size={14} />
                            <span>{t('cashbook.restore')}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {deletedEntries.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-8 py-16 text-center text-slate-400 text-sm">
                        <div className="flex flex-col items-center justify-center gap-3">
                          <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                            <Trash2 size={24} />
                          </div>
                          <p className="font-bold text-slate-500 dark:text-slate-400 text-sm">
                            {t('cashbook.noDeletedTransactions')}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Unlock Modal */}
      {unlockModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" onClick={() => !unlockSubmitting && setUnlockModalOpen(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-[32px] border border-slate-100 dark:border-slate-800 p-8 max-w-lg w-full shadow-2xl relative" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-4 mb-5 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Unlock size={22} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-wide">
                    {t('cashbook.unlockCycle')}
                  </h3>
                  <span className="font-mono text-xs font-bold text-slate-400">
                    {cycleToUnlock} ({cycleShortLabel(cycleToUnlock)})
                  </span>
                </div>
              </div>
              <button
                onClick={() => !unlockSubmitting && setUnlockModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-full"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleConfirmUnlock} className="space-y-5">
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                Wareeggan waa xirnaa. Si aad dib ugu furto, waxaad u baahan tahay inaad qorto sabab cad oo audit-ka u diiwaangashan (Audit Trail).
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-600 dark:text-slate-300 mb-2">
                  {t('cashbook.unlockReason')} <span className="text-rose-500">*</span>
                </label>
                <textarea
                  required
                  rows={4}
                  value={unlockReason}
                  onChange={(e) => setUnlockReason(e.target.value)}
                  placeholder={t('cashbook.unlockReasonPlaceholder')}
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={unlockSubmitting}
                  onClick={() => setUnlockModalOpen(false)}
                  className="px-6 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-black text-xs uppercase"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={unlockSubmitting || !unlockReason.trim()}
                  className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase shadow-md transition-all flex items-center gap-2"
                >
                  <Unlock size={14} />
                  {unlockSubmitting ? 'Furayaa…' : t('cashbook.unlockCycle')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjustments & Opening Balance Audit Modal */}
      {adjustmentsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" onClick={() => setAdjustmentsModalOpen(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-[32px] border border-slate-100 dark:border-slate-800 p-8 max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl relative" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-4 mb-5 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-brand-500/10 text-brand-600 dark:text-brand-400">
                  <Clock size={22} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-wide">
                    {t('cashbook.adjustmentsTitle')}
                  </h3>
                  <span className="font-mono text-xs font-bold text-slate-400">
                    {cycleForAdjustments} ({cycleShortLabel(cycleForAdjustments)})
                  </span>
                </div>
              </div>
              <button
                onClick={() => setAdjustmentsModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-full"
              >
                <X size={20} />
              </button>
            </div>

            {adjustmentsLoading ? (
              <div className="py-12 text-center text-slate-400 font-bold text-sm">
                {t('cashbook.loading')}
              </div>
            ) : adjustmentsData ? (
              <div className="space-y-6">
                {/* Net impact on Opening Balance */}
                <div className="p-5 rounded-2xl bg-gradient-to-tr from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block">
                      {t('cashbook.openingBalanceImpact')}
                    </span>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Saamaynta macaamilada dib-u-dhaca ah ee taariikhdoodu ka horreyso bilowga wareeggan ({adjustmentsData.cycleStart})
                    </p>
                  </div>
                  <div className={`text-2xl font-black font-mono shrink-0 ${
                    adjustmentsData.netImpactOnOpeningBalance > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : adjustmentsData.netImpactOnOpeningBalance < 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}>
                    {adjustmentsData.netImpactOnOpeningBalance > 0 ? '+' : ''}${fmtMoney(adjustmentsData.netImpactOnOpeningBalance)}
                  </div>
                </div>

                {/* Section 1: Prior adjustments (affecting opening balance) */}
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    {t('cashbook.priorAdjustmentsSection')} ({adjustmentsData.priorAdjustments?.length || 0})
                  </h4>

                  {adjustmentsData.priorAdjustments?.length > 0 ? (
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-xs">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10px] font-black uppercase text-slate-500">
                          <tr>
                            <th className="p-3">{t('common.date')}</th>
                            <th className="p-3">{t('common.category')}</th>
                            <th className="p-3">{t('common.amount')}</th>
                            <th className="p-3">{t('cashbook.backdatedReason')}</th>
                            <th className="p-3">{t('cashbook.lockedBy')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {adjustmentsData.priorAdjustments.map((adj) => (
                            <tr key={adj._id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                              <td className="p-3 font-mono">{adj.date}</td>
                              <td className="p-3 font-bold">{adj.categoryId?.title || '—'}</td>
                              <td className={`p-3 font-black font-mono ${
                                adj.categoryId?.type === 'Income' ? 'text-emerald-600' : 'text-rose-600'
                              }`}>
                                {adj.categoryId?.type === 'Income' ? '+' : '−'}${fmtMoney(adj.amount)}
                              </td>
                              <td className="p-3 text-slate-600 dark:text-slate-300 max-w-xs">{adj.backdatedReason || '—'}</td>
                              <td className="p-3 text-[11px] text-slate-500">{adj.adjustedByName || adj.createdBy?.fullName || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-xs text-slate-400 italic">
                      {t('cashbook.noAdjustments')}
                    </p>
                  )}
                </div>

                {/* Section 2: Direct cycle adjustments */}
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-brand-500" />
                    {t('cashbook.currentAdjustmentsSection')} ({adjustmentsData.currentCycleAdjustments?.length || 0})
                  </h4>

                  {adjustmentsData.currentCycleAdjustments?.length > 0 ? (
                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-xs">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10px] font-black uppercase text-slate-500">
                          <tr>
                            <th className="p-3">{t('common.date')}</th>
                            <th className="p-3">{t('common.category')}</th>
                            <th className="p-3">{t('common.amount')}</th>
                            <th className="p-3">{t('cashbook.backdatedReason')}</th>
                            <th className="p-3">{t('cashbook.lockedBy')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {adjustmentsData.currentCycleAdjustments.map((adj) => (
                            <tr key={adj._id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                              <td className="p-3 font-mono">{adj.date}</td>
                              <td className="p-3 font-bold">{adj.categoryId?.title || '—'}</td>
                              <td className={`p-3 font-black font-mono ${
                                adj.categoryId?.type === 'Income' ? 'text-emerald-600' : 'text-rose-600'
                              }`}>
                                {adj.categoryId?.type === 'Income' ? '+' : '−'}${fmtMoney(adj.amount)}
                              </td>
                              <td className="p-3 text-slate-600 dark:text-slate-300 max-w-xs">{adj.backdatedReason || '—'}</td>
                              <td className="p-3 text-[11px] text-slate-500">{adj.adjustedByName || adj.createdBy?.fullName || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-xs text-slate-400 italic">
                      {t('cashbook.noAdjustments')}
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setAdjustmentsModalOpen(false)}
                className="px-6 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-black text-xs uppercase"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CashbookManagement;
