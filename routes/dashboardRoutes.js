const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const isLoggedIn = require('../middleware/isLoggedIn');
const tenantAccess = require('../middleware/tenantAccess');

router.use(isLoggedIn, tenantAccess);

router.get('/', dashboardController.showDashboard);
router.get('/summary', dashboardController.getSummary);

module.exports = router;
