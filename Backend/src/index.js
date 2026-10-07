if (process.env.USE_LOCAL_DB === 'true') {
    require('dotenv').config({ path: '.env.local' });
}
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./db');
const { errorHandler } = require('./middleware/errorMiddleware');
const { assertJwtSecret } = require('./config/jwt');

// Fail fast in production if critical secrets are missing, rather than booting
// with insecure defaults.
assertJwtSecret();

process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]:', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]:', reason);
});

// Connect to Database and auto-seed admin
const seedAdminUser = async () => {
    try {
        const User = require('./models/User');
        const Role = require('./models/Role');
        const adminEmail = (process.env.ADMIN_EMAIL || 'admin@machad.edu').trim().toLowerCase();
        const adminPassword = process.env.ADMIN_PASSWORD || 'Machad!Admin2026#';
        const adminName = (process.env.ADMIN_NAME || 'System Administrator').trim();

        let ownerRole = await Role.findOne({ name: 'Owner' });
        if (!ownerRole) {
            ownerRole = await Role.create({
                name: 'Owner',
                description: 'Full system access - Business Owner',
                isSystemRole: true
            });
        }

        let adminUser = await User.findOne({ email: adminEmail });

        if (!adminUser) {
            adminUser = await User.create({
                fullName: adminName,
                email: adminEmail,
                passwordHash: adminPassword,
                role: 'Super Admin',
                roles: [ownerRole._id],
                status: 'active'
            });
            console.log(`✓ Admin user seeded (${adminEmail}). Password taken from ADMIN_PASSWORD env.`);
        } else {
            // Keep the admin's role/status correct but never touch an existing
            // password here — that is managed by the user, not overwritten on boot.
            adminUser.fullName = adminUser.fullName || adminName;
            adminUser.role = 'Super Admin';
            adminUser.roles = [ownerRole._id];
            adminUser.status = 'active';
            await adminUser.save();
        }
    } catch (error) {
        console.error('Auto-seed error:', error.message);
    }
};

connectDB().then(async () => {
    const TeacherAttendance = require('./models/TeacherAttendance');
    const StudentAttendance = require('./models/StudentAttendance');
    await Promise.all([
        TeacherAttendance.removeLegacyDailyUniqueIndex(),
        StudentAttendance.removeLegacyDailyUniqueIndex()
    ]);
    await seedAdminUser();
    const healFeeHistory = require('./utils/healFeeHistory');
    await healFeeHistory();
    const { ensureCycleSnapshot } = require('./services/cycleSnapshotService');
    const { previousCycle, currentCycle } = require('./utils/billingCycle');
    await ensureCycleSnapshot(previousCycle(currentCycle())).catch((e) => {
        console.error('Initial cycle snapshot check:', e.message);
    });
}).catch(err => {
    console.error('Failed to connect to MongoDB on startup. The server will start, but DB operations will fail until connection is established:', err.message);
});

const app = express();

// CORS. Set FRONTEND_URL to your deployed frontend origin(s) in production
// (comma-separated for multiple, e.g. "https://your-app.vercel.app").
const allowedOrigins = (process.env.FRONTEND_URL || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
    console.warn('[WARN] FRONTEND_URL is not set in production — CORS is reflecting ALL origins. Set FRONTEND_URL to lock this down to your frontend.');
}

app.use(cors({
    // When FRONTEND_URL is configured, only those origins are allowed.
    // Otherwise (local/dev) reflect the request origin so tooling works.
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true
}));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

// Routes
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/roles', require('./routes/roleRoutes'));
app.use('/api/branches', require('./routes/branchRoutes'));
app.use('/api/classes', require('./routes/clsRoutes'));
app.use('/api/guardians', require('./routes/guardianRoutes'));
app.use('/api/students', require('./routes/studentRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/student-attendance', require('./routes/studentAttendanceRoutes'));
app.use('/api/teacher-attendance', require('./routes/teacherAttendanceRoutes'));
app.use('/api/branch-sessions', require('./routes/branchSessionRoutes'));
app.use('/api/promotions', require('./routes/promotionRoutes'));
app.use('/api/salaries', require('./routes/salaryRoutes'));
app.use('/api/wallets', require('./routes/walletRoutes'));
app.use('/api/transactions', require('./routes/transactionRoutes'));
app.use('/api/cashbook', require('./routes/cashbookRoutes'));
app.use('/api/expenses', require('./routes/expenseRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/quran/surahs', require('./routes/quranSurahRoutes'));
app.use('/api/quran/lessons', require('./routes/quranLessonRoutes'));
app.use('/api/cycle-locks', require('./routes/cycleLockRoutes'));

// Unchanged AI/Analytics/Dashboard/Settings routes if they are generic, 
// but we deleted their routes. We can re-add them if needed, but since we deleted them let's remove.
// Wait, I only deleted specific warehouse ones. Let's see what I kept:
// aiRoutes, aiAnalyticsRoutes, dashboardRoutes, settingsRoutes, tenantRoutes, etc.
app.use('/api/ai', require('./routes/aiRoutes'));
app.use('/api/analytics', require('./routes/aiAnalyticsRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/settings', require('./routes/settingsRoutes'));
app.use('/api/tenants', require('./routes/tenantRoutes'));
app.use('/api/exams', require('./routes/examRoutes'));

// Health check. Deliberately minimal: reports liveness and DB connection state
// only — never credentials, connection strings, hostnames, or record counts.
app.get('/api/health', (req, res) => {
    const mongoose = require('mongoose');
    const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        database: dbStates[mongoose.connection.readyState] || 'unknown',
        timestamp: new Date()
    });
});

app.get('/', (req, res) => {
    res.send('Institute API is running...');
});

// Error Middleware
app.use(errorHandler);

const PORT = process.env.PORT || 5005; // Was 5005 in .env

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);

    // Render Keep-Alive: Ping server every 10 minutes so Render's free tier
    // does not spin the service down. Uses the URL Render injects at runtime;
    // if it is not present we skip keep-alive rather than pinging a stale host.
    const targetUrl = process.env.RENDER_EXTERNAL_URL;
    const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);
    if (isProduction && targetUrl) {
        const axios = require('axios');
        const PING_INTERVAL = 10 * 60 * 1000; // 10 minutes
        setInterval(async () => {
            try {
                await axios.get(`${targetUrl}/api/health`, { timeout: 15000 });
                console.log(`[Keep-Alive] Pinged ${targetUrl}/api/health successfully.`);
            } catch (err) {
                console.warn(`[Keep-Alive] Ping note: ${err.message}`);
            }
        }, PING_INTERVAL);
    }
});
