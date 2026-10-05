const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
    studentCode: {
        type: String,
        unique: true,
        trim: true
    },
    rollNumber: {
        type: String,
        trim: true
    },
    fullName: {
        type: String,
        required: true,
        trim: true
    },
    gender: {
        type: String,
        enum: ['Male', 'Female', 'Other']
    },
    dateOfBirth: {
        type: Date
    },
    fatherName: {
        type: String,
        required: true,
        trim: true
    },
    fatherPhone: {
        type: String,
        required: true,
        trim: true
    },
    guardianId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Guardian'
    },
    classId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Class',
        required: true
    },
    monthlyFee: {
        type: Number,
        default: 0
    },
    fee: {
        type: Number,
        default: 0
    },
    feeHistory: [
        {
            effectiveCycle: {
                type: String,
                required: true,
                trim: true
            },
            amount: {
                type: Number,
                required: true,
                min: 0
            },
            changedAt: {
                type: Date,
                default: Date.now
            }
        }
    ],
    branchId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Branch'
    },
    registrationDate: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['Active', 'Inactive', 'Graduated', 'Exited'],
        default: 'Active'
    },
    // Daily Quran progression state (current surah, verse, daily pace, and status)
    quranProgress: {
        surahNumber: {
            type: Number,
            default: 1
        },
        surahName: {
            type: String,
            default: 'Al-Faatixa'
        },
        fromVerse: {
            type: Number,
            default: 1
        },
        dailyPace: {
            type: Number,
            default: 5
        },
        lastStatus: {
            type: String,
            enum: ['passed', 'repeat', 'in_progress'],
            default: 'passed'
        },
        lastUpdated: {
            type: Date,
            default: Date.now
        }
    },
    // Exit / Archive metadata. Set only when a student is exited; the student
    // record itself (id, fees, history) is never deleted or altered by an exit.
    exitReason: {
        type: String,
        default: '',
        trim: true
    },
    exitDate: {
        type: Date,
        default: null
    },
    exitedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    exitedAt: {
        type: Date,
        default: null
    }
}, { timestamps: true });

module.exports = mongoose.model('Student', studentSchema);
