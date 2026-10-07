const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
    getCycleLocks,
    toggleCycleLock,
    getCycleAdjustments
} = require('../controllers/cycleLockController');

router.use(protect);

router.get('/', getCycleLocks);
router.post('/toggle', toggleCycleLock);
router.get('/adjustments/:cycleKey', getCycleAdjustments);

module.exports = router;
