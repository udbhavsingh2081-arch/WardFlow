const Ticket = require('../models/Ticket');
const Notification = require('../models/Notification');
const Department = require('../models/Department');
const { differenceInHours } = require('date-fns');

exports.showDashboard = async (req, res) => {
  try {
    const user = req.session.user;
    const hospitalId = req.hospitalId;
    const now = new Date();

    const baseQuery = { hospitalId };
    if (user.role === 'staff' || user.role === 'reporter') {
      baseQuery.$or = [{ reportedBy: user._id }, { assignedTo: user._id }];
    } else if (user.role === 'supervisor' && user.departmentIds.length) {
      baseQuery.reportingDepartmentId = { $in: user.departmentIds };
    }

    const [
      totalOpen,
      overdueCount,
      unassigned,
      critical,
      myAssigned,
      recentlyUpdated,
      dueSoon,
      notifications,
    ] = await Promise.all([
      Ticket.countDocuments({ ...baseQuery, status: { $in: ['open', 'assigned', 'in_progress', 'blocked'] } }),
      Ticket.countDocuments({ ...baseQuery, status: { $in: ['open', 'assigned', 'in_progress', 'blocked'] }, dueAt: { $lt: now } }),
      Ticket.countDocuments({ ...baseQuery, status: 'open', assignedTo: null }),
      Ticket.countDocuments({ ...baseQuery, priority: 'critical', status: { $in: ['open', 'assigned', 'in_progress'] } }),
      Ticket.find({ ...baseQuery, assignedTo: user._id, status: { $in: ['assigned', 'in_progress', 'blocked'] } })
        .populate('reportingDepartmentId', 'name').sort({ dueAt: 1 }).limit(5).lean(),
      Ticket.find({ ...baseQuery, status: { $nin: ['closed', 'cancelled'] } })
        .populate('reportingDepartmentId', 'name').sort({ updatedAt: -1 }).limit(5).lean(),
      Ticket.find({ ...baseQuery, status: { $in: ['open', 'assigned', 'in_progress'] }, dueAt: { $gte: now, $lte: new Date(now.getTime() + 4 * 3600000) } })
        .sort({ dueAt: 1 }).limit(5).lean(),
      Notification.find({ recipientId: user._id, isRead: false }).sort({ createdAt: -1 }).limit(5).lean(),
    ]);

    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600000);
    const recentClosed = await Ticket.find({
      ...baseQuery,
      status: 'closed',
      closedAt: { $gte: thirtyDaysAgo },
    }).select('dueAt closedAt priority').lean();

    const slaAttainment = recentClosed.length
      ? Math.round((recentClosed.filter(t => !t.dueAt || t.closedAt <= t.dueAt).length / recentClosed.length) * 100)
      : null;

    const avgResolutionHours = recentClosed.length
      ? Math.round(recentClosed.reduce((sum, t) => {
          if (t.closedAt && t.createdAt) return sum + differenceInHours(t.closedAt, t.createdAt);
          return sum;
        }, 0) / recentClosed.length)
      : null;

    res.render('dashboard/index', {
      title: 'Dashboard',
      activePage: 'dashboard',
      totalOpen,
      overdueCount,
      unassigned,
      critical,
      myAssigned,
      recentlyUpdated,
      dueSoon,
      notifications,
      slaAttainment,
      avgResolutionHours,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    req.session.flash = { error: 'Failed to load dashboard.' };
    res.redirect('/tickets');
  }
};

exports.getSummary = async (req, res) => {
  try {
    const hospitalId = req.hospitalId;
    const now = new Date();
    const [totalOpen, overdue, unassigned, critical] = await Promise.all([
      Ticket.countDocuments({ hospitalId, status: { $in: ['open', 'assigned', 'in_progress', 'blocked'] } }),
      Ticket.countDocuments({ hospitalId, status: { $in: ['open', 'assigned', 'in_progress'] }, dueAt: { $lt: now } }),
      Ticket.countDocuments({ hospitalId, status: 'open', assignedTo: null }),
      Ticket.countDocuments({ hospitalId, priority: 'critical', status: { $in: ['open', 'assigned', 'in_progress'] } }),
    ]);
    res.json({ totalOpen, overdue, unassigned, critical });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
};
