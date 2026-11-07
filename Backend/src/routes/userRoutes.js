const express = require('express');
const router = express.Router();
const {
    registerUser,
    publicRegister,
    getSetupStatus,
    authUser,
    getUserProfile,
    getUsers,
    updateUser,
    deleteUser
} = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');
const { checkPermission, checkAnyPermissionSet } = require('../middleware/roleMiddleware');

const canCreateUser = checkAnyPermissionSet([
    { moduleName: 'Users & Access', actions: ['Add', 'Write'], subModuleName: 'Users' },
    { moduleName: 'Academic Management', actions: ['Add', 'Write'], subModuleName: 'Employee' },
    { moduleName: 'Academic Management', actions: ['Add', 'Write'], subModuleName: 'Teachers' }
]);

const canReadUsers = checkAnyPermissionSet([
    { moduleName: 'Users & Access', actions: ['Read'], subModuleName: 'Users' },
    { moduleName: 'Academic Management', actions: ['Read'], subModuleName: 'Employee' },
    { moduleName: 'Academic Management', actions: ['Read'], subModuleName: 'Teachers' }
]);

const canUpdateUser = checkAnyPermissionSet([
    { moduleName: 'Users & Access', actions: ['Edit', 'Write'], subModuleName: 'Users' },
    { moduleName: 'Academic Management', actions: ['Edit', 'Write'], subModuleName: 'Employee' },
    { moduleName: 'Academic Management', actions: ['Edit', 'Write'], subModuleName: 'Teachers' }
]);

const canDeleteUser = checkAnyPermissionSet([
    { moduleName: 'Users & Access', actions: ['Delete', 'Write'], subModuleName: 'Users' },
    { moduleName: 'Academic Management', actions: ['Delete', 'Write'], subModuleName: 'Employee' },
    { moduleName: 'Academic Management', actions: ['Delete', 'Write'], subModuleName: 'Teachers' }
]);

router.get('/setup-status', getSetupStatus);
router.post('/login', authUser);
router.post('/register', publicRegister);
router.get('/profile', protect, getUserProfile);

router.post('/', protect, canCreateUser, registerUser); // Create User
router.get('/', protect, canReadUsers, getUsers);      // List Users
router.route('/:id')
    .put(protect, canUpdateUser, updateUser)
    .delete(protect, canDeleteUser, deleteUser);

module.exports = router;
