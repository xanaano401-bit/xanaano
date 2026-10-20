const asyncHandler = require('../middleware/asyncHandler');
const User = require('../models/User');
const { generateTeacherCode, withRetry } = require('../utils/generateCode');
const { normalizePermissions } = require('../utils/permissionUtils');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/jwt');

// Generate JWT
const generateToken = (id) => {
    return jwt.sign({ id }, getJwtSecret(), {
        expiresIn: '30d',
    });
};

// Helper: Format user response object
const formatUserResponse = (user, token = null) => {
    const obj = {
        _id: user._id,
        fullName: user.fullName,
        username: user.fullName,
        email: user.email,
        phone: user.phone || '',
        gender: user.gender || 'Male',
        role: user.role || 'Teacher',
        teacherCode: user.teacherCode || '',
        employeeCode: user.teacherCode || '',
        jobTitle: user.jobTitle || 'Teacher',
        customPermissions: user.customPermissions || {},
        masuulName: user.masuulName || '',
        masuulNumber: user.masuulNumber || '',
        roles: user.roles || [],
        salary: user.salary || 0,
        status: user.status || 'active',
        branchId: user.branchId || null,
        createdAt: user.createdAt
    };
    if (token) obj.token = token;
    return obj;
};

// @desc    Register / Create user
// @route   POST /api/users
// @access  Private
const registerUser = asyncHandler(async (req, res) => {
    const { fullName, username, phone, email, password, role, roles, salary, status, branchId, gender, masuulName, masuulNumber, jobTitle, teacherCode: customCode, employeeCode, customPermissions } = req.body;
    let cleanEmail = email ? String(email).trim().toLowerCase() : '';

    if (!cleanEmail) {
        const namePart = (fullName || username || 'employee').toLowerCase().replace(/[^a-z0-9]/g, '');
        cleanEmail = `${namePart}_${Date.now().toString().slice(-4)}@employee.local`;
    } else {
        const userExists = await User.findOne({ email: cleanEmail });
        if (userExists) {
            res.status(400);
            throw new Error('User with this email already exists');
        }
    }

    const nameToUse = fullName || username || cleanEmail.split('@')[0];
    const roleToUse = role || 'Teacher';

    let finalCode = (customCode || employeeCode || '').trim();
    if (finalCode) {
        const codeExists = await User.exists({ teacherCode: finalCode });
        if (codeExists) finalCode = '';
    }
    if (!finalCode && roleToUse === 'Teacher') {
        finalCode = await withRetry(
            generateTeacherCode,
            async (code) => Boolean(await User.exists({ teacherCode: code }))
        );
    }

    const user = await User.create({
        fullName: nameToUse,
        phone: phone || '',
        email: cleanEmail,
        // Admin-created accounts (e.g. teachers) get a default password the admin
        // can share, then the user changes it. Configurable via env; the hash hook
        // bcrypts it on save.
        passwordHash: password || process.env.DEFAULT_USER_PASSWORD || 'ChangeMe123',
        gender: gender || 'Male',
        role: roleToUse,
        jobTitle: (jobTitle || 'Teacher').trim(),
        roles: Array.isArray(roles) ? roles : [],
        salary: salary || 0,
        status: status || 'active',
        branchId,
        masuulName: masuulName || '',
        masuulNumber: masuulNumber || '',
        customPermissions: normalizePermissions(customPermissions),
        ...(finalCode ? { teacherCode: finalCode } : {})
    });

    const populatedUser = await User.findById(user._id).select('-passwordHash').populate('roles').populate('branchId', 'name address phone');

    if (user) {
        res.status(201).json(formatUserResponse(populatedUser, generateToken(user._id)));
    } else {
        res.status(400);
        throw new Error('Invalid user data');
    }
});

// @desc    Check if initial setup is completed (at least one active Super Admin exists)
// @route   GET /api/users/setup-status
// @access  Public
const getSetupStatus = asyncHandler(async (req, res) => {
    const adminCount = await User.countDocuments({
        role: { $in: ['Super Admin', 'Institute Admin'] },
        status: 'active'
    });

    const isSetupCompleted = adminCount > 0;

    res.json({
        isSetupCompleted,
        canRegister: !isSetupCompleted,
        adminCount
    });
});

// @desc    Public Register / Create initial admin user from login page
// @route   POST /api/users/register
// @access  Public
const publicRegister = asyncHandler(async (req, res) => {
    const adminCount = await User.countDocuments({
        role: { $in: ['Super Admin', 'Institute Admin'] },
        status: 'active'
    });

    if (adminCount > 0) {
        res.status(403);
        throw new Error('Diiwaangelinta tooska ah waa la xiray maadaama uu horey u jiro maamule nidaamka ah. Fadlan la xiriir maamulaha.');
    }

    const { fullName, email, password } = req.body;

    const trimmedName = (fullName || '').trim();
    const cleanEmail = (email || '').trim().toLowerCase();
    const trimmedPassword = (password || '').trim();

    if (!trimmedName) {
        res.status(400);
        throw new Error('Fadlan geli magacaaga oo buuxa (Full Name is required)');
    }

    if (!cleanEmail || !cleanEmail.includes('@')) {
        res.status(400);
        throw new Error('Fadlan geli cinwaan iimayl oo sax ah (Valid email is required)');
    }

    if (!trimmedPassword || trimmedPassword.length < 6) {
        res.status(400);
        throw new Error('Furaha sirta ah waa inuu ka kooban yahay ugu yaraan 6 xaraf ama lambar');
    }

    const userExists = await User.findOne({ email: cleanEmail });
    if (userExists) {
        res.status(400);
        throw new Error('Iimaylkan horey ayaa loo diiwaangeliyay. Fadlan isticmaal mid kale ama soo gal.');
    }

    // Ensure Owner role exists
    const Role = require('../models/Role');
    let ownerRole = await Role.findOne({ name: 'Owner' });
    if (!ownerRole) {
        ownerRole = await Role.create({
            name: 'Owner',
            description: 'Full system access - Business Owner',
            isSystemRole: true
        });
    }

    const user = await User.create({
        fullName: trimmedName,
        email: cleanEmail,
        passwordHash: trimmedPassword,
        role: 'Super Admin',
        roles: [ownerRole._id],
        status: 'active'
    });

    const populatedUser = await User.findById(user._id).select('-passwordHash').populate('roles');

    res.status(201).json(formatUserResponse(populatedUser, generateToken(user._id)));
});


// @desc    Get all users
// @route   GET /api/users
// @access  Private
const getUsers = asyncHandler(async (req, res) => {
    const { role } = req.query;
    let query = {};
    if (role) {
        query.role = role;
    }
    const users = await User.find(query).select('-passwordHash').populate('roles').populate('branchId', 'name address phone');
    const formatted = users.map(u => formatUserResponse(u));
    res.json(formatted);
});

// @desc    Auth user & get token
// @route   POST /api/users/login
// @access  Public
const authUser = asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const cleanEmail = email ? String(email).trim().toLowerCase() : '';

    const user = await User.findOne({ email: cleanEmail }).populate('roles');

    if (user && (await user.matchPassword(password))) {
        if (user.status !== 'active') {
            res.status(401);
            throw new Error('Account inactive. Contact admin.');
        }

        res.json(formatUserResponse(user, generateToken(user._id)));
    } else {
        res.status(401);
        throw new Error('Invalid email or password');
    }
});

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).select('-passwordHash').populate('roles');
    if (user) {
        res.json(formatUserResponse(user));
    } else {
        res.status(404);
        throw new Error('User not found');
    }
});

// @desc    Update user details
// @route   PUT /api/users/:id
// @access  Private
const updateUser = asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);

    if (user) {
        user.fullName = req.body.fullName || req.body.username || user.fullName;
        user.phone = req.body.phone !== undefined ? req.body.phone : user.phone;
        user.gender = req.body.gender || user.gender;
        user.email = req.body.email ? String(req.body.email).trim().toLowerCase() : user.email;
        user.role = req.body.role || user.role;
        if (Array.isArray(req.body.roles)) {
            user.roles = req.body.roles;
        }
        user.salary = req.body.salary !== undefined ? req.body.salary : user.salary;
        user.status = req.body.status || user.status;
        user.branchId = req.body.branchId || user.branchId;
        user.masuulName = req.body.masuulName !== undefined ? req.body.masuulName : user.masuulName;
        user.masuulNumber = req.body.masuulNumber !== undefined ? req.body.masuulNumber : user.masuulNumber;
        user.jobTitle = req.body.jobTitle !== undefined ? req.body.jobTitle : user.jobTitle;
        if (req.body.teacherCode || req.body.employeeCode) {
            user.teacherCode = String(req.body.teacherCode || req.body.employeeCode).trim();
        }

        // Editing an account replaces its custom grants outright, so clearing a
        // checkbox actually revokes access. Omitting the field leaves them as-is.
        if (req.body.customPermissions !== undefined) {
            user.customPermissions = normalizePermissions(req.body.customPermissions);
            user.markModified('customPermissions');
        }

        if (req.body.password) {
            user.passwordHash = req.body.password;
        }

        // An existing user promoted to Teacher is issued an identifier now. A code
        // already held is never reassigned or cleared — it stays with the person.
        if (user.role === 'Teacher' && !user.teacherCode) {
            user.teacherCode = await withRetry(
                generateTeacherCode,
                async (code) => Boolean(await User.exists({ teacherCode: code }))
            );
        }

        await user.save();
        const updatedUser = await User.findById(user._id).select('-passwordHash').populate('roles').populate('branchId', 'name address phone');

        res.json(formatUserResponse(updatedUser));
    } else {
        res.status(404);
        throw new Error('User not found');
    }
});

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private
const deleteUser = asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);

    if (user) {
        if (req.user && user._id.toString() === req.user._id.toString()) {
            res.status(400);
            throw new Error('You cannot delete your own account');
        }

        await user.deleteOne();
        res.json({ message: 'User removed' });
    } else {
        res.status(404);
        throw new Error('User not found');
    }
});

module.exports = {
    registerUser,
    publicRegister,
    getSetupStatus,
    authUser,
    getUserProfile,
    getUsers,
    updateUser,
    deleteUser
};
