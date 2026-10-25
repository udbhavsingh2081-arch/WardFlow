const { GoogleGenAI } = require('@google/genai');
const mongoose = require('mongoose');
const Ticket = require('../models/Ticket');
const Department = require('../models/Department');
const User = require('../models/User');
const env = require('../config/environment');
const { subDays, startOfDay } = require('date-fns');

/**
 * Executes real MongoDB aggregations to compute operational metrics.
 * Safe, tenant-isolated by hospitalId.
 */
async function computeAggregates(hospitalId) {
  const targetHospitalId = mongoose.isValidObjectId(hospitalId)
    ? new mongoose.Types.ObjectId(hospitalId)
    : hospitalId;

  const now = new Date();
  const fourteenDaysAgo = startOfDay(subDays(now, 14));

  const [departmentStats, categoryStats, workerStats, inflowStats, overallKpis] = await Promise.all([
    // 1. Department Breakdown & SLA Breaches
    Ticket.aggregate([
      { $match: { hospitalId: targetHospitalId } },
      {
        $group: {
          _id: '$reportingDepartmentId',
          total: { $sum: 1 },
          openCount: { $sum: { $cond: [{ $in: ['$status', ['open', 'assigned', 'in_progress', 'blocked']] }, 1, 0] } },
          resolvedCount: { $sum: { $cond: [{ $in: ['$status', ['resolved', 'closed']] }, 1, 0] } },
          criticalCount: { $sum: { $cond: [{ $eq: ['$priority', 'critical'] }, 1, 0] } },
          overdueCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $in: ['$status', ['open', 'assigned', 'in_progress', 'blocked']] },
                    { $lt: ['$dueAt', now] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $lookup: {
          from: 'departments',
          localField: '_id',
          foreignField: '_id',
          as: 'dept',
        },
      },
      { $unwind: { path: '$dept', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          departmentName: { $ifNull: ['$dept.name', 'General Facilities'] },
          departmentCode: { $ifNull: ['$dept.code', 'GEN'] },
          total: 1,
          openCount: 1,
          resolvedCount: 1,
          criticalCount: 1,
          overdueCount: 1,
          breachRate: {
            $cond: [
              { $gt: ['$total', 0] },
              { $round: [{ $multiply: [{ $divide: ['$overdueCount', '$total'] }, 100] }, 1] },
              0,
            ],
          },
        },
      },
      { $sort: { overdueCount: -1, openCount: -1 } },
    ]),

    // 2. Category Distribution
    Ticket.aggregate([
      { $match: { hospitalId: targetHospitalId } },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          openCount: { $sum: { $cond: [{ $in: ['$status', ['open', 'assigned', 'in_progress', 'blocked']] }, 1, 0] } },
          criticalCount: { $sum: { $cond: [{ $eq: ['$priority', 'critical'] }, 1, 0] } },
        },
      },
      { $sort: { count: -1 } },
    ]),

    // 3. Worker Workload Distribution
    Ticket.aggregate([
      { $match: { hospitalId: targetHospitalId, assignedTo: { $ne: null } } },
      {
        $group: {
          _id: '$assignedTo',
          activeCount: { $sum: { $cond: [{ $in: ['$status', ['assigned', 'in_progress', 'blocked']] }, 1, 0] } },
          overdueCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $in: ['$status', ['assigned', 'in_progress', 'blocked']] },
                    { $lt: ['$dueAt', now] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          resolvedCount: { $sum: { $cond: [{ $in: ['$status', ['resolved', 'closed']] }, 1, 0] } },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          workerName: { $ifNull: ['$user.name', 'Technician'] },
          role: { $ifNull: ['$user.role', 'staff'] },
          activeCount: 1,
          overdueCount: 1,
          resolvedCount: 1,
        },
      },
      { $sort: { activeCount: -1 } },
    ]),

    // 4. Inflow Trends (Daily over last 14 days)
    Ticket.aggregate([
      { $match: { hospitalId: targetHospitalId, createdAt: { $gte: fourteenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),

    // 5. Overall Totals
    Ticket.aggregate([
      { $match: { hospitalId: targetHospitalId } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          totalOpen: { $sum: { $cond: [{ $in: ['$status', ['open', 'assigned', 'in_progress', 'blocked']] }, 1, 0] } },
          totalOverdue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $in: ['$status', ['open', 'assigned', 'in_progress', 'blocked']] },
                    { $lt: ['$dueAt', now] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalCritical: { $sum: { $cond: [{ $eq: ['$priority', 'critical'] }, 1, 0] } },
          unassigned: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'open'] }, { $eq: ['$assignedTo', null] }] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const kpis = overallKpis[0] || {
    total: 0,
    totalOpen: 0,
    totalOverdue: 0,
    totalCritical: 0,
    unassigned: 0,
  };

  const overallBreachRate = kpis.total > 0
    ? Math.round((kpis.totalOverdue / kpis.total) * 100)
    : 0;

  return {
    kpis: {
      ...kpis,
      overallBreachRate,
    },
    departmentStats,
    categoryStats,
    workerStats,
    inflowStats,
  };
}

/**
 * Builds a privacy-safe minimized payload for Gemini AI.
 * Strips all patient, staff, and medical PII, leaving strictly mathematical operational aggregates.
 */
function buildPrivacySafePayload(aggregates) {
  return {
    summaryMetrics: {
      totalTickets: aggregates.kpis.total,
      activeOpenTickets: aggregates.kpis.totalOpen,
      overdueTickets: aggregates.kpis.totalOverdue,
      criticalTickets: aggregates.kpis.totalCritical,
      unassignedTickets: aggregates.kpis.unassigned,
      overallBreachRatePercent: aggregates.kpis.overallBreachRate,
    },
    departmentBreakdown: aggregates.departmentStats.map(d => ({
      department: d.departmentName,
      totalVolume: d.total,
      activeOpen: d.openCount,
      overdueSLA: d.overdueCount,
      breachRatePercent: d.breachRate,
    })),
    categoryDistribution: aggregates.categoryStats.map(c => ({
      category: c._id,
      incidentCount: c.count,
      activeOpen: c.openCount,
      criticalCount: c.criticalCount,
    })),
    workloadMetrics: {
      totalAssignedWorkers: aggregates.workerStats.length,
      workerLoads: aggregates.workerStats.map((w, idx) => ({
        technicianId: `Tech-${idx + 1}`,
        activeTasks: w.activeCount,
        overdueTasks: w.overdueCount,
      })),
    },
    dailyInflowTrends: aggregates.inflowStats,
  };
}

/**
 * Generates rule-based deterministic insights for fallback when Gemini is unavailable.
 */
function generateFallbackInsights(aggregates) {
  const topDept = aggregates.departmentStats[0];
  const topCat = aggregates.categoryStats[0];

  const bottlenecks = [];
  if (topDept && topDept.overdueCount > 0) {
    bottlenecks.push({
      area: topDept.departmentName,
      severity: topDept.overdueCount > 3 ? 'High' : 'Medium',
      description: `${topDept.departmentName} has ${topDept.overdueCount} overdue requests with a ${topDept.breachRate}% SLA breach rate.`,
    });
  }
  if (topCat && topCat.openCount > 0) {
    bottlenecks.push({
      area: `Category: ${topCat._id}`,
      severity: 'Medium',
      description: `${topCat._id} accounts for ${topCat.count} requests (${topCat.openCount} currently active).`,
    });
  }
  if (bottlenecks.length === 0) {
    bottlenecks.push({
      area: 'Hospital Facilities',
      severity: 'Low',
      description: 'Operations are stable with no systemic department bottlenecks detected.',
    });
  }

  const staffingRebalancing = [];
  if (aggregates.workerStats.length > 1) {
    const highestLoad = aggregates.workerStats[0];
    const lowestLoad = aggregates.workerStats[aggregates.workerStats.length - 1];
    if (highestLoad.activeCount - lowestLoad.activeCount >= 3) {
      staffingRebalancing.push(`Rebalance workload from ${highestLoad.workerName} (${highestLoad.activeCount} active tasks) to ${lowestLoad.workerName} (${lowestLoad.activeCount} active tasks).`);
    } else {
      staffingRebalancing.push('Technician assignments are currently balanced across active staff.');
    }
  } else {
    staffingRebalancing.push('Single technician pool detected. Consider cross-training additional support staff.');
  }

  const riskForecast = [];
  if (aggregates.kpis.totalOverdue > 0) {
    riskForecast.push({
      risk: 'SLA Escalation Cascade',
      impact: `${aggregates.kpis.totalOverdue} tickets currently past due date require supervisor escalation to avoid facility downtime.`,
    });
  }
  if (aggregates.kpis.unassigned > 0) {
    riskForecast.push({
      risk: 'Unassigned Backlog Risk',
      impact: `${aggregates.kpis.unassigned} incoming tickets are unassigned and pending immediate technician dispatch.`,
    });
  }
  if (riskForecast.length === 0) {
    riskForecast.push({
      risk: 'Routine Maintenance Drift',
      impact: 'Maintain scheduled periodic preventive checks on medical and facility assets.',
    });
  }

  const actionItems = [
    aggregates.kpis.unassigned > 0 ? `Immediately assign ${aggregates.kpis.unassigned} pending tickets to available technicians.` : 'Verify all completed maintenance tickets for closing.',
    topDept ? `Audit ${topDept.departmentName} equipment backlog to clear longest pending items.` : 'Review department SLA thresholds.',
    'Conduct equipment preventive maintenance on high-frequency asset categories.',
  ];

  return {
    executiveSummary: `Hospital operations currently have ${aggregates.kpis.totalOpen} active requests with ${aggregates.kpis.totalOverdue} overdue tickets (${aggregates.kpis.overallBreachRate}% breach rate). Primary incident drivers are concentrated in ${topDept ? topDept.departmentName : 'General Facilities'} and ${topCat ? topCat._id : 'Equipment'}.`,
    bottlenecks,
    riskForecast,
    staffingRebalancing,
    actionItems,
  };
}

/**
 * Main AI Analytics generation function with Gemini SDK integration and fallback.
 */
async function generateOperationalInsights(hospitalId) {
  const aggregates = await computeAggregates(hospitalId);
  const apiKey = process.env.GEMINI_API_KEY || (env.gemini && env.gemini.apiKey);

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    return {
      aiGenerated: false,
      modelUsed: 'deterministic-fallback',
      insights: generateFallbackInsights(aggregates),
      aggregates,
    };
  }

  const geminiModel = process.env.GEMINI_MODEL || (env.gemini && env.gemini.model) || 'gemini-flash-latest';
  const minimizedPayload = buildPrivacySafePayload(aggregates);

  const systemInstruction = `You are the Lead Hospital Operations and Facilities AI Analyst for WardFlow.
Your purpose is to evaluate mathematical hospital incident aggregates and deliver concise, high-impact managerial intelligence for hospital executives and department supervisors.

RULES:
1. ONLY utilize the numeric data in the payload. Do not invent departments or numbers.
2. Maintain strict privacy: No personal information is provided; refer to technicians and departments professionally.
3. Respond ONLY with valid JSON conforming to the requested schema.

SCHEMA (JSON):
{
  "executiveSummary": "2-3 concise sentences summarizing operational health, SLA performance, and primary operational bottlenecks.",
  "bottlenecks": [
    { "area": "Department or category name", "severity": "High/Medium/Low", "description": "Cause of delay or high incident concentration" }
  ],
  "riskForecast": [
    { "risk": "Title of predictive risk", "impact": "Operational consequence if unaddressed" }
  ],
  "staffingRebalancing": [
    "Specific actionable recommendation to rebalance or augment worker assignments"
  ],
  "actionItems": [
    "Top immediate action item for operations management"
  ]
}`;

  const userPrompt = `Analyze the following privacy-minimized hospital operational aggregates and produce managerial insights in the specified JSON schema:

<aggregates>
${JSON.stringify(minimizedPayload, null, 2)}
</aggregates>`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: geminiModel,
      contents: userPrompt,
      config: {
        systemInstruction,
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    });

    const raw = response.text;
    if (!raw) throw new Error('Empty response from Gemini');

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      parsed = JSON.parse(cleaned);
    }

    return {
      aiGenerated: true,
      modelUsed: geminiModel,
      insights: {
        executiveSummary: String(parsed.executiveSummary || 'Operational review completed.'),
        bottlenecks: Array.isArray(parsed.bottlenecks) && parsed.bottlenecks.length > 0 ? parsed.bottlenecks : [{ area: 'Operations', severity: 'Low', description: 'No major bottlenecks recorded.' }],
        riskForecast: Array.isArray(parsed.riskForecast) && parsed.riskForecast.length > 0 ? parsed.riskForecast : [{ risk: 'Routine Operations', impact: 'Normal facility operation.' }],
        staffingRebalancing: Array.isArray(parsed.staffingRebalancing) && parsed.staffingRebalancing.length > 0 ? parsed.staffingRebalancing : ['Maintain current staffing schedules.'],
        actionItems: Array.isArray(parsed.actionItems) && parsed.actionItems.length > 0 ? parsed.actionItems : ['Review open incident register.'],
      },
      aggregates,
    };
  } catch (err) {
    console.error('Gemini AI Analytics failed, falling back to deterministic engine:', err.message);
    return {
      aiGenerated: false,
      modelUsed: 'deterministic-fallback',
      fallbackNotice: `AI generation temporarily unavailable (${err.message}). Showing verified MongoDB aggregate calculations.`,
      insights: generateFallbackInsights(aggregates),
      aggregates,
    };
  }
}

module.exports = {
  computeAggregates,
  buildPrivacySafePayload,
  generateFallbackInsights,
  generateOperationalInsights,
};
