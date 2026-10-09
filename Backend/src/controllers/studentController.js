const asyncHandler = require('../middleware/asyncHandler');
const Student = require('../models/Student');
const { generateStudentCode, withRetry } = require('../utils/generateCode');
const { currentCycle, addCycles, cycleKeyForDate } = require('../utils/billingCycle');

const getStudents = asyncHandler(async (req, res) => {
    // Status handling for the Exit/Archive feature:
    //   (no status)      → active workflows: everyone EXCEPT Exited (archived).
    //   ?status=Exited   → only exited students (Exit Students page).
    //   ?status=All      → everyone, exited included.
    //   ?status=<value>  → that exact status.
    const { status, branchId } = req.query;
    let filter;
    if (status === 'All') filter = {};
    else if (status) filter = { status };
    else filter = { status: { $ne: 'Exited' } };

    if (branchId && branchId !== 'ALL') {
        filter.branchId = branchId;
    }

    const data = await Student.find(filter)
        .populate('guardianId')
        .populate('branchId', 'name address phone')
        .populate({ path: 'classId', populate: { path: 'branchId', select: 'name' } })
        .lean();
    res.json(data);
});

const getStudentById = asyncHandler(async (req, res) => {
    const data = await Student.findById(req.params.id)
        .populate('guardianId')
        .populate('branchId', 'name address phone')
        .populate({ path: 'classId', populate: { path: 'branchId', select: 'name' } });
    if (data) {
        res.json(data);
    } else {
        res.status(404);
        throw new Error('Student not found');
    }
});

const createStudent = asyncHandler(async (req, res) => {
    const payload = { ...req.body };

    const trimmedName = (payload.fullName || '').trim();
    if (!trimmedName) {
        res.status(400);
        throw new Error('Fadlan geli magaca buuxa ee ardayga');
    }

    if (!payload.classId) {
        delete payload.classId;
    }

    if (!payload.branchId && req.user?.branchId) {
        payload.branchId = req.user.branchId;
    }

    // Duplicate check: Prevent registering the same student multiple times in the same branch
    const escapedName = trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const duplicateQuery = {
        fullName: { $regex: new RegExp(`^${escapedName}$`, 'i') },
        status: { $ne: 'Exited' }
    };
    if (payload.branchId) {
        duplicateQuery.branchId = payload.branchId;
    }

    const existingStudent = await Student.findOne(duplicateQuery)
        .populate('branchId', 'name')
        .populate('classId', 'name className');
    if (existingStudent) {
        const placeName = existingStudent.branchId?.name ? `xarunta "${existingStudent.branchId.name}"` : 'nidaamka';
        res.status(400);
        throw new Error(`Ardaygan "${trimmedName}" horey ayuu ugu jiraa ${placeName} (#${existingStudent.studentCode || ''})! Laguma celin karo laba jeer.`);
    }

    // The student ID is issued by the system, never accepted from the client and
    // never derived from the user-typed roll number, so it cannot be set by hand
    // or duplicated. Existing students keep whatever code they were given.
    delete payload.studentCode;
    // Each retry advances the counter, so a run of legacy students already
    // holding plain numbers is stepped over rather than colliding with.
    payload.studentCode = await withRetry(
        generateStudentCode,
        async (code) => Boolean(await Student.exists({ studentCode: code })),
        200
    );

    if (payload.fee !== undefined && payload.monthlyFee === undefined) {
        payload.monthlyFee = Number(payload.fee) || 0;
    }
    if (payload.monthlyFee !== undefined && payload.fee === undefined) {
        payload.fee = Number(payload.monthlyFee) || 0;
    }

    const startFee = Number(payload.monthlyFee || payload.fee || 0);
    const startCycle = (payload.registrationDate && cycleKeyForDate(payload.registrationDate)) || currentCycle();
    if (!Array.isArray(payload.feeHistory) || !payload.feeHistory.length) {
        payload.feeHistory = [
            { effectiveCycle: startCycle, amount: startFee, changedAt: payload.registrationDate || new Date() }
        ];
    }

    const data = await Student.create(payload);
    const populated = await Student.findById(data._id)
        .populate('guardianId')
        .populate('branchId', 'name address phone')
        .populate({ path: 'classId', populate: { path: 'branchId', select: 'name' } });
    res.status(201).json(populated || data);
});

const updateStudent = asyncHandler(async (req, res) => {
    const payload = { ...req.body };

    const existing = await Student.findById(req.params.id);
    if (!existing) {
        res.status(404);
        throw new Error('Student not found');
    }

    if (!payload.classId && payload.classId !== undefined) {
        delete payload.classId;
    }

    // Check duplicate if name or branch changed
    if (payload.fullName || payload.branchId !== undefined) {
        const targetName = (payload.fullName || existing.fullName || '').trim();
        const targetBranch = payload.branchId !== undefined ? payload.branchId : existing.branchId;
        const escapedName = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        const duplicateQuery = {
            _id: { $ne: existing._id },
            fullName: { $regex: new RegExp(`^${escapedName}$`, 'i') },
            status: { $ne: 'Exited' }
        };
        if (targetBranch) {
            duplicateQuery.branchId = targetBranch;
        }

        const duplicateCheck = await Student.findOne(duplicateQuery)
            .populate('branchId', 'name')
            .populate('classId', 'name className');

        if (duplicateCheck) {
            const placeName = duplicateCheck.branchId?.name ? `xarunta "${duplicateCheck.branchId.name}"` : 'nidaamka';
            res.status(400);
            throw new Error(`Arday magacan "${targetName}" leh horey ayuu ugu jiraa ${placeName}!`);
        }
    }

    // The issued student ID stays with the student for life, so an edit can never
    // move or clear it.
    delete payload.studentCode;

    if (payload.fee !== undefined && payload.monthlyFee === undefined) {
        payload.monthlyFee = Number(payload.fee) || 0;
    }
    if (payload.monthlyFee !== undefined && payload.fee === undefined) {
        payload.fee = Number(payload.monthlyFee) || 0;
    }

    if (payload.monthlyFee !== undefined) {
        const newFee = Number(payload.monthlyFee);
        const oldFee = Number(existing.monthlyFee ?? existing.fee ?? 0);
        const feeScope = payload.feeScope || 'current'; // 'current' | 'all' | 'previous'

        if (newFee !== oldFee || payload.feeScope) {
            const current = currentCycle();

            if (feeScope === 'all') {
                // Completely reset fee across ALL cycles (heals historical ghost arrears when an accidental increase or error is corrected)
                payload.feeHistory = [
                    { effectiveCycle: '2000-01', amount: newFee, changedAt: new Date() }
                ];
            } else if (feeScope === 'previous') {
                const prev = addCycles(current, -1);
                payload.feeHistory = [
                    { effectiveCycle: '2000-01', amount: oldFee, changedAt: existing.registrationDate || new Date() },
                    { effectiveCycle: prev, amount: newFee, changedAt: new Date() }
                ];
            } else {
                // feeScope === 'current' (default)
                let history = Array.isArray(existing.feeHistory) ? [...existing.feeHistory] : [];

                // Smart reversion: If reducing the fee (e.g. admin reverting an accidental increase
                // without choosing a scope), update any previous baseline entry that held the inflated oldFee
                // so the reduction cleanly heals the previous cycle instead of leaving it trapped at oldFee.
                if (newFee < oldFee) {
                    history = history.map((h) => (h.amount === oldFee ? { ...h, amount: newFee, changedAt: new Date() } : h));
                }

                const hasPrior = history.some((h) => h.effectiveCycle < current);
                if (!hasPrior && (newFee < oldFee ? newFee : oldFee) > 0) {
                    history.push({
                        effectiveCycle: '2000-01',
                        amount: newFee < oldFee ? newFee : oldFee,
                        changedAt: existing.registrationDate || new Date()
                    });
                }
                const currentEntry = history.find((h) => h.effectiveCycle === current);
                if (currentEntry) {
                    currentEntry.amount = newFee;
                    currentEntry.changedAt = new Date();
                } else {
                    history.push({
                        effectiveCycle: current,
                        amount: newFee,
                        changedAt: new Date()
                    });
                }
                history.sort((a, b) => (a.effectiveCycle || '').localeCompare(b.effectiveCycle || ''));
                payload.feeHistory = history;
            }
        }
    }

    const data = await Student.findByIdAndUpdate(req.params.id, payload, { new: true })
        .populate('guardianId')
        .populate('branchId', 'name address phone')
        .populate({ path: 'classId', populate: { path: 'branchId', select: 'name' } });
    if (data) {
        res.json(data);
    } else {
        res.status(404);
        throw new Error('Student not found');
    }
});

const deleteStudent = asyncHandler(async (req, res) => {
    const data = await Student.findByIdAndDelete(req.params.id);
    if (data) {
        res.json({ message: 'Student removed' });
    } else {
        res.status(404);
        throw new Error('Student not found');
    }
});

// @desc    Exit / archive a student (Active → Exited). NO data is deleted; the
//          student keeps the same id, fees, payments and history. Exit only flips
//          status and records who/when/why so every active workflow excludes them.
// @route   POST /api/students/:id/exit
const exitStudent = asyncHandler(async (req, res) => {
    const student = await Student.findById(req.params.id);
    if (!student) {
        res.status(404);
        throw new Error('Student not found');
    }
    if (student.status === 'Exited') {
        res.status(400);
        throw new Error('Student has already exited');
    }

    const reason = (req.body.exitReason ?? req.body.reason ?? req.body.description ?? '').toString().trim();
    student.status = 'Exited';
    student.exitReason = reason;
    student.exitDate = req.body.exitDate ? new Date(req.body.exitDate) : new Date();
    student.exitedBy = req.user?._id || null;
    student.exitedAt = new Date();
    await student.save();

    const populated = await Student.findById(student._id)
        .populate('guardianId')
        .populate({ path: 'classId', populate: { path: 'branchId', select: 'name' } })
        .populate('exitedBy', 'fullName email');
    res.json(populated);
});

// @desc    Full archive/history for one (exited or active) student — read-only.
// @route   GET /api/students/:id/archive
const getStudentArchive = asyncHandler(async (req, res) => {
    const Payment = require('../models/Payment');
    const StudentAttendance = require('../models/StudentAttendance');
    const ExamResult = require('../models/ExamResult');
    const Transaction = require('../models/Transaction');

    const student = await Student.findById(req.params.id)
        .populate('guardianId')
        .populate({ path: 'classId', populate: { path: 'branchId', select: 'name' } })
        .populate('branchId', 'name')
        .populate('exitedBy', 'fullName email');
    if (!student) {
        res.status(404);
        throw new Error('Student not found');
    }

    const payments = await Payment.find({ studentId: student._id })
        .populate('walletId', 'name type')
        .sort({ paymentDate: -1, createdAt: -1 })
        .lean();

    // Financials are computed ONLY from this student's own records — never mixed
    // with any other student.
    const registeredFee = Number(student.monthlyFee ?? student.fee ?? 0);
    const totalPaid = payments
        .filter(p => p.status === 'Completed')
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const remaining = Math.max(0, registeredFee - totalPaid);

    const paymentIds = payments.map(p => p._id);
    const [attendance, examResults, transactions] = await Promise.all([
        StudentAttendance.find({ studentId: student._id })
            .populate({ path: 'classId', select: 'name className branchId', populate: { path: 'branchId', select: 'name' } })
            .sort({ date: -1, createdAt: -1 })
            .lean(),
        ExamResult.find({ studentId: student._id })
            .populate('examId', 'name title term date')
            .sort({ createdAt: -1 })
            .lean(),
        paymentIds.length
            ? Transaction.find({ referenceId: { $in: paymentIds } }).populate('walletId', 'name type').sort({ date: -1 }).lean()
            : Promise.resolve([])
    ]);

    res.json({
        student,
        financial: { registeredFee, totalPaid, remaining },
        payments,
        attendance,
        examResults,
        transactions,
        exit: {
            status: student.status,
            exitReason: student.exitReason || '',
            exitDate: student.exitDate,
            exitedBy: student.exitedBy || null,
            exitedAt: student.exitedAt
        }
    });
});

// @desc    Restore an exited student back to Active status
// @route   POST /api/students/:id/restore
const restoreStudent = asyncHandler(async (req, res) => {
    const student = await Student.findById(req.params.id);
    if (!student) {
        res.status(404);
        throw new Error('Student not found');
    }
    student.status = 'Active';
    student.exitReason = '';
    student.exitDate = null;
    student.exitedBy = null;
    student.exitedAt = null;
    await student.save();

    const populated = await Student.findById(student._id)
        .populate('guardianId')
        .populate({ path: 'classId', populate: { path: 'branchId', select: 'name' } });
    res.json(populated);
});

module.exports = {
    getStudents,
    getStudentById,
    createStudent,
    updateStudent,
    deleteStudent,
    exitStudent,
    restoreStudent,
    getStudentArchive
};
