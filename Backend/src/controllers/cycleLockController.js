const asyncHandler = require('../middleware/asyncHandler');
const CycleLock = require('../models/CycleLock');
const CashbookEntry = require('../models/CashbookEntry');
const { cycleRange, cycleKeyForDate } = require('../utils/billingCycle');

// Check if user is an administrator or has financial cycle lock permission
const canManageCycleLocks = (user) => {
    if (!user) return false;
    const roleName = user.role || '';
    const allowed = ['Super Admin', 'Institute Admin', 'Admin', 'Branch Manager', 'Accountant', 'Owner'];
    if (allowed.includes(roleName)) return true;
    const roleNames = Array.isArray(user.roles) ? user.roles.map(r => (typeof r === 'string' ? r : r.name)) : [];
    if (roleNames.some(rn => allowed.includes(rn))) return true;
    if (user.customPermissions?.Finance?.LockCycles || user.customPermissions?.Finance?.Cashbook) return true;
    return false;
};

// @desc    Get all cycle locks
// @route   GET /api/cycle-locks
// @access  Private
const getCycleLocks = asyncHandler(async (req, res) => {
    const locks = await CycleLock.find().lean();
    res.json(locks);
});

// @desc    Toggle lock/unlock for a billing cycle
// @route   POST /api/cycle-locks/toggle
// @access  Private (Admin only)
const toggleCycleLock = asyncHandler(async (req, res) => {
    if (!canManageCycleLocks(req.user)) {
        res.status(403);
        throw new Error('Ma lihid awood aad ku qufulato ama ku furto wareegyada xisaabeed (Access denied).');
    }

    const { cycleKey, action, reason } = req.body;
    if (!cycleKey) {
        res.status(400);
        throw new Error('Fadlan dooro wareegga xisaabeed (cycleKey is required).');
    }

    let lock = await CycleLock.findOne({ cycleKey });
    if (!lock) {
        lock = new CycleLock({ cycleKey, isLocked: false });
    }

    const userName = req.user?.fullName || req.user?.name || 'Administrator';
    const userRole = req.user?.role || 'Admin';

    if (action === 'lock') {
        lock.isLocked = true;
        lock.lockedBy = req.user?._id;
        lock.lockedByName = userName;
        lock.lockedByRole = userRole;
        lock.lockedAt = new Date();
    } else if (action === 'unlock') {
        if (!reason || !reason.trim()) {
            res.status(400);
            throw new Error('Fadlan geli sababta aad u furayso wareeggan xiran (Reason is required to unlock).');
        }

        lock.isLocked = false;
        lock.unlockHistory.push({
            unlockedBy: req.user?._id,
            unlockedByName: userName,
            unlockedByRole: userRole,
            unlockedAt: new Date(),
            reason: reason.trim()
        });
    } else {
        res.status(400);
        throw new Error('Ficil aan la garanayn (Invalid action).');
    }

    await lock.save();
    res.json(lock);
});

// @desc    Get backdated adjustments affecting Opening Balance for a cycle
// @route   GET /api/cycle-locks/adjustments/:cycleKey
// @access  Private
const getCycleAdjustments = asyncHandler(async (req, res) => {
    const { cycleKey } = req.params;
    let range;
    try {
        range = cycleRange(cycleKey);
    } catch {
        return res.json({
            cycleKey,
            priorAdjustments: [],
            currentCycleAdjustments: [],
            netImpactOnOpeningBalance: 0
        });
    }

    const cycleStart = range.start.toISOString().split('T')[0];
    const cycleEnd = range.end.toISOString().split('T')[0];

    // Find entries dated BEFORE this cycle start that have isBackdated = true,
    // OR have backdatedReason (which directly affect Opening Balance)
    const priorAdjustments = await CashbookEntry.find({
        date: { $lt: cycleStart },
        $or: [
            { isBackdated: true },
            { backdatedReason: { $exists: true, $ne: '' } }
        ]
    })
        .populate('categoryId', 'title type')
        .populate('createdBy', 'fullName role')
        .sort({ createdAt: -1 })
        .lean();

    let netImpactOnOpeningBalance = 0;
    priorAdjustments.forEach(entry => {
        const type = entry.categoryId?.type || 'Income';
        const amt = Number(entry.amount) || 0;
        if (type === 'Income') netImpactOnOpeningBalance += amt;
        else netImpactOnOpeningBalance -= amt;
    });

    // Also find adjustments made directly in this cycle
    const currentCycleAdjustments = await CashbookEntry.find({
        $or: [
            { targetMonth: cycleKey },
            { date: { $gte: cycleStart, $lte: cycleEnd } }
        ],
        $and: [
            {
                $or: [
                    { isBackdated: true },
                    { backdatedReason: { $exists: true, $ne: '' } }
                ]
            }
        ]
    })
        .populate('categoryId', 'title type')
        .populate('createdBy', 'fullName role')
        .sort({ createdAt: -1 })
        .lean();

    res.json({
        cycleKey,
        cycleStart,
        cycleEnd,
        priorAdjustments,
        currentCycleAdjustments,
        netImpactOnOpeningBalance
    });
});

module.exports = {
    getCycleLocks,
    toggleCycleLock,
    getCycleAdjustments,
    canManageCycleLocks
};
