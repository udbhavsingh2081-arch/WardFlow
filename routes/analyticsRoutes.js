const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const isLoggedIn = require('../middleware/isLoggedIn');
const tenantAccess = require('../middleware/tenantAccess');
const { requireMinRole } = require('../middleware/checkRole');

router.use(isLoggedIn, tenantAccess, requireMinRole('supervisor'));

router.get('/ai', analyticsController.showAIAnalytics);
router.get('/explain', analyticsController.explainAnalytics);
router.post('/explain', analyticsController.explainAnalytics);
router.get('/', analyticsController.showAnalytics);

module.exports = router;
