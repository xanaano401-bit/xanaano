const QuranLessonRecord = require('../models/QuranLessonRecord');
const Student = require('../models/Student');
const Class = require('../models/Class');
const { QURAN_SURAHS } = require('../data/quranSurahs');

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

// @desc    Get Quran daily sheet for a class with auto-calculated lessons
// @route   GET /api/quran/lessons/class-sheet
// @access  Private
const getClassQuranSheet = async (req, res) => {
    try {
        const { classId, date } = req.query;
        if (!classId) {
            return res.status(400).json({ message: 'Class ID is required' });
        }

        const cls = await Class.findById(classId).populate('branchId', 'name');
        if (!cls) {
            return res.status(404).json({ message: 'Class not found' });
        }

        const students = await Student.find({
            classId,
            status: { $nin: ['Inactive', 'Exited'] }
        }).sort({ rollNumber: 1, fullName: 1 });

        const targetDate = date ? new Date(date) : new Date();
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        const todayRecords = await QuranLessonRecord.find({
            classId,
            date: { $gte: startOfDay, $lte: endOfDay }
        });

        const recordMap = new Map();
        todayRecords.forEach(r => {
            recordMap.set(String(r.studentId), r);
        });

        const sheetStudents = students.map(s => {
            const progress = s.quranProgress || {
                surahNumber: 1,
                surahName: 'Al-Faatixa',
                fromVerse: 1,
                dailyPace: 5,
                lastStatus: 'passed'
            };

            const sNum = Number(progress.surahNumber) || 1;
            const surah = QURAN_SURAHS.find(item => item.number === sNum) || QURAN_SURAHS[0];
            const maxV = surah.verses || 100;
            const fromV = Math.max(1, Math.min(Number(progress.fromVerse) || 1, maxV));
            const pace = Number(progress.dailyPace) || 5;
            const toV = Math.min(maxV, fromV + (pace - 1));

            const existingRecord = recordMap.get(String(s._id));

            return {
                studentId: s._id,
                fullName: s.fullName,
                studentCode: s.studentCode || '',
                rollNumber: s.rollNumber || '',
                quranProgress: {
                    surahNumber: sNum,
                    surahName: surah.nameSo || surah.nameAr,
                    nameAr: surah.nameAr,
                    nameSo: surah.nameSo,
                    fromVerse: fromV,
                    dailyPace: pace,
                    maxVerses: maxV,
                    lastStatus: progress.lastStatus || 'passed'
                },
                scheduledLesson: {
                    surahNumber: sNum,
                    surahName: `${surah.number}. ${surah.nameAr} (${surah.nameSo})`,
                    rawSurahName: surah.nameSo || surah.nameAr,
                    fromVerse: existingRecord ? existingRecord.fromVerse : fromV,
                    toVerse: existingRecord ? existingRecord.toVerse : toV,
                    maxVerses: maxV
                },
                todayRecord: existingRecord ? {
                    _id: existingRecord._id,
                    status: existingRecord.status,
                    surahName: existingRecord.surahName,
                    fromVerse: existingRecord.fromVerse,
                    toVerse: existingRecord.toVerse,
                    note: existingRecord.note || '',
                    repeatCount: existingRecord.repeatCount || 1
                } : null
            };
        });

        res.status(200).json({
            classId: cls._id,
            className: cls.name || cls.className,
            branchId: cls.branchId?._id || cls.branchId,
            branchName: cls.branchId?.name || '',
            date: targetDate,
            students: sheetStudents
        });
    } catch (error) {
        console.error('Error getting class Quran sheet:', error);
        res.status(500).json({ message: 'Failed to get class Quran sheet', error: error.message });
    }
};

// @desc    Batch record daily Quran lessons for a class and auto-progress students
// @route   POST /api/quran/lessons/batch
// @access  Private
const batchRecordQuranLessons = async (req, res) => {
    try {
        const { classId, branchId, date, lessons } = req.body;

        if (!Array.isArray(lessons) || lessons.length === 0) {
            return res.status(400).json({ message: 'No lesson evaluations provided' });
        }

        const cls = classId ? await Class.findById(classId) : null;
        const halaqahName = cls?.name || cls?.className || '';
        const lessonDate = date ? new Date(date) : new Date();

        const results = [];

        for (const item of lessons) {
            if (!item.studentId) continue;

            const student = await Student.findById(item.studentId);
            if (!student) continue;

            const surahNum = Number(item.surahNumber) || student.quranProgress?.surahNumber || 1;
            const surah = QURAN_SURAHS.find(s => s.number === surahNum) || QURAN_SURAHS[0];
            const maxVerses = surah.verses || 100;
            const fromVerse = Number(item.fromVerse) || 1;
            const toVerse = Number(item.toVerse) || Math.min(maxVerses, fromVerse + 4);
            const status = item.status === 'repeat' ? 'repeat' : 'passed';
            const pace = Number(item.dailyPace || student.quranProgress?.dailyPace || (toVerse - fromVerse + 1) || 5);

            // Upsert today's record
            const startOfDay = new Date(lessonDate);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(lessonDate);
            endOfDay.setHours(23, 59, 59, 999);

            let record = await QuranLessonRecord.findOne({
                studentId: student._id,
                date: { $gte: startOfDay, $lte: endOfDay }
            });

            if (record) {
                record.surahName = item.surahName || `${surah.number}. ${surah.nameAr} (${surah.nameSo})`;
                record.surahNumber = surahNum;
                record.fromVerse = fromVerse;
                record.toVerse = toVerse;
                record.status = status;
                record.note = item.note || '';
                record.repeatCount = status === 'repeat' ? (record.repeatCount || 1) + 1 : 1;
                record.teacherId = req.user?._id;
                await record.save();
            } else {
                record = await QuranLessonRecord.create({
                    studentId: student._id,
                    studentName: student.fullName,
                    classId: classId || student.classId,
                    halaqahName,
                    branchId: branchId || student.branchId,
                    surahName: item.surahName || `${surah.number}. ${surah.nameAr} (${surah.nameSo})`,
                    surahNumber: surahNum,
                    fromVerse,
                    toVerse,
                    lessonType: item.lessonType || 'sabaq',
                    status,
                    repeatCount: status === 'repeat' ? 2 : 1,
                    note: item.note || '',
                    date: lessonDate,
                    teacherId: req.user?._id
                });
            }

            // AUTO-PROGRESSION LOGIC:
            if (status === 'passed') {
                let nextSurahNum = surahNum;
                let nextFrom = toVerse + 1;
                let nextSurahObj = surah;

                if (nextFrom > maxVerses) {
                    // Current Surah completed! Advance to next Surah (Bisin cusub)!
                    nextSurahNum = nextSurahNum < 114 ? nextSurahNum + 1 : 1;
                    nextFrom = 1;
                    nextSurahObj = QURAN_SURAHS.find(s => s.number === nextSurahNum) || QURAN_SURAHS[0];
                }

                student.quranProgress = {
                    surahNumber: nextSurahNum,
                    surahName: nextSurahObj.nameSo || nextSurahObj.nameAr,
                    fromVerse: nextFrom,
                    dailyPace: pace,
                    lastStatus: 'passed',
                    lastUpdated: new Date()
                };
            } else {
                // TIKRAAR (Repeat) - Stay on current surah and current starting verse!
                student.quranProgress = {
                    surahNumber: surahNum,
                    surahName: surah.nameSo || surah.nameAr,
                    fromVerse: fromVerse,
                    dailyPace: pace,
                    lastStatus: 'repeat',
                    lastUpdated: new Date()
                };
            }

            await student.save();
            results.push(record);
        }

        res.status(200).json({
            message: `Successfully processed ${results.length} student lessons`,
            count: results.length,
            records: results
        });
    } catch (error) {
        console.error('Error batch recording Quran lessons:', error);
        res.status(500).json({ message: 'Failed to batch record Quran lessons', error: error.message });
    }
};

// @desc    Update single student's Quran starting point (Bisinka & Aayadda)
// @route   PUT /api/quran/lessons/progress/:studentId
// @access  Private
const updateStudentQuranProgress = async (req, res) => {
    try {
        const { studentId } = req.params;
        const { surahNumber, fromVerse, dailyPace } = req.body;

        const student = await Student.findById(studentId);
        if (!student) {
            return res.status(404).json({ message: 'Student not found' });
        }

        const sNum = Number(surahNumber) || 1;
        const surah = QURAN_SURAHS.find(s => s.number === sNum) || QURAN_SURAHS[0];
        const pace = Math.max(1, Number(dailyPace) || 5);
        const fVerse = Math.max(1, Math.min(Number(fromVerse) || 1, surah.verses));

        student.quranProgress = {
            surahNumber: sNum,
            surahName: surah.nameSo || surah.nameAr,
            fromVerse: fVerse,
            dailyPace: pace,
            lastStatus: 'passed',
            lastUpdated: new Date()
        };

        await student.save();

        res.status(200).json({
            message: 'Student Quran starting point updated',
            quranProgress: student.quranProgress
        });
    } catch (error) {
        console.error('Error updating student Quran progress:', error);
        res.status(500).json({ message: 'Failed to update student Quran progress', error: error.message });
    }
};

module.exports = {
    getQuranLessonRecords,
    createQuranLessonRecord,
    updateQuranLessonRecord,
    deleteQuranLessonRecord,
    getClassQuranSheet,
    batchRecordQuranLessons,
    updateStudentQuranProgress
};

