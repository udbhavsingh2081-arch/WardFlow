const express = require('express');
const router = express.Router();
const qrController = require('../controllers/qrController');
const isLoggedIn = require('../middleware/isLoggedIn');
const tenantAccess = require('../middleware/tenantAccess');
const { requireMinRole } = require('../middleware/checkRole');

// ── Management routes (authenticated, operations_manager or higher) ──────────
// All routes below /qr/assets are protected by auth + tenant isolation + RBAC.
const managerGuard = [isLoggedIn, tenantAccess, requireMinRole('operations_manager')];

router.get('/assets', managerGuard, qrController.listAssets);
router.get('/assets/new', managerGuard, qrController.showNewAsset);
router.post('/assets', managerGuard, qrController.createAsset);
router.get('/assets/:id/edit', managerGuard, qrController.showEditAsset);
router.put('/assets/:id', managerGuard, qrController.updateAsset);
router.get('/assets/:id/qr', managerGuard, qrController.showQR);
router.post('/assets/:id/regenerate', managerGuard, qrController.regenerateToken);
router.post('/assets/:id/retire', managerGuard, qrController.retireAsset);
router.post('/assets/:id/reactivate', managerGuard, qrController.reactivateAsset);

// ── Public reporting routes (no auth, rate-limited) ─────────────────────────
// These are intentionally unauthenticated — any staff member with a phone can
// scan the QR code and file a report. The token acts as the access control.
router.get('/report/:token', qrController.qrReportLimiter, qrController.showReport);
router.post('/report/:token', qrController.qrReportLimiter, qrController.submitReport);

module.exports = router;
