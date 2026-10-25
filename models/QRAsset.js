const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * QRAsset — Represents a non-clinical physical asset or facility location
 * within a hospital department, used to generate QR codes for issue reporting.
 *
 * Security design:
 *  - reportingToken: a random, opaque, URL-safe token (NOT the ObjectId).
 *    The raw token is stored in the QR URL; its SHA-256 hash is stored here.
 *    Tokens are revocable by regenerating them.
 *  - The QR URL only identifies the reporting context (hospital, dept, asset).
 *    It grants no access to dashboards, tickets, or user data.
 */
const qrAssetSchema = new mongoose.Schema({
  hospitalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hospital',
    required: true,
  },
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null,
  },

  // Human-readable details prefilled on the reporting form
  name: { type: String, required: true, trim: true, maxlength: 100 },
  assetCode: { type: String, trim: true, uppercase: true, maxlength: 30 },
  assetType: {
    type: String,
    enum: ['equipment', 'room', 'facility', 'other'],
    default: 'other',
  },
  location: { type: String, trim: true, maxlength: 200 },
  description: { type: String, trim: true, maxlength: 500 },

  // Security token fields
  reportingToken: { type: String, required: true, unique: true },
  tokenHash: { type: String, required: true, unique: true, select: true },

  // Status
  isActive: { type: Boolean, default: true },

  // Audit
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  lastTokenGeneratedAt: { type: Date, default: Date.now },
  retiredAt: { type: Date, default: null },
  retiredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

// Compound index for tenant-scoped queries
qrAssetSchema.index({ hospitalId: 1, isActive: 1 });
qrAssetSchema.index({ hospitalId: 1, departmentId: 1 });

/**
 * Generate a cryptographically random opaque token.
 * Returns { rawToken, tokenHash }.
 * Store tokenHash in DB; put rawToken in the QR URL.
 */
qrAssetSchema.statics.generateToken = () => {
  const rawToken = crypto.randomBytes(32).toString('hex'); // 64-char hex string
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return { rawToken, tokenHash };
};

/**
 * Look up an active asset by its raw reporting token.
 * Returns null if not found, inactive, or token is invalid.
 */
qrAssetSchema.statics.findByRawToken = async function (rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return this.findOne({
    $or: [{ tokenHash }, { reportingToken: rawToken }],
    isActive: true,
  })
    .populate('hospitalId', 'name isActive')
    .populate('departmentId', 'name isActive');
};

module.exports = mongoose.model('QRAsset', qrAssetSchema);
