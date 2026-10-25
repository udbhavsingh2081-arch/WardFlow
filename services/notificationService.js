const Notification = require('../models/Notification');
const nodemailer = require('nodemailer');
const env = require('../config/environment');

const transporter = nodemailer.createTransport({
  host: env.email.host,
  port: env.email.port,
  auth: { user: env.email.user, pass: env.email.pass },
});

exports.createNotification = async ({ hospitalId, recipientId, ticketId, type, title, message, channel = 'in_app' }) => {
  const notification = await Notification.create({
    hospitalId,
    recipientId,
    ticketId,
    type,
    title,
    message,
    channel,
    deliveryStatus: 'pending',
  });
  if (channel === 'email' && env.email.user) {
    await exports.sendEmail(notification);
  }
  return notification;
};

exports.sendEmail = async (notification) => {
  try {
    const recipient = await require('../models/User').findById(notification.recipientId).select('email name').lean();
    if (!recipient) return;
    await transporter.sendMail({
      from: `"${env.app.name}" <${env.email.user}>`,
      to: recipient.email,
      subject: notification.title,
      text: notification.message,
      html: `<p>${notification.message}</p><p><a href="${env.app.url}/tickets/${notification.ticketId}">View Ticket</a></p>`,
    });
    await Notification.findByIdAndUpdate(notification._id, { deliveryStatus: 'sent', deliveredAt: new Date() });
  } catch (err) {
    console.error('Email send failed:', err.message);
    await Notification.findByIdAndUpdate(notification._id, {
      deliveryStatus: 'failed',
      $inc: { deliveryAttempts: 1 },
    });
  }
};

exports.markRead = async (notificationId, userId) => {
  return Notification.findOneAndUpdate({ _id: notificationId, recipientId: userId }, { isRead: true });
};
