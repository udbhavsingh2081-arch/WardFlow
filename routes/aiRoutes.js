const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');
const isLoggedIn = require('../middleware/isLoggedIn');
const tenantAccess = require('../middleware/tenantAccess');

router.use(isLoggedIn, tenantAccess);

router.post('/suggest-ticket', aiController.suggestTicket);
router.get('/summary', aiController.managementSummary);

module.exports = router;
