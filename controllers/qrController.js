const QRAsset = require('../models/QRAsset');
const Department = require('../models/Department');
const Hospital = require('../models/Hospital');
const ticketService = require('../services/ticketService');
const { CATEGORIES, PRIORITIES } = require('../models/Ticket');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const env = require('../config/environment');

// ─── Rate limiter for the public report-submission endpoint ────────────────
// Applied directly in this controller so it can be exported and used in routes.
const qrReportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  message: 'Too many issue reports submitted from this IP. Please wait a while.',
  standardHeaders: true,
  legacyHeaders: false,
});
exports.qrReportLimiter = qrReportLimiter;

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Builds the public QR reporting URL for a raw token. */
function buildReportUrl(rawToken) {
  const base = (env.app.url || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/qr/report/${rawToken}`;
}

/** Renders a page with a flash-style error inside the main layout. */
function renderError(res, status, message, title = 'Error') {
  return res.status(status).render('errors/generic', { title, message });
}

// ─── Management routes (authenticated, operations_manager+) ────────────────

/**
 * GET /qr/assets
 * List all QR assets for this hospital.
 */
exports.listAssets = async (req, res) => {
  try {
    const assets = await QRAsset.find({ hospitalId: req.hospitalId })
      .populate('departmentId', 'name')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const departments = await Department.find({
      hospitalId: req.hospitalId,
      isActive: true,
    }).lean();

    res.render('qr/manage', {
      title: 'QR Assets',
      activePage: 'qr',
      assets,
      departments,
    });
  } catch (err) {
    console.error('QR listAssets error:', err);
    req.session.flash = { error: 'Failed to load QR assets.' };
    res.redirect('/dashboard');
  }
};

/**
 * GET /qr/assets/new
 * Show form to create a new QR asset.
 */
exports.showNewAsset = async (req, res) => {
  try {
    const departments = await Department.find({
      hospitalId: req.hospitalId,
      isActive: true,
    }).lean();

    res.render('qr/asset-form', {
      title: 'New QR Asset',
      activePage: 'qr',
      asset: {},
      departments,
      formAction: '/qr/assets',
      formMethod: 'POST',
      isEdit: false,
    });
  } catch (err) {
    console.error('QR showNewAsset error:', err);
    req.session.flash = { error: 'Failed to load form.' };
    res.redirect('/qr/assets');
  }
};

/**
 * POST /qr/assets
 * Create a new QR asset with a freshly generated token.
 */
exports.createAsset = async (req, res) => {
  try {
    const { name, assetCode, assetType, departmentId, location, description } = req.body;

    if (!name || !name.trim()) {
      req.session.flash = { error: 'Asset name is required.' };
      return res.redirect('/qr/assets/new');
    }

    // Validate department belongs to this hospital (if provided)
    if (departmentId) {
      const dept = await Department.findOne({
        _id: departmentId,
        hospitalId: req.hospitalId,
      });
      if (!dept) {
        req.session.flash = { error: 'Invalid department.' };
        return res.redirect('/qr/assets/new');
      }
    }

    const validTypes = ['equipment', 'room', 'facility', 'other'];
    if (assetType && !validTypes.includes(assetType)) {
      req.session.flash = { error: 'Invalid asset type.' };
      return res.redirect('/qr/assets/new');
    }

    const { rawToken, tokenHash } = QRAsset.generateToken();

    const asset = await QRAsset.create({
      hospitalId: req.hospitalId,
      departmentId: departmentId || null,
      name: name.trim(),
      assetCode: assetCode ? assetCode.trim().toUpperCase() : undefined,
      assetType: assetType || 'other',
      location: location ? location.trim() : undefined,
      description: description ? description.trim() : undefined,
      reportingToken: rawToken,
      tokenHash,
      createdBy: req.session.user._id,
      lastTokenGeneratedAt: new Date(),
    });

    req.session.flash = {
      success: `QR asset "${asset.name}" created.`,
    };
    res.redirect(`/qr/assets/${asset._id}/qr`);
  } catch (err) {
    console.error('QR createAsset error:', err);
    req.session.flash = { error: 'Failed to create QR asset.' };
    res.redirect('/qr/assets/new');
  }
};

/**
 * GET /qr/assets/:id/edit
 * Show the edit form for an existing asset.
 */
exports.showEditAsset = async (req, res) => {
  try {
    const asset = await QRAsset.findOne({
      _id: req.params.id,
      hospitalId: req.hospitalId,
    }).populate('departmentId', 'name').lean();

    if (!asset) {
      req.session.flash = { error: 'Asset not found.' };
      return res.redirect('/qr/assets');
    }

    const departments = await Department.find({
      hospitalId: req.hospitalId,
      isActive: true,
    }).lean();

    res.render('qr/asset-form', {
      title: `Edit — ${asset.name}`,
      activePage: 'qr',
      asset,
      departments,
      formAction: `/qr/assets/${asset._id}?_method=PUT`,
      formMethod: 'POST',
      isEdit: true,
    });
  } catch (err) {
    console.error('QR showEditAsset error:', err);
    req.session.flash = { error: 'Failed to load asset.' };
    res.redirect('/qr/assets');
  }
};

/**
 * PUT /qr/assets/:id
 * Update metadata (not the token) of an existing asset.
 */
exports.updateAsset = async (req, res) => {
  try {
    const asset = await QRAsset.findOne({
      _id: req.params.id,
      hospitalId: req.hospitalId,
    });

    if (!asset) {
      req.session.flash = { error: 'Asset not found.' };
      return res.redirect('/qr/assets');
    }

    const { name, assetCode, assetType, departmentId, location, description } = req.body;

    if (!name || !name.trim()) {
      req.session.flash = { error: 'Asset name is required.' };
      return res.redirect(`/qr/assets/${asset._id}/edit`);
    }

    if (departmentId) {
      const dept = await Department.findOne({
        _id: departmentId,
        hospitalId: req.hospitalId,
      });
      if (!dept) {
        req.session.flash = { error: 'Invalid department.' };
        return res.redirect(`/qr/assets/${asset._id}/edit`);
      }
    }

    const validTypes = ['equipment', 'room', 'facility', 'other'];
    if (assetType && !validTypes.includes(assetType)) {
      req.session.flash = { error: 'Invalid asset type.' };
      return res.redirect(`/qr/assets/${asset._id}/edit`);
    }

    asset.name = name.trim();
    asset.assetCode = assetCode ? assetCode.trim().toUpperCase() : asset.assetCode;
    asset.assetType = assetType || asset.assetType;
    asset.departmentId = departmentId || null;
    asset.location = location ? location.trim() : asset.location;
    asset.description = description ? description.trim() : asset.description;
    await asset.save();

    req.session.flash = { success: 'Asset updated successfully.' };
    res.redirect('/qr/assets');
  } catch (err) {
    console.error('QR updateAsset error:', err);
    req.session.flash = { error: 'Failed to update asset.' };
    res.redirect('/qr/assets');
  }
};

/**
 * GET /qr/assets/:id/qr
 * Show the QR code preview/download page for an asset.
 * The raw token is consumed from session (if just created) or regenerated
 * only on explicit /regenerate action.
 */
exports.showQR = async (req, res) => {
  try {
    const asset = await QRAsset.findOne({
      _id: req.params.id,
      hospitalId: req.hospitalId,
    })
      .populate('departmentId', 'name')
      .lean();

    if (!asset) {
      req.session.flash = { error: 'Asset not found.' };
      return res.redirect('/qr/assets');
    }

    const reportUrl = buildReportUrl(asset.reportingToken);
    const qrDataUrl = await QRCode.toDataURL(reportUrl, {
      errorCorrectionLevel: 'M',
      width: 320,
      margin: 2,
    });

    res.render('qr/qr-preview', {
      title: `QR Code — ${asset.name}`,
      activePage: 'qr',
      asset,
      reportUrl,
      qrDataUrl,
      canRegenerate: true,
    });
  } catch (err) {
    console.error('QR showQR error:', err);
    req.session.flash = { error: 'Failed to load QR code.' };
    res.redirect('/qr/assets');
  }
};

/**
 * POST /qr/assets/:id/regenerate
 * Revoke the old token and issue a new one. The previous QR codes
 * immediately stop working.
 */
exports.regenerateToken = async (req, res) => {
  try {
    const asset = await QRAsset.findOne({
      _id: req.params.id,
      hospitalId: req.hospitalId,
    });

    if (!asset) {
      req.session.flash = { error: 'Asset not found.' };
      return res.redirect('/qr/assets');
    }

    const { rawToken, tokenHash } = QRAsset.generateToken();
    asset.reportingToken = rawToken;
    asset.tokenHash = tokenHash;
    asset.lastTokenGeneratedAt = new Date();
    await asset.save();

    req.session.flash = { success: 'QR token regenerated. Previous QR codes are now invalid.' };
    res.redirect(`/qr/assets/${asset._id}/qr`);
  } catch (err) {
    console.error('QR regenerateToken error:', err);
    req.session.flash = { error: 'Failed to regenerate QR token.' };
    res.redirect('/qr/assets');
  }
};

/**
 * POST /qr/assets/:id/retire
 * Mark an asset as inactive so its QR code stops working.
 */
exports.retireAsset = async (req, res) => {
  try {
    const asset = await QRAsset.findOne({
      _id: req.params.id,
      hospitalId: req.hospitalId,
    });

    if (!asset) {
      req.session.flash = { error: 'Asset not found.' };
      return res.redirect('/qr/assets');
    }

    asset.isActive = false;
    asset.retiredAt = new Date();
    asset.retiredBy = req.session.user._id;
    await asset.save();

    req.session.flash = { success: `"${asset.name}" retired. Its QR code will no longer accept reports.` };
    res.redirect('/qr/assets');
  } catch (err) {
    console.error('QR retireAsset error:', err);
    req.session.flash = { error: 'Failed to retire asset.' };
    res.redirect('/qr/assets');
  }
};

/**
 * POST /qr/assets/:id/reactivate
 * Reactivate a previously retired asset.
 */
exports.reactivateAsset = async (req, res) => {
  try {
    const asset = await QRAsset.findOne({
      _id: req.params.id,
      hospitalId: req.hospitalId,
    });

    if (!asset) {
      req.session.flash = { error: 'Asset not found.' };
      return res.redirect('/qr/assets');
    }

    asset.isActive = true;
    asset.retiredAt = null;
    asset.retiredBy = null;
    await asset.save();

    req.session.flash = { success: `"${asset.name}" reactivated.` };
    res.redirect('/qr/assets');
  } catch (err) {
    console.error('QR reactivateAsset error:', err);
    req.session.flash = { error: 'Failed to reactivate asset.' };
    res.redirect('/qr/assets');
  }
};

// ─── Public reporting routes (unauthenticated, rate-limited) ───────────────

/**
 * GET /qr/report/:token
 * Public page: validates the token, pre-fills the report form.
 * No authentication required — but token must be valid and active.
 */
exports.showReport = async (req, res) => {
  try {
    const asset = await QRAsset.findByRawToken(req.params.token);

    if (!asset || !asset.hospitalId || !asset.hospitalId.isActive) {
      return res.status(404).render('qr/report-invalid', {
        title: 'Invalid QR Code',
        message: 'This QR code is no longer valid or has been retired. Please contact hospital staff.',
      });
    }

    // Build category and priority lists for the form
    const categories = CATEGORIES;
    const priorities = PRIORITIES;

    res.render('qr/report', {
      title: 'Report an Issue',
      asset,
      categories,
      priorities,
      token: req.params.token,
      errors: [],
      formData: {},
      layout: 'mobile', // use mobile-friendly layout
    });
  } catch (err) {
    console.error('QR showReport error:', err);
    res.status(500).render('qr/report-invalid', {
      title: 'Error',
      message: 'Something went wrong. Please try again or contact staff.',
    });
  }
};

/**
 * POST /qr/report/:token
 * Public submission: validates input, resolves context from token, creates ticket.
 * Never trusts hospitalId/departmentId from the request body.
 */
exports.submitReport = async (req, res) => {
  try {
    const asset = await QRAsset.findByRawToken(req.params.token);

    if (!asset || !asset.hospitalId || !asset.hospitalId.isActive) {
      return res.status(404).render('qr/report-invalid', {
        title: 'Invalid QR Code',
        message: 'This QR code is no longer valid. Please contact hospital staff.',
      });
    }

    const { reporterName, category, title, description, priority } = req.body;

    // ── Server-side validation ───────────────────────────────────────────
    const errors = [];

    if (!reporterName || !reporterName.trim()) {
      errors.push({ msg: 'Your name is required.' });
    } else if (reporterName.trim().length > 100) {
      errors.push({ msg: 'Name must be 100 characters or fewer.' });
    }

    if (!category || !CATEGORIES.includes(category)) {
      errors.push({ msg: 'Please select a valid issue category.' });
    }

    if (!title || !title.trim()) {
      errors.push({ msg: 'A short description of the issue is required.' });
    } else if (title.trim().length > 200) {
      errors.push({ msg: 'Issue title must be 200 characters or fewer.' });
    }

    if (!description || !description.trim()) {
      errors.push({ msg: 'Please describe the issue in detail.' });
    } else if (description.trim().length > 2000) {
      errors.push({ msg: 'Details must be 2000 characters or fewer.' });
    }

    const resolvedPriority = PRIORITIES.includes(priority) ? priority : 'medium';

    if (errors.length > 0) {
      return res.status(422).render('qr/report', {
        title: 'Report an Issue',
        asset,
        categories: CATEGORIES,
        priorities: PRIORITIES,
        token: req.params.token,
        errors,
        formData: req.body,
        layout: 'mobile',
      });
    }

    // ── Resolve context server-side from token ───────────────────────────
    // We need a valid reportedBy user. For QR reporting we use a sentinel
    // approach: find a hospital_admin or operations_manager as the "system"
    // reporter, since the submitter may not have a WardFlow account.
    // The reporterName is stored in the ticket title prefix.
    const User = require('../models/User');

    // If staff member is already logged into WardFlow for this hospital, use their account;
    // otherwise use a hospital admin/manager sentinel account for QR submissions.
    let reporterUser = null;
    if (req.session && req.session.user && req.session.user.hospitalId === asset.hospitalId._id.toString()) {
      reporterUser = await User.findById(req.session.user._id).lean();
    }
    if (!reporterUser) {
      reporterUser = await User.findOne({
        hospitalId: asset.hospitalId._id,
        role: { $in: ['hospital_admin', 'operations_manager', 'supervisor', 'reporter'] },
        isActive: true,
      }).lean();
    }

    if (!reporterUser) {
      return res.status(500).render('qr/report-invalid', {
        title: 'Configuration Error',
        message: 'Hospital reporting is not fully configured. Please contact staff.',
      });
    }

    // Resolve departmentId: prefer asset's department, fall back to any active dept
    let departmentId = asset.departmentId
      ? asset.departmentId._id
      : null;

    if (!departmentId) {
      const dept = await Department.findOne({
        hospitalId: asset.hospitalId._id,
        isActive: true,
      }).lean();
      departmentId = dept ? dept._id : null;
    }

    if (!departmentId) {
      return res.status(500).render('qr/report-invalid', {
        title: 'Configuration Error',
        message: 'No active department found for this hospital. Please contact staff.',
      });
    }

    // Build the ticket title with QR context
    const ticketTitle = `[QR] ${title.trim()}`;
    const ticketDescription =
      `Reported via QR code by: ${reporterName.trim()}\n` +
      `Asset/Location: ${asset.name}${asset.location ? ' — ' + asset.location : ''}\n\n` +
      description.trim();

    const ticket = await ticketService.createTicket({
      hospitalId: asset.hospitalId._id,
      reportingDepartmentId: departmentId,
      category,
      title: ticketTitle,
      description: ticketDescription,
      priority: resolvedPriority,
      reportedBy: reporterUser._id,
      assignedTo: null,
      assignedTeam: null,
      files: [],
      actorId: reporterUser._id,
      actorName: `QR Report (${reporterName.trim()})`,
    });

    res.render('qr/report-success', {
      title: 'Issue Reported',
      ticketNumber: ticket.ticketNumber,
      assetName: asset.name,
      layout: 'mobile',
    });
  } catch (err) {
    console.error('QR submitReport error:', err);
    res.status(500).render('qr/report-invalid', {
      title: 'Submission Error',
      message: 'Your report could not be submitted. Please try again or contact staff.',
    });
  }
};
