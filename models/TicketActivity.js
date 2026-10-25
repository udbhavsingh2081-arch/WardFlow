const mongoose = require('mongoose');

const ticketActivitySchema = new mongoose.Schema({
  ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  actorName: String, // denormalized for audit purposes
  type: {
    type: String,
    enum: [
      'created', 'assigned', 'unassigned', 'status_changed', 'priority_changed',
      'comment_added', 'deadline_changed', 'escalated', 'resolved', 'verified',
      'reopened', 'cancelled', 'blocked', 'attachment_added',
    ],
    required: true,
  },
  description: { type: String, required: true },
  previousValue: mongoose.Schema.Types.Mixed,
  newValue: mongoose.Schema.Types.Mixed,
}, { timestamps: true });

ticketActivitySchema.index({ ticketId: 1, createdAt: -1 });
ticketActivitySchema.index({ hospitalId: 1, createdAt: -1 });

module.exports = mongoose.model('TicketActivity', ticketActivitySchema);
