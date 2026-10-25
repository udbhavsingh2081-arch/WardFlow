const Ticket = require('../models/Ticket');
const Department = require('../models/Department');
const SLAPolicy = require('../models/SLAPolicy');
const TicketActivity = require('../models/TicketActivity');
const geminiAnalyticsService = require('../services/geminiAnalyticsService');
const { CATEGORIES, PRIORITIES, STATUSES } = require('../models/Ticket');
const { differenceInHours, differenceInMinutes, subDays, startOfDay, endOfDay, format } = require('date-fns');

exports.showAnalytics = async (req, res) => {
  try {
    const hospitalId = req.hospitalId;
    const now = new Date();

    const defaultFrom = format(subDays(now, 30), 'yyyy-MM-dd');
    const defaultTo = format(now, 'yyyy-MM-dd');

    const fromParam = req.query.from || defaultFrom;
    const toParam = req.query.to || defaultTo;

    const startDate = startOfDay(new Date(fromParam));
    const endDate = endOfDay(new Date(toParam));

    const departmentId = req.query.departmentId || '';
    const category = req.query.category || '';
    const priority = req.query.priority || '';
    const status = req.query.status || '';

    const validCategory = CATEGORIES.includes(category) ? category : '';
    const validPriority = PRIORITIES.includes(priority) ? priority : '';
    const validStatus = STATUSES.includes(status) ? status : '';

    const baseFilter = {
      hospitalId,
      createdAt: { $gte: startDate, $lte: endDate },
    };

    if (departmentId) baseFilter.reportingDepartmentId = departmentId;
    if (validCategory) baseFilter.category = validCategory;
    if (validPriority) baseFilter.priority = validPriority;
    if (validStatus) baseFilter.status = validStatus;

    const [departments, tickets, slaPolicies] = await Promise.all([
      Department.find({ hospitalId, isActive: true }).sort({ name: 1 }).lean(),
      Ticket.find(baseFilter)
        .populate('reportingDepartmentId', 'name')
        .populate('assignedTo', 'name email')
        .populate('reportedBy', 'name')
        .lean(),
      SLAPolicy.find({ hospitalId, isActive: true }).lean(),
    ]);

    const totalTickets = tickets.length;
    const openStatuses = ['open', 'assigned', 'in_progress', 'blocked'];

    const overdueOpenTickets = tickets.filter(
      t => openStatuses.includes(t.status) && t.dueAt && new Date(t.dueAt) < now
    );

    const awaitingAssignment = tickets.filter(
      t => t.status === 'open' && !t.assignedTo
    );

    let eligibleSLACount = 0;
    let breachedSLACount = 0;

    tickets.forEach(t => {
      if (!t.dueAt) return;
      const due = new Date(t.dueAt);

      if (['resolved', 'closed'].includes(t.status)) {
        eligibleSLACount++;
        const finishDate = t.resolvedAt ? new Date(t.resolvedAt) : (t.closedAt ? new Date(t.closedAt) : null);
        if (finishDate && finishDate > due) {
          breachedSLACount++;
        }
      } else if (openStatuses.includes(t.status)) {
        if (now > due) {
          eligibleSLACount++;
          breachedSLACount++;
        }
      }
    });

    const slaBreachRate = eligibleSLACount > 0
      ? Math.round((breachedSLACount / eligibleSLACount) * 100)
      : 0;

    let totalAssignmentDelayMinutes = 0;
    let assignmentCount = 0;

    tickets.forEach(t => {
      if (t.acknowledgedAt && t.createdAt) {
        const mins = differenceInMinutes(new Date(t.acknowledgedAt), new Date(t.createdAt));
        if (mins >= 0) {
          totalAssignmentDelayMinutes += mins;
          assignmentCount++;
        }
      }
    });

    const avgAssignmentDelayHours = assignmentCount > 0
      ? (totalAssignmentDelayMinutes / assignmentCount / 60).toFixed(1)
      : null;

    let totalResolutionHours = 0;
    let resolvedCount = 0;

    tickets.forEach(t => {
      if (['resolved', 'closed'].includes(t.status)) {
        const finishDate = t.resolvedAt ? new Date(t.resolvedAt) : (t.closedAt ? new Date(t.closedAt) : null);
        if (finishDate && t.createdAt) {
          const hours = differenceInHours(finishDate, new Date(t.createdAt));
          if (hours >= 0) {
            totalResolutionHours += hours;
            resolvedCount++;
          }
        }
      }
    });

    const avgResolutionHours = resolvedCount > 0
      ? (totalResolutionHours / resolvedCount).toFixed(1)
      : null;

    const deptStatsMap = {};
    departments.forEach(d => {
      deptStatsMap[d._id.toString()] = {
        departmentId: d._id,
        name: d.name,
        code: d.code,
        ticketCount: 0,
        openBacklog: 0,
        overdueCount: 0,
        slaEligible: 0,
        slaBreached: 0,
        slaBreachRate: 0,
        totalAssignMins: 0,
        assignCount: 0,
        avgAssignHours: null,
        totalResolveHours: 0,
        resolveCount: 0,
        avgResolveHours: null,
      };
    });

    const otherDeptStats = {
      departmentId: null,
      name: 'Unassigned / Other',
      code: '—',
      ticketCount: 0,
      openBacklog: 0,
      overdueCount: 0,
      slaEligible: 0,
      slaBreached: 0,
      slaBreachRate: 0,
      totalAssignMins: 0,
      assignCount: 0,
      avgAssignHours: null,
      totalResolveHours: 0,
      resolveCount: 0,
      avgResolveHours: null,
    };

    tickets.forEach(t => {
      const deptIdStr = t.reportingDepartmentId?._id
        ? t.reportingDepartmentId._id.toString()
        : (t.reportingDepartmentId ? t.reportingDepartmentId.toString() : null);

      const dStat = (deptIdStr && deptStatsMap[deptIdStr]) ? deptStatsMap[deptIdStr] : otherDeptStats;
      dStat.ticketCount++;

      if (openStatuses.includes(t.status)) {
        dStat.openBacklog++;
        if (t.dueAt && new Date(t.dueAt) < now) {
          dStat.overdueCount++;
        }
      }

      if (t.dueAt) {
        const due = new Date(t.dueAt);
        if (['resolved', 'closed'].includes(t.status)) {
          dStat.slaEligible++;
          const finish = t.resolvedAt ? new Date(t.resolvedAt) : (t.closedAt ? new Date(t.closedAt) : null);
          if (finish && finish > due) dStat.slaBreached++;
        } else if (openStatuses.includes(t.status) && now > due) {
          dStat.slaEligible++;
          dStat.slaBreached++;
        }
      }

      if (t.acknowledgedAt && t.createdAt) {
        const mins = differenceInMinutes(new Date(t.acknowledgedAt), new Date(t.createdAt));
        if (mins >= 0) {
          dStat.totalAssignMins += mins;
          dStat.assignCount++;
        }
      }

      if (['resolved', 'closed'].includes(t.status)) {
        const finish = t.resolvedAt ? new Date(t.resolvedAt) : (t.closedAt ? new Date(t.closedAt) : null);
        if (finish && t.createdAt) {
          const h = differenceInHours(finish, new Date(t.createdAt));
          if (h >= 0) {
            dStat.totalResolveHours += h;
            dStat.resolveCount++;
          }
        }
      }
    });

    const departmentBottlenecks = Object.values(deptStatsMap).concat(
      otherDeptStats.ticketCount > 0 ? [otherDeptStats] : []
    ).map(d => {
      d.slaBreachRate = d.slaEligible > 0 ? Math.round((d.slaBreached / d.slaEligible) * 100) : 0;
      d.avgAssignHours = d.assignCount > 0 ? (d.totalAssignMins / d.assignCount / 60).toFixed(1) : null;
      d.avgResolveHours = d.resolveCount > 0 ? (d.totalResolveHours / d.resolveCount).toFixed(1) : null;
      return d;
    });

    departmentBottlenecks.sort((a, b) => b.overdueCount - a.overdueCount || b.ticketCount - a.ticketCount);

    const categoryStats = CATEGORIES.map(cat => {
      const catTickets = tickets.filter(t => t.category === cat);
      let eligible = 0;
      let breached = 0;
      let totalResHours = 0;
      let resCount = 0;

      catTickets.forEach(t => {
        if (t.dueAt) {
          const due = new Date(t.dueAt);
          if (['resolved', 'closed'].includes(t.status)) {
            eligible++;
            const finish = t.resolvedAt ? new Date(t.resolvedAt) : (t.closedAt ? new Date(t.closedAt) : null);
            if (finish && finish > due) breached++;
          } else if (openStatuses.includes(t.status) && now > due) {
            eligible++;
            breached++;
          }
        }

        if (['resolved', 'closed'].includes(t.status)) {
          const finish = t.resolvedAt ? new Date(t.resolvedAt) : (t.closedAt ? new Date(t.closedAt) : null);
          if (finish && t.createdAt) {
            const h = differenceInHours(finish, new Date(t.createdAt));
            if (h >= 0) {
              totalResHours += h;
              resCount++;
            }
          }
        }
      });

      return {
        category: cat,
        count: catTickets.length,
        openCount: catTickets.filter(t => openStatuses.includes(t.status)).length,
        eligible,
        breached,
        breachRate: eligible > 0 ? Math.round((breached / eligible) * 100) : 0,
        avgResolutionHours: resCount > 0 ? (totalResHours / resCount).toFixed(1) : null,
      };
    });

    const activeOverdueTickets = await Ticket.find({
      hospitalId,
      status: { $in: openStatuses },
      dueAt: { $lt: now },
    })
      .populate('reportingDepartmentId', 'name')
      .populate('assignedTo', 'name email')
      .sort({ dueAt: 1 })
      .limit(30)
      .lean();

    const escalationList = activeOverdueTickets.map(t => {
      const overdueHours = differenceInHours(now, new Date(t.dueAt));
      return {
        _id: t._id,
        ticketNumber: t.ticketNumber,
        title: t.title,
        priority: t.priority,
        status: t.status,
        departmentName: t.reportingDepartmentId?.name || '—',
        assigneeName: t.assignedTo?.name || 'Unassigned',
        dueAt: t.dueAt,
        overdueHours: overdueHours >= 24
          ? `${Math.floor(overdueHours / 24)}d ${overdueHours % 24}h`
          : `${overdueHours}h`,
        escalationLevel: t.escalationLevel || 0,
        lastEscalatedAt: t.lastEscalatedAt || null,
      };
    });

    res.render('analytics/index', {
      title: 'Escalation & Bottleneck Analytics',
      activePage: 'analytics',
      filters: {
        from: fromParam,
        to: toParam,
        departmentId,
        category: validCategory,
        priority: validPriority,
        status: validStatus,
      },
      departments,
      CATEGORIES,
      PRIORITIES,
      STATUSES,
      kpis: {
        totalTickets,
        overdueOpenCount: overdueOpenTickets.length,
        slaBreachRate,
        eligibleSLACount,
        breachedSLACount,
        avgAssignmentDelayHours,
        assignmentCount,
        avgResolutionHours,
        resolvedCount,
        awaitingAssignmentCount: awaitingAssignment.length,
      },
      departmentBottlenecks,
      categoryStats,
      escalationList,
    });
  } catch (err) {
    console.error('Analytics showAnalytics error:', err);
    req.session.flash = { error: 'Failed to load analytics dashboard.' };
    res.redirect('/dashboard');
  }
};

exports.showAIAnalytics = async (req, res) => {
  try {
    const result = await geminiAnalyticsService.generateOperationalInsights(req.hospitalId);

    res.render('analytics/ai', {
      title: 'Gemini AI Operational Analytics',
      activePage: 'ai-analytics',
      data: result,
      insights: result.insights,
      aggregates: result.aggregates,
      aiGenerated: result.aiGenerated,
      modelUsed: result.modelUsed,
      fallbackNotice: result.fallbackNotice || null,
    });
  } catch (err) {
    console.error('showAIAnalytics error:', err);
    req.session.flash = { error: 'Failed to generate AI analytics.' };
    res.redirect('/analytics');
  }
};

exports.explainAnalytics = async (req, res) => {
  try {
    const hospitalId = req.hospitalId;
    const result = await geminiAnalyticsService.generateOperationalInsights(hospitalId);

    const kpis = result.aggregates?.kpis || {};
    const insights = result.insights || {};
    const deptStats = result.aggregates?.departmentStats || [];
    const catStats = result.aggregates?.categoryStats || [];
    const workerStats = result.aggregates?.workerStats || [];

    // Friendly plain-language headline
    let headline = '';
    let statusClass = 'success';
    if (kpis.totalOverdue > 0) {
      statusClass = 'danger';
      headline = `Attention: ${kpis.totalOverdue} task is running past its resolution deadline.`;
    } else if (kpis.unassigned > 0) {
      statusClass = 'warning';
      headline = `Notice: ${kpis.unassigned} reported request is awaiting staff assignment.`;
    } else {
      statusClass = 'success';
      headline = `Operations are on schedule! All hospital tasks are within SLA targets.`;
    }

    // Friendly bullet points
    const points = [];

    // 1. Delays & Bottlenecks
    if (kpis.totalOverdue > 0) {
      const topOverdueDept = deptStats.find(d => d.overdueCount > 0);
      const deptName = topOverdueDept ? topOverdueDept.departmentName : 'hospital units';
      points.push({
        type: 'danger',
        badge: 'Overdue Issue',
        icon: 'bi-exclamation-octagon-fill',
        text: `${topOverdueDept?.overdueCount || kpis.totalOverdue} overdue issue in ${deptName} needs prompt resolution.`,
      });
    } else {
      points.push({
        type: 'success',
        badge: 'Zero Overdue',
        icon: 'bi-check-circle-fill',
        text: 'All open tasks are within their target deadlines.',
      });
    }

    // 2. Staffing & Assignment
    if (kpis.unassigned > 0) {
      points.push({
        type: 'warning',
        badge: 'Awaiting Staff',
        icon: 'bi-person-exclamation',
        text: `${kpis.unassigned} open request needs to be assigned to a technician or support staff member.`,
      });
    } else {
      points.push({
        type: 'success',
        badge: 'Staff Assigned',
        icon: 'bi-person-check-fill',
        text: 'All active requests have an assigned technician.',
      });
    }

    // 3. Top Demand Category
    if (catStats.length > 0 && catStats[0].count > 0) {
      const topCatName = catStats[0]._id ? (catStats[0]._id.charAt(0).toUpperCase() + catStats[0]._id.slice(1)) : 'General';
      points.push({
        type: 'info',
        badge: 'Top Category',
        icon: 'bi-tag-fill',
        text: `${topCatName} has the highest volume with ${catStats[0].count} requests logged.`,
      });
    }

    // 4. Staff workload note
    if (workerStats.length > 0) {
      const busyTech = workerStats[0];
      if (busyTech && busyTech.activeCount > 0) {
        points.push({
          type: 'secondary',
          badge: 'Worker Load',
          icon: 'bi-people-fill',
          text: `${busyTech.workerName} has ${busyTech.activeCount} active task(s) in progress.`,
        });
      }
    }

    // Action step
    const nextStep = (insights.actionItems && insights.actionItems.length > 0)
      ? insights.actionItems[0]
      : (kpis.totalOverdue > 0 ? 'Prioritize overdue items in the escalation table below.' : 'Keep monitoring incoming requests.');

    return res.json({
      success: true,
      aiGenerated: result.aiGenerated,
      modelUsed: result.modelUsed,
      statusClass,
      headline,
      summary: insights.executiveSummary || 'Hospital operations review completed.',
      points,
      nextStep,
      stats: {
        total: kpis.total || 0,
        open: kpis.totalOpen || 0,
        overdue: kpis.totalOverdue || 0,
        unassigned: kpis.unassigned || 0,
      },
    });
  } catch (err) {
    console.error('explainAnalytics error:', err);
    return res.status(500).json({
      success: false,
      error: 'Unable to generate AI summary at this time.',
    });
  }
};
