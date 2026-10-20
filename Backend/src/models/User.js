const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    branchId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Branch'
    },
    fullName: {
        type: String,
        required: true,
        trim: true
    },
    phone: {
        type: String,
        trim: true
    },
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    passwordHash: {
        type: String,
        required: true
    },
    role: {
        type: String,
        // 'User' is additive: accounts on it draw access from customPermissions
        // below rather than from a role's own permission set. Existing values and
        // the accounts using them are unchanged.
        enum: ['Super Admin', 'Institute Admin', 'Branch Manager', 'Teacher', 'Accountant', 'User'],
        default: 'Teacher'
    },
    // System-issued teacher identifier, kept separate from student codes. Only
    // users registered as Teacher carry one, hence the sparse unique index below.
    teacherCode: {
        type: String,
        trim: true
    },
    jobTitle: {
        type: String,
        trim: true,
        default: 'Teacher'
    },
    // Responsible person recorded on the teacher registration form.
    masuulName: {
        type: String,
        trim: true,
        default: ''
    },
    masuulNumber: {
        type: String,
        trim: true,
        default: ''
    },
    roles: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Role'
    }],
    // Per-user permission grants, used by accounts on the "User" role whose access
    // is chosen individually rather than inherited from a role. Same nested shape
    // as Role.permissions ({ Module: { SubModule: { Action: bool } } }) so the one
    // existing resolver evaluates both.
    customPermissions: {
        type: Object,
        default: {}
    },
    salary: {
        type: Number,
        default: 0
    },
    gender: {
        type: String,
        enum: ['Male', 'Female'],
        default: 'Male'
    },
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, { strictPopulate: false });

userSchema.index({ email: 1 }, { unique: true });
// Sparse so the many users without a teacher code do not collide on null.
userSchema.index({ teacherCode: 1 }, { unique: true, sparse: true });

userSchema.pre('save', async function (next) {
    if (!this.isModified('passwordHash')) {
        return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
});

userSchema.methods.matchPassword = async function (enteredPassword) {
    try {
        if (!this.passwordHash || !enteredPassword) {
            return false;
        }
        // Always verify against the bcrypt hash. No plaintext shortcuts — a
        // hard-coded password match would be an authentication backdoor.
        return await bcrypt.compare(enteredPassword, this.passwordHash);
    } catch (error) {
        console.error('Bcrypt comparison error:', error.message);
        return false;
    }
};

module.exports = mongoose.model('User', userSchema);
