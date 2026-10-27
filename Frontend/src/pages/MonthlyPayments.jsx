import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CalendarRange, Search, Phone, ChevronDown, ChevronRight, Wallet, X,
  CheckCircle2, Clock, AlertCircle, Users, ArrowUpRight, DollarSign, Filter, Printer, History
} from 'lucide-react';
import api from '../services/api';
import { useAlert } from '../components/common/alerts/useAlert';
import { cycleShortLabel, cycleLabel, currentCycle } from '../utils/billingCycle';
import { useLanguage } from '../i18n/LanguageContext.jsx';

const fmtMoney = (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Format person names cleanly with proper capitalization and elegant typography.
 */
const formatPersonName = (str) => {
  if (!str || typeof str !== 'string') return '—';
  return str
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
};

/**
 * Monthly payment view.
 *
 * Reads the /cashbook/payers endpoint for a given billing cycle.
 * Supports filtering by payment status:
 *  - 'all': All registered payers
 *  - 'paid': ONLY payers who have actually paid this month (paidAmount > 0)
 *  - 'pending': ONLY payers who have unpaid balance (remaining > 0)
 */
const MonthlyPayments = () => {
  const { showAlert } = useAlert();
  const { t, months: MONTH_NAMES, locale } = useLanguage();
  const relationshipLabel = (value) => t(`academic.guardians.relationships.${value}`, { defaultValue: value });
  const [searchParams, setSearchParams] = useSearchParams();
  const [payers, setPayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [expandedKey, setExpandedKey] = useState(null);

  // Dynamic tenant / institute branding (salaax aldaareyn)
  const [tenantInfo, setTenantInfo] = useState(() => {
    try {
      const cached = localStorage.getItem('tenantBranding');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.name) return { name: parsed.name, subtitle: parsed.systemSubtitle || '' };
      }
    } catch (e) {}
    return { name: 'salaax aldaareyn', subtitle: '' };
  });

  useEffect(() => {
    api.get('/tenants/me').then(({ data }) => {
      if (data?.name) {
        setTenantInfo({
          name: data.name,
          subtitle: data.systemSubtitle || ''
        });
      }
    }).catch(() => {});
  }, []);

  // Status filter: 'all' | 'paid' | 'pending' (from URL or state)
  const initialStatus = searchParams.get('status') || searchParams.get('filter') || 'all';
  const [statusFilter, setStatusFilter] = useState(initialStatus);

  const viewParam = searchParams.get('view');
  const isPreviousDebtView = viewParam === 'previousDebt';

  // Open on the requested URL ?month=YYYY-MM or ?cycle=YYYY-MM or CURRENT 25→24 billing cycle
  const initialMonthParam = searchParams.get('month');
  const initialCycleParam = searchParams.get('cycle');
  const effectiveInitialCycle = (initialMonthParam && /^\d{4}-\d{2}$/.test(initialMonthParam))
    ? initialMonthParam
    : ((initialCycleParam && /^\d{4}-\d{2}$/.test(initialCycleParam))
      ? initialCycleParam
      : currentCycle());
  const [initYear, initMonth] = effectiveInitialCycle.split('-').map(Number);
  const [year, setYear] = useState(initYear);
  const [month, setMonth] = useState(initMonth - 1); // 0-11

  // Sync with URL query parameter when it changes
  useEffect(() => {
    const s = searchParams.get('status') || searchParams.get('filter') || 'all';
    setStatusFilter(s);
    const m = searchParams.get('month') || searchParams.get('cycle');
    if (m && /^\d{4}-\d{2}$/.test(m)) {
      const [y, mon] = m.split('-').map(Number);
      setYear(y);
      setMonth(mon - 1);
    }
  }, [searchParams]);

  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

  // Sync active billing cycle to whole system
  useEffect(() => {
    try {
      if (monthKey && /^\d{4}-\d{2}$/.test(monthKey)) {
        sessionStorage.setItem('active_billing_cycle', monthKey);
      }
    } catch (_) {}
  }, [monthKey]);

  const fetchPayers = async () => {
    try {
      setLoading(true);
      setError(null);
      const targetCycle = searchParams.get('cycle') || monthKey;
      const params = isPreviousDebtView
        ? { view: 'previousDebt', cycle: targetCycle }
        : { month: monthKey, view: viewParam || undefined };
      const { data } = await api.get('/cashbook/payers', { params });
      const rawPayers = Array.isArray(data) ? data : (data?.payers || []);
      const cleanPayers = rawPayers.filter(p => !p.key?.startsWith('cashbook_direct_tuition'));
      setPayers(cleanPayers);
    } catch (err) {
      console.error('Failed to load monthly payments', err);
      const msg = err.response?.data?.message || err.message || t('monthlyPayments.loadFailed');
      setError(msg);
      showAlert({ type: 'danger', title: t('common.error'), message: msg });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayers();
  }, [monthKey, isPreviousDebtView, viewParam, searchParams.get('cycle')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Status filter logic
  const statusFiltered = useMemo(() => {
    if (isPreviousDebtView) {
      // In previous debt view, strictly ONLY payers who have remaining unpaid debt
      return payers.filter((p) => {
        const remaining = Number(p.remaining !== undefined ? p.remaining : (p.totalFee - (p.paidAmount || 0)));
        return remaining > 0 && !p.paid;
      });
    }
    if (statusFilter === 'paid') {
      // ONLY payers who actually paid money for this cycle (paidAmount > 0)
      return payers.filter((p) => Number(p.paidAmount || 0) > 0);
    }
    if (statusFilter === 'pending') {
      // ONLY payers who have an unpaid balance (remaining > 0 or not fully paid)
      return payers.filter((p) => {
        const remaining = Number(p.remaining !== undefined ? p.remaining : (p.totalFee - (p.paidAmount || 0)));
        return remaining > 0 && !p.paid;
      });
    }
    return payers;
  }, [payers, statusFilter, isPreviousDebtView]);

  // Search filter applied on top of status filter
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return statusFiltered;
    const qDigits = q.replace(/\D/g, '');
    return statusFiltered.filter((p) => {
      const nameMatch = (p.name || '').toLowerCase().includes(q);
      const phoneMatch =
        (p.phone || '').toLowerCase().includes(q) ||
        (qDigits && (p.phone || '').replace(/\D/g, '').includes(qDigits));
      const altPhoneMatch =
        (p.alternatePhone || '').toLowerCase().includes(q) ||
        (qDigits && (p.alternatePhone || '').replace(/\D/g, '').includes(qDigits));
      const studentMatch = (p.students || []).some((s) => (s.name || '').toLowerCase().includes(q));
      return nameMatch || phoneMatch || altPhoneMatch || studentMatch;
    });
  }, [statusFiltered, search]);

  // Comprehensive aggregate stats
  const totals = useMemo(() => {
    let expected = 0;
    let collected = 0;
    let pending = 0;
    let paidPayersCount = 0;
    let pendingPayersCount = 0;
    let studentsCount = 0;

    payers.forEach((p) => {
      const fee = Number(p.totalFee || 0);
      const paid = Number(p.paidAmount || 0);
      const rem = Number(p.remaining !== undefined ? p.remaining : Math.max(0, fee - paid));
      expected += fee;
      collected += paid;
      pending += (p.paid ? 0 : rem);
      studentsCount += Number(p.studentCount !== undefined ? p.studentCount : (p.students?.length || 0));

      if (paid > 0) {
        paidPayersCount += 1;
      }
      if (rem > 0 && !p.paid) {
        pendingPayersCount += 1;
      }
    });

    return {
      expected: isPreviousDebtView ? pending : expected,
      collected: isPreviousDebtView ? 0 : collected,
      pending,
      paidPayersCount: isPreviousDebtView ? 0 : paidPayersCount,
      pendingPayersCount: isPreviousDebtView ? payers.length : pendingPayersCount,
      studentsCount
    };
  }, [payers, monthKey, isPreviousDebtView]);

  const years = useMemo(() => {
    const thisYear = new Date().getFullYear();
    return [thisYear - 2, thisYear - 1, thisYear, thisYear + 1];
  }, []);

  const monthOptions = useMemo(() => {
    const opts = [];
    for (const y of [...years].sort((a, b) => b - a)) {
      for (let m = 11; m >= 0; m -= 1) {
        const value = `${y}-${String(m + 1).padStart(2, '0')}`;
        opts.push({
          value,
          label: t('monthlyPayments.cycleOption', { month: MONTH_NAMES[m], year: y, range: cycleShortLabel(value) })
        });
      }
    }
    return opts;
  }, [years, MONTH_NAMES]);

  const handleTabChange = (newStatus) => {
    setStatusFilter(newStatus);
    const nextParams = new URLSearchParams(searchParams);
    if (newStatus === 'all') {
      nextParams.delete('status');
      nextParams.delete('filter');
    } else {
      nextParams.set('status', newStatus);
    }
    setSearchParams(nextParams);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="p-6 lg:p-8 space-y-8 max-w-[1800px] mx-auto animate-in fade-in duration-500 pb-24 print:p-0 print:m-0 print:space-y-0 print:max-w-none print:pb-0">
      {/* Ultra-compact print style - 100% Pure White Paper, No Dark Fills */}
      <style>{`
        @media print {
          @page {
            margin: 4mm 4mm 4mm 4mm !important;
            size: A4 portrait;
          }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body, html, #root {
            background: #ffffff !important;
            color: #000000 !important;
            font-size: 8pt !important;
            font-family: 'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif !important;
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
          }
          .person-name-print {
            font-family: 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif !important;
            font-weight: 800 !important;
            color: #000000 !important;
            text-transform: capitalize !important;
            letter-spacing: -0.01em !important;
          }
          aside, nav, header, footer, .print\\:hidden {
            display: none !important;
          }
          main {
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            background: #ffffff !important;
          }
          .print-header-banner {
            background-color: #ffffff !important;
            color: #000000 !important;
            padding: 2px 0 6px 0 !important;
            margin-bottom: 6px !important;
            border-bottom: 1.5px solid #000000 !important;
          }
          .print-header-banner h1,
          .print-header-banner h2,
          .print-header-banner p,
          .print-header-banner span,
          .print-header-banner div {
            color: #000000 !important;
          }
          .print-compact-table {
            border-collapse: collapse !important;
            width: 100% !important;
            margin: 0 !important;
            background-color: #ffffff !important;
          }
          .print-compact-table th {
            padding: 3px 4px !important;
            font-size: 7.5pt !important;
            background-color: #ffffff !important;
            color: #000000 !important;
            border: 0.5px solid #000000 !important;
            font-weight: 900 !important;
            line-height: 1.1 !important;
            text-transform: uppercase !important;
          }
          .print-compact-table th * {
            color: #000000 !important;
          }
          .print-compact-table td {
            padding: 2px 4px !important;
            font-size: 8pt !important;
            line-height: 1.1 !important;
            border: 0.5px solid #cbd5e1 !important;
            color: #000000 !important;
            background-color: #ffffff !important;
          }
          .print-compact-table td * {
            color: #000000 !important;
          }
          .print-compact-table tr {
            page-break-inside: avoid !important;
            background-color: #ffffff !important;
          }
          .print-summary-row {
            background-color: #ffffff !important;
            color: #000000 !important;
            font-weight: 900 !important;
          }
          .print-summary-row td {
            color: #000000 !important;
            background-color: #ffffff !important;
            border-top: 1.5px solid #000000 !important;
            border-bottom: 1.5px solid #000000 !important;
            border-left: 0.5px solid #000000 !important;
            border-right: 0.5px solid #000000 !important;
            font-weight: 900 !important;
          }
          .print-summary-row td * {
            color: #000000 !important;
            font-weight: 900 !important;
          }
        }
      `}</style>

      {/* Printable Header Banner (Front of paper - pure white, crisp black text) */}
      <div className="hidden print:block print-header-banner">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[11pt] font-black uppercase tracking-tight text-black leading-tight">
              {tenantInfo.name} - {tenantInfo.subtitle && tenantInfo.subtitle !== 'Institute Management' ? tenantInfo.subtitle : t('nav.instituteManagement')}
            </h1>
            <h2 className="text-[8.5pt] font-extrabold text-black uppercase mt-0.5 leading-tight">
              {isPreviousDebtView
                ? (locale === 'so' ? 'DEYNTA WAREEGYADII HORE (PREVIOUS CYCLES DEBT)' : 'PREVIOUS CYCLES DEBT')
                : statusFilter === 'paid'
                ? t('monthlyPayments.print.titlePaid')
                : statusFilter === 'pending'
                ? t('monthlyPayments.print.titlePending')
                : t('monthlyPayments.print.titleAll')}
            </h2>
            <p className="text-[7.5pt] text-black mt-0.5">
              {t('monthlyPayments.print.cycle')}: <span className="font-bold text-black">{cycleLabel(monthKey)}</span> · {t('monthlyPayments.print.printed')}: <span className="text-black">{new Date().toLocaleDateString(locale)} {new Date().toLocaleTimeString(locale || [], { hour: '2-digit', minute: '2-digit' })}</span>
            </p>
          </div>
          <div className="text-right text-[8pt] leading-tight text-black">
            <p className="font-bold text-black">
              {t('monthlyPayments.print.unpaidTotal')}: <span className="font-black text-[9pt]">${fmtMoney(filtered.reduce((sum, p) => sum + Number(p.remaining !== undefined ? p.remaining : Math.max(0, p.totalFee - (p.paidAmount || 0))), 0))}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 px-2 print:hidden">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 bg-slate-900 dark:bg-slate-800 rounded-[24px] flex items-center justify-center text-brand-400 shadow-2xl border border-slate-700 ring-4 ring-brand-400/10 print:hidden">
            <CalendarRange size={32} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight uppercase leading-none md:text-4xl">
              {isPreviousDebtView
                ? (locale === 'so' ? 'Deynta Wareegyadii Hore' : 'Previous Cycles Debt')
                : t('monthlyPayments.title')}
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-xs font-bold mt-2 uppercase tracking-wider flex items-center gap-2 flex-wrap">
              {isPreviousDebtView ? (
                <>
                  <span>{locale === 'so' ? 'Deymaha Nool ee Ka Horreeyay' : 'All Arrears Before'} · {cycleLabel(currentCycle())}</span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 uppercase tracking-widest">
                    <AlertCircle size={11} strokeWidth={2.5} />
                    {locale === 'so' ? 'Deyn Hore oo Nool' : 'Live Previous Debt'}
                  </span>
                </>
              ) : (
                <>
                  <span>{t('monthlyPayments.subtitle')} · {cycleLabel(monthKey)}</span>
                  {monthKey < currentCycle() && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 uppercase tracking-widest">
                      <History size={11} strokeWidth={2.5} />
                      {locale === 'so' ? 'Snapshot Qufulan' : 'Sealed Snapshot'}
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
        </div>

        {/* Action Controls: Period selector + Print Button */}
        <div className="flex flex-wrap items-center gap-3">
          {/* If in previousDebtView, show a switcher back to current monthly view */}
          {isPreviousDebtView && (
            <button
              type="button"
              onClick={() => {
                const nextParams = new URLSearchParams(searchParams);
                nextParams.delete('view');
                nextParams.delete('cycle');
                nextParams.set('month', currentCycle());
                setSearchParams(nextParams);
              }}
              className="flex items-center gap-2 rounded-2xl bg-slate-100 dark:bg-slate-800 px-4 py-3 text-xs font-bold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all print:hidden"
            >
              <span>{locale === 'so' ? '← Eeg Wareegga Hadda' : '← View Current Cycle'}</span>
            </button>
          )}

          {/* Period selector - ALWAYS available so user can pick ANY cycle: mid hore ama mid dambe */}
          <div className="flex items-center gap-3 bg-white dark:bg-slate-900 rounded-2xl px-5 py-3 border border-slate-100 dark:border-slate-800 shadow-sm w-full sm:w-auto print:hidden">
            <label htmlFor="month-select" className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 shrink-0 leading-tight">
              {t('monthlyPayments.cycle')}
            </label>
            <select
              id="month-select"
              value={monthKey}
              onChange={(e) => {
                const [y, m] = e.target.value.split('-');
                setYear(Number(y));
                setMonth(Number(m) - 1);
                const nextParams = new URLSearchParams(searchParams);
                if (isPreviousDebtView) {
                  nextParams.set('cycle', e.target.value);
                  nextParams.delete('month');
                } else {
                  nextParams.set('month', e.target.value);
                }
                setSearchParams(nextParams);
              }}
              className="w-full min-w-0 bg-transparent outline-none text-xs font-bold text-slate-900 dark:text-white cursor-pointer"
            >
              {monthOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Print Button */}
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-2 rounded-2xl bg-brand-600 px-5 py-3 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-brand-600/30 transition-all hover:bg-brand-700 active:scale-95 print:hidden"
            title={t('monthlyPayments.printTitle')}
          >
            <Printer size={16} />
            <span>{t('common.print')}</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 print:hidden">
        {/* Total Expected */}
        <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {t('monthlyPayments.totalDue')}
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
              <DollarSign size={18} />
            </div>
          </div>
          <div className="mt-3 text-2xl font-black text-slate-900 dark:text-white tabular-nums">
            ${fmtMoney(totals.expected)}
          </div>
          <p className="mt-1 text-xs font-medium text-slate-400">
            {t('monthlyPayments.studentsTotal', { count: totals.studentsCount })}
          </p>
        </div>

        {/* Collected */}
        <div 
          onClick={() => handleTabChange('paid')}
          className={`cursor-pointer rounded-3xl border p-5 shadow-sm transition-all hover:-translate-y-0.5 ${
            statusFilter === 'paid'
              ? 'border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-500/20 dark:border-emerald-500 dark:bg-emerald-950/20'
              : 'border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              {t('monthlyPayments.collected')}
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
              <CheckCircle2 size={18} />
            </div>
          </div>
          <div className="mt-3 text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
            ${fmtMoney(totals.collected)}
          </div>
          <p className="mt-1 text-xs font-medium text-slate-400">
            {t('monthlyPayments.paidPeople', { count: totals.paidPayersCount })}
          </p>
        </div>

        {/* Pending */}
        <div 
          onClick={() => handleTabChange('pending')}
          className={`cursor-pointer rounded-3xl border p-5 shadow-sm transition-all hover:-translate-y-0.5 ${
            statusFilter === 'pending'
              ? 'border-rose-500 bg-rose-50/40 ring-2 ring-rose-500/20 dark:border-rose-500 dark:bg-rose-950/20'
              : 'border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
              {t('monthlyPayments.pending')}
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
              <AlertCircle size={18} />
            </div>
          </div>
          <div className="mt-3 text-2xl font-black text-rose-600 dark:text-rose-400 tabular-nums">
            ${fmtMoney(totals.pending)}
          </div>
          <p className="mt-1 text-xs font-medium text-slate-400">
            {t('monthlyPayments.pendingPeople', { count: totals.pendingPayersCount })}
          </p>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 print:hidden">
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto rounded-2xl bg-slate-100/90 p-1.5 dark:bg-slate-800/90 w-fit">
          <button
            onClick={() => handleTabChange('all')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
              statusFilter === 'all'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <span>{t('common.all')}</span>
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-extrabold text-slate-700 dark:bg-slate-600 dark:text-slate-200">
              {payers.length}
            </span>
          </button>

          <button
            onClick={() => handleTabChange('paid')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
              statusFilter === 'paid'
                ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30'
                : 'text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-400'
            }`}
          >
            <CheckCircle2 size={14} />
            <span>{t('monthlyPayments.tabPaid')}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
              statusFilter === 'paid' ? 'bg-white/25 text-white' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
            }`}>
              {totals.paidPayersCount}
            </span>
          </button>

          <button
            onClick={() => handleTabChange('pending')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
              statusFilter === 'pending'
                ? 'bg-rose-600 text-white shadow-sm shadow-rose-600/30'
                : 'text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400'
            }`}
          >
            <AlertCircle size={14} />
            <span>{t('monthlyPayments.tabPending')}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
              statusFilter === 'pending' ? 'bg-white/25 text-white' : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
            }`}>
              {totals.pendingPayersCount}
            </span>
          </button>
        </div>

        {/* Search */}
        <div className="flex items-center bg-white dark:bg-slate-900 rounded-2xl px-4 py-2.5 border border-slate-100 dark:border-slate-800 shadow-sm w-full max-w-md focus-within:ring-2 focus-within:ring-brand-500/20 transition-all">
          <Search size={16} className="text-slate-400 mr-2.5 shrink-0" />
          <input
            type="text"
            placeholder={t('monthlyPayments.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent outline-none text-xs text-slate-900 dark:text-white placeholder:text-slate-400 font-medium"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600 p-1">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-[32px] border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden print:rounded-none print:border-0 print:shadow-none print:m-0 print:p-0">
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full text-left print-compact-table">
            <thead>
              <tr className="bg-slate-50/70 dark:bg-slate-800/40 text-slate-400 text-[10px] font-black uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 print:text-[7.5pt] print:bg-white print:text-black">
                <th className="px-4 py-4 w-10 print:hidden"></th>
                <th className="px-5 py-4 print:px-1.5 print:py-1 print:text-[8pt] print:text-black print:bg-white">{t('monthlyPayments.colPayer')}</th>
                <th className="px-5 py-4 print:px-1.5 print:py-1 print:text-[8pt] print:text-black print:bg-white">{t('monthlyPayments.colPhones')}</th>
                <th className="px-5 py-4 text-center print:px-1.5 print:py-1 print:text-[8pt] print:text-black print:bg-white">{t('nav.students')}</th>
                <th className="px-5 py-4 text-right print:px-1.5 print:py-1 print:text-[8pt] print:text-black print:bg-white">{t('monthlyPayments.colFee')}</th>
                <th className="px-5 py-4 text-right print:px-1.5 print:py-1 print:text-[8pt] print:text-black print:bg-white">{t('monthlyPayments.colPaid')}</th>
                <th className="px-5 py-4 text-right print:px-1.5 print:py-1 print:text-[8pt] print:text-black print:bg-white">{t('monthlyPayments.colRemaining')}</th>
                <th className="px-5 py-4 text-center print:px-1.5 print:py-1 print:text-[8pt] print:text-black print:bg-white">{t('common.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 print:divide-slate-300">
              {filtered.map((p) => {
                const isOpen = expandedKey === p.key;
                const paidAmt = Number(p.paidAmount || 0);
                const feeAmt = Number(p.totalFee || 0);
                const remAmt = Number(p.remaining !== undefined ? p.remaining : Math.max(0, feeAmt - paidAmt));
                const isFullyPaid = p.paid || (feeAmt > 0 && paidAmt >= feeAmt);
                const isPartial = !isFullyPaid && paidAmt > 0;

                return (
                  <React.Fragment key={p.key}>
                    <tr
                      onClick={() => setExpandedKey(isOpen ? null : p.key)}
                      className={`cursor-pointer transition-colors ${
                        isOpen ? 'bg-slate-50 dark:bg-slate-800/30' : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/10'
                      } print:border-b print:border-slate-300`}
                    >
                      <td className="px-4 py-4 text-slate-400 print:hidden">
                        {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </td>
                      <td className="px-5 py-4 text-sm print:px-1.5 print:py-0.5 print:text-[8pt] print:text-black">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-600 to-emerald-500 text-white font-black text-xs flex items-center justify-center shrink-0 shadow-sm print:hidden select-none">
                            {formatPersonName(p.name).charAt(0)}
                          </div>
                          <div className="leading-tight">
                            <span className="font-bold tracking-tight capitalize text-slate-900 dark:text-white print:font-bold print:text-[8.5pt] print:text-black block person-name-print font-sans">
                              {formatPersonName(p.name)}
                            </span>
                            {p.relationship && (
                              <span className="inline-block text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider print:hidden leading-none mt-0.5 font-sans">
                                {relationshipLabel(p.relationship)}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm font-semibold text-slate-600 dark:text-slate-300 print:px-1.5 print:py-0.5 print:text-[8pt] print:text-black">
                        <div className="flex flex-col gap-1.5 print:gap-0 leading-tight">
                          {p.phone ? (
                            <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 print:text-[7.5pt] print:text-black">
                              {p.phone}
                            </span>
                          ) : (
                            <span className="text-slate-400 font-mono text-xs print:text-[7.5pt]">—</span>
                          )}
                          {p.alternatePhone && p.alternatePhone !== p.phone && (
                            <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400 print:text-[7.5pt] print:text-slate-700">
                              {p.alternatePhone}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-center print:px-1.5 print:py-0.5 print:text-[8pt] print:text-black">
                        <span className="px-3 py-1 text-xs font-black rounded-full bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300 print:bg-transparent print:p-0 print:text-black">
                          {p.studentCount}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right text-sm font-bold text-slate-700 dark:text-slate-300 tabular-nums print:px-1.5 print:py-0.5 print:text-[8pt] print:text-black">
                        ${fmtMoney(feeAmt)}
                      </td>
                      <td className="px-5 py-4 text-right text-sm font-black text-emerald-600 dark:text-emerald-400 tabular-nums print:px-1.5 print:py-0.5 print:text-[8pt] print:text-black">
                        ${fmtMoney(paidAmt)}
                      </td>
                      <td className="px-5 py-4 text-right text-sm font-black text-rose-600 dark:text-rose-400 tabular-nums print:px-1.5 print:py-0.5 print:text-[8pt] print:text-black">
                        ${fmtMoney(remAmt)}
                      </td>
                      <td className="px-5 py-4 text-center print:px-1.5 print:py-0.5 print:text-[7.5pt]">
                        {isFullyPaid ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-500/20 dark:bg-emerald-950/40 dark:text-emerald-300 print:border-emerald-700 print:text-emerald-900 print:px-1.5 print:py-0.2 print:text-[7pt]">
                            <CheckCircle2 size={12} className="print:hidden" />
                            <span>{t('monthlyPayments.statusPaid')}</span>
                          </span>
                        ) : isPartial ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-500/20 dark:bg-amber-950/40 dark:text-amber-300 print:border-amber-700 print:text-amber-900 print:px-1.5 print:py-0.2 print:text-[7pt]">
                            <Clock size={12} className="print:hidden" />
                            <span>{t('monthlyPayments.statusPartial')}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-500/20 dark:bg-rose-950/40 dark:text-rose-300 print:border-rose-700 print:text-rose-900 print:px-1.5 print:py-0.2 print:text-[7pt]">
                            <AlertCircle size={12} className="print:hidden" />
                            <span>{t('monthlyPayments.statusUnpaid')}</span>
                          </span>
                        )}
                      </td>
                    </tr>

                    {isOpen && (
                      <tr className="bg-slate-50/70 dark:bg-slate-800/20 print:hidden">
                        <td colSpan={8} className="px-6 pb-6 pt-0">
                          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900 mt-2">
                            <table className="w-full text-left text-sm">
                              <thead>
                                <tr className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                                  <th className="px-5 py-3">{t('students.studentName')}</th>
                                  <th className="px-5 py-3">{t('common.class')}</th>
                                  <th className="px-5 py-3 text-right">{t('monthlyPayments.monthlyFee')}</th>
                                  <th className="px-5 py-3 text-right">{t('common.paid')}</th>
                                  <th className="px-5 py-3 text-right">{t('common.remaining')}</th>
                                  <th className="px-5 py-3 text-center">{t('common.status')}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {(p.students || []).map((s) => {
                                  const sPaid = Number(s.paid || 0);
                                  const sFee = Number(s.monthlyFee || 0);
                                  const sRem = Number(s.remaining !== undefined ? s.remaining : Math.max(0, sFee - sPaid));
                                  const sIsPaid = sFee > 0 && sPaid >= sFee;

                                  return (
                                    <tr key={s.studentId}>
                                      <td className="px-5 py-3 font-bold text-slate-800 dark:text-slate-200 capitalize font-sans">{formatPersonName(s.name)}</td>
                                      <td className="px-5 py-3 text-slate-500">{s.className || '—'}</td>
                                      <td className="px-5 py-3 text-right font-bold text-slate-900 dark:text-white tabular-nums">
                                        ${fmtMoney(sFee)}
                                      </td>
                                      <td className="px-5 py-3 text-right font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                                        ${fmtMoney(sPaid)}
                                      </td>
                                      <td className="px-5 py-3 text-right font-black text-rose-600 dark:text-rose-400 tabular-nums">
                                        ${fmtMoney(sRem)}
                                      </td>
                                      <td className="px-5 py-3 text-center">
                                        {sIsPaid ? (
                                          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                                            ✓ {t('monthlyPayments.studentPaid')}
                                          </span>
                                        ) : sPaid > 0 ? (
                                          <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                                            {t('monthlyPayments.studentPartial')}
                                          </span>
                                        ) : (
                                          <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400">
                                            {t('monthlyPayments.studentUnpaid')}
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                                <tr className="bg-slate-50 dark:bg-slate-800/40 font-black">
                                  <td className="px-5 py-3 uppercase text-[11px] text-slate-500" colSpan={2}>{t('monthlyPayments.payerTotal')}</td>
                                  <td className="px-5 py-3 text-right text-slate-900 dark:text-white tabular-nums">
                                    ${fmtMoney(feeAmt)}
                                  </td>
                                  <td className="px-5 py-3 text-right text-emerald-600 dark:text-emerald-400 tabular-nums">
                                    ${fmtMoney(paidAmt)}
                                  </td>
                                  <td className="px-5 py-3 text-right text-rose-600 dark:text-rose-400 tabular-nums">
                                    ${fmtMoney(remAmt)}
                                  </td>
                                  <td></td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {loading && (
                <tr>
                  <td colSpan={8} className="px-8 py-16 text-center text-slate-400 text-sm font-medium">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-slate-500 font-semibold">{t('monthlyPayments.loading')}</span>
                    </div>
                  </td>
                </tr>
              )}

              {!loading && error && (
                <tr>
                  <td colSpan={8} className="px-8 py-12 text-center">
                    <div className="max-w-md mx-auto p-5 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-sm flex flex-col items-center gap-3">
                      <p className="font-semibold">{error}</p>
                      <button
                        onClick={fetchPayers}
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition shadow-sm"
                      >
                        {t('monthlyPayments.retry')}
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {!loading && !error && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-8 py-16 text-center text-slate-500 text-sm">
                    {statusFilter === 'paid' ? (
                      <div className="max-w-md mx-auto flex flex-col items-center gap-2">
                        <CheckCircle2 size={32} className="text-slate-300 dark:text-slate-600" />
                        <p className="font-bold text-slate-700 dark:text-slate-300">
                          {t('monthlyPayments.emptyPaidTitle')}
                        </p>
                        <p className="text-xs text-slate-400">
                          {t('monthlyPayments.emptyPaidMsg', { cycle: cycleLabel(monthKey) })}
                        </p>
                      </div>
                    ) : statusFilter === 'pending' ? (
                      <div className="max-w-md mx-auto flex flex-col items-center gap-2">
                        <CheckCircle2 size={32} className="text-emerald-500" />
                        <p className="font-bold text-slate-700 dark:text-slate-300">
                          {t('monthlyPayments.emptyPendingTitle')}
                        </p>
                        <p className="text-xs text-slate-400">
                          {t('monthlyPayments.emptyPendingMsg')}
                        </p>
                      </div>
                    ) : (
                      <p className="font-semibold">
                        {t('monthlyPayments.emptyAll', { month: MONTH_NAMES[month], year })}
                      </p>
                    )}
                  </td>
                </tr>
              )}

              {/* Screen & Print Table Footer Row */}
              {filtered.length > 0 && (
                <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50/75 dark:bg-slate-800/50 font-black">
                  <td colSpan={4} className="px-5 py-3.5 text-right uppercase text-xs tracking-wider text-slate-500 dark:text-slate-400 print:text-black print:px-1.5 print:py-0.5 print:text-[8pt]">
                    {t('common.total')}:
                  </td>
                  <td className="px-5 py-3.5 text-right text-xs font-black text-slate-900 dark:text-white tabular-nums print:text-black print:px-1.5 print:py-0.5 print:text-[8pt]">
                    ${fmtMoney(filtered.reduce((sum, p) => sum + Number(p.totalFee || 0), 0))}
                  </td>
                  <td className="px-5 py-3.5 text-right text-xs font-black text-emerald-600 dark:text-emerald-400 tabular-nums print:text-black print:px-1.5 print:py-0.5 print:text-[8pt]">
                    ${fmtMoney(filtered.reduce((sum, p) => sum + Number(p.paidAmount || 0), 0))}
                  </td>
                  <td className="px-5 py-3.5 text-right text-xs font-black text-rose-600 dark:text-rose-400 tabular-nums print:text-black print:px-1.5 print:py-0.5 print:text-[8pt]">
                    ${fmtMoney(filtered.reduce((sum, p) => sum + Number(p.remaining !== undefined ? p.remaining : Math.max(0, p.totalFee - (p.paidAmount || 0))), 0))}
                  </td>
                  <td className="px-5 py-3.5 text-center print:hidden"></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Month total footer (Web only, hidden in print) */}
      <div className="bg-white dark:bg-slate-900 rounded-[40px] border border-slate-100 dark:border-slate-800 shadow-sm px-8 py-6 flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400 print:hidden">
            <Wallet size={22} strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
              {t('monthlyPayments.footerCycle', { month: MONTH_NAMES[month], year })} · {cycleLabel(monthKey)}
            </p>
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
              {t('monthlyPayments.filteredCount', { count: filtered.length })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('monthlyPayments.colFee') || t('common.total')}</p>
            <p className="text-2xl font-black text-slate-900 dark:text-white leading-none tabular-nums">
              ${fmtMoney(filtered.reduce((sum, p) => sum + Number(p.totalFee || 0), 0))}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">{t('monthlyPayments.footerCollected')}</p>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 leading-none tabular-nums">
              ${fmtMoney(filtered.reduce((sum, p) => sum + Number(p.paidAmount || 0), 0))}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">{t('monthlyPayments.pending')}</p>
            <p className="text-2xl font-black text-rose-600 dark:text-rose-400 leading-none tabular-nums">
              ${fmtMoney(filtered.reduce((sum, p) => sum + Number(p.remaining !== undefined ? p.remaining : Math.max(0, p.totalFee - (p.paidAmount || 0))), 0))}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MonthlyPayments;
