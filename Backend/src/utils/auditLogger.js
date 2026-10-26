const AuditLog = require('../models/AuditLog');

const logAudit = async ({
    req,
    action = 'DELETE',
    entityType = 'Other',
    entityId,
    entityName,
    entityCode,
    snapshot,
    reason
}) => {
    try {
        const user = req?.user;
        const ip = req?.ip || req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '';
        const userAgent = req?.headers?.['user-agent'] || '';

        const cleanSnapshot = snapshot ? JSON.parse(JSON.stringify(snapshot)) : {};

        const entry = await AuditLog.create({
            action,
            entityType,
            entityId: String(entityId || cleanSnapshot?._id || ''),
            entityName: entityName || cleanSnapshot?.fullName || cleanSnapshot?.name || cleanSnapshot?.description || cleanSnapshot?.title || 'Unknown',
            entityCode: entityCode || cleanSnapshot?.teacherCode || cleanSnapshot?.studentCode || cleanSnapshot?.rollNumber || '',
            deletedBy: user?._id || null,
            deletedByName: user?.fullName || user?.name || user?.username || 'Administrator',
            deletedByEmail: user?.email || '',
            deletedByRole: user?.role || 'Admin',
            deletedAt: new Date(),
            snapshot: cleanSnapshot,
            status: action === 'DELETE' ? 'Deleted' : 'Restored',
            ipAddress: String(ip),
            userAgent: String(userAgent),
            reason: reason || ''
        });

        return entry;
    } catch (err) {
        console.error('Failed to write audit log:', err.message);
        return null;
    }
};

module.exports = { logAudit };
