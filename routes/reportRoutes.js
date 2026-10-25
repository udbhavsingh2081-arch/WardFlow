const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const isLoggedIn = require('../middleware/isLoggedIn');
const tenantAccess = require('../middleware/tenantAccess');
const { requireMinRole } = require('../middleware/checkRole');

router.use(isLoggedIn, tenantAccess, requireMinRole('supervisor'));

router.get('/export', reportController.exportCSV);
router.get('/trends', reportController.showTrends);

module.exports = router;
