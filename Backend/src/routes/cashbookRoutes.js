const express = require('express');
const router = express.Router();
const {
    getCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    getEntries,
    getDeletedEntries,
    createEntry,
    updateEntry,
    deleteEntry,
    restoreEntry,
    lookupPhone,
    getPayers,
    togglePayer
} = require('../controllers/cashbookController');
const { protect } = require('../middleware/authMiddleware');
const { checkAnyPermission, checkAnyPermissionSet } = require('../middleware/roleMiddleware');

// The payers list backs both the Payers screen and the Monthly Payments view.
const canReadPayers = checkAnyPermissionSet([
    { moduleName: 'Finance', actions: ['Read'], subModuleName: 'Payers' },
    { moduleName: 'Finance', actions: ['Read'], subModuleName: 'Monthly Payments' },
    { moduleName: 'Finance', actions: ['Read'] },
    { moduleName: 'Reports', actions: ['Read'] }
]);

router.get('/lookup', protect, checkAnyPermission('Finance', ['Read']), lookupPhone);
router.get('/payers', protect, canReadPayers, getPayers);
// Ticking a payer as paid records a payment, so it needs a Finance write.
router.post('/payers/toggle', protect, checkAnyPermission('Finance', ['Add', 'Edit']), togglePayer);

// Cashbook categories and entries are Finance data, but the Category Summary and
// Payment reports read them too, so a Reports grant admits a read exactly as it
// does on the payers and payments endpoints.
const canReadCashbook = checkAnyPermissionSet([
    { moduleName: 'Finance', actions: ['Read'] },
    { moduleName: 'Reports', actions: ['Read'] }
]);

// Writes stay Finance-only. Add/Edit/Delete all resolve to Write, so this is the
// existing Finance write permission rather than any new granularity.
const canWriteCashbook = checkAnyPermission('Finance', ['Add', 'Edit', 'Delete']);

router.route('/categories')
    .get(protect, canReadCashbook, getCategories)
    .post(protect, canWriteCashbook, createCategory);

router.route('/categories/:id')
    .put(protect, canWriteCashbook, updateCategory)
    .delete(protect, canWriteCashbook, deleteCategory);

router.route('/entries')
    .get(protect, canReadCashbook, getEntries)
    .post(protect, canWriteCashbook, createEntry);

router.get('/deleted-entries', protect, canReadCashbook, getDeletedEntries);
router.post('/entries/:id/restore', protect, canWriteCashbook, restoreEntry);

router.route('/entries/:id')
    .put(protect, canWriteCashbook, updateEntry)
    .delete(protect, canWriteCashbook, deleteEntry);

module.exports = router;
