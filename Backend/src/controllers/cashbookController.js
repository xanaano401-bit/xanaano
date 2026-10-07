const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');
const CashbookCategory = require('../models/CashbookCategory');
const CashbookEntry = require('../models/CashbookEntry');
const Guardian = require('../models/Guardian');
const Student = require('../models/Student');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const Payment = require('../models/Payment');
const Salary = require('../models/Salary');
const { phoneVariants, isValidSomaliMobile, digitsOnly } = require('../utils/somaliPhone');
const {
    cycleKeyForDate, cycleRange, isValidCycleKey, addCycles,
    currentCycle, nextCycle, cycleMatch
} = require('../utils/billingCycle');
const { getStudentFeeForCycle } = require('../utils/studentFee');
const { ensureCycleSnapshot } = require('../services/cycleSnapshotService');
const CycleLock = require('../models/CycleLock');
const { canManageCycleLocks } = require('./cycleLockController');

// The wallet is populated alongside the category so reports can name the
// institute side of a transaction: it is the sender on an expense and the
// receiver on an income.
const populateEntry = [
    { path: 'categoryId', select: 'title type description' },
    { path: 'walletId', select: 'name accountNumber type' },
    { path: 'createdBy', select: 'fullName username role' }
];

// Resolve the wallet an entry should affect: explicit wallet → branch's active wallet → any active wallet.
const resolveWallet = async (walletId, branchId) => {
    let wallet = null;
    if (walletId) wallet = await Wallet.findById(walletId);
    if (!wallet && branchId) wallet = await Wallet.findOne({ branchId, status: 'Active' });
    if (!wallet) wallet = await Wallet.findOne({ status: 'Active' });
    return wallet;
};

// Apply a signed effect to a wallet balance. sign = +1 to apply, -1 to reverse.
// Income raises the balance, Expense lowers it (clamped at 0, mirroring expense/payment flows).
const applyWalletEffect = async (wallet, type, amount, sign = 1) => {
    if (!wallet) return;
    const delta = (type === 'Income' ? 1 : -1) * Number(amount || 0) * sign;
    wallet.balance = Math.max(0, (wallet.balance || 0) + delta);
    await wallet.save();
};

// Keep student fee Payment records in sync with a Cashbook entry.
// When a responsible payer (guardian / student's father) records Income, the
// amount is allocated across their students' outstanding monthly balances and
// stored as Payment records — WITHOUT crediting the wallet again (the Cashbook
// entry already did). This is what makes "Remaining" drop after a partial pay.
const syncFeePayments = async (entry, category, createdBy) => {
    // Always clear any prior fee payments tied to this entry first (idempotent).
    await Payment.deleteMany({ sourceEntryId: entry._id });

    if (!category || category.type !== 'Income') return null;
    if (!['guardian', 'student'].includes(entry.senderEntityType)) return null;

    const variants = phoneVariants(entry.senderPhone);
    const orConds = [];
    if (entry.senderEntityType === 'guardian' && entry.senderEntityId) {
        orConds.push({ guardianId: entry.senderEntityId });
        if (variants.length) {
            orConds.push({ fatherPhone: { $in: variants }, guardianId: { $in: [null, undefined] } });
        }
    } else if (variants.length) {
        orConds.push({ fatherPhone: { $in: variants }, guardianId: { $in: [null, undefined] } });
    }
    if (!orConds.length) return null;

    // Exited (archived) students never receive new fee allocations.
    const students = await Student.find({ $or: orConds, status: { $ne: 'Exited' } })
        .select('fullName monthlyFee fee guardianId branchId feeHistory');
    if (!students.length) return null;

    // The starting billing cycle: the entry's target cycle if set, else derived
    // from the entry's actual date (25th→24th rule).
    const startCycle = isValidCycleKey(entry.targetMonth) ? entry.targetMonth : cycleKeyForDate(entry.date);

    // Owed in the STARTING cycle (for the ledger snapshot below).
    let totalOwedBefore = 0;
    for (const s of students) {
        const paidDocs = await Payment.find({
            studentId: s._id, status: 'Completed', ...cycleMatch('billingCycle', 'paymentDate', startCycle)
        }).select('amount');
        const paid = paidDocs.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        totalOwedBefore += Math.max(0, getStudentFeeForCycle(s, startCycle) - paid);
    }

    // Allocate to the starting cycle first, then roll leftover into upcoming
    // billing cycles (pre-payment). Capped at 12 cycles ahead.
    let leftover = Number(entry.amount) || 0;
    const toCreate = [];
    for (let cOffset = 0; cOffset < 12 && leftover > 0; cOffset++) {
        const cycle = addCycles(startCycle, cOffset);
        for (const s of students) {
            if (leftover <= 0) break;
            const paidDocs = await Payment.find({
                studentId: s._id, status: 'Completed', ...cycleMatch('billingCycle', 'paymentDate', cycle)
            }).select('amount');
            const paid = paidDocs.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
            const monthlyFee = getStudentFeeForCycle(s, cycle);
            const remaining = Math.max(0, monthlyFee - paid);
            if (remaining <= 0) continue;
            const alloc = Math.min(remaining, leftover);
            toCreate.push({
                studentId: s._id,
                guardianId: s.guardianId || undefined,
                walletId: entry.walletId,
                amount: alloc,
                month: cycle,
                billingCycle: cycle,
                paymentDate: entry.date || new Date(),
                paymentMethod: ['Bank', 'Mobile Money', 'Card'].includes(entry.method) ? 'Bank Transfer' : 'Cash',
                status: 'Completed',
                description: `Cashbook fee payment (${category.title})${cOffset > 0 ? ` · ${cycle}` : ''}`,
                sourceEntryId: entry._id
            });
            leftover -= alloc;
        }
    }

    if (toCreate.length) {
        // Direct insert only — no wallet credit / Transaction (Cashbook already handled that).
        await Payment.insertMany(toCreate.map((p) => ({ ...p, createdBy })));
    }

    // Remaining still owed for the STARTING cycle after this entry was applied.
    const allocatedThisMonth = toCreate
        .filter((p) => p.billingCycle === startCycle)
        .reduce((sum, p) => sum + p.amount, 0);
    return Math.max(0, totalOwedBefore - allocatedThisMonth);
};

const getCategories = asyncHandler(async (req, res) => {
    const data = await CashbookCategory.find().sort({ title: 1 });
    res.json(data);
});

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const createCategory = asyncHandler(async (req, res) => {
    const { title, type, description } = req.body;
    if (!title || !type) {
        res.status(400);
        throw new Error('Title and type are required');
    }
    // No duplicate category names (case-insensitive) for the same type.
    const duplicate = await CashbookCategory.findOne({
        title: new RegExp(`^${escapeRegex(title.trim())}$`, 'i'),
        type
    });
    if (duplicate) {
        res.status(400);
        throw new Error(`A "${type}" category named "${title.trim()}" already exists`);
    }
    const data = await CashbookCategory.create({
        title: title.trim(),
        type,
        description: description || '',
        createdBy: req.user?._id
    });
    res.status(201).json(data);
});

const updateCategory = asyncHandler(async (req, res) => {
    // Block renaming into a duplicate (case-insensitive, same type), ignoring self.
    if (req.body.title && req.body.type) {
        const duplicate = await CashbookCategory.findOne({
            _id: { $ne: req.params.id },
            title: new RegExp(`^${escapeRegex(req.body.title.trim())}$`, 'i'),
            type: req.body.type
        });
        if (duplicate) {
            res.status(400);
            throw new Error(`A "${req.body.type}" category named "${req.body.title.trim()}" already exists`);
        }
    }
    const data = await CashbookCategory.findByIdAndUpdate(
        req.params.id,
        {
            title: req.body.title?.trim(),
            type: req.body.type,
            description: req.body.description ?? ''
        },
        { new: true, runValidators: true }
    );
    if (!data) {
        res.status(404);
        throw new Error('Category not found');
    }
    res.json(data);
});

const deleteCategory = asyncHandler(async (req, res) => {
    const inUse = await CashbookEntry.countDocuments({ categoryId: req.params.id });
    if (inUse > 0) {
        res.status(400);
        throw new Error('Category is used by cashbook transactions and cannot be deleted');
    }
    const data = await CashbookCategory.findByIdAndDelete(req.params.id);
    if (!data) {
        res.status(404);
        throw new Error('Category not found');
    }
    res.json({ message: 'Category removed' });
});

const getEntries = asyncHandler(async (req, res) => {
    const data = await CashbookEntry.find({ isDeleted: { $ne: true } })
        .populate(populateEntry)
        .sort({ date: -1, createdAt: -1 });
    res.json(data);
});

const getDeletedEntries = asyncHandler(async (req, res) => {
    const data = await CashbookEntry.find({ isDeleted: true })
        .populate(populateEntry)
        .sort({ deletedAt: -1, date: -1 });
    res.json(data);
});

const resStatus400 = (message) => {
    const err = new Error(message);
    err.statusCode = 400;
    throw err;
};

const validateMobileFields = (method, senderPhone, receiverPhone) => {
    const needsParties = ['Mobile Money', 'Bank', 'EVC-Plus', 'E-Dahab'].includes(method);
    if (!needsParties) return;

    if (['EVC-Plus', 'E-Dahab'].includes(method)) {
        if (!senderPhone || !receiverPhone) {
            resStatus400('EVC-Plus and E-Dahab require both sender and receiver phone numbers');
        }
    }

    if (['EVC-Plus', 'E-Dahab', 'Mobile Money'].includes(method)) {
        if (senderPhone && !isValidSomaliMobile(senderPhone)) {
            resStatus400('Sender phone must be 9 or 10 digits');
        }
        if (receiverPhone && !isValidSomaliMobile(receiverPhone)) {
            resStatus400('Receiver phone must be 9 or 10 digits');
        }
    }
};

// Two campuses can each run a class of the same name, so the branch is shown
// alongside it: "Tamhiid 3 (FR1)". The stored class name itself is unchanged.
const classDisplayName = (cls) => {
    const name = cls?.name || cls?.className || '';
    const branch = cls?.branchId?.name || '';
    if (!name) return '';
    return branch ? `${name} (${branch})` : name;
};

const phoneOrQuery = (field, variants) => ({
    [field]: { $in: variants }
});

const createEntry = asyncHandler(async (req, res) => {
    const {
        categoryId,
        amount,
        method,
        payerName,
        senderPhone,
        senderName,
        senderEntityType,
        senderEntityId,
        receiverPhone,
        receiverName,
        receiverEntityType,
        receiverEntityId,
        date,
        description
    } = req.body;

    if (!categoryId || amount === undefined || amount === null || amount === '') {
        res.status(400);
        throw new Error('Category and amount are required');
    }

    const category = await CashbookCategory.findById(categoryId);
    if (!category) {
        res.status(400);
        throw new Error('Invalid category');
    }

    try {
        validateMobileFields(method || 'Cash', senderPhone, receiverPhone);
    } catch (e) {
        res.status(e.statusCode || 400);
        throw e;
    }

    const branchId = req.user?.branchId;
    const wallet = await resolveWallet(req.body.walletId, branchId);

    // No wallet in the system → refuse to record money (income or expense).
    if (!wallet) {
        res.status(400);
        throw new Error('No wallet found in the system. Create a wallet before recording income or expenses.');
    }

    const targetCycle = req.body.targetMonth || cycleKeyForDate(date || new Date());
    const lock = await CycleLock.findOne({ cycleKey: targetCycle, isLocked: true });
    const isUserAdmin = canManageCycleLocks(req.user);

    if (lock) {
        if (!isUserAdmin) {
            res.status(403);
            throw new Error(`Wareegga xisaabeed ee ${targetCycle} waa xiran yahay (Cycle is locked). Lama gelin karo xisaab cusub ilaa maamuluhu furo.`);
        }
        if (!req.body.backdatedReason || !req.body.backdatedReason.trim()) {
            res.status(400);
            throw new Error(`Wareegga xisaabeed ee ${targetCycle} waa xiran yahay. Si aad ugu darto xisaab dib-u-saxid ah, fadlan geli Sababta Dib-u-saxidda (Backdated Reason) ama fur wareegga.`);
        }
    }

    const isBackdated = Boolean(req.body.isBackdated || (lock && req.body.backdatedReason) || (req.body.backdatedReason && req.body.backdatedReason.trim()));
    const backdatedReason = (req.body.backdatedReason || '').trim();
    const adjustedByName = isBackdated ? (req.user?.fullName || req.user?.name || 'Administrator') : '';
    const adjustedByRole = isBackdated ? (req.user?.role || 'Admin') : '';

    const data = await CashbookEntry.create({
        categoryId,
        amount: Number(amount),
        method: method || 'Cash',
        payerName: payerName || '',
        senderPhone: digitsOnly(senderPhone),
        senderName: senderName || '',
        senderEntityType: senderEntityType || '',
        senderEntityId: senderEntityId || undefined,
        receiverPhone: digitsOnly(receiverPhone),
        receiverName: receiverName || '',
        receiverEntityType: receiverEntityType || '',
        receiverEntityId: receiverEntityId || undefined,
        date: date || new Date().toISOString().split('T')[0],
        // targetMonth now holds a BILLING CYCLE key (25th→24th): the client's
        // chosen cycle for an advance, else the cycle of the entry's own date.
        targetMonth: targetCycle,
        description: description || '',
        branchId,
        walletId: wallet?._id,
        createdBy: req.user?._id,
        isBackdated,
        backdatedReason,
        adjustedByName,
        adjustedByRole
    });

    // Reflect the movement on the system wallet and record it in the transaction ledger.
    if (wallet) {
        await applyWalletEffect(wallet, category.type, data.amount, 1);
        await Transaction.create({
            branchId: wallet.branchId || branchId || null,
            walletId: wallet._id,
            type: category.type,
            amount: data.amount,
            referenceId: data._id,
            description: description || `Cashbook: ${category.title} (${category.type})`,
            date: data.date,
            createdBy: req.user?._id
        });
    }

    // Record student fee payments (partial-aware) linked to this entry, and
    // snapshot how much the payer still owes after this payment.
    let feeRemaining = await syncFeePayments(data, category, req.user?._id);

    // If not a student fee payment, snapshot remaining balance for Expense (Teacher / Rent / Account / Contact)
    if (feeRemaining === null || feeRemaining === undefined) {
        if (category.type === 'Expense') {
            // selectedMonth is a BILLING CYCLE key (the entry's targetMonth).
            const selectedMonth = data.targetMonth || cycleKeyForDate(data.date);
            const isAdvance = selectedMonth > currentCycle();

            // If receiver is a Teacher / User with salary:
            if (data.receiverEntityId && ['teacher', 'user'].includes(data.receiverEntityType)) {
                const user = await User.findById(data.receiverEntityId).select('salary');
                const totalSalary = Number(user?.salary || 0);
                if (totalSalary > 0) {
                    try {
                        await Salary.create({
                            teacherId: data.receiverEntityId,
                            walletId: wallet?._id,
                            month: selectedMonth,
                            billingCycle: selectedMonth,
                            amount: data.amount,
                            paymentMethod: data.method || 'Cash',
                            paymentDate: new Date(data.date || Date.now()),
                            status: 'Paid',
                            notes: `Cashbook: ${category.title} (${selectedMonth}${isAdvance ? ' · Hormarin' : ''}) · ref:${data._id}${data.description ? ` · ${data.description}` : ''}`,
                            paidBy: req.user?._id
                        });
                    } catch (e) {
                        console.error('Salary sync note:', e.message);
                    }

                    // Remaining balance for this billing cycle after this payment.
                    const salaryDocs = await Salary.find({
                        teacherId: data.receiverEntityId,
                        status: { $ne: 'Cancelled' },
                        ...cycleMatch('billingCycle', 'paymentDate', selectedMonth)
                    }).select('amount notes');
                    const externalSalaryPaid = salaryDocs
                        .filter((s) => !s.notes || !s.notes.startsWith('Cashbook:'))
                        .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

                    const entryDocs = await CashbookEntry.find({
                        _id: { $ne: data._id },
                        $and: [
                            {
                                $or: [
                                    { receiverEntityId: data.receiverEntityId },
                                    phoneOrQuery('receiverPhone', phoneVariants(data.receiverPhone || ''))
                                ]
                            },
                            entryInCycle(selectedMonth)
                        ]
                    }).populate('categoryId');
                    const cashbookPaid = entryDocs
                        .filter((e) => !e.categoryId || e.categoryId.type === 'Expense')
                        .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

                    const totalPaidForMonth = externalSalaryPaid + cashbookPaid + Number(data.amount || 0);
                    feeRemaining = Math.max(0, totalSalary - totalPaidForMonth);
                }
            } else if (data.receiverPhone) {
                // If receiver is Rent or other contact with previous feeRemaining or Account:
                const Account = require('../models/Account');
                const variants = phoneVariants(data.receiverPhone);
                const acc = await Account.findOne({
                    $or: [
                        phoneOrQuery('accountNo', variants),
                        phoneOrQuery('code', variants)
                    ]
                });

                const prevEntry = await CashbookEntry.findOne({
                    _id: { $ne: data._id },
                    receiverPhone: data.receiverPhone,
                    feeRemaining: { $ne: null },
                    ...entryInCycle(selectedMonth)
                }).sort({ date: -1, createdAt: -1 });

                let remainingBefore = null;
                if (prevEntry && prevEntry.feeRemaining !== null && prevEntry.feeRemaining !== undefined) {
                    remainingBefore = Number(prevEntry.feeRemaining);
                } else if (acc && acc.balance !== undefined && Number(acc.balance) > 0) {
                    remainingBefore = Number(acc.balance);
                }

                if (remainingBefore !== null) {
                    feeRemaining = Math.max(0, remainingBefore - Number(data.amount || 0));
                }
            }

            data.targetMonth = selectedMonth;
        }
    }

    if (feeRemaining !== null && feeRemaining !== undefined) {
        data.feeRemaining = feeRemaining;
        await data.save();
    }

    await data.populate(populateEntry);
    res.status(201).json(data);
});

const updateEntry = asyncHandler(async (req, res) => {
    const existing = await CashbookEntry.findById(req.params.id);
    if (!existing) {
        res.status(404);
        throw new Error('Transaction not found');
    }

    const method = req.body.method ?? existing.method;
    const senderPhone = req.body.senderPhone ?? existing.senderPhone;
    const receiverPhone = req.body.receiverPhone ?? existing.receiverPhone;

    try {
        validateMobileFields(method, senderPhone, receiverPhone);
    } catch (e) {
        res.status(e.statusCode || 400);
        throw e;
    }

    // Old category type is needed to reverse the previous wallet effect.
    const oldCategory = await CashbookCategory.findById(existing.categoryId);
    let newCategory = oldCategory;
    if (req.body.categoryId && String(req.body.categoryId) !== String(existing.categoryId)) {
        newCategory = await CashbookCategory.findById(req.body.categoryId);
        if (!newCategory) {
            res.status(400);
            throw new Error('Invalid category');
        }
    }

    const payload = { ...req.body };
    if (payload.senderPhone !== undefined) payload.senderPhone = digitsOnly(payload.senderPhone);
    if (payload.receiverPhone !== undefined) payload.receiverPhone = digitsOnly(payload.receiverPhone);
    if (payload.amount !== undefined) payload.amount = Number(payload.amount);

    // Check Cycle Lock for existing and updated cycle
    const oldCycle = existing.targetMonth || cycleKeyForDate(existing.date);
    const newCycle = payload.targetMonth || (payload.date ? cycleKeyForDate(payload.date) : oldCycle);
    const lockedOld = await CycleLock.findOne({ cycleKey: oldCycle, isLocked: true });
    const lockedNew = (newCycle !== oldCycle) ? await CycleLock.findOne({ cycleKey: newCycle, isLocked: true }) : lockedOld;
    const isUserAdmin = canManageCycleLocks(req.user);

    if (lockedOld || lockedNew) {
        if (!isUserAdmin) {
            res.status(403);
            throw new Error('Wareegga xisaabeed waa xiran yahay (Cycle is locked). Ma beddeli kartid xisaabtan ilaa wareegga la furo.');
        }
        if (!payload.backdatedReason || !payload.backdatedReason.trim()) {
            res.status(400);
            throw new Error('Wareegga xisaabeed waa xiran yahay. Fadlan geli Sababta Dib-u-saxidda (Backdated Reason) si aad wax uga beddesho.');
        }
        payload.isBackdated = true;
        payload.backdatedReason = payload.backdatedReason.trim();
        payload.adjustedByName = req.user?.fullName || req.user?.name || 'Administrator';
        payload.adjustedByRole = req.user?.role || 'Admin';
    } else if (payload.backdatedReason && payload.backdatedReason.trim()) {
        payload.isBackdated = true;
        payload.backdatedReason = payload.backdatedReason.trim();
        payload.adjustedByName = req.user?.fullName || req.user?.name || 'Administrator';
        payload.adjustedByRole = req.user?.role || 'Admin';
    }

    // Empty strings for ObjectId fields must become null, otherwise Mongoose throws a Cast error.
    ['senderEntityId', 'receiverEntityId'].forEach((k) => {
        if (k in payload && !payload[k]) payload[k] = null;
    });

    // Reverse the previous effect only if one was actually applied (entry had a wallet).
    if (existing.walletId && oldCategory) {
        const oldWallet = await Wallet.findById(existing.walletId);
        if (oldWallet) await applyWalletEffect(oldWallet, oldCategory.type, existing.amount, -1);
    }

    // Resolve the wallet for the updated entry and apply the new effect.
    const newWallet = await resolveWallet(payload.walletId ?? existing.walletId, existing.branchId);
    payload.walletId = newWallet?._id;

    const data = await CashbookEntry.findByIdAndUpdate(req.params.id, payload, {
        new: true,
        runValidators: true
    }).populate(populateEntry);

    if (newWallet && newCategory) {
        await applyWalletEffect(newWallet, newCategory.type, data.amount, 1);
    }

    // Keep the transaction ledger in sync with the edited entry.
    await Transaction.updateMany(
        { referenceId: data._id },
        {
            walletId: newWallet?._id,
            type: newCategory?.type,
            amount: data.amount,
            branchId: newWallet?.branchId || existing.branchId || null,
            description: data.description || `Cashbook: ${newCategory?.title} (${newCategory?.type})`,
            date: data.date
        }
    );

    // Re-sync linked fee payments against the updated amount / category / date.
    const feeRemaining = await syncFeePayments(data, newCategory, req.user?._id);
    data.feeRemaining = feeRemaining ?? null;
    await data.save();

    res.json(data);
});

const deleteEntry = asyncHandler(async (req, res) => {
    const existing = await CashbookEntry.findById(req.params.id);
    if (!existing) {
        res.status(404);
        throw new Error('Transaction not found');
    }

    const cycle = existing.targetMonth || cycleKeyForDate(existing.date);
    const lock = await CycleLock.findOne({ cycleKey: cycle, isLocked: true });
    if (lock) {
        res.status(403);
        throw new Error(`Wareegga xisaabeed ee ${cycle} waa xiran yahay (Cycle is locked). Ma tirtiri kartid xisaab ku jirta wareeg xiran. Fur wareegga marka hore haddii loo baahdo.`);
    }

    // Reverse the wallet effect (only if one was applied) and remove linked ledger transaction(s).
    if (existing.walletId) {
        const category = await CashbookCategory.findById(existing.categoryId);
        const wallet = await Wallet.findById(existing.walletId);
        if (wallet && category) await applyWalletEffect(wallet, category.type, existing.amount, -1);
    }
    await Transaction.deleteMany({ referenceId: existing._id });
    // Remove any student fee payments or salary disbursements recorded from this entry.
    await Payment.deleteMany({ sourceEntryId: existing._id });
    await Salary.deleteMany({ notes: new RegExp(existing._id) });

    // Mark as soft deleted instead of destroying from database
    existing.isDeleted = true;
    existing.deletedAt = new Date();
    existing.deletedBy = req.user?._id;
    existing.deletedByName = req.user?.fullName || req.user?.name || 'Administrator';
    existing.deletedByRole = req.user?.role || 'Admin';
    await existing.save();

    res.json({ message: 'Transaction moved to trash', data: existing });
});

const restoreEntry = asyncHandler(async (req, res) => {
    const existing = await CashbookEntry.findById(req.params.id);
    if (!existing || !existing.isDeleted) {
        res.status(404);
        throw new Error('Deleted transaction not found');
    }

    const cycle = existing.targetMonth || cycleKeyForDate(existing.date);
    const lock = await CycleLock.findOne({ cycleKey: cycle, isLocked: true });
    if (lock) {
        res.status(403);
        throw new Error(`Wareegga xisaabeed ee ${cycle} waa xiran yahay (Cycle is locked). Ma soo celin kartid xisaab ku jirta wareeg xiran ilaa aad furto.`);
    }

    const category = await CashbookCategory.findById(existing.categoryId);
    const wallet = await resolveWallet(existing.walletId, existing.branchId);

    // Re-apply wallet effect & create linked transaction ledger
    if (wallet && category) {
        await applyWalletEffect(wallet, category.type, existing.amount, 1);
        await Transaction.create({
            branchId: wallet.branchId || existing.branchId || null,
            walletId: wallet._id,
            type: category.type,
            amount: existing.amount,
            referenceId: existing._id,
            description: existing.description || `Cashbook: ${category.title} (${category.type}) [Restored]`,
            date: existing.date,
            createdBy: req.user?._id
        });
    }

    // Re-sync fee payments if it was a student fee payment
    const feeRemaining = await syncFeePayments(existing, category, req.user?._id);
    existing.feeRemaining = feeRemaining ?? null;

    // Reset soft delete flags
    existing.isDeleted = false;
    existing.deletedAt = null;
    existing.deletedBy = null;
    existing.deletedByName = '';
    existing.deletedByRole = '';
    await existing.save();

    const populated = await CashbookEntry.findById(existing._id).populate(populateEntry);
    res.json({ message: 'Transaction restored successfully', data: populated });
});

const lookupGuardian = async (variants) => {
    const guardian = await Guardian.findOne({
        $or: [
            phoneOrQuery('phone', variants),
            phoneOrQuery('alternatePhone', variants)
        ]
    }).select('fullName phone alternatePhone type');
    if (!guardian) return null;
    return {
        found: true,
        name: guardian.fullName,
        entityType: 'guardian',
        entityId: guardian._id,
        role: guardian.type === 'Responsible' ? 'Responsible' : guardian.type || 'Parent',
        phone: guardian.phone,
        alternatePhone: guardian.alternatePhone || ''
    };
};

const lookupStudent = async (variants) => {
    const student = await Student.findOne(phoneOrQuery('fatherPhone', variants)).select('fullName fatherPhone fatherName');
    if (!student) return null;
    return {
        found: true,
        name: student.fatherName || student.fullName,
        entityType: 'student',
        entityId: student._id,
        role: 'Responsible',
        phone: student.fatherPhone,
        responsibleName: student.fatherName,
        studentName: student.fullName
    };
};

const lookupUser = async (variants, preferTeacher = false) => {
    const baseQuery = phoneOrQuery('phone', variants);
    const user = preferTeacher
        ? await User.findOne({ ...baseQuery, role: 'Teacher' }).select('fullName phone role salary')
        : await User.findOne(baseQuery).select('fullName phone role salary');
    if (!user) return null;
    const entityType = user.role === 'Teacher' ? 'teacher' : 'user';
    return {
        found: true,
        name: user.fullName,
        entityType,
        entityId: user._id,
        role: user.role,
        phone: user.phone
    };
};

const lookupAccount = async (variants) => {
    const Account = require('../models/Account');
    const acc = await Account.findOne({
        $or: [
            phoneOrQuery('accountNo', variants),
            phoneOrQuery('code', variants)
        ]
    }).select('name code accountNo type balance');
    if (!acc) return null;
    return {
        found: true,
        name: acc.name,
        entityType: 'account',
        entityId: acc._id,
        role: acc.type || 'Account',
        phone: acc.accountNo || acc.code,
        balance: Number(acc.balance || 0)
    };
};

// Match CashbookEntry documents belonging to a billing cycle (25th→24th),
// migration-safe for historical rows.
//
// The tricky part is `targetMonth`: NEW entries store a billing-CYCLE key there,
// while HISTORICAL entries stored a CALENDAR month (always equal to their date's
// own "YYYY-MM"). We must attribute historical entries by their REAL DATE, and
// only honour `targetMonth` when it is a deliberate cross-cycle (advance)
// assignment — detected as targetMonth differing from the date's calendar month.
//
//   (a) "plain" entries — no targetMonth, or targetMonth == the date's own
//       calendar month (this is every historical row, and same-cycle new rows) —
//       are matched purely by their real date falling in the cycle range.
//   (b) genuine ADVANCE entries — targetMonth deliberately set to a DIFFERENT
//       cycle than the payment date's month — are matched to that target cycle
//       (and, thanks to (a)'s guard, are NOT double-counted in their pay-date
//       cycle).
//
// `date` is a "YYYY-MM-DD" string, so its month is $substr(date,0,7) and range
// comparisons are lexicographic (correct because that format sorts by time).
const entryInCycle = (cycle) => {
    const { start, end } = cycleRange(cycle);
    const startISO = start.toISOString().slice(0, 10);
    const endISO = end.toISOString().slice(0, 10);
    const dateMonth = { $substr: [{ $ifNull: ['$date', ''] }, 0, 7] };
    return {
        $or: [
            // (a) plain / historical / same-cycle entries → attribute by real date
            {
                $and: [
                    { date: { $gte: startISO, $lte: endISO } },
                    {
                        $or: [
                            { targetMonth: null },
                            { targetMonth: '' },
                            { targetMonth: { $exists: false } },
                            { $expr: { $eq: ['$targetMonth', dateMonth] } }
                        ]
                    }
                ]
            },
            // (b) genuine advance entries deliberately targeted to THIS cycle
            {
                $and: [
                    { targetMonth: cycle },
                    { $expr: { $ne: ['$targetMonth', dateMonth] } }
                ]
            }
        ]
    };
};

// Summarize the students a responsible person pays for: fees, amount paid in the
// given billing cycle, and the remaining balance still owed for that cycle.
const summarizeStudents = async (students, cycle = currentCycle(), excludeEntryId = null) => {
    const list = [];
    let totalMonthlyFee = 0;
    let totalPaid = 0;
    let totalBalance = 0;
    for (const s of students) {
        const paymentFilter = {
            studentId: s._id,
            status: 'Completed',
            ...cycleMatch('billingCycle', 'paymentDate', cycle)
        };
        if (excludeEntryId && mongoose.Types.ObjectId.isValid(excludeEntryId)) {
            paymentFilter.sourceEntryId = { $ne: new mongoose.Types.ObjectId(excludeEntryId) };
        }
        const paidThisMonthAgg = await Payment.find(paymentFilter).select('amount');
        const paidThisMonth = paidThisMonthAgg.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        const monthlyFee = getStudentFeeForCycle(s, cycle);
        const balance = Math.max(0, monthlyFee - paidThisMonth);
        totalMonthlyFee += monthlyFee;
        totalPaid += paidThisMonth;
        totalBalance += balance;
        list.push({
            studentId: s._id,
            name: s.fullName,
            className: classDisplayName(s.classId),
            monthlyFee,
            totalPaid: paidThisMonth,
            balance
        });
    }
    return { students: list, totalMonthlyFee, totalPaid, totalBalance, month: cycle, count: list.length };
};

// Attach financial context to a matched payer/receiver:
// Calculates current remaining balance for:
// - Parent / Waalid (responsible student fees)
// - Teacher / Macallin (salary minus payments this month)
// - Rent / Kiro or other registered accounts / contacts
const buildPayerInfo = async (match, variants, purpose = 'sender', reqDate = null, excludeEntryId = null) => {
    if (!match) return null;
    // The billing cycle in focus: an explicit cycle key if provided, else derived
    // from the supplied date (or now) using the 25th→24th rule.
    const currentMonth = isValidCycleKey(reqDate) ? reqDate : cycleKeyForDate(reqDate || new Date());

    // 1. Guardian / responsible / student's father → gather all students under them.
    if (match.entityType === 'guardian' || match.entityType === 'student') {
        const orConds = [];
        if (match.entityType === 'guardian' && match.entityId) {
            orConds.push({ guardianId: match.entityId });
            if (variants.length) {
                orConds.push({ fatherPhone: { $in: variants }, guardianId: { $in: [null, undefined] } });
            }
        } else if (variants.length) {
            orConds.push({ fatherPhone: { $in: variants }, guardianId: { $in: [null, undefined] } });
        }
        if (!orConds.length) return { kind: 'responsible', students: [], totalMonthlyFee: 0, totalPaid: 0, totalBalance: 0, remainingBalance: 0, count: 0 };
        // Exited (archived) students are not active payers.
        const students = await Student.find({ $or: orConds, status: { $ne: 'Exited' } })
            .select('fullName classId monthlyFee fee fatherPhone guardianId feeHistory')
            .populate({ path: 'classId', select: 'name className branchId', populate: { path: 'branchId', select: 'name' } });

        if (!students.length) return { kind: 'responsible', students: [], totalMonthlyFee: 0, totalPaid: 0, totalBalance: 0, remainingBalance: 0, count: 0 };
        const summary = await summarizeStudents(students, currentMonth, excludeEntryId);

        // Previous debt (arrears) — the Dashboard's own calculation, narrowed to
        // this payer's students. Reported alongside the current cycle only; it is
        // never folded into totalBalance / remainingBalance (allocation unchanged).
        // Capped at the real current cycle so an advance lookup matches the Dashboard.
        const now = currentCycle();
        const debtCycle = currentMonth < now ? currentMonth : now;
        const { debt: previousBalance, rows: debtRows } = await computePreviousDebt(debtCycle, {
            studentIds: students.map((s) => s._id),
            detail: true
        });
        const byMonth = new Map();
        for (const r of debtRows) {
            const agg = byMonth.get(r.month) || { month: r.month, fee: 0, paid: 0, balance: 0 };
            agg.fee += r.fee;
            agg.paid += r.paid;
            agg.balance += r.balance;
            byMonth.set(r.month, agg);
        }
        summary.students.forEach((row) => {
            row.arrears = debtRows
                .filter((r) => r.studentId === String(row.studentId))
                .map(({ month, fee, paid, balance }) => ({ month, fee, paid, balance }));
            row.previousBalance = row.arrears.reduce((sum, a) => sum + a.balance, 0);
        });

        return {
            kind: 'responsible',
            ...summary,
            remainingBalance: summary.totalBalance,
            previousBalance,
            arrears: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
            totalDue: summary.totalBalance + previousBalance
        };
    }

    // 2. Teacher / staff / user → calculate salary and payments this month.
    if (match.entityType === 'teacher' || match.entityType === 'user') {
        const user = await User.findById(match.entityId).select('fullName role salary');
        const totalSalary = Number(user?.salary || 0);

        // Salary payments for this billing cycle (excluding Cashbook mirrors to
        // prevent double counting). New salaries carry billingCycle; historical
        // ones are attributed by paymentDate.
        const salaryFilter = {
            teacherId: match.entityId,
            status: { $ne: 'Cancelled' },
            ...cycleMatch('billingCycle', 'paymentDate', currentMonth)
        };
        if (excludeEntryId) {
            salaryFilter.notes = { $not: new RegExp(`ref:${excludeEntryId}`) };
        }
        const salaryDocs = await Salary.find(salaryFilter).select('amount month status notes');
        const externalSalaryPaid = salaryDocs
            .filter((s) => !s.notes || !s.notes.startsWith('Cashbook:'))
            .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

        // Cashbook expense entries to THIS receiver within this billing cycle.
        const entryConditions = [
            { $or: [
                { receiverEntityId: match.entityId },
                phoneOrQuery('receiverPhone', variants)
            ] },
            entryInCycle(currentMonth)
        ];
        if (excludeEntryId && mongoose.Types.ObjectId.isValid(excludeEntryId)) {
            entryConditions.push({ _id: { $ne: new mongoose.Types.ObjectId(excludeEntryId) } });
        }
        const entryDocs = await CashbookEntry.find({
            $and: entryConditions
        }).populate('categoryId');
        const cashbookPaid = entryDocs
            .filter((e) => !e.categoryId || e.categoryId.type === 'Expense')
            .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

        const totalPaid = externalSalaryPaid + cashbookPaid;
        const remaining = totalSalary > 0 ? Math.max(0, totalSalary - totalPaid) : 0;
        const lastSalary = salaryDocs.sort((a, b) => (b.month || '').localeCompare(a.month || ''))[0] || null;

        if (totalSalary > 0) {
            return {
                kind: 'staff',
                role: user?.role || match.role,
                salary: totalSalary,
                totalMonthlyFee: totalSalary,
                totalPaid,
                totalBalance: remaining,
                remainingBalance: remaining,
                month: currentMonth,
                isAdvance: currentMonth > currentCycle(),
                lastSalary: lastSalary ? { amount: Number(lastSalary.amount || 0), month: lastSalary.month, status: lastSalary.status } : null
            };
        }

        // If user has no salary, check previous CashbookEntry snapshots
        const lastEntry = await CashbookEntry.findOne({
            $or: [
                { receiverEntityId: match.entityId },
                phoneOrQuery('receiverPhone', variants)
            ]
        }).sort({ date: -1, createdAt: -1 });

        if (lastEntry && lastEntry.feeRemaining !== null && lastEntry.feeRemaining !== undefined) {
            const rem = Math.max(0, Number(lastEntry.feeRemaining));
            return {
                kind: 'staff',
                role: user?.role || match.role,
                salary: 0,
                totalBalance: rem,
                remainingBalance: rem,
                month: currentMonth
            };
        }

        return {
            kind: 'staff',
            role: user?.role || match.role,
            salary: 0,
            totalBalance: 0,
            remainingBalance: 0,
            month: currentMonth
        };
    }

    // 3. Account model match (e.g. Rent, Utilities, or general ledger account)
    if (match.entityType === 'account') {
        const phoneQuery = purpose === 'receiver'
            ? phoneOrQuery('receiverPhone', variants)
            : phoneOrQuery('senderPhone', variants);

        const monthQuery = { $and: [phoneQuery, entryInCycle(currentMonth)] };
        const monthEntries = await CashbookEntry.find(monthQuery).populate('categoryId');
        const paidThisMonth = monthEntries
            .filter((e) => !e.categoryId || (purpose === 'receiver' ? e.categoryId.type === 'Expense' : e.categoryId.type === 'Income'))
            .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

        const baseBalance = Math.max(0, Number(match.balance || 0));
        let rem = baseBalance;
        if (baseBalance > 0) {
            rem = Math.max(0, baseBalance - paidThisMonth);
        } else {
            const lastEntry = await CashbookEntry.findOne(phoneQuery).sort({ date: -1, createdAt: -1 });
            if (lastEntry && lastEntry.feeRemaining !== null && lastEntry.feeRemaining !== undefined) {
                rem = Math.max(0, Number(lastEntry.feeRemaining) - paidThisMonth);
            }
        }

        return {
            kind: 'account',
            name: match.name,
            totalBalance: rem,
            remainingBalance: rem,
            month: currentMonth,
            baseBalance,
            paidThisMonth
        };
    }

    // 4. Any other registered account or contact (check previous CashbookEntry records for this phone/account)
    const phoneQuery = purpose === 'receiver'
        ? phoneOrQuery('receiverPhone', variants)
        : phoneOrQuery('senderPhone', variants);

    const monthQuery = { $and: [phoneQuery, entryInCycle(currentMonth)] };
    const monthEntries = await CashbookEntry.find(monthQuery).populate('categoryId');
    const paidThisMonth = monthEntries
        .filter((e) => !e.categoryId || (purpose === 'receiver' ? e.categoryId.type === 'Expense' : e.categoryId.type === 'Income'))
        .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    const lastEntry = match.lastEntry || await CashbookEntry.findOne(phoneQuery).sort({ date: -1, createdAt: -1 });
    if (lastEntry) {
        let base = 0;
        if (lastEntry.amount && Number(lastEntry.amount) > 0) {
            base = Number(lastEntry.amount);
        }
        if (lastEntry.feeRemaining !== null && lastEntry.feeRemaining !== undefined) {
            base = Number(lastEntry.feeRemaining);
        }
        const rem = Math.max(0, base - paidThisMonth);
        return {
            kind: 'contact',
            name: match.name,
            totalBalance: rem,
            remainingBalance: rem,
            month: currentMonth,
            baseBalance: base,
            paidThisMonth
        };
    }

    return null;
};

const lookupPhone = asyncHandler(async (req, res) => {
    const raw = (req.query.phone || '').trim();
    const purpose = (req.query.purpose || 'sender').toLowerCase();
    const reqDate = req.query.month || req.query.date || null;
    const excludeEntryId = (req.query.excludeEntryId || '').trim() || null;
    const variants = phoneVariants(raw);

    if (!variants.length) {
        return res.json({ found: false, name: '', entityType: '', entityId: null, role: '' });
    }

    // Payer autocomplete resolves ONLY against current, active records — guardian,
    // student, user/teacher, and account. The historical-cashbook name fallback
    // was removed so an old counterparty name (e.g. from a past cashbook entry)
    // is never suggested as a current payer. Unknown numbers return found:false.
    const tryOrder =
        purpose === 'receiver'
            ? [
                  () => lookupUser(variants, true),
                  () => lookupUser(variants, false),
                  () => lookupAccount(variants),
                  () => lookupGuardian(variants),
                  () => lookupStudent(variants)
              ]
            : [
                  () => lookupGuardian(variants),
                  () => lookupStudent(variants),
                  () => lookupAccount(variants),
                  () => lookupUser(variants, false)
              ];

    for (const lookup of tryOrder) {
        const match = await lookup();
        if (match) {
            const payerInfo = await buildPayerInfo(match, variants, purpose, reqDate, excludeEntryId);
            return res.json({ ...match, payerInfo });
        }
    }

    res.json({ found: false, name: '', entityType: '', entityId: null, role: '' });
});

// ---------------------------------------------------------------------------
// Shared student-fee calculation — the single source of truth reused by BOTH the
// Monthly Payments endpoint (getPayers) and the Dashboard (computeFeeTotals), so
// the two can never drift apart. Always institute-wide (never branch-filtered).
// ---------------------------------------------------------------------------

// Active (non-Inactive/Exited) students and how much each has paid within a
// billing cycle. registrationBound=true applies the Monthly-Payments rule: a
// student counts once registered by the cycle's END (its 24th).
const fetchStudentFeeData = async (cycle, { registrationBound = true } = {}) => {
    const { end } = cycleRange(cycle);
    const studentQuery = { status: { $nin: ['Inactive', 'Exited'] } };
    if (registrationBound) {
        studentQuery.registrationDate = { $lte: end };
    }

    const students = await Student.find(studentQuery)
        .select('fullName fatherName fatherPhone guardianId monthlyFee fee classId registrationDate status studentCode feeHistory')
        .populate({ path: 'classId', select: 'name className branchId', populate: { path: 'branchId', select: 'name' } })
        .populate('guardianId', 'fullName phone alternatePhone relationship')
        .lean();

    // Payments counted for this cycle: new records by their billingCycle key,
    // historical records (no key) by their real paymentDate falling in the range.
    const studentIds = students.map((s) => s._id);
    const payments = studentIds.length
        ? await Payment.find({
            studentId: { $in: studentIds },
            status: 'Completed',
            ...cycleMatch('billingCycle', 'paymentDate', cycle)
        }).select('studentId amount').lean()
        : [];

    const paidByStudent = new Map();
    for (const p of payments) {
        const sId = String(p.studentId);
        paidByStudent.set(sId, (paidByStudent.get(sId) || 0) + (Number(p.amount) || 0));
    }

    return { students, paidByStudent };
};

// Institute-wide fee totals for a billing cycle (25th→24th):
//   expected  = Σ each active student's monthly fee
//   collected = Σ payments attributed to the cycle
//   pending   = Σ max(0, fee − paid)   (an AMOUNT, not a student count)
// This is exactly the calculation Monthly Payments performs, so the Dashboard's
// "Student Fees Collected" and "Pending Student Fees" match that report.
const computeFeeTotals = async (cycle = currentCycle()) => {
    const { students, paidByStudent } = await fetchStudentFeeData(cycle, { registrationBound: true });
    let expected = 0;
    let collected = 0;
    let pending = 0;
    for (const s of students) {
        const fee = getStudentFeeForCycle(s, cycle);
        const paid = paidByStudent.get(String(s._id)) || 0;
        expected += fee;
        collected += paid;
        pending += Math.max(0, fee - paid);
    }
    return { cycle, expected, collected, pending };
};

// Debt carried over from EARLIER billing cycles: for every cycle before `cycle`,
// Σ max(0, fee − paid) — exactly computeFeeTotals' `pending` rule applied to each
// past cycle and summed (same active student set, same "registered by the cycle's
// end" rule, same payment attribution as cycleMatch: billingCycle key, else the
// cycle of paymentDate). Once a cycle ends its unpaid amount leaves the current
// `pending` and lands here; a later payment targeted at that cycle reduces it.
// Counting starts at the first cycle with any completed fee payment, so cycles
// from before the system was in use are never counted as debt.
//
// Optional `studentIds` narrows the same calculation to one payer's students, and
// `detail: true` returns the per-student/per-cycle rows behind the sum as
// { debt, rows }. With no options (the Dashboard call) it returns the number.
const computePreviousDebt = async (cycle = currentCycle(), { studentIds = null, detail = false } = {}) => {
    const none = detail ? { debt: 0, rows: [] } : 0;
    const [firstByDate, firstByKey] = await Promise.all([
        Payment.findOne({ status: 'Completed', paymentDate: { $ne: null } }).sort({ paymentDate: 1 }).select('paymentDate').lean(),
        Payment.findOne({ status: 'Completed', billingCycle: { $nin: [null, ''] } }).sort({ billingCycle: 1 }).select('billingCycle').lean()
    ]);
    const starts = [
        firstByDate && cycleKeyForDate(firstByDate.paymentDate),
        firstByKey && firstByKey.billingCycle
    ].filter(Boolean).sort();
    const firstCycle = starts[0];
    if (!firstCycle || firstCycle >= cycle) return none;

    const { end: lastEnd } = cycleRange(addCycles(cycle, -1));
    const studentQuery = {
        status: { $nin: ['Inactive', 'Exited'] },
        registrationDate: { $lte: lastEnd }
    };
    if (studentIds) studentQuery._id = { $in: studentIds };
    const students = await Student.find(studentQuery).select('monthlyFee fee registrationDate feeHistory').lean();
    if (!students.length) return none;

    const payments = await Payment.find({
        studentId: { $in: students.map((s) => s._id) },
        status: 'Completed'
    }).select('studentId amount billingCycle paymentDate').lean();

    const paidByStudentCycle = new Map();
    for (const p of payments) {
        const key = p.billingCycle || (p.paymentDate ? cycleKeyForDate(p.paymentDate) : null);
        if (!key || key >= cycle) continue;
        const k = `${p.studentId}|${key}`;
        paidByStudentCycle.set(k, (paidByStudentCycle.get(k) || 0) + (Number(p.amount) || 0));
    }

    let debt = 0;
    const rows = [];
    for (const s of students) {
        const regCycle = cycleKeyForDate(s.registrationDate);
        for (let c = regCycle > firstCycle ? regCycle : firstCycle; c < cycle; c = addCycles(c, 1)) {
            const fee = getStudentFeeForCycle(s, c);
            if (fee <= 0) continue;
            const paid = paidByStudentCycle.get(`${s._id}|${c}`) || 0;
            const owed = Math.max(0, fee - paid);
            debt += owed;
            if (detail && owed > 0) rows.push({ studentId: String(s._id), month: c, fee, paid, balance: owed });
        }
    }
    return detail ? { debt, rows } : debt;
};

// Generates the payer list for live Previous Debt across all cycles before currentCycle,
// strictly matching computePreviousDebt's total.
const getPreviousDebtPayers = async (cycle = currentCycle()) => {
    const [firstByDate, firstByKey] = await Promise.all([
        Payment.findOne({ status: 'Completed', paymentDate: { $ne: null } }).sort({ paymentDate: 1 }).select('paymentDate').lean(),
        Payment.findOne({ status: 'Completed', billingCycle: { $nin: [null, ''] } }).sort({ billingCycle: 1 }).select('billingCycle').lean()
    ]);
    const starts = [
        firstByDate && cycleKeyForDate(firstByDate.paymentDate),
        firstByKey && firstByKey.billingCycle
    ].filter(Boolean).sort();
    const firstCycle = starts[0];
    if (!firstCycle || firstCycle >= cycle) return [];

    const { end: lastEnd } = cycleRange(addCycles(cycle, -1));
    const studentQuery = {
        status: { $nin: ['Inactive', 'Exited'] },
        registrationDate: { $lte: lastEnd }
    };
    const students = await Student.find(studentQuery)
        .select('fullName fatherName fatherPhone guardianId monthlyFee fee classId registrationDate status studentCode feeHistory')
        .populate({ path: 'classId', select: 'name className branchId', populate: { path: 'branchId', select: 'name' } })
        .populate('guardianId', 'fullName phone alternatePhone relationship')
        .lean();
    if (!students.length) return [];

    const payments = await Payment.find({
        studentId: { $in: students.map((s) => s._id) },
        status: 'Completed'
    }).select('studentId amount billingCycle paymentDate').lean();

    const paidByStudentCycle = new Map();
    for (const p of payments) {
        const key = p.billingCycle || (p.paymentDate ? cycleKeyForDate(p.paymentDate) : null);
        if (!key || key >= cycle) continue;
        const k = `${p.studentId}|${key}`;
        paidByStudentCycle.set(k, (paidByStudentCycle.get(k) || 0) + (Number(p.amount) || 0));
    }

    const groups = new Map();
    for (const s of students) {
        const regCycle = cycleKeyForDate(s.registrationDate);
        let studentTotalFee = 0;
        let studentTotalPaid = 0;
        let studentTotalOwed = 0;

        for (let c = regCycle > firstCycle ? regCycle : firstCycle; c < cycle; c = addCycles(c, 1)) {
            const fee = getStudentFeeForCycle(s, c);
            if (fee <= 0) continue;
            const paid = paidByStudentCycle.get(`${s._id}|${c}`) || 0;
            const owed = Math.max(0, fee - paid);
            const credited = Math.min(fee, paid);
            studentTotalFee += fee;
            studentTotalPaid += credited;
            studentTotalOwed += owed;
        }

        if (studentTotalFee <= 0) continue;

        const guardian = s.guardianId && typeof s.guardianId === 'object' ? s.guardianId : null;
        const payerName = guardian?.fullName || s.fatherName || '';
        const payerPhone = guardian?.phone || s.fatherPhone || '';
        const payerAltPhone = guardian?.alternatePhone || '';
        const phoneKey = digitsOnly(payerPhone);
        const key = (guardian?._id && `g:${guardian._id}`) || phoneKey || `s:${s._id}`;

        if (!groups.has(key)) {
            groups.set(key, {
                key,
                name: payerName,
                phone: payerPhone,
                alternatePhone: payerAltPhone,
                relationship: guardian?.relationship || '',
                guardianId: guardian?._id || null,
                students: [],
                totalFee: 0,
                paidAmount: 0,
                remaining: 0
            });
        }

        const g = groups.get(key);
        g.students.push({
            studentId: s._id,
            name: s.fullName,
            studentCode: s.studentCode || '',
            className: classDisplayName(s.classId),
            monthlyFee: studentTotalFee,
            paid: studentTotalPaid,
            remaining: studentTotalOwed,
            isPaid: studentTotalFee > 0 && studentTotalPaid >= studentTotalFee
        });
        g.totalFee += studentTotalFee;
        g.paidAmount += studentTotalPaid;
        g.remaining += studentTotalOwed;
        if (!g.name && payerName) g.name = payerName;
        if (!g.phone && payerPhone) g.phone = payerPhone;
        if (!g.alternatePhone && payerAltPhone) g.alternatePhone = payerAltPhone;
        if (!g.relationship && guardian?.relationship) g.relationship = guardian.relationship;
    }

    const result = [];
    for (const g of groups.values()) {
        const isPaid = g.totalFee > 0 && g.paidAmount >= g.totalFee;
        result.push({
            key: g.key,
            name: g.name || 'Unknown',
            phone: g.phone,
            alternatePhone: g.alternatePhone || '',
            relationship: g.relationship || '',
            guardianId: g.guardianId,
            studentIds: g.students.map((s) => s.studentId),
            students: g.students,
            studentCount: g.students.length,
            totalFee: g.totalFee,
            paidAmount: g.paidAmount,
            remaining: g.remaining,
            paid: isPaid,
            month: 'previous',
            cycle: `before-${cycle}`,
            isPreviousDebt: true
        });
    }

    result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return result;
};

// The payer (fee-responsible person) shown for a student: the linked guardian's
// name, else the denormalised father name.
const payerNameOf = (student) => {
    const g = student && student.guardianId && typeof student.guardianId === 'object' ? student.guardianId : null;
    return (g && g.fullName) || student?.fatherName || '—';
};

// ---------------------------------------------------------------------------
// FINANCE CARD DETAIL — the record-level rows behind each Dashboard finance card.
// Every branch below reuses the SAME source + filter as the matching total, so a
// report's summed rows always equal the card's headline figure. Institute-wide:
// no branchId filter is ever applied. `columns` describes the report layout (and
// which columns are money/date) so the frontend and print view render generically.
// ---------------------------------------------------------------------------
const financeCardDetail = async (cardKey, cycle = currentCycle()) => {
    const num = (v) => Number(v) || 0;
    const sumRows = (rows) => rows.reduce((a, r) => a + num(r.amount), 0);

    switch (cardKey) {
        // 1. Student Fees Collected — the same completed payments computeFeeTotals
        // sums as `collected` (current-cycle payments for the active student set).
        case 'studentFeesCollected': {
            const { students } = await fetchStudentFeeData(cycle, { registrationBound: true });
            const byId = new Map(students.map((s) => [String(s._id), s]));
            const studentIds = students.map((s) => s._id);
            const payments = studentIds.length
                ? await Payment.find({
                    studentId: { $in: studentIds }, status: 'Completed',
                    ...cycleMatch('billingCycle', 'paymentDate', cycle)
                }).select('studentId amount paymentDate billingCycle').sort({ paymentDate: 1 }).lean()
                : [];
            const rows = payments.map((p) => {
                const s = byId.get(String(p.studentId));
                return {
                    studentName: s?.fullName || '—',
                    studentId: s?.studentCode || String(p.studentId),
                    payer: payerNameOf(s),
                    amount: num(p.amount),
                    paymentDate: p.paymentDate || null,
                    billingCycle: p.billingCycle || cycle
                };
            });
            return {
                title: 'Student Fees Collected',
                columns: [
                    { key: 'studentName', label: 'Student Name' },
                    { key: 'studentId', label: 'Student ID' },
                    { key: 'payer', label: 'Payer' },
                    { key: 'amount', label: 'Amount', money: true },
                    { key: 'paymentDate', label: 'Payment Date', date: true },
                    { key: 'billingCycle', label: 'Billing Cycle' }
                ],
                rows,
                total: sumRows(rows)
            };
        }

        // 3. Pending Student Fees — same active student set + paid map as
        // computeFeeTotals; pending = max(0, fee - paid), summed = `pending`.
        case 'pendingStudentFees': {
            const { students, paidByStudent } = await fetchStudentFeeData(cycle, { registrationBound: true });
            const rows = [];
            for (const s of students) {
                const fee = getStudentFeeForCycle(s, cycle);
                const paid = paidByStudent.get(String(s._id)) || 0;
                const pending = Math.max(0, fee - paid);
                if (pending <= 0) continue;
                rows.push({
                    studentName: s.fullName || '—',
                    studentId: s.studentCode || String(s._id),
                    monthlyFee: fee,
                    paidAmount: paid,
                    amount: pending, // the report's summed column = pending total
                    payer: payerNameOf(s)
                });
            }
            return {
                title: 'Pending Student Fees',
                columns: [
                    { key: 'studentName', label: 'Student Name' },
                    { key: 'studentId', label: 'Student ID' },
                    { key: 'monthlyFee', label: 'Monthly Fee', money: true },
                    { key: 'paidAmount', label: 'Paid', money: true },
                    { key: 'amount', label: 'Pending', money: true },
                    { key: 'payer', label: 'Payer' }
                ],
                rows,
                total: sumRows(rows)
            };
        }

        // 2. Total Income / 4. Total Expenses — the Transaction ledger, the single
        // source of truth, filtered by type + date within the current cycle (same
        // filter as totalIncomeAgg / totalExpensesAgg). Institute-wide.
        case 'totalIncome':
        case 'totalExpenses': {
            const isIncome = cardKey === 'totalIncome';
            const { start, end } = cycleRange(cycle);
            const txns = await Transaction.find({ type: isIncome ? 'Income' : 'Expense', date: { $gte: start, $lte: end } })
                .select('date description amount referenceId walletId')
                .populate('walletId', 'name')
                .sort({ date: 1 })
                .lean();
            const rows = txns.map((t) => ({
                date: t.date || null,
                description: t.description || '—',
                wallet: (t.walletId && t.walletId.name) || '—',
                amount: num(t.amount),
                reference: t.referenceId ? String(t.referenceId) : '—'
            }));
            const columns = isIncome
                ? [
                    { key: 'date', label: 'Date', date: true },
                    { key: 'description', label: 'Category / Description' },
                    { key: 'wallet', label: 'Receiver / Wallet' },
                    { key: 'amount', label: 'Amount', money: true },
                    { key: 'reference', label: 'Reference' }
                ]
                : [
                    { key: 'date', label: 'Date', date: true },
                    { key: 'description', label: 'Category / Description' },
                    { key: 'wallet', label: 'Sender / Wallet' },
                    { key: 'amount', label: 'Amount', money: true },
                    { key: 'reference', label: 'Reference' }
                ];
            return {
                title: isIncome ? 'Total Income' : 'Total Expenses',
                columns,
                rows,
                total: sumRows(rows)
            };
        }

        default:
            return null;
    }
};

// One row per responsible payer (father / guardian): name, number, how many
// students they cover, the total monthly fee, and whether it's fully paid this month.
const getPayers = asyncHandler(async (req, res) => {
    // 1. Live Previous Debt view: all unpaid arrears from cycles before current,
    // exactly matching the Dashboard's Previous Debt card total.
    if (req.query.view === 'previousDebt' || req.query.month === 'previous') {
        const livePreviousPayers = await getPreviousDebtPayers(currentCycle());
        return res.json(livePreviousPayers);
    }

    // The `month` param is now a BILLING CYCLE key (25th→24th), not a calendar
    // month. Without it: the current cycle, every active student (Payers page).
    const requestedCycle = isValidCycleKey(req.query.month || '') ? req.query.month : null;
    const cycle = requestedCycle || currentCycle();

    // 2. Sealed Historical Cycle Snapshot: closed historical cycle requested, serve the sealed snapshot.
    // Immutable: payments made later do not alter historical cycle debt.
    if (requestedCycle && requestedCycle < currentCycle()) {
        const snapshot = await ensureCycleSnapshot(requestedCycle);
        if (snapshot && Array.isArray(snapshot.payers) && snapshot.payers.length > 0) {
            return res.json(snapshot.payers);
        }
    }

    // Reuse the shared fee-data calculation. Monthly Payments (a specific cycle)
    // bounds students to those registered by the cycle end; the Payers page (no
    // cycle) lists every active student. Registration-window rationale:
    //   • older active students keep appearing in later cycles;
    //   • a newly registered student appears from their registration cycle onward
    //     (registered Oct 24 → from the September cycle [ends Oct 24]; Oct 25 →
    //     from October). Inactive/Exited stay excluded (Exit behaviour preserved).
    const { students, paidByStudent } = await fetchStudentFeeData(cycle, { registrationBound: !!requestedCycle });

    const groups = new Map();
    for (const s of students) {
        // Group by the fee payer (guardian), not the responsible person.
        const guardian = s.guardianId && typeof s.guardianId === 'object' ? s.guardianId : null;
        const payerName = guardian?.fullName || s.fatherName || '';
        const payerPhone = guardian?.phone || s.fatherPhone || '';
        const payerAltPhone = guardian?.alternatePhone || '';
        const phoneKey = digitsOnly(payerPhone);
        const key = (guardian?._id && `g:${guardian._id}`) || phoneKey || `s:${s._id}`;
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                name: payerName,
                phone: payerPhone,
                alternatePhone: payerAltPhone,
                relationship: guardian?.relationship || '',
                guardianId: guardian?._id || null,
                students: [],
                totalFee: 0
            });
        }
        const sFee = getStudentFeeForCycle(s, cycle);
        const g = groups.get(key);
        g.students.push(s);
        g.totalFee += sFee;
        if (!g.name && payerName) g.name = payerName;
        if (!g.phone && payerPhone) g.phone = payerPhone;
        if (!g.alternatePhone && payerAltPhone) g.alternatePhone = payerAltPhone;
        if (!g.relationship && guardian?.relationship) g.relationship = guardian.relationship;
    }

    const result = [];
    for (const g of groups.values()) {
        // Per-student paid / remaining for the month.
        const studentDetails = [];
        let paidAmount = 0;
        for (const s of g.students) {
            const paid = paidByStudent.get(String(s._id)) || 0;
            const fee = getStudentFeeForCycle(s, cycle);
            paidAmount += paid;
            studentDetails.push({
                studentId: s._id,
                name: s.fullName,
                className: classDisplayName(s.classId),
                monthlyFee: fee,
                paid,
                remaining: Math.max(0, fee - paid),
                isPaid: fee > 0 && paid >= fee
            });
        }
        result.push({
            key: g.key,
            name: g.name || 'Unknown',
            phone: g.phone,
            alternatePhone: g.alternatePhone || '',
            relationship: g.relationship || '',
            guardianId: g.guardianId,
            studentIds: g.students.map((s) => s._id),
            students: studentDetails,
            studentCount: g.students.length,
            totalFee: g.totalFee,
            paidAmount,
            remaining: Math.max(0, g.totalFee - paidAmount),
            paid: g.totalFee > 0 && paidAmount >= g.totalFee,
            month: cycle,
            cycle
        });
    }
    result.sort((a, b) => a.name.localeCompare(b.name));
    res.json(result);
});

// Tick / untick "paid" for a payer. Ticking records the remaining fee as a
// Payment for each of their students (crediting the wallet); unticking removes
// only the payments this toggle created and reverses the wallet.
const togglePayer = asyncHandler(async (req, res) => {
    const { studentIds, paid } = req.body;
    if (!Array.isArray(studentIds) || !studentIds.length) {
        res.status(400);
        throw new Error('No students provided for this payer');
    }

    // Quick-pay applies to the CURRENT billing cycle (25th→24th).
    const cycle = currentCycle();
    const lock = await CycleLock.findOne({ cycleKey: cycle, isLocked: true });
    if (lock) {
        res.status(403);
        throw new Error(`Wareegga xisaabeed ee ${cycle} waa xiran yahay (Cycle is locked). Ma beddeli kartid bixinta ardayda wareeggan xiran.`);
    }

    // Exited students are excluded from quick-pay so no new money can be attached
    // to an archived student.
    const students = await Student.find({ _id: { $in: studentIds }, status: { $ne: 'Exited' } })
        .select('fullName monthlyFee fee guardianId branchId feeHistory');

    if (paid) {
        const wallet = await resolveWallet(req.body.walletId, req.user?.branchId);
        // No wallet → do not catch any money.
        if (!wallet) {
            res.status(400);
            throw new Error('No wallet found in the system. Create a wallet before recording payments.');
        }
        for (const s of students) {
            const existing = await Payment.find({
                studentId: s._id, status: 'Completed', ...cycleMatch('billingCycle', 'paymentDate', cycle)
            }).select('amount');
            const already = existing.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
            const fee = getStudentFeeForCycle(s, cycle);
            const remaining = Math.max(0, fee - already);
            if (remaining <= 0) continue;

            const payment = await Payment.create({
                studentId: s._id,
                guardianId: s.guardianId || undefined,
                walletId: wallet?._id,
                amount: remaining,
                month: cycle,
                billingCycle: cycle,
                paymentDate: new Date(),
                paymentMethod: 'Cash',
                status: 'Completed',
                description: 'Payer table quick-pay',
                viaPayerToggle: true
            });

            if (wallet) {
                await Transaction.create({
                    branchId: wallet.branchId || req.user?.branchId || null,
                    walletId: wallet._id,
                    type: 'Income',
                    amount: remaining,
                    referenceId: payment._id,
                    description: `Payer quick-pay: ${s.fullName}`,
                    date: new Date(),
                    createdBy: req.user?._id
                });
                wallet.balance = (wallet.balance || 0) + remaining;
            }
        }
        if (wallet) await wallet.save();
    } else {
        // Remove only payments this toggle created (this cycle), reversing their wallet effect.
        const pays = await Payment.find({
            studentId: { $in: studentIds }, viaPayerToggle: true,
            ...cycleMatch('billingCycle', 'paymentDate', cycle)
        });
        for (const p of pays) {
            if (p.walletId) {
                const w = await Wallet.findById(p.walletId);
                if (w) {
                    w.balance = Math.max(0, (w.balance || 0) - Number(p.amount || 0));
                    await w.save();
                }
            }
            await Transaction.deleteMany({ referenceId: p._id });
            await p.deleteOne();
        }
    }

    res.json({ message: 'Payer payment updated' });
});

module.exports = {
    getCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    getEntries,
    getDeletedEntries,
    createEntry,
    updateEntry,
    deleteEntry,
    restoreEntry,
    lookupPhone,
    getPayers,
    togglePayer,
    computeFeeTotals,
    computePreviousDebt
};
