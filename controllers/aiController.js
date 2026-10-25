const aiService = require('../services/aiService');
const Department = require('../models/Department');
const Ticket = require('../models/Ticket');
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
