const aiService = require('../services/aiService');
const Department = require('../models/Department');
const Ticket = require('../models/Ticket');
const TicketActivity = require('../models/TicketActivity');
const Comment = require('../models/Comment');
const { CATEGORIES } = require('../models/Ticket');

exports.suggestTicket = async (req, res) => {
  const { description } = req.body;
  if (!description || !description.trim()) {
    return res.status(400).json({ error: 'Description is required.' });
  }
  try {
    const departments = await Department.find({ hospitalId: req.hospitalId, isActive: true }).select('name').lean();
    const suggestion = await aiService.suggestTicket(description.trim(), {
      validCategories: CATEGORIES,
      validDepartments: departments.map(d => d.name),
    });
    res.json({ suggestion });
  } catch (err) {
    console.error('AI suggest error:', err.message);
    res.status(503).json({ error: 'AI service unavailable. Please fill in the fields manually.', suggestion: null });
  }
};

exports.managementSummary = async (req, res) => {
  const user = req.session.user;
  if (!['operations_manager', 'hospital_admin'].includes(user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions.' });
  }
  try {
    const now = new Date();
    const tickets = await Ticket.find({
      hospitalId: req.hospitalId,
      status: { $in: ['open', 'assigned', 'in_progress', 'blocked'] },
    }).select('title category priority status dueAt ticketNumber').lean();

    const overdue = tickets.filter(t => t.dueAt && t.dueAt < now);
    const summary = await aiService.summarizeTickets(tickets, overdue);
    res.json({ summary });
  } catch (err) {
    res.status(503).json({ error: 'AI service unavailable.' });
  }
};

exports.generateIncidentSummary = async (req, res) => {
  const user = req.session.user;
  const allowedRoles = ['supervisor', 'operations_manager', 'hospital_admin', 'platform_admin'];
  if (!user || !allowedRoles.includes(user.role)) {
    return res.status(403).json({ error: 'You do not have permission to generate AI incident summaries.' });
  }

  const { id } = req.params;
  try {
    const ticket = await Ticket.findOne({ _id: id, hospitalId: req.hospitalId })
      .populate('reportingDepartmentId', 'name')
      .populate('assignedDepartmentId', 'name')
      .populate('assignedTo', 'name email role')
      .populate('reportedBy', 'name email role')
      .lean();

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    if (user.role === 'supervisor' && Array.isArray(user.departmentIds) && user.departmentIds.length > 0) {
      const reportingDeptId = ticket.reportingDepartmentId?._id ? ticket.reportingDepartmentId._id.toString() : ticket.reportingDepartmentId?.toString();
      const assignedDeptId = ticket.assignedDepartmentId?._id ? ticket.assignedDepartmentId._id.toString() : ticket.assignedDepartmentId?.toString();
      const userDeptIds = user.departmentIds.map(d => d.toString());

      const hasOversight = userDeptIds.includes(reportingDeptId) || userDeptIds.includes(assignedDeptId);
      if (!hasOversight) {
        return res.status(403).json({ error: 'Access denied: You do not have supervisor oversight for this ticket.' });
      }
    }

    const [activities, comments] = await Promise.all([
      TicketActivity.find({ ticketId: ticket._id, hospitalId: req.hospitalId }).sort({ createdAt: 1 }).lean(),
      Comment.find({ ticketId: ticket._id, hospitalId: req.hospitalId }).populate('authorId', 'name role').sort({ createdAt: 1 }).lean(),
    ]);

    const summary = await aiService.generateIncidentSummary({ ticket, activities, comments });
    return res.json({ success: true, summary });
  } catch (err) {
    if (err.status && err.status >= 500 && err.code !== 'GEMINI_NOT_CONFIGURED') {
      console.error('Incident summary generation error:', err.message);
    }
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Failed to generate incident summary.' });
  }
};
