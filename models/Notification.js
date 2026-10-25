const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' },
  type: {
    type: String,
    enum: ['assignment', 'escalation', 'deadline_approaching', 'overdue', 'resolved', 'reopened', 'comment', 'mention'],
    required: true,
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  isRead: { type: Boolean, default: false },
  deliveryStatus: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
  deliveryAttempts: { type: Number, default: 0 },
  deliveredAt: Date,
  channel: { type: String, enum: ['in_app', 'email'], default: 'in_app' },
}, { timestamps: true });

notificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ hospitalId: 1, deliveryStatus: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
