const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
    getAuditLogs,
    getAuditStats,
    getAuditLogById,
    restoreAuditLog
} = require('../controllers/auditLogController');

router.route('/')
    .get(protect, getAuditLogs);

router.route('/stats')
    .get(protect, getAuditStats);

router.route('/:id')
    .get(protect, getAuditLogById);

router.route('/:id/restore')
    .post(protect, restoreAuditLog);

module.exports = router;
