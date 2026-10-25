const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  name: { type: String, required: true, trim: true },
  code: { type: String, trim: true, uppercase: true },
  supervisorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  defaultAssignedTeam: { type: String, trim: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

departmentSchema.index({ hospitalId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Department', departmentSchema);
