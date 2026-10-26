const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
    {
        action: {
            type: String,
            required: true,
            enum: ['DELETE', 'RESTORE', 'CREATE', 'UPDATE', 'AUTH', 'SYSTEM'],
            default: 'DELETE'
        },
        entityType: {
            type: String,
            required: true,
            enum: ['Teacher', 'User', 'Student', 'Payment', 'CashbookEntry', 'Class', 'Subject', 'Salary', 'Wallet', 'Other'],
            default: 'Other'
        },
        entityId: {
            type: String,
            required: true
        },
        entityName: {
            type: String,
            default: ''
        },
        entityCode: {
            type: String,
            default: ''
        },
        deletedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        deletedByName: {
            type: String,
            default: 'System / Admin'
        },
        deletedByEmail: {
            type: String,
            default: ''
        },
        deletedByRole: {
            type: String,
            default: 'Admin'
        },
        deletedAt: {
            type: Date,
            default: Date.now
        },
        snapshot: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },
        status: {
            type: String,
            enum: ['Deleted', 'Restored'],
            default: 'Deleted'
        },
        restoredAt: {
            type: Date,
            default: null
        },
        restoredBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        restoredByName: {
            type: String,
            default: ''
        },
        ipAddress: {
            type: String,
            default: ''
        },
        userAgent: {
            type: String,
            default: ''
        },
        reason: {
            type: String,
            default: ''
        }
    },
    {
        timestamps: true
    }
);

auditLogSchema.index({ action: 1, entityType: 1, createdAt: -1 });
auditLogSchema.index({ deletedAt: -1 });
auditLogSchema.index({ status: 1 });
auditLogSchema.index({ entityType: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
