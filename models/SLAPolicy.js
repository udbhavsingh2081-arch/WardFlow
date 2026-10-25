const mongoose = require('mongoose');

const slaPolicySchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], required: true },
  acknowledgementHours: { type: Number, required: true }, // time until someone accepts
  responseHours: { type: Number, required: true },        // time until work begins
  resolutionHours: { type: Number, required: true },      // time until marked resolved
  useBusinessHours: { type: Boolean, default: true },
  escalationSteps: [{
    stepNumber: Number,
    triggerAfterHours: Number, // hours after creation/deadline miss
    notifyRoles: [String],
    notifyUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    message: String,
  }],
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

slaPolicySchema.index({ hospitalId: 1, priority: 1 }, { unique: true });

module.exports = mongoose.model('SLAPolicy', slaPolicySchema);
