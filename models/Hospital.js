const mongoose = require('mongoose');

const hospitalSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  address: { type: String, trim: true },
  phone: { type: String, trim: true },
  timezone: { type: String, default: 'Asia/Kolkata' },
  businessHours: {
    start: { type: String, default: '08:00' },
    end: { type: String, default: '20:00' },
    workDays: { type: [Number], default: [1, 2, 3, 4, 5, 6] }, // Mon–Sat
  },
  settings: {
    requireVerification: { type: Boolean, default: true },
    allowReporterView: { type: Boolean, default: true },
  },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Hospital', hospitalSchema);
