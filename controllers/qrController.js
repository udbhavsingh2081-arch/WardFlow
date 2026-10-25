const QRAsset = require('../models/QRAsset');
const Department = require('../models/Department');
const Hospital = require('../models/Hospital');
const ticketService = require('../services/ticketService');
const { CATEGORIES, PRIORITIES } = require('../models/Ticket');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const env = require('../config/environment');

const qrReportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  message: 'Too many issue reports submitted from this IP. Please wait a while.',
  standardHeaders: true,
  legacyHeaders: false,
});
exports.qrReportLimiter = qrReportLimiter;


function buildReportUrl(rawToken, req) {
  const configuredUrl = process.env.APP_URL || process.env.APP_BASE_URL || (env.app && env.app.url);

  // If configured with a real domain, use it
  if (configuredUrl && !configuredUrl.includes('localhost') && !configuredUrl.includes('127.0.0.1')) {
    return `${configuredUrl.replace(/\/$/, '')}/qr/report/${rawToken}`;
  }

  // If request is coming from a live domain (e.g. wardflow.pie.host)
  if (req) {
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.get('host');
    if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
      return `${proto}://${host}/qr/report/${rawToken}`;
    }
  }

  // Fallback to production PieHost domain so localhost is never baked into printable stickers
  const prodBase = (process.env.APP_URL && !process.env.APP_URL.includes('localhost'))
    ? process.env.APP_URL
    : 'https://wardflow.pie.host';

  return `${prodBase.replace(/\/$/, '')}/qr/report/${rawToken}`;
}

function renderError(res, status, message, title = 'Error') {
  return res.status(status).render('errors/generic', { title, message });
}


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

exports.createAsset = async (req, res) => {
  try {
    const { name, assetCode, assetType, departmentId, location, description } = req.body;

    if (!name || !name.trim()) {
      req.session.flash = { error: 'Asset name is required.' };
      return res.redirect('/qr/assets/new');
    }
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

    const reportUrl = buildReportUrl(asset.reportingToken, req);
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


exports.showReport = async (req, res) => {
  try {
    const asset = await QRAsset.findByRawToken(req.params.token);

    if (!asset || !asset.hospitalId || !asset.hospitalId.isActive) {
      return res.status(404).render('qr/report-invalid', {
        title: 'Invalid QR Code',
        message: 'This QR code is no longer valid or has been retired. Please contact hospital staff.',
      });
    }
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
    const User = require('../models/User');
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

exports.showStaffQR = async (req, res) => {
  try {
    const user = req.session.user;
    const Ticket = require('../models/Ticket');

    const activeTasks = await Ticket.find({
      hospitalId: req.hospitalId,
      assignedTo: user._id,
      status: { $in: ['assigned', 'in_progress', 'blocked'] },
    })
      .populate('reportingDepartmentId', 'name')
      .sort({ dueAt: 1 })
      .limit(10)
      .lean();

    const assets = await QRAsset.find({
      hospitalId: req.hospitalId,
      status: 'active',
    })
      .populate('departmentId', 'name')
      .sort({ name: 1 })
      .limit(20)
      .lean();

    res.render('qr/staff', {
      title: 'Staff QR Portal',
      activePage: 'qr-staff',
      activeTasks,
      assets,
      searchedAsset: null,
      searchQuery: '',
    });
  } catch (err) {
    console.error('QR showStaffQR error:', err);
    req.session.flash = { error: 'Failed to load Staff QR portal.' };
    res.redirect('/dashboard');
  }
};

exports.staffLookup = async (req, res) => {
  try {
    const { query } = req.body;
    const user = req.session.user;
    const Ticket = require('../models/Ticket');

    const activeTasks = await Ticket.find({
      hospitalId: req.hospitalId,
      assignedTo: user._id,
      status: { $in: ['assigned', 'in_progress', 'blocked'] },
    })
      .populate('reportingDepartmentId', 'name')
      .sort({ dueAt: 1 })
      .limit(10)
      .lean();

    const assets = await QRAsset.find({
      hospitalId: req.hospitalId,
      status: 'active',
    })
      .populate('departmentId', 'name')
      .sort({ name: 1 })
      .limit(20)
      .lean();

    if (!query || !query.trim()) {
      return res.render('qr/staff', {
        title: 'Staff QR Portal',
        activePage: 'qr-staff',
        activeTasks,
        assets,
        searchedAsset: null,
        searchQuery: '',
      });
    }

    const clean = query.trim();
    const tokenHash = QRAsset.hashToken(clean);
    const searchedAsset = await QRAsset.findOne({
      hospitalId: req.hospitalId,
      $or: [
        { assetCode: clean.toUpperCase() },
        { tokenHash },
        { name: { $regex: clean, $options: 'i' } },
      ],
    }).populate('departmentId', 'name').lean();

    res.render('qr/staff', {
      title: 'Staff QR Portal',
      activePage: 'qr-staff',
      activeTasks,
      assets,
      searchedAsset,
      searchQuery: clean,
    });
  } catch (err) {
    console.error('QR staffLookup error:', err);
    req.session.flash = { error: 'Lookup failed.' };
    res.redirect('/qr/staff');
  }
};
