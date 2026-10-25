const Ticket = require('../models/Ticket');
const SLAPolicy = require('../models/SLAPolicy');
const TicketActivity = require('../models/TicketActivity');
const User = require('../models/User');
const notificationService = require('./notificationService');
const { differenceInHours } = require('date-fns');

exports.runEscalationCheck = async () => {
  console.log('[Escalation] Running check at', new Date().toISOString());
  try {
    // Find all active tickets with a due date
    const activeTickets = await Ticket.find({
      status: { $in: ['open', 'assigned', 'in_progress', 'blocked'] },
      dueAt: { $exists: true, $ne: null },
    }).populate('assignedTo', '_id name email').populate('reportingDepartmentId', 'supervisorId');

    const now = new Date();
    let escalatedCount = 0;

    for (const ticket of activeTickets) {
      const hoursUntilDue = differenceInHours(ticket.dueAt, now);
      const hoursSinceCreated = differenceInHours(now, ticket.createdAt);

      const slaPolicy = await SLAPolicy.findOne({ hospitalId: ticket.hospitalId, priority: ticket.priority, isActive: true });
      if (!slaPolicy) continue;

      // Step 1: Unassigned past acknowledgement window
      if (!ticket.assignedTo && hoursSinceCreated >= slaPolicy.acknowledgementHours) {
        await escalateTicket(ticket, 'unassigned_overdue', 'supervisor');
        escalatedCount++;
      }

      // Step 2: Approaching deadline (2 hours warning)
      if (ticket.assignedTo && hoursUntilDue > 0 && hoursUntilDue <= 2) {
        const Notification = require('../models/Notification');
        const notified = await Notification.exists({
          ticketId: ticket._id,
          type: 'deadline_approaching',
          createdAt: { $gte: new Date(now.getTime() - 2 * 3600000) },
        });
        if (!notified) {
          await notificationService.createNotification({
            hospitalId: ticket.hospitalId,
            recipientId: ticket.assignedTo._id,
            ticketId: ticket._id,
            type: 'deadline_approaching',
            title: `Deadline approaching: ${ticket.ticketNumber}`,
            message: `Ticket ${ticket.ticketNumber} is due in ${Math.round(hoursUntilDue)} hours.`,
          });
        }
      }

      // Step 3: Overdue — notify assignee and supervisor
      if (hoursUntilDue < 0 && !ticket.lastEscalatedAt || (ticket.lastEscalatedAt && differenceInHours(now, ticket.lastEscalatedAt) >= 4)) {
        await escalateTicket(ticket, 'overdue', 'operations_manager');
        escalatedCount++;
      }
    }

    console.log(`[Escalation] Done — escalated ${escalatedCount} ticket(s)`);
  } catch (err) {
    console.error('[Escalation] Error:', err.message);
  }
};

async function escalateTicket(ticket, reason, targetRole) {
  const Notification = require('../models/Notification');
  try {
    // Find supervisors/managers in the same hospital
    const recipients = await User.find({
      hospitalId: ticket.hospitalId,
      role: { $in: ['supervisor', 'operations_manager', 'hospital_admin'] },
      isActive: true,
    }).select('_id').lean();

    for (const recipient of recipients) {
      await notificationService.createNotification({
        hospitalId: ticket.hospitalId,
        recipientId: recipient._id,
        ticketId: ticket._id,
        type: 'escalation',
        title: `Escalation: ${ticket.ticketNumber}`,
        message: `Ticket ${ticket.ticketNumber} (${ticket.priority}) requires attention — ${reason}.`,
      });
    }

    await Ticket.findByIdAndUpdate(ticket._id, {
      lastEscalatedAt: new Date(),
      $inc: { escalationLevel: 1 },
    });

    await TicketActivity.create({
      ticketId: ticket._id,
      hospitalId: ticket.hospitalId,
      type: 'escalated',
      description: `Auto-escalated (${reason}) to ${targetRole}`,
    });
  } catch (err) {
    console.error('[Escalation] Failed to escalate ticket:', ticket.ticketNumber, err.message);
  }
}
