const Ticket = require('../models/Ticket');
const TicketActivity = require('../models/TicketActivity');
const SLAPolicy = require('../models/SLAPolicy');
const { generateTicketNumber } = require('../utils/ticketNumber');
const { addHours } = require('date-fns');

const VALID_TRANSITIONS = {
  open: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'blocked', 'resolved', 'cancelled'],
  in_progress: ['blocked', 'resolved', 'cancelled'],
  blocked: ['in_progress', 'resolved', 'cancelled'],
  resolved: ['closed', 'open'],
  closed: ['open'],
  cancelled: [],
};

exports.isValidTransition = (from, to) => {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
};

exports.createTicket = async ({ hospitalId, reportingDepartmentId, category, title, description, priority, reportedBy, assignedTo, assignedTeam, files, actorId, actorName }) => {
  const ticketNumber = await generateTicketNumber(hospitalId);

  const slaPolicy = await SLAPolicy.findOne({ hospitalId, priority, isActive: true });
  let dueAt = null;
  if (slaPolicy) {
    dueAt = addHours(new Date(), slaPolicy.resolutionHours);
  }

  const attachments = (files || []).map(f => ({
    filename: f.filename,
    originalName: f.originalname,
    mimetype: f.mimetype,
    size: f.size,
    path: f.path,
    uploadedBy: actorId,
  }));

  const ticket = new Ticket({
    ticketNumber,
    hospitalId,
    reportingDepartmentId,
    category,
    title,
    description,
    priority,
    reportedBy,
    assignedTo: assignedTo || null,
    assignedTeam: assignedTeam || null,
    status: assignedTo ? 'assigned' : 'open',
    dueAt,
    attachments,
  });

  if (assignedTo) ticket.acknowledgedAt = new Date();
  await ticket.save();

  await TicketActivity.create({
    ticketId: ticket._id,
    hospitalId,
    actorId,
    actorName,
    type: 'created',
    description: `Ticket created with priority '${priority}' in category '${category}'`,
  });

  return ticket;
};

exports.getOverdueTickets = async (hospitalId) => {
  return Ticket.find({
    hospitalId,
    status: { $in: ['open', 'assigned', 'in_progress', 'blocked'] },
    dueAt: { $lt: new Date() },
  }).populate('assignedTo', 'name email').populate('reportingDepartmentId', 'name');
};

exports.getUnassignedTickets = async (hospitalId) => {
  return Ticket.find({ hospitalId, status: 'open', assignedTo: null });
};
