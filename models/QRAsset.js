const mongoose = require('mongoose');
const crypto = require('crypto');

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
  name: { type: String, required: true, trim: true, maxlength: 100 },
  assetCode: { type: String, trim: true, uppercase: true, maxlength: 30 },
  assetType: {
    type: String,
    enum: ['equipment', 'room', 'facility', 'other'],
    default: 'other',
  },
  location: { type: String, trim: true, maxlength: 200 },
  description: { type: String, trim: true, maxlength: 500 },
  reportingToken: { type: String, required: true, unique: true },
  tokenHash: { type: String, required: true, unique: true, select: true },
  isActive: { type: Boolean, default: true },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  lastTokenGeneratedAt: { type: Date, default: Date.now },
  retiredAt: { type: Date, default: null },
  retiredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

qrAssetSchema.index({ hospitalId: 1, isActive: 1 });
qrAssetSchema.index({ hospitalId: 1, departmentId: 1 });

qrAssetSchema.statics.generateToken = () => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return { rawToken, tokenHash };
};

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
