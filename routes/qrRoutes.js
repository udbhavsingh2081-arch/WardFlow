const express = require('express');
const router = express.Router();
const qrController = require('../controllers/qrController');
const isLoggedIn = require('../middleware/isLoggedIn');
const tenantAccess = require('../middleware/tenantAccess');
const { requireMinRole } = require('../middleware/checkRole');

const managerGuard = [isLoggedIn, tenantAccess, requireMinRole('operations_manager')];
const staffGuard = [isLoggedIn, tenantAccess, requireMinRole('staff')];

// Staff & Technician QR Scanner and Lookup
router.get('/staff', staffGuard, qrController.showStaffQR);
router.post('/staff/lookup', staffGuard, qrController.staffLookup);

router.get('/assets', managerGuard, qrController.listAssets);
router.get('/assets/new', managerGuard, qrController.showNewAsset);
router.post('/assets', managerGuard, qrController.createAsset);
router.get('/assets/:id/edit', managerGuard, qrController.showEditAsset);
router.put('/assets/:id', managerGuard, qrController.updateAsset);
router.get('/assets/:id/qr', managerGuard, qrController.showQR);
router.post('/assets/:id/regenerate', managerGuard, qrController.regenerateToken);
router.post('/assets/:id/retire', managerGuard, qrController.retireAsset);
router.post('/assets/:id/reactivate', managerGuard, qrController.reactivateAsset);

router.get('/report/:token', qrController.qrReportLimiter, qrController.showReport);
router.post('/report/:token', qrController.qrReportLimiter, qrController.submitReport);

module.exports = router;
