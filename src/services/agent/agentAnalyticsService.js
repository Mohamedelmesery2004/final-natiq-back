import mongoose from 'mongoose';
import { ticketRepo, qaAnalysisRepo, eventLogRepo, ticketFeedbackRepo, callRepo } from '../../repositories/index.js';
import { TICKET_STATUS, EVENT_TYPES } from '../../constants/index.js';

const CONFIG = {
  RESPONSE: {
    FAST_MAX: 5,
    SLOW_MIN: 30,
    SLA_TARGET_MINUTES: 30,
  },
  RESOLUTION: {
    FAST_MAX: 60,
    SLOW_MIN: 180,
    SLA_TARGET_MINUTES: 240,
  },
  CSAT: {
    HIGH_MIN: 80,
    LOW_MAX: 60,
  },
  REOPEN: {
    HIGH_MIN: 20,
    LOW_MAX: 5,
  },
  QA: {
    HIGH_MIN: 80,
    LOW_MAX: 60,
  },
  WORKLOAD: {
    OVERLOADED_MIN: 15,
    IDLE_MAX: 3,
  },
  TREND_PERIOD_DAYS: 14,
  DEFAULT_RANGE_DAYS: 30,
  ACTIVITY_FEED_LIMIT: 20,
};

class AgentAnalyticsService {

  // ─── UTILITY HELPERS ──────────────────────────

  _toObjectId(id) {
    if (!id) return null;
    try {
      return new mongoose.Types.ObjectId(id);
    } catch {
      return null;
    }
  }

  _buildDateMatch(companyId, agentId, { from, to, channel } = {}) {
    const match = {
      companyId: this._toObjectId(companyId),
      assignedTo: this._toObjectId(agentId),
    };
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to) match.createdAt.$lte = new Date(to);
    }
    if (channel) match.channel = channel;
    return match;
  }

  _buildDateFilter({ from, to } = {}) {
    const filter = {};
    if (from) filter.$gte = new Date(from);
    if (to) filter.$lte = new Date(to);
    return filter;
  }

  _buildAgentDateMatch(companyId, agentId, dateFilter) {
    const match = {
      companyId: this._toObjectId(companyId),
      assignedTo: this._toObjectId(agentId),
    };
    if (Object.keys(dateFilter).length > 0) match.createdAt = dateFilter;
    return match;
  }

  _fillDateRange(labels, datasets, from, to) {
    const start = from ? new Date(from) : new Date(Date.now() - CONFIG.DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
    const end = to ? new Date(to) : new Date();
    const dateMap = {};
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      dateMap[key] = true;
      cursor.setDate(cursor.getDate() + 1);
    }

    const allLabels = Object.keys(dateMap).sort();
    const filled = datasets.map((ds) => {
      const lookup = {};
      labels.forEach((l, i) => { lookup[l] = ds.data[i]; });
      return {
        label: ds.label,
        data: allLabels.map((d) => lookup[d] || 0),
      };
    });

    return { labels: allLabels, datasets: filled };
  }

  _round(value, decimals = 1) {
    if (value === null || value === undefined || isNaN(value)) return 0;
    return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
  }

  _minutesFromMs(ms) {
    return ms ? this._round(ms / 60000) : 0;
  }

  _daysBetween(a, b) {
    return Math.max(1, Math.ceil(Math.abs(b - a) / (1000 * 60 * 60 * 24)));
  }

  // ─── KPI ENGINE ───────────────────────────────

  async _computeKPIs(companyId, agentId, filters = {}) {
    const match = this._buildDateMatch(companyId, agentId, filters);
    const resolvedMatch = { ...match, resolvedAt: { $ne: null } };

    const [totalTickets, pendingTickets, inProgressTickets, resolvedTickets, reopenedData, avgFrtAgg, avgRtAgg, slaResponseAgg, slaResolutionAgg] = await Promise.all([
      ticketRepo.count(match),
      ticketRepo.count({ ...match, status: TICKET_STATUS.PENDING }),
      ticketRepo.count({ ...match, status: TICKET_STATUS.OPENED }),
      ticketRepo.count({ ...match, status: TICKET_STATUS.CLOSED }),
      this._getReopenData(companyId, agentId, filters),
      ticketRepo.aggregate([
        { $match: { ...match, firstResponseAt: { $ne: null } } },
        { $project: { responseTime: { $subtract: ['$firstResponseAt', '$createdAt'] } } },
        { $group: { _id: null, avgTime: { $avg: '$responseTime' } } },
      ]),
      ticketRepo.aggregate([
        { $match: { ...resolvedMatch } },
        { $project: { resolutionTime: { $subtract: ['$resolvedAt', '$createdAt'] } } },
        { $group: { _id: null, avgTime: { $avg: '$resolutionTime' } } },
      ]),
      ticketRepo.aggregate([
        { $match: { ...match, firstResponseAt: { $ne: null } } },
        {
          $project: {
            responseTimeMinutes: { $divide: [{ $subtract: ['$firstResponseAt', '$createdAt'] }, 60000] },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            withinSla: { $sum: { $cond: [{ $lte: ['$responseTimeMinutes', CONFIG.RESPONSE.SLA_TARGET_MINUTES] }, 1, 0] } },
          },
        },
      ]),
      ticketRepo.aggregate([
        { $match: { ...resolvedMatch } },
        {
          $project: {
            resolutionTimeMinutes: { $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, 60000] },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            withinSla: { $sum: { $cond: [{ $lte: ['$resolutionTimeMinutes', CONFIG.RESOLUTION.SLA_TARGET_MINUTES] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const avgFirstResponseTime = this._minutesFromMs(avgFrtAgg[0]?.avgTime);
    const avgResolutionTime = this._minutesFromMs(avgRtAgg[0]?.avgTime);

    const reopenedTotal = reopenedData?.count || 0;
    const reopenedResolutionTotal = reopenedData?.resolved || 0;
    const reopenedRate = reopenedResolutionTotal > 0
      ? this._round((reopenedTotal / reopenedResolutionTotal) * 100)
      : 0;

    const slaResponse = slaResponseAgg[0]
      ? this._round((slaResponseAgg[0].withinSla / slaResponseAgg[0].total) * 100)
      : 100;
    const slaResolution = slaResolutionAgg[0]
      ? this._round((slaResolutionAgg[0].withinSla / slaResolutionAgg[0].total) * 100)
      : 100;

    return {
      totalTickets,
      assignedTickets: totalTickets,
      pendingTickets,
      inProgressTickets,
      resolvedTickets,
      reopenedTickets: reopenedTotal,
      reopenedRate,
      avgFirstResponseTime,
      avgResolutionTime,
      slaCompliance: {
        response: slaResponse,
        resolution: slaResolution,
        overall: this._round((slaResponse + slaResolution) / 2),
      },
    };
  }

  async _getReopenData(companyId, agentId, filters = {}) {
    const dateFilter = this._buildDateFilter(filters);
    const match = {
      companyId: this._toObjectId(companyId),
      eventType: EVENT_TYPES.TICKET_CLOSED,
      'metadata.agentId': this._toObjectId(agentId),
      entityType: 'ticket',
    };
    if (Object.keys(dateFilter).length > 0) match.timestamp = dateFilter;

    const closedTickets = await eventLogRepo.aggregate([
      { $match: match },
      { $group: { _id: '$entityId' } },
    ]);

    const closedTicketIds = closedTickets.map((t) => t._id);
    if (closedTicketIds.length === 0) return { count: 0, resolved: 0 };

    const reopened = await ticketRepo.count({
      _id: { $in: closedTicketIds },
      status: { $ne: TICKET_STATUS.CLOSED },
    });

    return { count: reopened, resolved: closedTicketIds.length };
  }

  // ─── TIME SERIES ENGINE ───────────────────────

  async _computeTimeSeries(companyId, agentId, filters = {}) {
    const { from, to, channel } = filters;
    const dateFilter = this._buildDateFilter(filters);
    const hasDateFilter = Object.keys(dateFilter).length > 0;
    const companyObjId = this._toObjectId(companyId);
    const agentObjId = this._toObjectId(agentId);

    // ── Separate match objects — each pipeline uses the CORRECT date field ──
    const assignedMatch = { companyId: companyObjId, assignedTo: agentObjId };
    if (hasDateFilter) assignedMatch.createdAt = dateFilter;
    if (channel) assignedMatch.channel = channel;

    const resolvedMatch = { companyId: companyObjId, assignedTo: agentObjId, status: TICKET_STATUS.CLOSED };
    if (hasDateFilter) {
      resolvedMatch.resolvedAt = { $ne: null, ...dateFilter };
    } else {
      resolvedMatch.resolvedAt = { $ne: null };
    }
    if (channel) resolvedMatch.channel = channel;

    const responseMatch = { companyId: companyObjId, assignedTo: agentObjId, firstResponseAt: { $ne: null } };
    if (hasDateFilter) responseMatch.createdAt = dateFilter;
    if (channel) responseMatch.channel = channel;

    const resolutionMatch = { companyId: companyObjId, assignedTo: agentObjId };
    if (hasDateFilter) {
      resolutionMatch.resolvedAt = { $ne: null, ...dateFilter };
    } else {
      resolutionMatch.resolvedAt = { $ne: null };
    }
    if (channel) resolutionMatch.channel = channel;

    const peakMatch = { companyId: companyObjId, assignedTo: agentObjId };
    if (hasDateFilter) peakMatch.createdAt = dateFilter;
    if (channel) peakMatch.channel = channel;

    const [assignedPerDay, resolvedPerDay, responseTimePerDay, resolutionTimePerDay, peakDay, busiestHour] = await Promise.all([
      ticketRepo.aggregate([
        { $match: assignedMatch },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      ticketRepo.aggregate([
        { $match: resolvedMatch },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$resolvedAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      ticketRepo.aggregate([
        { $match: responseMatch },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            avgResponseMs: { $avg: { $subtract: ['$firstResponseAt', '$createdAt'] } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            _id: 1,
            avgResponseMin: { $round: [{ $divide: ['$avgResponseMs', 60000] }, 1] },
            count: 1,
          },
        },
      ]),
      ticketRepo.aggregate([
        { $match: resolutionMatch },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$resolvedAt' } },
            avgResolutionMs: { $avg: { $subtract: ['$resolvedAt', '$createdAt'] } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            _id: 1,
            avgResolutionMin: { $round: [{ $divide: ['$avgResolutionMs', 60000] }, 1] },
            count: 1,
          },
        },
      ]),
      ticketRepo.aggregate([
        { $match: peakMatch },
        { $group: { _id: { $dayOfWeek: '$createdAt' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 1 },
      ]),
      ticketRepo.aggregate([
        { $match: peakMatch },
        { $group: { _id: { $hour: '$createdAt' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 1 },
      ]),
    ]);

    console.log('[Analytics TimeSeries] Assigned per day:', JSON.stringify(assignedPerDay));
    console.log('[Analytics TimeSeries] Resolved per day:', JSON.stringify(resolvedPerDay));
    console.log('[Analytics TimeSeries] Response time trend:', JSON.stringify(responseTimePerDay));
    console.log('[Analytics TimeSeries] Resolution time trend:', JSON.stringify(resolutionTimePerDay));

    const daysOfWeek = ['', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // ── ticketsOverTime: merge assigned + resolved by string key — no Date objects, no duplicates ──
    const dateMap = {};
    assignedPerDay.forEach((d) => { dateMap[d._id] = { assigned: d.count, resolved: 0 }; });
    resolvedPerDay.forEach((d) => {
      if (dateMap[d._id]) dateMap[d._id].resolved = d.count;
      else dateMap[d._id] = { assigned: 0, resolved: d.count };
    });

    const ticketsOverTime = Object.keys(dateMap)
      .sort()
      .map((date) => ({
        date,
        assigned: dateMap[date].assigned,
        resolved: dateMap[date].resolved,
      }));

    // ── Trends: only days with computed values — no gap filling ──
    const responseTimeTrend = responseTimePerDay
      .filter((d) => d.avgResponseMin != null)
      .map((d) => ({ date: d._id, avgResponseTimeMin: d.avgResponseMin }));

    const resolutionTimeTrend = resolutionTimePerDay
      .filter((d) => d.avgResolutionMin != null)
      .map((d) => ({ date: d._id, avgResolutionTimeMin: d.avgResolutionMin }));

    return {
      ticketsOverTime,
      responseTimeTrend,
      resolutionTimeTrend,
      peakDay: peakDay[0]
        ? { day: daysOfWeek[peakDay[0]._id] || 'Unknown', count: peakDay[0].count }
        : null,
      busiestHour: busiestHour[0]
        ? { hour: busiestHour[0]._id, count: busiestHour[0].count }
        : null,
    };
  }

  // ─── PERFORMANCE INSIGHTS ENGINE ──────────────

  async _computePerformanceInsights(companyId, agentId, kpis) {
    const { avgFirstResponseTime, avgResolutionTime, reopenedRate } = kpis;

    const responseTimeStatus = avgFirstResponseTime <= CONFIG.RESPONSE.FAST_MAX
      ? 'fast'
      : avgFirstResponseTime >= CONFIG.RESPONSE.SLOW_MIN
        ? 'slow'
        : 'average';

    const resolutionEfficiency = avgResolutionTime <= CONFIG.RESOLUTION.FAST_MAX
      ? 'high'
      : avgResolutionTime >= CONFIG.RESOLUTION.SLOW_MIN
        ? 'low'
        : 'medium';

    const openCount = await ticketRepo.count({
      companyId: this._toObjectId(companyId),
      assignedTo: this._toObjectId(agentId),
      status: { $in: [TICKET_STATUS.PENDING, TICKET_STATUS.OPENED] },
    });

    const workloadStatus = openCount >= CONFIG.WORKLOAD.OVERLOADED_MIN
      ? 'overloaded'
      : openCount <= CONFIG.WORKLOAD.IDLE_MAX
        ? 'idle'
        : 'balanced';

    const trendPeriodDays = CONFIG.TREND_PERIOD_DAYS;
    const now = new Date();
    const currentStart = new Date(now.getTime() - trendPeriodDays * 24 * 60 * 60 * 1000);
    const previousEnd = new Date(currentStart.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - trendPeriodDays * 24 * 60 * 60 * 1000);

    const agentObjId = this._toObjectId(agentId);
    const companyObjId = this._toObjectId(companyId);

    const [currentResolvedAgg, previousResolvedAgg, currentFrtAgg, previousFrtAgg] = await Promise.all([
      ticketRepo.aggregate([
        { $match: { companyId: companyObjId, assignedTo: agentObjId, status: TICKET_STATUS.CLOSED, createdAt: { $gte: currentStart, $lte: now } } },
        { $group: { _id: null, count: { $sum: 1 } } },
      ]),
      ticketRepo.aggregate([
        { $match: { companyId: companyObjId, assignedTo: agentObjId, status: TICKET_STATUS.CLOSED, createdAt: { $gte: previousStart, $lte: previousEnd } } },
        { $group: { _id: null, count: { $sum: 1 } } },
      ]),
      ticketRepo.aggregate([
        { $match: { companyId: companyObjId, assignedTo: agentObjId, firstResponseAt: { $ne: null }, createdAt: { $gte: currentStart, $lte: now } } },
        { $group: { _id: null, avgTime: { $avg: { $subtract: ['$firstResponseAt', '$createdAt'] } } } },
      ]),
      ticketRepo.aggregate([
        { $match: { companyId: companyObjId, assignedTo: agentObjId, firstResponseAt: { $ne: null }, createdAt: { $gte: previousStart, $lte: previousEnd } } },
        { $group: { _id: null, avgTime: { $avg: { $subtract: ['$firstResponseAt', '$createdAt'] } } } },
      ]),
    ]);

    const currentResolved = currentResolvedAgg[0]?.count || 0;
    const previousResolved = previousResolvedAgg[0]?.count || 0;
    const currentAvgFrt = this._minutesFromMs(currentFrtAgg[0]?.avgTime);
    const previousAvgFrt = this._minutesFromMs(previousFrtAgg[0]?.avgTime);

    const resolutionTrend = currentResolved - previousResolved;
    const responseTrend = previousAvgFrt - currentAvgFrt;

    const performanceTrend = resolutionTrend > 0 && responseTrend >= 0
      ? 'improving'
      : resolutionTrend < 0 && responseTrend <= 0
        ? 'declining'
        : 'stable';

    return {
      responseTimeStatus,
      resolutionEfficiency,
      workloadStatus,
      performanceTrend,
      details: {
        avgFirstResponseTime,
        avgResolutionTime,
        reopenedRate,
        openTicketCount: openCount,
        currentPeriodResolved: currentResolved,
        previousPeriodResolved: previousResolved,
        currentPeriodAvgFrt: currentAvgFrt,
        previousPeriodAvgFrt: previousAvgFrt,
      },
    };
  }

  // ─── AGENT INTELLIGENCE ───────────────────────

  async _computeAgentIntelligence(companyId, agentId, kpis) {
    const companyObjId = this._toObjectId(companyId);
    const agentObjId = this._toObjectId(agentId);

    const qaAgg = await qaAnalysisRepo.aggregate([
      { $match: { companyId: companyObjId, agentId: agentObjId } },
      {
        $group: {
          _id: null,
          totalEvaluations: { $sum: 1 },
          avgProfessionalism: { $avg: '$scores.professionalism' },
          avgEmpathy: { $avg: '$scores.empathy' },
          avgQuality: { $avg: '$scores.quality' },
        },
      },
    ]);

    if (qaAgg[0] && qaAgg[0].totalEvaluations > 0) {
      return this._qaBasedIntelligence(qaAgg[0]);
    }

    return this._behaviorBasedIntelligence(kpis);
  }

  _qaBasedIntelligence(qa) {
    const professionalism = this._round(qa.avgProfessionalism);
    const empathy = this._round(qa.avgEmpathy);
    const quality = this._round(qa.avgQuality);

    const skillsScore = {
      communication: Math.min(100, this._round((empathy + quality) / 2)),
      problemSolving: Math.min(100, quality),
      speed: Math.min(100, this._round(professionalism * 0.7 + empathy * 0.3)),
      professionalism: Math.min(100, professionalism),
    };

    const qualityScore = this._round((professionalism + empathy + quality) / 3);
    const { strengths, weaknesses } = this._categorizeSkills(skillsScore);

    return { strengths, weaknesses, skillsScore, qualityScore, source: 'qa' };
  }

  _behaviorBasedIntelligence(kpis) {
    const { avgFirstResponseTime, reopenedRate, resolvedTickets, totalTickets } = kpis;
    const resolutionRate = totalTickets > 0 ? (resolvedTickets / totalTickets) * 100 : 0;

    const speedScore = Math.min(100, Math.max(0, 100 - (avgFirstResponseTime / CONFIG.RESPONSE.SLOW_MIN) * 100));
    const professionalismScore = Math.min(100, Math.max(0, 100 - reopenedRate * 3));
    const problemSolvingScore = Math.min(100, resolutionRate);
    const communicationScore = Math.min(100, this._round((speedScore + professionalismScore) / 2));

    const skillsScore = {
      communication: this._round(communicationScore),
      problemSolving: this._round(problemSolvingScore),
      speed: this._round(speedScore),
      professionalism: this._round(professionalismScore),
    };

    const qualityScore = this._round((communicationScore + problemSolvingScore + speedScore + professionalismScore) / 4);
    const { strengths, weaknesses } = this._categorizeSkills(skillsScore);

    return { strengths, weaknesses, skillsScore, qualityScore, source: 'behavior' };
  }

  _categorizeSkills(skillsScore) {
    const strengths = [];
    const weaknesses = [];

    const labels = {
      communication: { strength: 'Strong communicator', weakness: 'Needs communication improvement' },
      problemSolving: { strength: 'Excellent problem solver', weakness: 'Problem-solving needs work' },
      speed: { strength: 'Fast responder', weakness: 'Response speed needs improvement' },
      professionalism: { strength: 'Highly professional', weakness: 'Professionalism needs attention' },
    };

    for (const [skill, score] of Object.entries(skillsScore)) {
      if (score >= CONFIG.QA.HIGH_MIN) {
        strengths.push({ area: skill, label: labels[skill]?.strength || skill, score });
      } else if (score <= CONFIG.QA.LOW_MAX) {
        weaknesses.push({ area: skill, label: labels[skill]?.weakness || skill, score });
      }
    }

    return { strengths, weaknesses };
  }

  // ─── GOALS & GAMIFICATION ENGINE ──────────────

  async _computeGoals(companyId, agentId, kpis, filters = {}) {
    const { from, to } = filters;
    const now = to ? new Date(to) : new Date();
    const periodStart = from ? new Date(from) : new Date(now.getTime() - CONFIG.DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
    const daysDiff = this._daysBetween(periodStart, now);
    const avgDailyResolved = kpis.resolvedTickets / daysDiff;

    const dailyTarget = Math.max(1, Math.round(avgDailyResolved * 1.2));
    const weeklyTarget = dailyTarget * 5;
    const achievementRate = dailyTarget > 0
      ? Math.min(100, this._round((avgDailyResolved / dailyTarget) * 100))
      : 0;

    const [streakDays, rank] = await Promise.all([
      this._computeStreak(companyId, agentId, dailyTarget),
      this._computeAgentRank(companyId, agentId),
    ]);

    return { dailyTarget, weeklyTarget, achievementRate, streakDays, rank };
  }

  async _computeStreak(companyId, agentId, dailyTarget) {
    const resolvedPerDay = await ticketRepo.aggregate([
      {
        $match: {
          companyId: this._toObjectId(companyId),
          assignedTo: this._toObjectId(agentId),
          status: TICKET_STATUS.CLOSED,
          resolvedAt: { $ne: null },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$resolvedAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
    ]);

    if (!resolvedPerDay.length) return 0;

    let streak = 0;
    for (const day of resolvedPerDay) {
      if (day.count >= dailyTarget) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }

  async _computeAgentRank(companyId, agentId) {
    const agentPerformance = await ticketRepo.aggregate([
      {
        $match: {
          companyId: this._toObjectId(companyId),
          assignedTo: { $ne: null },
          status: TICKET_STATUS.CLOSED,
        },
      },
      { $group: { _id: '$assignedTo', resolvedCount: { $sum: 1 } } },
      { $sort: { resolvedCount: -1 } },
    ]);

    if (!agentPerformance.length) return null;

    const agentIndex = agentPerformance.findIndex(
      (a) => a._id.toString() === agentId.toString()
    );

    if (agentIndex === -1) return null;

    const percentile = this._round(
      ((agentPerformance.length - agentIndex - 1) / agentPerformance.length) * 100
    );

    return {
      position: agentIndex + 1,
      totalAgents: agentPerformance.length,
      percentile,
    };
  }

  // ─── ACTIVITY FEED ENGINE ─────────────────────

  async _computeActivityFeed(companyId, agentId) {
    const match = {
      companyId: this._toObjectId(companyId),
      'metadata.agentId': this._toObjectId(agentId),
      eventType: {
        $in: [
          EVENT_TYPES.TICKET_CLAIMED,
          EVENT_TYPES.TICKET_RESOLVED,
          EVENT_TYPES.TICKET_CLOSED,
          EVENT_TYPES.AGENT_REPLIED,
        ],
      },
    };

    const events = await eventLogRepo.aggregate([
      { $match: match },
      { $sort: { timestamp: -1 } },
      { $limit: CONFIG.ACTIVITY_FEED_LIMIT },
      {
        $project: {
          _id: 0,
          eventType: 1,
          entityId: 1,
          entityType: 1,
          timestamp: 1,
          metadata: 1,
        },
      },
    ]);

    return events.map((event) => ({
      type: event.eventType,
      label: this._formatActivityLabel(event),
      entityId: event.entityId,
      timestamp: event.timestamp,
    }));
  }

  _formatActivityLabel(event) {
    const shortId = event.entityId ? `#${event.entityId.toString().slice(-6)}` : '';
    switch (event.eventType) {
      case EVENT_TYPES.TICKET_CLAIMED: return `You claimed ticket ${shortId}`;
      case EVENT_TYPES.TICKET_RESOLVED: return `You resolved ticket ${shortId}`;
      case EVENT_TYPES.TICKET_CLOSED: return `You closed ticket ${shortId}`;
      case EVENT_TYPES.AGENT_REPLIED: return `You replied to ticket ${shortId}`;
      default: return `Activity: ${event.eventType}`;
    }
  }

  // ─── CALL ANALYTICS ENGINE ────────────────────

  async _computeCallAnalytics(companyId, agentId, filters = {}) {
    const dateFilter = this._buildDateFilter(filters);
    const match = {
      companyId: this._toObjectId(companyId),
      agentId: this._toObjectId(agentId),
    };
    if (Object.keys(dateFilter).length > 0) match.startedAt = dateFilter;

    const now = new Date();
    const currentPeriodStart = new Date(now.getTime() - CONFIG.DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
    const previousPeriodStart = new Date(currentPeriodStart.getTime() - CONFIG.DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);

    const [callStats, peakCallHours, previousMissAgg] = await Promise.all([
      callRepo.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            totalCalls: { $sum: 1 },
            answeredCalls: { $sum: { $cond: [{ $ne: ['$answeredAt', null] }, 1, 0] } },
            missedCalls: { $sum: { $cond: [{ $eq: ['$status', 'missed'] }, 1, 0] } },
            rejectedCalls: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
            avgDuration: { $avg: '$duration' },
            totalDuration: { $sum: '$duration' },
          },
        },
      ]),
      callRepo.aggregate([
        { $match: match },
        { $group: { _id: { $hour: '$startedAt' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 3 },
      ]),
      callRepo.aggregate([
        {
          $match: {
            ...match,
            startedAt: { $gte: previousPeriodStart, $lt: currentPeriodStart },
          },
        },
        {
          $group: {
            _id: null,
            totalCalls: { $sum: 1 },
            missedCalls: { $sum: { $cond: [{ $eq: ['$status', 'missed'] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const stats = callStats[0] || { totalCalls: 0, answeredCalls: 0, missedCalls: 0, rejectedCalls: 0, avgDuration: 0, totalDuration: 0 };
    const answerRate = stats.totalCalls > 0 ? this._round((stats.answeredCalls / stats.totalCalls) * 100) : 0;

    const prevMiss = previousMissAgg[0] || { totalCalls: 0, missedCalls: 0 };
    const prevMissRate = prevMiss.totalCalls > 0 ? (prevMiss.missedCalls / prevMiss.totalCalls) * 100 : 0;
    const currentMissRate = stats.totalCalls > 0 ? (stats.missedCalls / stats.totalCalls) * 100 : 0;

    const missTrend = currentMissRate < prevMissRate
      ? 'decreasing'
      : currentMissRate > prevMissRate
        ? 'increasing'
        : 'stable';

    return {
      totalCalls: stats.totalCalls,
      answeredCalls: stats.answeredCalls,
      missedCalls: stats.missedCalls,
      rejectedCalls: stats.rejectedCalls,
      avgDuration: this._round(stats.avgDuration || 0),
      totalDuration: stats.totalDuration,
      answerRate,
      peakCallHours: peakCallHours.map((h) => ({ hour: h._id, count: h.count })),
      missTrend,
    };
  }

  // ─── RECOMMENDATION ENGINE ────────────────────

  async _computeRecommendations(companyId, agentId, kpis, performanceInsights, agentIntelligence, callInsights) {
    const recommendations = [];

    if (kpis.avgFirstResponseTime > CONFIG.RESPONSE.FAST_MAX) {
      if (kpis.avgFirstResponseTime > CONFIG.RESPONSE.SLOW_MIN) {
        recommendations.push({
          type: 'critical',
          area: 'response_time',
          message: `Your response time (${kpis.avgFirstResponseTime} min) is significantly slower than the ${CONFIG.RESPONSE.FAST_MAX} min benchmark. Try replying within ${CONFIG.RESPONSE.FAST_MAX} minutes.`,
          impact: 'Customer satisfaction drops by 16% for every 10-minute delay in first response.',
          priority: 1,
        });
      } else {
        recommendations.push({
          type: 'improvement',
          area: 'response_time',
          message: `Your average response time is ${kpis.avgFirstResponseTime} min. Aim for under ${CONFIG.RESPONSE.FAST_MAX} min to boost satisfaction.`,
          impact: 'Faster responses lead to higher CSAT and fewer reopened tickets.',
          priority: 2,
        });
      }
    } else {
      recommendations.push({
        type: 'positive',
        area: 'response_time',
        message: `Excellent response time at ${kpis.avgFirstResponseTime} min. Maintain this pace.`,
        impact: 'Quick responses are your strongest driver of customer satisfaction.',
        priority: 5,
      });
    }

    if (kpis.avgResolutionTime > CONFIG.RESOLUTION.FAST_MAX) {
      recommendations.push({
        type: kpis.avgResolutionTime > CONFIG.RESOLUTION.SLOW_MIN ? 'critical' : 'improvement',
        area: 'resolution_time',
        message: `Resolution time averages ${kpis.avgResolutionTime} min. Streamline your workflow to resolve faster.`,
        impact: 'Long resolution times increase customer effort score and reduce capacity.',
        priority: 2,
      });
    }

    if (kpis.reopenedRate > CONFIG.REOPEN.HIGH_MIN) {
      recommendations.push({
        type: 'critical',
        area: 'reopen_rate',
        message: `Your reopen rate is ${kpis.reopenedRate}%. Ensure thorough resolution before closing tickets.`,
        impact: 'High reopen rates indicate incomplete resolutions, wasting up to 30% of capacity.',
        priority: 3,
      });
    }

    if (performanceInsights.workloadStatus === 'overloaded') {
      recommendations.push({
        type: 'warning',
        area: 'workload',
        message: `You have ${performanceInsights.details.openTicketCount} open tickets. Focus on closing before taking new assignments.`,
        impact: 'High open ticket counts increase SLA breach risk and agent burnout.',
        priority: 1,
      });
    } else if (performanceInsights.workloadStatus === 'idle') {
      recommendations.push({
        type: 'opportunity',
        area: 'workload',
        message: 'Your queue is light. Consider picking up pending tickets or helping teammates.',
        impact: 'Idle time can be used for knowledge base updates or peer reviews.',
        priority: 4,
      });
    }

    if (performanceInsights.performanceTrend === 'declining') {
      recommendations.push({
        type: 'warning',
        area: 'trend',
        message: 'Your performance has declined compared to last period. Review what changed and adjust.',
        impact: 'Catching a decline early prevents a downward spiral in metrics.',
        priority: 1,
      });
    }

    if (agentIntelligence.weaknesses?.length) {
      for (const weakness of agentIntelligence.weaknesses) {
        recommendations.push({
          type: 'improvement',
          area: weakness.area,
          message: `${weakness.label} (score: ${weakness.score}/100). Focus on building this skill.`,
          impact: 'Improving this skill directly boosts your overall quality score.',
          priority: 3,
        });
      }
    }

    if (callInsights.totalCalls > 0) {
      if (callInsights.answerRate < 70) {
        recommendations.push({
          type: 'critical',
          area: 'calls',
          message: `Call answer rate is ${callInsights.answerRate}%. Missing calls reduces customer trust.`,
          impact: 'Each missed call is a potential customer churn risk.',
          priority: 2,
        });
      }
      if (callInsights.missTrend === 'increasing') {
        recommendations.push({
          type: 'warning',
          area: 'calls',
          message: 'Missed call rate is increasing. Consider adjusting availability or notification settings.',
          impact: 'An increasing miss trend indicates capacity or scheduling issues.',
          priority: 3,
        });
      }
    }

    const channelAgg = await ticketRepo.aggregate([
      {
        $match: {
          companyId: this._toObjectId(companyId),
          assignedTo: this._toObjectId(agentId),
        },
      },
      {
        $group: {
          _id: '$channel',
          count: { $sum: 1 },
          avgFrt: {
            $avg: {
              $cond: [
                { $ne: ['$firstResponseAt', null] },
                { $subtract: ['$firstResponseAt', '$createdAt'] },
                null,
              ],
            },
          },
        },
      },
      { $sort: { count: -1 } },
    ]);

    if (channelAgg.length > 1) {
      const channelsWithFrt = channelAgg.filter((c) => c.avgFrt != null);
      if (channelsWithFrt.length > 1) {
        const bestChannel = channelsWithFrt.reduce((best, c) =>
          this._minutesFromMs(c.avgFrt) < this._minutesFromMs(best.avgFrt) ? c : best
        );
        const worstChannel = channelsWithFrt.reduce((worst, c) =>
          this._minutesFromMs(c.avgFrt) > this._minutesFromMs(worst.avgFrt) ? c : worst
        );

        if (bestChannel._id !== worstChannel._id) {
          recommendations.push({
            type: 'opportunity',
            area: 'channel',
            message: `You perform best on "${bestChannel._id}" (${this._minutesFromMs(bestChannel.avgFrt)} min avg response). Consider prioritizing this channel.`,
            impact: 'Channel specialization can improve your overall response metrics.',
            priority: 4,
          });
          recommendations.push({
            type: 'improvement',
            area: 'channel',
            message: `Your "${worstChannel._id}" responses are slowest (${this._minutesFromMs(worstChannel.avgFrt)} min avg). Review your approach for this channel.`,
            impact: 'Improving your weakest channel balances your overall performance.',
            priority: 3,
          });
        }
      }
    }

    recommendations.sort((a, b) => a.priority - b.priority);
    return recommendations;
  }

  // ══════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════

  async getFullAnalytics(companyId, agentId, filters = {}) {
    const kpis = await this._computeKPIs(companyId, agentId, filters);

    const [charts, performanceInsights, agentAnalysis, goals, activityFeed, callInsights] = await Promise.all([
      this._computeTimeSeries(companyId, agentId, filters),
      this._computePerformanceInsights(companyId, agentId, kpis),
      this._computeAgentIntelligence(companyId, agentId, kpis),
      this._computeGoals(companyId, agentId, kpis, filters),
      this._computeActivityFeed(companyId, agentId),
      this._computeCallAnalytics(companyId, agentId, filters),
    ]);

    const recommendations = await this._computeRecommendations(
      companyId, agentId, kpis, performanceInsights, agentAnalysis, callInsights,
    );

    const channelBreakdown = await this._computeChannelBreakdown(companyId, agentId, filters);

    return {
      kpis,
      charts,
      channelBreakdown,
      performanceInsights,
      agentAnalysis,
      goals,
      recommendations,
      activityFeed,
      callInsights,
    };
  }

  async _computeChannelBreakdown(companyId, agentId, filters = {}) {
    const match = this._buildDateMatch(companyId, agentId, filters);

    const channelAgg = await ticketRepo.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$channel',
          count: { $sum: 1 },
          resolvedCount: { $sum: { $cond: [{ $eq: ['$status', TICKET_STATUS.CLOSED] }, 1, 0] } },
          avgFrtMs: {
            $avg: {
              $cond: [
                { $ne: ['$firstResponseAt', null] },
                { $subtract: ['$firstResponseAt', '$createdAt'] },
                null,
              ],
            },
          },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const total = channelAgg.reduce((s, c) => s + c.count, 0) || 1;

    return channelAgg.map((c) => ({
      channel: c._id,
      count: c.count,
      resolvedCount: c.resolvedCount,
      percentage: Math.round((c.count / total) * 100),
      avgResponseTimeMin: c.avgFrtMs ? this._minutesFromMs(c.avgFrtMs) : 0,
    }));
  }

  // ─── BACKWARD-COMPATIBLE PUBLIC METHODS ───────

  async getOverview(companyId, agentId, filters = {}) {
    const kpis = await this._computeKPIs(companyId, agentId, filters);
    const channelBreakdown = await this._computeChannelBreakdown(companyId, agentId, filters);

    return {
      summary: {
        totalAssigned: kpis.totalTickets,
        pending: kpis.pendingTickets,
        inProgress: kpis.inProgressTickets,
        resolved: kpis.resolvedTickets,
        unresolved: kpis.pendingTickets + kpis.inProgressTickets,
      },
      performance: {
        avgFirstResponseTime: kpis.avgFirstResponseTime,
        avgFirstResponseMinutes: kpis.avgFirstResponseTime,
        avgResolutionTime: kpis.avgResolutionTime,
        avgResolutionMinutes: kpis.avgResolutionTime,
        reopenRate: kpis.reopenedRate,
        reopenedCount: kpis.reopenedTickets,
        slaCompliance: kpis.slaCompliance,
      },
      channels: channelBreakdown,
    };
  }

  async getTicketAnalytics(companyId, agentId, filters = {}) {
    const match = this._buildDateMatch(companyId, agentId, filters);

    const [categoryAgg, priorityAgg, topCustomers] = await Promise.all([
      ticketRepo.aggregate([
        { $match: match },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      ticketRepo.aggregate([
        { $match: match },
        { $group: { _id: '$priority', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      ticketRepo.aggregate([
        { $match: match },
        { $group: { _id: '$userId', ticketCount: { $sum: 1 } } },
        { $sort: { ticketCount: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'customer',
          },
        },
        { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            customerId: '$_id',
            name: '$customer.name',
            email: '$customer.email',
            ticketCount: 1,
          },
        },
      ]),
    ]);

    const categoryTotal = categoryAgg.reduce((s, c) => s + c.count, 0) || 1;

    return {
      categories: categoryAgg.map((c) => ({
        category: c._id,
        count: c.count,
        percentage: Math.round((c.count / categoryTotal) * 100),
      })),
      priorities: priorityAgg.map((p) => ({ priority: p._id, count: p.count })),
      topCustomers,
    };
  }

  async getTimeSeries(companyId, agentId, filters = {}) {
    const charts = await this._computeTimeSeries(companyId, agentId, filters);

    const assignedLabels = charts.ticketsOverTime.map((t) => t.date);
    const assignedData = charts.ticketsOverTime.map((t) => t.assigned);
    const resolvedLabels = charts.ticketsOverTime.map((t) => t.date);
    const resolvedData = charts.ticketsOverTime.map((t) => t.resolved);
    const responseLabels = charts.responseTimeTrend.map((t) => t.date);
    const responseData = charts.responseTimeTrend.map((t) => t.avgResponseTimeMin);

    return {
      assigned: this._fillDateRange(
        assignedLabels,
        [{ label: 'Assigned Tickets', data: assignedData }],
        filters.from, filters.to
      ),
      resolved: this._fillDateRange(
        resolvedLabels,
        [{ label: 'Resolved Tickets', data: resolvedData }],
        filters.from, filters.to
      ),
      responseTime: this._fillDateRange(
        responseLabels,
        [{ label: 'Avg Response Time (min)', data: responseData }],
        filters.from, filters.to
      ),
    };
  }

  async getQualityMetrics(companyId, agentId) {
    const companyObjId = this._toObjectId(companyId);
    const agentObjId = this._toObjectId(agentId);

    const [qaAgg, feedbackAgg] = await Promise.all([
      qaAnalysisRepo.aggregate([
        { $match: { companyId: companyObjId, agentId: agentObjId } },
        {
          $group: {
            _id: null,
            totalEvaluations: { $sum: 1 },
            avgProfessionalism: { $avg: '$scores.professionalism' },
            avgEmpathy: { $avg: '$scores.empathy' },
            avgQuality: { $avg: '$scores.quality' },
            overallAvg: { $avg: { $avg: ['$scores.professionalism', '$scores.empathy', '$scores.quality'] } },
          },
        },
      ]),
      ticketFeedbackRepo.aggregate([
        { $match: { companyId: companyObjId, agentId: agentObjId } },
        {
          $group: {
            _id: null,
            totalRatings: { $sum: 1 },
            avgRating: { $avg: '$rating' },
            satisfiedCount: { $sum: { $cond: [{ $gte: ['$rating', 4] }, 1, 0] } },
            count1: { $sum: { $cond: [{ $eq: ['$rating', 1] }, 1, 0] } },
            count2: { $sum: { $cond: [{ $eq: ['$rating', 2] }, 1, 0] } },
            count3: { $sum: { $cond: [{ $eq: ['$rating', 3] }, 1, 0] } },
            count4: { $sum: { $cond: [{ $eq: ['$rating', 4] }, 1, 0] } },
            count5: { $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const qa = qaAgg[0] || { totalEvaluations: 0, avgProfessionalism: 0, avgEmpathy: 0, avgQuality: 0, overallAvg: 0 };
    const feedback = feedbackAgg[0] || { totalRatings: 0, avgRating: 0, satisfiedCount: 0, count1: 0, count2: 0, count3: 0, count4: 0, count5: 0 };

    const avgRating = this._round(feedback.avgRating);
    const csat = feedback.totalRatings > 0 ? Math.round((feedback.satisfiedCount / feedback.totalRatings) * 100) : 0;

    return {
      qa: {
        totalEvaluations: qa.totalEvaluations,
        averageScores: {
          professionalism: this._round(qa.avgProfessionalism),
          empathy: this._round(qa.avgEmpathy),
          quality: this._round(qa.avgQuality),
          overall: this._round(qa.overallAvg),
        },
      },
      satisfaction: {
        totalRatings: feedback.totalRatings,
        avgRating,
        csat,
        ratingDistribution: { 1: feedback.count1, 2: feedback.count2, 3: feedback.count3, 4: feedback.count4, 5: feedback.count5 },
      },
    };
  }

  async getInsights(companyId, agentId) {
    const full = await this.getFullAnalytics(companyId, agentId);
    return {
      strengths: full.agentAnalysis.strengths,
      weaknesses: full.agentAnalysis.weaknesses,
      recommendations: full.recommendations.map((r) => ({
        area: r.area,
        label: r.message,
        detail: r.impact,
        type: r.type,
      })),
    };
  }
}

export default new AgentAnalyticsService();
