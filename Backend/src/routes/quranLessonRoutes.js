const express = require('express');
const router = express.Router();
const {
    getQuranLessonRecords,
    createQuranLessonRecord,
    updateQuranLessonRecord,
    deleteQuranLessonRecord
} = require('../controllers/quranLessonController');
const { protect } = require('../middleware/authMiddleware');

router.route('/')
    .get(protect, getQuranLessonRecords)
    .post(protect, createQuranLessonRecord);

router.route('/:id')
    .put(protect, updateQuranLessonRecord)
    .delete(protect, deleteQuranLessonRecord);

module.exports = router;
