const mongoose = require('mongoose');

const quranLessonRecordSchema = new mongoose.Schema({
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true,
        index: true
    },
    studentName: {
        type: String,
        required: true,
        trim: true
    },
    classId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Class'
    },
    halaqahName: {
        type: String,
        trim: true,
        default: ''
    },
    surahName: {
        type: String,
        required: true,
        trim: true
    },
    surahNumber: {
        type: Number
    },
    fromVerse: {
        type: Number,
        default: 1
    },
    toVerse: {
        type: Number
    },
    lessonType: {
        type: String,
        enum: ['sabaq', 'sabqi', 'manzil', 'dars'],
        default: 'sabaq'
    },
    status: {
        type: String,
        enum: ['passed', 'repeat', 'in_progress'],
        default: 'passed'
    },
    repeatCount: {
        type: Number,
        default: 1,
        min: 1
    },
    note: {
        type: String,
        trim: true,
        default: ''
    },
    date: {
        type: Date,
        default: Date.now,
        index: true
    },
    teacherId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    branchId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Branch'
    }
}, { timestamps: true });

module.exports = mongoose.model('QuranLessonRecord', quranLessonRecordSchema);
