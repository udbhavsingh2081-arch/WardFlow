const mongoose = require('mongoose');

const CATEGORIES = ['equipment', 'facilities', 'electrical', 'plumbing', 'housekeeping', 'supplies', 'other'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['open', 'assigned', 'in_progress', 'blocked', 'resolved', 'closed', 'cancelled'];

const attachmentSchema = new mongoose.Schema({
  filename: String,
  originalName: String,
  mimetype: String,
  size: Number,
  path: String,
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: true });

const ticketSchema = new mongoose.Schema({
  ticketNumber: { type: String, required: true },
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  reportingDepartmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  assignedDepartmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  category: { type: String, enum: CATEGORIES, required: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, required: true, trim: true, maxlength: 2000 },
  priority: { type: String, enum: PRIORITIES, required: true },
  status: { type: String, enum: STATUSES, default: 'open' },
  reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assignedTeam: { type: String, trim: true },
  dueAt: { type: Date },
  acknowledgedAt: { type: Date },
  workStartedAt: { type: Date },
  resolvedAt: { type: Date },
  verifiedAt: { type: Date },
  closedAt: { type: Date },
  resolutionSummary: { type: String, trim: true, maxlength: 2000 },
  blockedReason: { type: String, trim: true },
  blockedExpectedAt: { type: Date },
  cancellationReason: { type: String, trim: true },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  escalationLevel: { type: Number, default: 0 },
  lastEscalatedAt: { type: Date },
  attachments: [attachmentSchema],
  isOverdue: { type: Boolean, default: false },
  resolutionHistory: [{
    resolvedAt: Date,
    resolutionSummary: String,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reopenedAt: Date,
    reopenedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reopenReason: String,
  }],
}, { timestamps: true });

ticketSchema.index({ hospitalId: 1, ticketNumber: 1 }, { unique: true });
ticketSchema.index({ hospitalId: 1, status: 1, dueAt: 1 });
ticketSchema.index({ hospitalId: 1, assignedTo: 1, status: 1 });
ticketSchema.index({ hospitalId: 1, reportingDepartmentId: 1, createdAt: -1 });
ticketSchema.index({ hospitalId: 1, priority: 1, status: 1 });

ticketSchema.virtual('isOpen').get(function() {
  return !['closed', 'cancelled'].includes(this.status);
});

module.exports = mongoose.model('Ticket', ticketSchema);
module.exports.CATEGORIES = CATEGORIES;
module.exports.PRIORITIES = PRIORITIES;
module.exports.STATUSES = STATUSES;
