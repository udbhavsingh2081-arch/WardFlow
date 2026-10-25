const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const isLoggedIn = require('../middleware/isLoggedIn');
const tenantAccess = require('../middleware/tenantAccess');
const { requireMinRole } = require('../middleware/checkRole');

// Analytics requires supervisor or higher
router.use(isLoggedIn, tenantAccess, requireMinRole('supervisor'));

router.get('/', analyticsController.showAnalytics);

module.exports = router;
