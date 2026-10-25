const Ticket = require('../models/Ticket');
const Notification = require('../models/Notification');
const Department = require('../models/Department');
const User = require('../models/User');
const { differenceInHours } = require('date-fns');

exports.showDashboard = async (req, res) => {
  try {
    const user = req.session.user;
    const hospitalId = req.hospitalId;
    const now = new Date();

    // 1. Normal User (Reporter) Dashboard
    if (user.role === 'reporter') {
      const [totalReported, activeCount, resolvedCount, myTickets] = await Promise.all([
        Ticket.countDocuments({ hospitalId, reportedBy: user._id }),
        Ticket.countDocuments({ hospitalId, reportedBy: user._id, status: { $in: ['open', 'assigned', 'in_progress', 'blocked'] } }),
        Ticket.countDocuments({ hospitalId, reportedBy: user._id, status: { $in: ['resolved', 'closed'] } }),
        Ticket.find({ hospitalId, reportedBy: user._id })
          .populate('reportingDepartmentId', 'name')
          .populate('assignedTo', 'name')
          .sort({ createdAt: -1 })
          .limit(20)
          .lean(),
      ]);

      return res.render('dashboard/user', {
        title: 'Service Portal',
        activePage: 'dashboard',
        totalReported,
        activeCount,
        resolvedCount,
        myTickets,
      });
    }

    // 2. Worker (Staff) Dashboard
    if (user.role === 'staff') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const [
        assignedActiveCount,
        assignedOverdueCount,
        assignedCriticalCount,
        resolvedThisMonthCount,
        activeTasks,
        recentlyCompleted,
      ] = await Promise.all([
        Ticket.countDocuments({ hospitalId, assignedTo: user._id, status: { $in: ['assigned', 'in_progress', 'blocked'] } }),
        Ticket.countDocuments({ hospitalId, assignedTo: user._id, status: { $in: ['assigned', 'in_progress', 'blocked'] }, dueAt: { $lt: now } }),
        Ticket.countDocuments({ hospitalId, assignedTo: user._id, priority: 'critical', status: { $in: ['assigned', 'in_progress'] } }),
        Ticket.countDocuments({ hospitalId, assignedTo: user._id, status: { $in: ['resolved', 'closed'] }, resolvedAt: { $gte: startOfMonth } }),
        Ticket.find({ hospitalId, assignedTo: user._id, status: { $in: ['assigned', 'in_progress', 'blocked'] } })
          .populate('reportingDepartmentId', 'name')
          .sort({ dueAt: 1 })
          .limit(20)
          .lean(),
        Ticket.find({ hospitalId, assignedTo: user._id, status: { $in: ['resolved', 'closed'] } })
          .sort({ resolvedAt: -1 })
          .limit(5)
          .lean(),
      ]);

      return res.render('dashboard/worker', {
        title: 'Worker Task Queue',
        activePage: 'dashboard',
        assignedActiveCount,
        assignedOverdueCount,
        assignedCriticalCount,
        resolvedThisMonthCount,
        activeTasks,
        recentlyCompleted,
      });
    }

    // 3. Admin & Supervisor Command Center
    const baseQuery = { hospitalId };
    if (user.role === 'supervisor' && user.departmentIds && user.departmentIds.length) {
      baseQuery.reportingDepartmentId = { $in: user.departmentIds };
    }

    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600000);

    const [
      totalOpen,
      unassignedCount,
      overdueCount,
      criticalCount,
      recentClosed,
      unassignedTickets,
      urgentTickets,
      staffList,
    ] = await Promise.all([
      Ticket.countDocuments({ ...baseQuery, status: { $in: ['open', 'assigned', 'in_progress', 'blocked'] } }),
      Ticket.countDocuments({ ...baseQuery, status: 'open', assignedTo: null }),
      Ticket.countDocuments({ ...baseQuery, status: { $in: ['open', 'assigned', 'in_progress', 'blocked'] }, dueAt: { $lt: now } }),
      Ticket.countDocuments({ ...baseQuery, priority: 'critical', status: { $in: ['open', 'assigned', 'in_progress'] } }),
      Ticket.find({
        ...baseQuery,
        status: 'closed',
        closedAt: { $gte: thirtyDaysAgo },
      }).select('dueAt closedAt createdAt priority').lean(),
      Ticket.find({ ...baseQuery, status: 'open', assignedTo: null })
        .populate('reportingDepartmentId', 'name')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      Ticket.find({
        ...baseQuery,
        status: { $in: ['open', 'assigned', 'in_progress'] },
        $or: [
          { dueAt: { $lt: now } },
          { dueAt: { $lte: new Date(now.getTime() + 4 * 3600000) } },
        ],
      })
        .populate('reportingDepartmentId', 'name')
        .populate('assignedTo', 'name')
        .sort({ dueAt: 1 })
        .limit(10)
        .lean(),
      User.find({
        hospitalId,
        isActive: true,
        role: { $in: ['staff', 'supervisor'] },
      }).select('_id name role').lean(),
    ]);

    const slaAttainment = recentClosed.length
      ? Math.round((recentClosed.filter(t => !t.dueAt || t.closedAt <= t.dueAt).length / recentClosed.length) * 100)
      : null;

    const avgResolutionHours = recentClosed.length
      ? Math.round(recentClosed.reduce((sum, t) => {
          if (t.closedAt && t.createdAt) return sum + differenceInHours(t.closedAt, t.createdAt);
          return sum;
        }, 0) / recentClosed.length)
      : null;

    // Calculate active ticket load per worker
    const activeStaffIds = staffList.map(s => s._id);
    const workerTicketCounts = await Ticket.aggregate([
      { $match: { hospitalId: user.hospitalId, assignedTo: { $in: activeStaffIds }, status: { $in: ['assigned', 'in_progress', 'blocked'] } } },
      { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
    ]);
    const countMap = {};
    workerTicketCounts.forEach(w => { countMap[w._id.toString()] = w.count; });

    const staffWorkloads = staffList.map(s => ({
      _id: s._id,
      name: s.name,
      role: s.role,
      activeCount: countMap[s._id.toString()] || 0,
    }));

    res.render('dashboard/admin', {
      title: 'Command Center',
      activePage: 'dashboard',
      totalOpen,
      unassignedCount,
      overdueCount,
      criticalCount,
      slaAttainment,
      avgResolutionHours,
      unassignedTickets,
      urgentTickets,
      staffList,
      staffWorkloads,
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
