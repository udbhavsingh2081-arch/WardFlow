const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const isLoggedIn = require('../middleware/isLoggedIn');
const tenantAccess = require('../middleware/tenantAccess');
const { requireRole } = require('../middleware/checkRole');

router.use(isLoggedIn, tenantAccess, requireRole('hospital_admin', 'platform_admin'));

router.get('/departments', adminController.listDepartments);
router.get('/departments/new', adminController.showNewDepartment);
router.post('/departments', adminController.createDepartment);
router.get('/departments/:id/edit', adminController.showEditDepartment);
router.post('/departments/:id', adminController.updateDepartment);

router.get('/users', adminController.listUsers);
router.get('/users/new', adminController.showNewUser);
router.post('/users', adminController.createUser);
router.get('/users/:id/edit', adminController.showEditUser);
router.post('/users/:id', adminController.updateUser);
router.post('/users/:id/toggle', adminController.toggleUserStatus);

router.get('/sla', adminController.listSLAPolicies);
router.post('/sla', adminController.saveSLAPolicy);

router.get('/settings', adminController.showSettings);
router.post('/settings', adminController.updateSettings);

module.exports = router;
