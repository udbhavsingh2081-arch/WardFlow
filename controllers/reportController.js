const Ticket = require('../models/Ticket');
const { format } = require('date-fns');
const { differenceInHours } = require('date-fns');

exports.exportCSV = async (req, res) => {
  try {
    const { status, priority, from, to, departmentId } = req.query;
    const query = { hospitalId: req.hospitalId };
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (departmentId) query.reportingDepartmentId = departmentId;
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lte = new Date(to);
    }

    const tickets = await Ticket.find(query)
      .populate('reportingDepartmentId', 'name')
      .populate('assignedTo', 'name')
      .populate('reportedBy', 'name')
      .lean();

    const headers = ['Ticket Number', 'Title', 'Category', 'Priority', 'Status', 'Department', 'Reported By', 'Assigned To', 'Created At', 'Due At', 'Resolved At', 'Closed At', 'Resolution Hours'];
    const rows = tickets.map(t => {
      const resolutionHours = (t.createdAt && t.resolvedAt) ? differenceInHours(t.resolvedAt, t.createdAt) : '';
      return [
        t.ticketNumber,
        `"${(t.title || '').replace(/"/g, '""')}"`,
        t.category,
        t.priority,
        t.status,
        t.reportingDepartmentId?.name || '',
        t.reportedBy?.name || '',
        t.assignedTo?.name || '',
        t.createdAt ? format(new Date(t.createdAt), 'yyyy-MM-dd HH:mm') : '',
        t.dueAt ? format(new Date(t.dueAt), 'yyyy-MM-dd HH:mm') : '',
        t.resolvedAt ? format(new Date(t.resolvedAt), 'yyyy-MM-dd HH:mm') : '',
        t.closedAt ? format(new Date(t.closedAt), 'yyyy-MM-dd HH:mm') : '',
        resolutionHours,
      ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const filename = `wardflow-export-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Export failed.' });
  }
};

exports.showTrends = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600000);
    const tickets = await Ticket.find({
      hospitalId: req.hospitalId,
      createdAt: { $gte: thirtyDaysAgo },
    }).lean();

    // Category breakdown
    const byCategory = {};
    tickets.forEach(t => { byCategory[t.category] = (byCategory[t.category] || 0) + 1; });

    // Priority breakdown
    const byPriority = {};
    tickets.forEach(t => { byPriority[t.priority] = (byPriority[t.priority] || 0) + 1; });

    res.json({ byCategory, byPriority, total: tickets.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load trends.' });
  }
};
