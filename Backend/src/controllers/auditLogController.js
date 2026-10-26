const asyncHandler = require('../middleware/asyncHandler');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const Student = require('../models/Student');
const CashbookEntry = require('../models/CashbookEntry');
const ClassModel = require('../models/Class');
const Payment = require('../models/Payment');
const { cycleRange } = require('../utils/billingCycle');

// @desc    Get all audit logs with optional filters
// @route   GET /api/audit-logs
// @access  Private (Admin / Owner)
const getAuditLogs = asyncHandler(async (req, res) => {
    const { entityType, status, action, search, cycle } = req.query;

    const query = {};

    if (entityType && entityType !== 'All') {
        query.entityType = entityType;
    }

    if (status && status !== 'All') {
        query.status = status;
    }

    if (action && action !== 'All') {
        query.action = action;
    }

    if (cycle && cycle !== 'All') {
        const { start, end } = cycleRange(cycle);
        const startISO = start.toISOString().slice(0, 10);
        const endISO = end.toISOString().slice(0, 10);
        query.$or = [
            { deletedAt: { $gte: start, $lte: end } },
            { createdAt: { $gte: start, $lte: end } },
            { 'snapshot.billingCycle': cycle },
            { 'snapshot.targetMonth': cycle },
            { 'snapshot.month': cycle },
            { 'snapshot.date': { $gte: startISO, $lte: endISO } }
        ];
    }

    if (search && search.trim()) {
        const regex = new RegExp(search.trim(), 'i');
        const searchCond = {
            $or: [
                { entityName: regex },
                { entityCode: regex },
                { deletedByName: regex },
                { deletedByEmail: regex },
                { deletedByRole: regex },
                { ipAddress: regex }
            ]
        };
        if (query.$or) {
            query.$and = [{ $or: query.$or }, searchCond];
            delete query.$or;
        } else {
            query.$or = searchCond.$or;
        }
    }

    const logs = await AuditLog.find(query)
        .sort({ createdAt: -1 })
        .limit(300)
        .lean();

    res.json(logs);
});

// @desc    Get summary statistics for audit & trash
// @route   GET /api/audit-logs/stats
// @access  Private
const getAuditStats = asyncHandler(async (req, res) => {
    const { cycle } = req.query;
    const baseQuery = {};
    if (cycle && cycle !== 'All') {
        const { start, end } = cycleRange(cycle);
        const startISO = start.toISOString().slice(0, 10);
        const endISO = end.toISOString().slice(0, 10);
        baseQuery.$or = [
            { deletedAt: { $gte: start, $lte: end } },
            { createdAt: { $gte: start, $lte: end } },
            { 'snapshot.billingCycle': cycle },
            { 'snapshot.targetMonth': cycle },
            { 'snapshot.month': cycle },
            { 'snapshot.date': { $gte: startISO, $lte: endISO } }
        ];
    }

    const [totalDeleted, teachersDeleted, studentsDeleted, totalRestored, totalLogs] = await Promise.all([
        AuditLog.countDocuments({ ...baseQuery, status: 'Deleted' }),
        AuditLog.countDocuments({ ...baseQuery, entityType: 'Teacher', status: 'Deleted' }),
        AuditLog.countDocuments({ ...baseQuery, entityType: 'Student', status: 'Deleted' }),
        AuditLog.countDocuments({ ...baseQuery, status: 'Restored' }),
        AuditLog.countDocuments(baseQuery)
    ]);

    res.json({
        totalDeleted,
        teachersDeleted,
        studentsDeleted,
        totalRestored,
        totalLogs
    });
});

// @desc    Get single audit log by ID
// @route   GET /api/audit-logs/:id
// @access  Private
const getAuditLogById = asyncHandler(async (req, res) => {
    const log = await AuditLog.findById(req.params.id).lean();
    if (!log) {
        res.status(404);
        throw new Error('Audit record not found');
    }
    res.json(log);
});

// @desc    Restore a deleted record from trash / snapshot
// @route   POST /api/audit-logs/:id/restore
// @access  Private
const restoreAuditLog = asyncHandler(async (req, res) => {
    const log = await AuditLog.findById(req.params.id);
    if (!log) {
        res.status(404);
        throw new Error('Audit record not found');
    }

    if (log.status === 'Restored') {
        res.status(400);
        throw new Error('Record has already been restored');
    }

    const snapshot = log.snapshot || {};
    let restoredRecord = null;

    if (log.entityType === 'Teacher' || log.entityType === 'User') {
        // Check if teacher/user already exists by email or phone
        const existing = await User.findOne({
            $or: [
                snapshot.email ? { email: snapshot.email } : null,
                snapshot.phone ? { phone: snapshot.phone } : null
            ].filter(Boolean)
        });

        if (existing) {
            res.status(400);
            throw new Error(`Macallin ama user wata email "${snapshot.email}" ama phone "${snapshot.phone}" ayaa hadda jira.`);
        }

        const toRestore = { ...snapshot };
        delete toRestore._id;
        delete toRestore.__v;
        delete toRestore.createdAt;
        delete toRestore.updatedAt;

        restoredRecord = await User.create(toRestore);
    } else if (log.entityType === 'Student') {
        const toRestore = { ...snapshot };
        delete toRestore._id;
        delete toRestore.__v;
        delete toRestore.createdAt;
        delete toRestore.updatedAt;

        // Ensure status is restored to active
        if (toRestore.status === 'Exited' || toRestore.status === 'Inactive') {
            toRestore.status = 'Active';
        }

        restoredRecord = await Student.create(toRestore);
    } else if (log.entityType === 'CashbookEntry') {
        const toRestore = { ...snapshot };
        delete toRestore._id;
        delete toRestore.__v;
        delete toRestore.createdAt;
        delete toRestore.updatedAt;
        toRestore.isDeleted = false;
        toRestore.deletedAt = null;
        toRestore.deletedBy = null;
        toRestore.deletedByName = '';
        toRestore.deletedByRole = '';

        restoredRecord = await CashbookEntry.create(toRestore);
    } else if (log.entityType === 'Class') {
        const toRestore = { ...snapshot };
        delete toRestore._id;
        delete toRestore.__v;
        delete toRestore.createdAt;
        delete toRestore.updatedAt;

        restoredRecord = await ClassModel.create(toRestore);
    } else if (log.entityType === 'Payment') {
        const toRestore = { ...snapshot };
        delete toRestore._id;
        delete toRestore.__v;
        delete toRestore.createdAt;
        delete toRestore.updatedAt;

        restoredRecord = await Payment.create(toRestore);
    } else {
        res.status(400);
        throw new Error(`Dib u soo celinta nooca "${log.entityType}" hadda lama taageero.`);
    }

    log.status = 'Restored';
    log.restoredAt = new Date();
    log.restoredBy = req.user?._id;
    log.restoredByName = req.user?.fullName || req.user?.name || 'Administrator';
    await log.save();

    res.json({
        message: `${log.entityType} "${log.entityName || ''}" si guul leh ayaa dib loogu soo celiyey.`,
        data: restoredRecord,
        log
    });
});

module.exports = {
    getAuditLogs,
    getAuditStats,
    getAuditLogById,
    restoreAuditLog
};
