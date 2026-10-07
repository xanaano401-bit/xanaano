const mongoose = require('mongoose');

const cycleLockSchema = new mongoose.Schema({
    cycleKey: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    isLocked: {
        type: Boolean,
        default: false
    },
    lockedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    lockedByName: {
        type: String,
        default: ''
    },
    lockedByRole: {
        type: String,
        default: ''
    },
    lockedAt: {
        type: Date
    },
    unlockHistory: [{
        unlockedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        unlockedByName: {
            type: String,
            default: ''
        },
        unlockedByRole: {
            type: String,
            default: ''
        },
        unlockedAt: {
            type: Date,
            default: Date.now
        },
        reason: {
            type: String,
            required: true,
            trim: true
        }
    }]
}, { timestamps: true });

module.exports = mongoose.model('CycleLock', cycleLockSchema);
