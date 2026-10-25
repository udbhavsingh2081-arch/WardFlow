const Ticket = require('../models/Ticket');
const TicketActivity = require('../models/TicketActivity');
const Comment = require('../models/Comment');
const Department = require('../models/Department');
const User = require('../models/User');
const SLAPolicy = require('../models/SLAPolicy');
const ticketService = require('../services/ticketService');
const notificationService = require('../services/notificationService');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { CATEGORIES, PRIORITIES, STATUSES } = require('../models/Ticket');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|pdf|doc|docx/;
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.test(ext)) cb(null, true);
    else cb(new Error('Invalid file type'));
  },
});

exports.uploadMiddleware = upload.array('attachments', 5);

exports.listTickets = async (req, res) => {
  try {
    const { status, priority, category, departmentId, search, scope, page = 1 } = req.query;
    const limit = 20;
    const skip = (parseInt(page) - 1) * limit;

    const query = { hospitalId: req.hospitalId };
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (category) query.category = category;
    if (departmentId) query.reportingDepartmentId = departmentId;
    if (search) query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { ticketNumber: { $regex: search, $options: 'i' } },
    ];

    const user = req.session.user;
    if (user.role === 'reporter') {
      // Normal User strictly sees only their own reported tickets
      query.reportedBy = user._id;
    } else if (user.role === 'staff') {
      // Worker queue
      if (scope === 'history') {
        query.assignedTo = user._id;
        query.status = { $in: ['resolved', 'closed'] };
      } else {
        query.assignedTo = user._id;
        if (!status) {
          query.status = { $in: ['assigned', 'in_progress', 'blocked'] };
        }
      }
    } else if (user.role === 'supervisor' && user.departmentIds && user.departmentIds.length) {
      query.reportingDepartmentId = { $in: user.departmentIds };
    }

    const [tickets, total] = await Promise.all([
      Ticket.find(query)
        .populate('reportingDepartmentId', 'name')
        .populate('assignedTo', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Ticket.countDocuments(query),
    ]);

    const departments = await Department.find({ hospitalId: req.hospitalId, isActive: true }).lean();
    const totalPages = Math.ceil(total / limit);

    res.render('tickets/list', {
      title: user.role === 'reporter' ? 'My Requests' : (user.role === 'staff' ? (scope === 'history' ? 'Task History' : 'Task Queue') : 'All Tickets'),
      activePage: user.role === 'staff' && scope === 'history' ? 'task-history' : 'tickets',
      tickets,
      departments,
      scope: scope || 'active',
      filters: { status, priority, category, departmentId, search },
      pagination: { page: parseInt(page), totalPages, total },
      CATEGORIES, PRIORITIES, STATUSES,
    });
  } catch (err) {
    console.error('List tickets error:', err);
    req.session.flash = { error: 'Failed to load tickets.' };
    res.redirect('/dashboard');
  }
};

exports.showCreate = async (req, res) => {
  try {
    const departments = await Department.find({ hospitalId: req.hospitalId, isActive: true }).lean();
    const staff = await User.find({
      hospitalId: req.hospitalId,
      isActive: true,
      role: { $in: ['staff', 'supervisor'] },
    }).lean();
    res.render('tickets/create', {
      title: 'Report Issue',
      departments,
      staff,
      CATEGORIES,
      PRIORITIES,
      ticket: {},
    });
  } catch (err) {
    req.session.flash = { error: 'Failed to load form.' };
    res.redirect('/tickets');
  }
};

exports.createTicket = async (req, res) => {
  exports.uploadMiddleware(req, res, async (uploadErr) => {
    if (uploadErr) {
      req.session.flash = { error: uploadErr.message };
      return res.redirect('/tickets/new');
    }
    try {
      const { departmentId, category, title, description, priority, assignedTo, assignedTeam } = req.body;

      if (!departmentId || !category || !title || !description || !priority) {
        req.session.flash = { error: 'All required fields must be filled.' };
        return res.redirect('/tickets/new');
      }

      if (!CATEGORIES.includes(category)) { req.session.flash = { error: 'Invalid category.' }; return res.redirect('/tickets/new'); }
      if (!PRIORITIES.includes(priority)) { req.session.flash = { error: 'Invalid priority.' }; return res.redirect('/tickets/new'); }

      const dept = await Department.findOne({ _id: departmentId, hospitalId: req.hospitalId });
      if (!dept) { req.session.flash = { error: 'Invalid department.' }; return res.redirect('/tickets/new'); }

      let assignedToUser = null;
      if (assignedTo) {
        assignedToUser = await User.findOne({ _id: assignedTo, hospitalId: req.hospitalId, isActive: true });
        if (!assignedToUser) { req.session.flash = { error: 'Invalid assignee.' }; return res.redirect('/tickets/new'); }
      }

      const ticket = await ticketService.createTicket({
        hospitalId: req.hospitalId,
        reportingDepartmentId: departmentId,
        category,
        title: title.trim(),
        description: description.trim(),
        priority,
        reportedBy: req.session.user._id,
        assignedTo: assignedToUser ? assignedToUser._id : null,
        assignedTeam: assignedTeam || null,
        files: req.files || [],
        actorId: req.session.user._id,
        actorName: req.session.user.name,
      });

      req.session.flash = { success: `Ticket ${ticket.ticketNumber} created successfully.` };
      res.redirect(`/tickets/${ticket._id}`);
    } catch (err) {
      console.error('Create ticket error:', err);
      req.session.flash = { error: 'Failed to create ticket.' };
      res.redirect('/tickets/new');
    }
  });
};

exports.showTicket = async (req, res) => {
  try {
    const ticket = await Ticket.findOne({ _id: req.params.id, hospitalId: req.hospitalId })
      .populate('reportingDepartmentId', 'name')
      .populate('assignedDepartmentId', 'name')
      .populate('reportedBy', 'name email role')
      .populate('assignedTo', 'name email')
      .populate('verifiedBy', 'name')
      .populate('cancelledBy', 'name');

    if (!ticket) {
      req.session.flash = { error: 'Ticket not found.' };
      return res.redirect('/tickets');
    }

    const user = req.session.user;

    // Strict Authorization check:
    // Reporter can only view their own requests
    if (user.role === 'reporter') {
      const reporterId = ticket.reportedBy?._id ? ticket.reportedBy._id.toString() : ticket.reportedBy?.toString();
      if (reporterId !== user._id.toString()) {
        req.session.flash = { error: 'Access denied: You can only view your own submitted requests.' };
        return res.status(403).render('errors/403', { title: 'Access Denied', message: 'You can only view your own submitted requests.' });
      }
    }

    // Staff (Worker) can view tasks assigned to them or reported by them
    if (user.role === 'staff') {
      const assignedId = ticket.assignedTo?._id ? ticket.assignedTo._id.toString() : ticket.assignedTo?.toString();
      const reporterId = ticket.reportedBy?._id ? ticket.reportedBy._id.toString() : ticket.reportedBy?.toString();
      if (assignedId !== user._id.toString() && reporterId !== user._id.toString()) {
        req.session.flash = { error: 'Access denied: You are not assigned to this task.' };
        return res.status(403).render('errors/403', { title: 'Access Denied', message: 'You are not assigned to this task.' });
      }
    }

    const [activities, comments, staff, departments] = await Promise.all([
      TicketActivity.find({ ticketId: ticket._id }).sort({ createdAt: 1 }).lean(),
      Comment.find({ ticketId: ticket._id }).populate('authorId', 'name role').sort({ createdAt: 1 }).lean(),
      User.find({ hospitalId: req.hospitalId, isActive: true, role: { $in: ['staff', 'supervisor', 'operations_manager'] } }).lean(),
      Department.find({ hospitalId: req.hospitalId, isActive: true }).lean(),
    ]);

    const canAssign = ['supervisor', 'operations_manager', 'hospital_admin', 'platform_admin'].includes(user.role);
    const canResolve = (user.role === 'staff' && ticket.assignedTo && ticket.assignedTo._id.toString() === user._id.toString()) || canAssign;
    const canVerify = ['supervisor', 'operations_manager', 'hospital_admin', 'platform_admin'].includes(user.role);
    const canCancel = ['operations_manager', 'hospital_admin', 'platform_admin'].includes(user.role);
    const canReopen = canAssign;

    res.render('tickets/detail', {
      title: `${ticket.ticketNumber}`,
      ticket,
      activities,
      comments,
      staff,
      departments,
      canAssign,
      canResolve,
      canVerify,
      canCancel,
      canReopen,
      STATUSES,
    });
  } catch (err) {
    console.error('Show ticket error:', err);
    req.session.flash = { error: 'Failed to load ticket.' };
    res.redirect('/tickets');
  }
};

exports.showEdit = async (req, res) => {
  const user = req.session.user;
  if (!['supervisor', 'operations_manager', 'hospital_admin', 'platform_admin'].includes(user.role)) {
    req.session.flash = { error: 'Access denied.' };
    return res.status(403).render('errors/403', { title: 'Access Denied', message: 'You do not have permission to edit ticket configuration.' });
  }
  try {
    const ticket = await Ticket.findOne({ _id: req.params.id, hospitalId: req.hospitalId }).lean();
    if (!ticket) { req.session.flash = { error: 'Ticket not found.' }; return res.redirect('/tickets'); }
    const departments = await Department.find({ hospitalId: req.hospitalId, isActive: true }).lean();
    res.render('tickets/edit', { title: 'Edit Ticket', ticket, departments, CATEGORIES, PRIORITIES });
  } catch (err) {
    req.session.flash = { error: 'Failed to load ticket for editing.' };
    res.redirect('/tickets');
  }
};

exports.assignTicket = async (req, res) => {
  const { assignedTo, assignedTeam, assignedDepartmentId } = req.body;
  const user = req.session.user;
  if (!['supervisor', 'operations_manager', 'hospital_admin', 'platform_admin'].includes(user.role)) {
    req.session.flash = { error: 'You do not have permission to assign tickets.' };
    return res.redirect(`/tickets/${req.params.id}`);
  }
  try {
    const ticket = await Ticket.findOne({ _id: req.params.id, hospitalId: req.hospitalId });
    if (!ticket) { req.session.flash = { error: 'Ticket not found.' }; return res.redirect('/tickets'); }

    let assignee = null;
    if (assignedTo) {
      assignee = await User.findOne({ _id: assignedTo, isActive: true });
      if (!assignee) { req.session.flash = { error: 'Invalid assignee selected.' }; return res.redirect(`/tickets/${req.params.id}`); }
    }

    const previousAssignee = ticket.assignedTo;
    ticket.assignedTo = assignee ? assignee._id : null;
    if (assignedTeam !== undefined && assignedTeam !== '') {
      ticket.assignedTeam = assignedTeam;
    }
    if (assignedDepartmentId) ticket.assignedDepartmentId = assignedDepartmentId;

    if (ticket.status === 'open' && assignee) {
      ticket.status = 'assigned';
    } else if (!assignee && ticket.status === 'assigned') {
      ticket.status = 'open';
    }

    if (!ticket.acknowledgedAt && assignee) ticket.acknowledgedAt = new Date();
    await ticket.save();

    await TicketActivity.create({
      ticketId: ticket._id,
      hospitalId: req.hospitalId,
      actorId: user._id,
      actorName: user.name,
      type: 'assigned',
      description: assignee ? `Assigned to ${assignee.name}` : `Assignment cleared`,
      previousValue: previousAssignee,
      newValue: assignee ? assignee._id : null,
    });

    if (assignee) {
      await notificationService.createNotification({
        hospitalId: req.hospitalId,
        recipientId: assignee._id,
        ticketId: ticket._id,
        type: 'assignment',
        title: `Task Assigned: ${ticket.ticketNumber}`,
        message: `You were assigned ticket ${ticket.ticketNumber}: ${ticket.title}`,
      });
    }

    req.session.flash = {
      success: assignee
        ? `Task ${ticket.ticketNumber} assigned to ${assignee.name}.`
        : `Task ${ticket.ticketNumber} assignment removed.`,
    };

    const returnUrl = (req.headers.referer && req.headers.referer.includes('/dashboard'))
      ? '/dashboard'
      : `/tickets/${ticket._id}`;
    res.redirect(returnUrl);
  } catch (err) {
    console.error('Assign ticket error:', err);
    req.session.flash = { error: 'Failed to assign ticket.' };
    res.redirect(`/tickets/${req.params.id}`);
  }
};

exports.updateStatus = async (req, res) => {
  const { status, blockedReason, blockedExpectedAt } = req.body;
  const user = req.session.user;

  if (user.role === 'reporter') {
    req.session.flash = { error: 'Access denied: Normal users cannot change ticket status.' };
    return res.status(403).render('errors/403', { title: 'Access Denied', message: 'Normal users cannot change ticket status.' });
  }

  try {
    const ticket = await Ticket.findOne({ _id: req.params.id, hospitalId: req.hospitalId });
    if (!ticket) { req.session.flash = { error: 'Ticket not found.' }; return res.redirect('/tickets'); }

    if (user.role === 'staff') {
      const assignedId = ticket.assignedTo ? ticket.assignedTo.toString() : null;
      if (assignedId !== user._id.toString()) {
        req.session.flash = { error: 'Access denied: You can only update tasks assigned to you.' };
        return res.status(403).render('errors/403', { title: 'Access Denied', message: 'You can only update tasks assigned to you.' });
      }

      if (['closed', 'cancelled'].includes(status)) {
        req.session.flash = { error: 'Workers cannot directly close or cancel tasks. Please mark as resolved for supervisor verification.' };
        return res.redirect(`/tickets/${req.params.id}`);
      }
    }

    const valid = ticketService.isValidTransition(ticket.status, status);
    if (!valid) {
      req.session.flash = { error: `Cannot transition from '${ticket.status}' to '${status}'.` };
      return res.redirect(`/tickets/${req.params.id}`);
    }

    if (status === 'blocked' && !blockedReason) {
      req.session.flash = { error: 'A reason is required when blocking a ticket.' };
      return res.redirect(`/tickets/${req.params.id}`);
    }

    const previousStatus = ticket.status;
    ticket.status = status;
    if (status === 'in_progress' && !ticket.workStartedAt) ticket.workStartedAt = new Date();
    if (status === 'blocked') {
      ticket.blockedReason = blockedReason;
      ticket.blockedExpectedAt = blockedExpectedAt ? new Date(blockedExpectedAt) : null;
    }
    await ticket.save();

    await TicketActivity.create({
      ticketId: ticket._id,
      hospitalId: req.hospitalId,
      actorId: user._id,
      actorName: user.name,
      type: 'status_changed',
      description: `Status changed from '${previousStatus}' to '${status}'${status === 'blocked' ? `: ${blockedReason}` : ''}`,
      previousValue: previousStatus,
      newValue: status,
    });

    req.session.flash = { success: 'Status updated.' };
    res.redirect(`/tickets/${ticket._id}`);
  } catch (err) {
    console.error('Update status error:', err);
    req.session.flash = { error: 'Failed to update status.' };
    res.redirect(`/tickets/${req.params.id}`);
  }
};

exports.addComment = async (req, res) => {
  const { content, isInternal } = req.body;
  if (!content || !content.trim()) {
    req.session.flash = { error: 'Comment cannot be empty.' };
    return res.redirect(`/tickets/${req.params.id}`);
  }
  try {
    const ticket = await Ticket.findOne({ _id: req.params.id, hospitalId: req.hospitalId });
    if (!ticket) { req.session.flash = { error: 'Ticket not found.' }; return res.redirect('/tickets'); }

    const user = req.session.user;
    await Comment.create({
      ticketId: ticket._id,
      hospitalId: req.hospitalId,
      authorId: user._id,
      content: content.trim(),
      isInternal: isInternal === 'on',
    });

    await TicketActivity.create({
      ticketId: ticket._id,
      hospitalId: req.hospitalId,
      actorId: user._id,
      actorName: user.name,
      type: 'comment_added',
      description: `${user.name} added a comment`,
    });

    req.session.flash = { success: 'Comment added.' };
    res.redirect(`/tickets/${ticket._id}`);
  } catch (err) {
    req.session.flash = { error: 'Failed to add comment.' };
    res.redirect(`/tickets/${req.params.id}`);
  }
};

exports.resolveTicket = async (req, res) => {
  const { resolutionSummary } = req.body;
  const user = req.session.user;

  if (user.role === 'reporter') {
    req.session.flash = { error: 'Access denied: Normal users cannot resolve tickets.' };
    return res.status(403).render('errors/403', { title: 'Access Denied', message: 'Normal users cannot resolve tickets.' });
  }

  if (!resolutionSummary || !resolutionSummary.trim()) {
    req.session.flash = { error: 'Resolution summary is required.' };
    return res.redirect(`/tickets/${req.params.id}`);
  }
  try {
    const ticket = await Ticket.findOne({ _id: req.params.id, hospitalId: req.hospitalId });
    if (!ticket) { req.session.flash = { error: 'Ticket not found.' }; return res.redirect('/tickets'); }

    if (user.role === 'staff') {
      const assignedId = ticket.assignedTo ? ticket.assignedTo.toString() : null;
      if (assignedId !== user._id.toString()) {
        req.session.flash = { error: 'Access denied: You can only resolve tasks assigned to you.' };
        return res.status(403).render('errors/403', { title: 'Access Denied', message: 'You can only resolve tasks assigned to you.' });
      }
    }

    if (!['assigned', 'in_progress', 'blocked'].includes(ticket.status)) {
      req.session.flash = { error: 'Ticket cannot be resolved from its current status.' };
      return res.redirect(`/tickets/${req.params.id}`);
    }

    ticket.status = 'resolved';
    ticket.resolvedAt = new Date();
    ticket.resolutionSummary = resolutionSummary.trim();
    await ticket.save();

    await TicketActivity.create({
      ticketId: ticket._id,
      hospitalId: req.hospitalId,
      actorId: user._id,
      actorName: user.name,
      type: 'resolved',
      description: `Marked as resolved by ${user.name}. Summary: ${resolutionSummary.trim().substring(0, 100)}`,
    });

    req.session.flash = { success: 'Ticket marked as resolved. Awaiting verification.' };
    res.redirect(`/tickets/${ticket._id}`);
  } catch (err) {
    console.error('Resolve ticket error:', err);
    req.session.flash = { error: 'Failed to resolve ticket.' };
    res.redirect(`/tickets/${req.params.id}`);
  }
};

exports.verifyTicket = async (req, res) => {
  const user = req.session.user;
  if (!['supervisor', 'operations_manager', 'hospital_admin'].includes(user.role)) {
    req.session.flash = { error: 'You are not authorized to verify tickets.' };
    return res.redirect(`/tickets/${req.params.id}`);
  }
  try {
    const ticket = await Ticket.findOne({ _id: req.params.id, hospitalId: req.hospitalId });
    if (!ticket) { req.session.flash = { error: 'Ticket not found.' }; return res.redirect('/tickets'); }

    if (ticket.status !== 'resolved') {
      req.session.flash = { error: 'Only resolved tickets can be verified and closed.' };
      return res.redirect(`/tickets/${ticket._id}`);
    }

    if (ticket.assignedTo && ticket.assignedTo.toString() === user._id.toString() && user.role === 'staff') {
      req.session.flash = { error: 'You cannot verify a ticket you resolved.' };
      return res.redirect(`/tickets/${ticket._id}`);
    }

    ticket.status = 'closed';
    ticket.verifiedAt = new Date();
    ticket.closedAt = new Date();
    ticket.verifiedBy = user._id;
    await ticket.save();

    await TicketActivity.create({
      ticketId: ticket._id,
      hospitalId: req.hospitalId,
      actorId: user._id,
      actorName: user.name,
      type: 'verified',
      description: `Verified and closed by ${user.name}`,
    });

    req.session.flash = { success: 'Ticket verified and closed.' };
    res.redirect(`/tickets/${ticket._id}`);
  } catch (err) {
    req.session.flash = { error: 'Failed to verify ticket.' };
    res.redirect(`/tickets/${req.params.id}`);
  }
};

exports.reopenTicket = async (req, res) => {
  const { reopenReason } = req.body;
  const user = req.session.user;
  if (!['supervisor', 'operations_manager', 'hospital_admin'].includes(user.role)) {
    req.session.flash = { error: 'You are not authorized to reopen tickets.' };
    return res.redirect(`/tickets/${req.params.id}`);
  }
  try {
    const ticket = await Ticket.findOne({ _id: req.params.id, hospitalId: req.hospitalId });
    if (!ticket) { req.session.flash = { error: 'Ticket not found.' }; return res.redirect('/tickets'); }

    if (!['resolved', 'closed'].includes(ticket.status)) {
      req.session.flash = { error: 'Only resolved or closed tickets can be reopened.' };
      return res.redirect(`/tickets/${ticket._id}`);
    }

    ticket.resolutionHistory.push({
      resolvedAt: ticket.resolvedAt,
      resolutionSummary: ticket.resolutionSummary,
      resolvedBy: ticket.assignedTo,
      reopenedAt: new Date(),
      reopenedBy: user._id,
      reopenReason: reopenReason || 'No reason provided',
    });

    ticket.status = 'assigned';
    ticket.resolvedAt = null;
    ticket.verifiedAt = null;
    ticket.closedAt = null;
    ticket.resolutionSummary = null;
    ticket.verifiedBy = null;
    await ticket.save();

    await TicketActivity.create({
      ticketId: ticket._id,
      hospitalId: req.hospitalId,
      actorId: user._id,
      actorName: user.name,
      type: 'reopened',
      description: `Reopened by ${user.name}. Reason: ${reopenReason || 'Not provided'}`,
    });

    req.session.flash = { success: 'Ticket reopened.' };
    res.redirect(`/tickets/${ticket._id}`);
  } catch (err) {
    req.session.flash = { error: 'Failed to reopen ticket.' };
    res.redirect(`/tickets/${req.params.id}`);
  }
};

exports.cancelTicket = async (req, res) => {
  const { cancellationReason } = req.body;
  const user = req.session.user;
  if (!['operations_manager', 'hospital_admin'].includes(user.role)) {
    req.session.flash = { error: 'You are not authorized to cancel tickets.' };
    return res.redirect(`/tickets/${req.params.id}`);
  }
  if (!cancellationReason) {
    req.session.flash = { error: 'Cancellation reason is required.' };
    return res.redirect(`/tickets/${req.params.id}`);
  }
  try {
    const ticket = await Ticket.findOne({ _id: req.params.id, hospitalId: req.hospitalId });
    if (!ticket) { req.session.flash = { error: 'Ticket not found.' }; return res.redirect('/tickets'); }
    if (['closed', 'cancelled'].includes(ticket.status)) {
      req.session.flash = { error: 'Ticket is already closed or cancelled.' };
      return res.redirect(`/tickets/${ticket._id}`);
    }
    ticket.status = 'cancelled';
    ticket.cancellationReason = cancellationReason;
    ticket.cancelledBy = user._id;
    await ticket.save();

    await TicketActivity.create({
      ticketId: ticket._id,
      hospitalId: req.hospitalId,
      actorId: user._id,
      actorName: user.name,
      type: 'cancelled',
      description: `Cancelled by ${user.name}. Reason: ${cancellationReason}`,
    });

    req.session.flash = { success: 'Ticket cancelled.' };
    res.redirect(`/tickets/${ticket._id}`);
  } catch (err) {
    req.session.flash = { error: 'Failed to cancel ticket.' };
    res.redirect(`/tickets/${req.params.id}`);
  }
};

const aiController = require('./aiController');
exports.generateAISummary = aiController.generateIncidentSummary;
