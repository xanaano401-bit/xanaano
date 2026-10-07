const QuranLessonRecord = require('../models/QuranLessonRecord');
const Student = require('../models/Student');
const Class = require('../models/Class');

// @desc    Get all Quran lesson records with optional filtering
// @route   GET /api/quran/lessons
// @access  Private
const getQuranLessonRecords = async (req, res) => {
    try {
        const { search, classId, branchId, status, lessonType, startDate, endDate } = req.query;
        const query = {};

        if (search) {
            query.$or = [
                { studentName: { $regex: search, $options: 'i' } },
                { surahName: { $regex: search, $options: 'i' } },
                { halaqahName: { $regex: search, $options: 'i' } },
                { note: { $regex: search, $options: 'i' } }
            ];
        }

        if (classId) {
            query.classId = classId;
        }

        if (branchId) {
            query.branchId = branchId;
        }

        if (status) {
            query.status = status;
        }

        if (lessonType) {
            query.lessonType = lessonType;
        }

        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.date.$lte = end;
            }
        }

        const records = await QuranLessonRecord.find(query)
            .populate('studentId', 'fullName studentCode rollNumber fatherPhone classId branchId')
            .populate('classId', 'name className branchId')
            .populate('branchId', 'name')
            .populate('teacherId', 'fullName username')
            .sort({ date: -1, createdAt: -1 });

        res.status(200).json(records);
    } catch (error) {
        console.error('Error fetching Quran lesson records:', error);
        res.status(500).json({ message: 'Failed to fetch Quran lesson records', error: error.message });
    }
};

// @desc    Create a new Quran lesson record
// @route   POST /api/quran/lessons
// @access  Private
const createQuranLessonRecord = async (req, res) => {
    try {
        const {
            studentId,
            studentName,
            classId,
            branchId,
            halaqahName,
            surahName,
            surahNumber,
            fromVerse,
            toVerse,
            lessonType,
            status,
            repeatCount,
            note,
            date
        } = req.body;

        if (!studentId && !studentName) {
            return res.status(400).json({ message: 'Student information is required' });
        }

        if (!surahName || !surahName.trim()) {
            return res.status(400).json({ message: 'Surah name is required' });
        }

        let resolvedName = studentName;
        let resolvedClassId = classId;
        let resolvedHalaqah = halaqahName;
        let resolvedBranchId = branchId;

        if (studentId) {
            const student = await Student.findById(studentId).populate('classId');
            if (student) {
                resolvedName = student.fullName || studentName;
                if (!resolvedClassId && student.classId) {
                    resolvedClassId = student.classId._id;
                }
                if (!resolvedHalaqah && student.classId) {
                    resolvedHalaqah = student.classId.name || student.classId.className || '';
                }
                if (!resolvedBranchId) {
                    resolvedBranchId = student.branchId || (student.classId && student.classId.branchId) || undefined;
                }
            }
        }

        const record = new QuranLessonRecord({
            studentId,
            studentName: resolvedName,
            classId: resolvedClassId,
            branchId: resolvedBranchId,
            halaqahName: resolvedHalaqah || '',
            surahName: surahName.trim(),
            surahNumber: surahNumber ? Number(surahNumber) : undefined,
            fromVerse: fromVerse ? Number(fromVerse) : 1,
            toVerse: toVerse ? Number(toVerse) : undefined,
            lessonType: lessonType || 'sabaq',
            status: status === 'repeat' ? 'repeat' : (status === 'in_progress' ? 'in_progress' : 'passed'),
            repeatCount: status === 'repeat' ? Math.max(1, Number(repeatCount) || 1) : 1,
            note: note ? note.trim() : '',
            date: date ? new Date(date) : new Date(),
            teacherId: req.user ? req.user._id : undefined
        });

        const savedRecord = await record.save();
        const populated = await QuranLessonRecord.findById(savedRecord._id)
            .populate('studentId', 'fullName studentCode rollNumber fatherPhone classId branchId')
            .populate('classId', 'name className branchId')
            .populate('branchId', 'name')
            .populate('teacherId', 'fullName username');

        res.status(201).json(populated);

    } catch (error) {
        console.error('Error creating Quran lesson record:', error);
        res.status(500).json({ message: 'Failed to save Quran lesson record', error: error.message });
    }
};

// @desc    Update a Quran lesson record
// @route   PUT /api/quran/lessons/:id
// @access  Private
const updateQuranLessonRecord = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            studentId,
            studentName,
            classId,
            halaqahName,
            surahName,
            surahNumber,
            fromVerse,
            toVerse,
            lessonType,
            status,
            repeatCount,
            note,
            date
        } = req.body;

        const record = await QuranLessonRecord.findById(id);
        if (!record) {
            return res.status(404).json({ message: 'Quran lesson record not found' });
        }

        if (studentId) record.studentId = studentId;
        if (studentName) record.studentName = studentName;
        if (classId !== undefined) record.classId = classId;
        if (halaqahName !== undefined) record.halaqahName = halaqahName;
        if (surahName) record.surahName = surahName.trim();
        if (surahNumber !== undefined) record.surahNumber = surahNumber ? Number(surahNumber) : undefined;
        if (fromVerse !== undefined) record.fromVerse = Number(fromVerse) || 1;
        if (toVerse !== undefined) record.toVerse = toVerse ? Number(toVerse) : undefined;
        if (lessonType) record.lessonType = lessonType;
        if (status) record.status = status;
        if (repeatCount !== undefined) {
            record.repeatCount = Math.max(1, Number(repeatCount) || 1);
        } else if (status === 'passed') {
            record.repeatCount = 1;
        }
        if (note !== undefined) record.note = note.trim();
        if (date) record.date = new Date(date);

        const updated = await record.save();
        const populated = await QuranLessonRecord.findById(updated._id)
            .populate('studentId', 'fullName studentCode rollNumber fatherPhone classId')
            .populate('classId', 'name className')
            .populate('teacherId', 'fullName username');

        res.status(200).json(populated);
    } catch (error) {
        console.error('Error updating Quran lesson record:', error);
        res.status(500).json({ message: 'Failed to update Quran lesson record', error: error.message });
    }
};

// @desc    Delete a Quran lesson record
// @route   DELETE /api/quran/lessons/:id
// @access  Private
const deleteQuranLessonRecord = async (req, res) => {
    try {
        const { id } = req.params;
        const record = await QuranLessonRecord.findById(id);
        if (!record) {
            return res.status(404).json({ message: 'Quran lesson record not found' });
        }

        await QuranLessonRecord.findByIdAndDelete(id);
        res.status(200).json({ message: 'Quran lesson record deleted successfully' });
    } catch (error) {
        console.error('Error deleting Quran lesson record:', error);
        res.status(500).json({ message: 'Failed to delete Quran lesson record', error: error.message });
    }
};

module.exports = {
    getQuranLessonRecords,
    createQuranLessonRecord,
    updateQuranLessonRecord,
    deleteQuranLessonRecord
};
