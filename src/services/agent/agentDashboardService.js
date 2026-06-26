import mongoose from 'mongoose';
import { ticketRepo, eventLogRepo, ticketFeedbackRepo, callRepo, userRepo } from '../../repositories/index.js';
import { TICKET_STATUS, EVENT_TYPES } from '../../constants/index.js';

const SLA_TARGET_MINUTES = 240;
const SLA_TARGET_MS = SLA_TARGET_MINUTES * 60 * 1000;
const DUE_SOON_WINDOW_MINUTES = 60;
const DEFAULT_RANGE_DAYS = 30;
const ACTIVITY_FEED_LIMIT = 10;

class AgentDashboardService {

  // ─── UTILITY HELPERS ──────────────────────────

  _toObjectId(id) {
    if (!id) return null;
    try { return new mongoose.Types.ObjectId(id); } catch { return null; }
  }

  _buildDateFilter({ from, to } = {}) {
    const filter = {};
    if (from) filter.$gte = new Date(from);
    if (to) filter.$lte = new Date(to);
    return filter;
  }

  _round(value, decimals = 1) {
    if (value === null || value === undefined || isNaN(value)) return 0;
    return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
  }

  _minutesFromMs(ms) { return ms ? this._round(ms / 60000) : 0; }

  _timeAgo(date) {
    if (!date) return '';
    const diff = Date.now() - new Date(date).getTime();
    if (diff < 0) return 'just now';
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}min ago`;
    return 'just now';
  }

  // ─── MODULE 1: KPIs ────────────────────────────

  async _computeKPIs(companyId, agentId, dateFilter) {
    const companyObjId = this._toObjectId(companyId);
    const agentObjId = this._toObjectId(agentId);
    const hasFilter = Object.keys(dateFilter).length > 0;

    const baseMatch = { companyId: companyObjId, assignedTo: agentObjId };
    if (hasFilter) baseMatch.createdAt = dateFilter;

    const resolvedMatch = { companyId: companyObjId, assignedTo: agentObjId, status: TICKET_STATUS.CLOSED };
    if (hasFilter) resolvedMatch.resolvedAt = dateFilter;

    const [totalAssigned, pendingCount, inProgressCount, resolvedCount, avgFrtAgg, avgRtAgg, feedbackAgg] = await Promise.all([
      ticketRepo.count(baseMatch),
      ticketRepo.count({ ...baseMatch, status: TICKET_STATUS.PENDING }),
      ticketRepo.count({ ...baseMatch, status: TICKET_STATUS.OPENED }),
      ticketRepo.count({ ...baseMatch, status: TICKET_STATUS.CLOSED }),
      ticketRepo.aggregate([
        { $match: { ...baseMatch, firstResponseAt: { $ne: null } } },
        { $project: { responseTime: { $subtract: ['$firstResponseAt', '$createdAt'] } } },
        { $group: { _id: null, avgTime: { $avg: '$responseTime' } } },
      ]),
      ticketRepo.aggregate([
        { $match: { ...resolvedMatch, resolvedAt: { $ne: null } } },
        { $project: { resolutionTime: { $subtract: ['$resolvedAt', '$createdAt'] } } },
        { $group: { _id: null, avgTime: { $avg: '$resolutionTime' } } },
      ]),
      ticketFeedbackRepo.aggregate([
        { $match: { companyId: companyObjId, agentId: agentObjId } },
        {
          $group: {
            _id: null,
            totalRatings: { $sum: 1 },
            avgRating: { $avg: '$rating' },
            satisfiedCount: { $sum: { $cond: [{ $gte: ['$rating', 4] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const avgFirstResponseTime = this._minutesFromMs(avgFrtAgg[0]?.avgTime);
    const avgResolutionTime = this._minutesFromMs(avgRtAgg[0]?.avgTime);
    const fb = feedbackAgg[0] || { totalRatings: 0, avgRating: 0, satisfiedCount: 0 };
    const csatScore = fb.totalRatings > 0 ? Math.round((fb.satisfiedCount / fb.totalRatings) * 100) : 0;

    return {
      assignedTickets: totalAssigned,
      resolvedTickets: resolvedCount,
      pendingTickets: pendingCount,
      inProgressTickets: inProgressCount,
      avgFirstResponseTime,
      avgResolutionTime,
      csatScore,
    };
  }

  // ─── MODULE 2: Today Stats ─────────────────────

  async _computeTodayStats(companyId, agentId) {
    const now = new Date();
    // Use UTC boundaries to match MongoDB's UTC-stored dates
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const todayEnd = new Date(todayStart.getTime() + 86400000);
    const companyObjId = this._toObjectId(companyId);
    const agentObjId = this._toObjectId(agentId);

    const [ticketsToday, resolvedToday, avgResponseAgg, avgResolutionAgg] = await Promise.all([
      ticketRepo.count({
        companyId: companyObjId,
        assignedTo: agentObjId,
        createdAt: { $gte: todayStart, $lt: todayEnd },
      }),
      ticketRepo.count({
        companyId: companyObjId,
        assignedTo: agentObjId,
        resolvedAt: { $gte: todayStart, $lt: todayEnd },
      }),
      ticketRepo.aggregate([
        {
          $match: {
            companyId: companyObjId,
            assignedTo: agentObjId,
            firstResponseAt: { $ne: null },
            createdAt: { $gte: todayStart, $lt: todayEnd },
          },
        },
        { $project: { responseTime: { $subtract: ['$firstResponseAt', '$createdAt'] } } },
        { $group: { _id: null, avgTime: { $avg: '$responseTime' } } },
      ]),
      ticketRepo.aggregate([
        {
          $match: {
            companyId: companyObjId,
            assignedTo: agentObjId,
            resolvedAt: { $gte: todayStart, $lt: todayEnd },
          },
        },
        { $project: { resolutionTime: { $subtract: ['$resolvedAt', '$createdAt'] } } },
        { $group: { _id: null, avgTime: { $avg: '$resolutionTime' } } },
      ]),
    ]);

    return {
      ticketsToday,
      resolvedToday,
      avgResponseToday: this._minutesFromMs(avgResponseAgg[0]?.avgTime),
      avgResolutionToday: this._minutesFromMs(avgResolutionAgg[0]?.avgTime),
    };
  }

  // ─── MODULE 3: SLA / Urgency ───────────────────

  async _computeSLAStats(companyId, agentId) {
    const companyObjId = this._toObjectId(companyId);
    const agentObjId = this._toObjectId(agentId);
    const now = new Date();
    const slaDeadline = new Date(now.getTime() - SLA_TARGET_MS);
    const warningThreshold = new Date(slaDeadline.getTime() + DUE_SOON_WINDOW_MINUTES * 60 * 1000);

    const [overdueTickets, dueSoonTickets, breachedAgg] = await Promise.all([
      ticketRepo.count({
        companyId: companyObjId,
        assignedTo: agentObjId,
        status: { $ne: TICKET_STATUS.CLOSED },
        createdAt: { $lt: slaDeadline },
      }),
      ticketRepo.count({
        companyId: companyObjId,
        assignedTo: agentObjId,
        status: { $ne: TICKET_STATUS.CLOSED },
        createdAt: { $gte: slaDeadline, $lt: warningThreshold },
      }),
      ticketRepo.aggregate([
        {
          $match: {
            companyId: companyObjId,
            assignedTo: agentObjId,
            status: TICKET_STATUS.CLOSED,
            resolvedAt: { $ne: null },
          },
        },
        {
          $project: {
            resolutionTime: { $subtract: ['$resolvedAt', '$createdAt'] },
          },
        },
        { $match: { resolutionTime: { $gt: SLA_TARGET_MS } } },
        { $count: 'count' },
      ]),
    ]);

    return {
      overdueTickets,
      dueSoon: dueSoonTickets,
      breachedTickets: breachedAgg[0]?.count || 0,
    };
  }

  // ─── MODULE 4: Productivity ────────────────────

  async _computeProductivity(companyId, agentId, dateFilter) {
    const companyObjId = this._toObjectId(companyId);
    const agentObjId = this._toObjectId(agentId);
    const hasFilter = Object.keys(dateFilter).length > 0;

    const profile = await userRepo.model.findById(agentId).select('lastLogin').lean();
    const lastLogin = profile?.lastLogin;
    const activeTimeSec = lastLogin
      ? Math.floor((Date.now() - new Date(lastLogin).getTime()) / 1000)
      : 0;

    const resolvedMatch = { companyId: companyObjId, assignedTo: agentObjId, status: TICKET_STATUS.CLOSED };
    if (hasFilter) resolvedMatch.resolvedAt = dateFilter;

    const resolvedAgg = await ticketRepo.aggregate([
      { $match: resolvedMatch },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]);
    const resolvedCount = resolvedAgg[0]?.count || 0;

    const activeHours = activeTimeSec / 3600;
    const ticketsPerHour = activeHours > 0 ? this._round(resolvedCount / activeHours, 2) : 0;

    const avgRtAgg = await ticketRepo.aggregate([
      { $match: { ...resolvedMatch, resolvedAt: { $ne: null } } },
      { $project: { resolutionTime: { $subtract: ['$resolvedAt', '$createdAt'] } } },
      { $group: { _id: null, avgTime: { $avg: '$resolutionTime' } } },
    ]);

    return {
      ticketsPerHour,
      avgHandlingTime: this._minutesFromMs(avgRtAgg[0]?.avgTime),
      activeTimeSec,
    };
  }

  // ─── MODULE 5: Performance Trend (full time series) ──

  async _computePerformanceTrend(companyId, agentId, dateFilter) {
    const companyObjId = this._toObjectId(companyId);
    const agentObjId = this._toObjectId(agentId);
    const hasFilter = Object.keys(dateFilter).length > 0;

    let startDate, endDate;
    if (hasFilter && dateFilter.$gte) {
      startDate = new Date(dateFilter.$gte);
    } else {
      endDate = new Date();
      startDate = new Date(endDate.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
    }
    if (hasFilter && dateFilter.$lte) {
      endDate = new Date(dateFilter.$lte);
    } else if (!endDate) {
      endDate = new Date();
    }

    startDate.setUTCHours(0, 0, 0, 0);
    endDate.setUTCHours(23, 59, 59, 999);

    const fullRange = [];
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      fullRange.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const rangeFilter = { $gte: startDate, $lte: endDate };

    const [assignedPerDay, resolvedPerDay] = await Promise.all([
      ticketRepo.aggregate([
        { $match: { companyId: companyObjId, assignedTo: agentObjId, createdAt: rangeFilter } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      ]),
      ticketRepo.aggregate([
        { $match: { companyId: companyObjId, assignedTo: agentObjId, status: TICKET_STATUS.CLOSED, resolvedAt: { $ne: null, ...rangeFilter } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$resolvedAt' } }, count: { $sum: 1 } } },
      ]),
    ]);

    const assignedMap = {};
    assignedPerDay.forEach(d => { assignedMap[d._id] = d.count; });
    const resolvedMap = {};
    resolvedPerDay.forEach(d => { resolvedMap[d._id] = d.count; });

    return fullRange.map(date => ({
      date,
      assigned: assignedMap[date] || 0,
      resolved: resolvedMap[date] || 0,
    }));
  }

  // ─── MODULE 6: Channel Distribution ────────────

  async _computeChannelDistribution(companyId, agentId, dateFilter) {
    const companyObjId = this._toObjectId(companyId);
    const agentObjId = this._toObjectId(agentId);
    const hasFilter = Object.keys(dateFilter).length > 0;

    const match = { companyId: companyObjId, assignedTo: agentObjId };
    if (hasFilter) match.createdAt = dateFilter;

    const channelAgg = await ticketRepo.aggregate([
      { $match: match },
      { $group: { _id: '$channel', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const total = channelAgg.reduce((s, c) => s + c.count, 0) || 1;

    return channelAgg.map((c) => ({
      channel: c._id,
      count: c.count,
      percentage: Math.round((c.count / total) * 100),
    }));
  }

  // ─── MODULE 7: Feedback Stats ──────────────────

  async _computeFeedbackStats(companyId, agentId) {
    const companyObjId = this._toObjectId(companyId);
    const agentObjId = this._toObjectId(agentId);

    const feedbackAgg = await ticketFeedbackRepo.aggregate([
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
    ]);

    const f = feedbackAgg[0] || { totalRatings: 0, avgRating: 0, satisfiedCount: 0, count1: 0, count2: 0, count3: 0, count4: 0, count5: 0 };

    return {
      totalRatings: f.totalRatings,
      avgRating: this._round(f.avgRating),
      csat: f.totalRatings > 0 ? Math.round((f.satisfiedCount / f.totalRatings) * 100) : 0,
      ratingBreakdown: {
        1: f.count1, 2: f.count2, 3: f.count3, 4: f.count4, 5: f.count5,
      },
    };
  }

  // ─── MODULE 8: Recent Activity ─────────────────

  async _computeRecentActivity(companyId, agentId) {
    const companyObjId = this._toObjectId(companyId);
    const agentObjId = this._toObjectId(agentId);

    // Only fetch events from the last 72 hours to keep the feed fresh
    const recentCutoff = new Date(Date.now() - 72 * 60 * 60 * 1000);

    const events = await eventLogRepo.aggregate([
      {
        $match: {
          companyId: companyObjId,
          'metadata.agentId': agentObjId,
          eventType: {
            $in: [
              EVENT_TYPES.TICKET_CLAIMED,
              EVENT_TYPES.TICKET_RESOLVED,
              EVENT_TYPES.TICKET_CLOSED,
              EVENT_TYPES.AGENT_REPLIED,
              EVENT_TYPES.TICKET_CREATED,
            ],
          },
          timestamp: { $gte: recentCutoff },
        },
      },
      { $sort: { timestamp: -1 } },
      { $limit: ACTIVITY_FEED_LIMIT },
      {
        $project: {
          _id: 0,
          eventType: 1,
          entityId: 1,
          timestamp: 1,
          metadata: 1,
        },
      },
    ]);

    const typeLabels = {
      [EVENT_TYPES.TICKET_CLAIMED]: 'Claimed ticket',
      [EVENT_TYPES.TICKET_RESOLVED]: 'Resolved ticket',
      [EVENT_TYPES.TICKET_CLOSED]: 'Closed ticket',
      [EVENT_TYPES.AGENT_REPLIED]: 'Replied to ticket',
      [EVENT_TYPES.TICKET_CREATED]: 'Created ticket',
    };

    return events.map((e) => ({
      type: e.eventType,
      ticketId: e.entityId,
      label: `${typeLabels[e.eventType] || e.eventType} #${e.entityId?.toString().slice(-6) || ''}`,
      timeAgo: this._timeAgo(e.timestamp),
    }));
  }

  // ─── MODULE 9: Top Categories ──────────────────

  async _computeTopCategories(companyId, agentId, dateFilter) {
    const companyObjId = this._toObjectId(companyId);
    const agentObjId = this._toObjectId(agentId);
    const hasFilter = Object.keys(dateFilter).length > 0;

    const match = { companyId: companyObjId, assignedTo: agentObjId };
    if (hasFilter) match.createdAt = dateFilter;

    const categoryAgg = await ticketRepo.aggregate([
      { $match: match },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    return categoryAgg.map((c) => ({ name: c._id, count: c.count }));
  }

  // ─── MODULE 10: Goal Progress ──────────────────

  async _computeGoalProgress(companyId, agentId, dateFilter) {
    const companyObjId = this._toObjectId(companyId);
    const agentObjId = this._toObjectId(agentId);
    const hasFilter = Object.keys(dateFilter).length > 0;

    const resolvedMatch = { companyId: companyObjId, assignedTo: agentObjId, status: TICKET_STATUS.CLOSED };
    if (hasFilter) resolvedMatch.resolvedAt = dateFilter;

    const [resolvedAgg, assignedAgg] = await Promise.all([
      ticketRepo.aggregate([
        { $match: resolvedMatch },
        { $group: { _id: null, count: { $sum: 1 } } },
      ]),
      ticketRepo.aggregate([
        { $match: { companyId: companyObjId, assignedTo: agentObjId } },
        {
          $group: {
            _id: null,
            minDate: { $min: '$createdAt' },
            maxDate: { $max: '$createdAt' },
          },
        },
      ]),
    ]);

    const resolvedCount = resolvedAgg[0]?.count || 0;

    let daysInPeriod;
    if (hasFilter && dateFilter.$gte && dateFilter.$lte) {
      daysInPeriod = Math.max(1, Math.ceil((dateFilter.$lte - dateFilter.$gte) / (1000 * 60 * 60 * 24)));
    } else if (assignedAgg[0]?.minDate && assignedAgg[0]?.maxDate) {
      daysInPeriod = Math.max(1, Math.ceil(
        (assignedAgg[0].maxDate - assignedAgg[0].minDate) / (1000 * 60 * 60 * 24)
      ));
    } else {
      daysInPeriod = DEFAULT_RANGE_DAYS;
    }

    const avgDailyResolved = resolvedCount / daysInPeriod;
    const dailyTarget = Math.max(1, Math.round(avgDailyResolved * 1.2));
    const total = dailyTarget * daysInPeriod;
    const percentage = total > 0 ? Math.min(100, Math.round((resolvedCount / total) * 100)) : 0;

    return { total, current: resolvedCount, percentage, dailyTarget };
  }

  // ─── MODULE 11: Call Performance ──────────────

  async _computeCallPerformance(companyId, agentId, dateFilter) {
    const companyObjId = this._toObjectId(companyId);
    const agentObjId = this._toObjectId(agentId);
    const hasFilter = Object.keys(dateFilter).length > 0;

    const match = { companyId: companyObjId, agentId: agentObjId };
    if (hasFilter) match.startedAt = dateFilter;

    const [callAgg] = await Promise.all([
      callRepo.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            totalCalls: { $sum: 1 },
            answered: {
              $sum: { $cond: [{ $in: ['$status', ['active', 'ended']] }, 1, 0] },
            },
            missed: {
              $sum: { $cond: [{ $eq: ['$status', 'missed'] }, 1, 0] },
            },
            totalDuration: { $sum: '$duration' },
          },
        },
      ]),
    ]);

    const r = callAgg[0] || { totalCalls: 0, answered: 0, missed: 0, totalDuration: 0 };
    const avgDuration = r.totalCalls > 0 ? Math.round(r.totalDuration / r.totalCalls) : 0;
    const answerRate = r.totalCalls > 0 ? Math.round((r.answered / r.totalCalls) * 100) : 0;

    return {
      totalCalls: r.totalCalls,
      answered: r.answered,
      missed: r.missed,
      avgDuration,
      answerRate,
    };
  }

  // ─── MODULE 12: CSAT UI (derived from feedbackStats) ──

  _computeCsatUI(feedbackStats) {
    const percentage = feedbackStats.csat || 0;
    let label, color;
    if (percentage >= 75) {
      label = 'Good';
      color = 'green';
    } else if (percentage >= 50) {
      label = 'Average';
      color = 'orange';
    } else {
      label = 'Bad';
      color = 'red';
    }
    return { percentage, label, color, trend: 0 };
  }

  // ─── MODULE 13: Workload (utilization) ────────

  _computeWorkload(kpis, goalProgress) {
    const used = kpis.assignedTickets || 0;
    const total = goalProgress.total || 1;
    const percentage = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
    let level;
    if (percentage >= 70) level = 'high';
    else if (percentage >= 40) level = 'medium';
    else level = 'low';
    return { used, total, percentage, level };
  }

  // ══════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════

  async getAgentDashboard(companyId, agentId, { from, to } = {}) {
    const dateFilter = this._buildDateFilter({ from, to });

    const [kpis, todayStats, slaStats, productivity, performanceTrend, channelDistribution, feedbackStats, recentActivity, topCategories, goalProgress, callPerformance] = await Promise.all([
      this._computeKPIs(companyId, agentId, dateFilter),
      this._computeTodayStats(companyId, agentId),
      this._computeSLAStats(companyId, agentId),
      this._computeProductivity(companyId, agentId, dateFilter),
      this._computePerformanceTrend(companyId, agentId, dateFilter),
      this._computeChannelDistribution(companyId, agentId, dateFilter),
      this._computeFeedbackStats(companyId, agentId),
      this._computeRecentActivity(companyId, agentId),
      this._computeTopCategories(companyId, agentId, dateFilter),
      this._computeGoalProgress(companyId, agentId, dateFilter),
      this._computeCallPerformance(companyId, agentId, dateFilter),
    ]);

    const csatUI = this._computeCsatUI(feedbackStats);
    const workload = this._computeWorkload(kpis, goalProgress);

    return {
      kpis,
      todayStats,
      slaStats,
      productivity,
      performanceTrend,
      callPerformance,
      channelDistribution,
      feedbackStats,
      csatUI,
      recentActivity,
      topCategories,
      goalProgress,
      workload,
    };
  }

  async getAgentsOverview(companyId, { from, to } = {}) {
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(to);
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const ticketMatch = { companyId: this._toObjectId(companyId), assignedTo: { $ne: null } };
    if (hasDateFilter) ticketMatch.createdAt = dateFilter;

    const agentStats = await ticketRepo.aggregate([
      { $match: ticketMatch },
      {
        $group: {
          _id: '$assignedTo',
          totalAssigned: { $sum: 1 },
          openCount: { $sum: { $cond: [{ $eq: ['$status', TICKET_STATUS.PENDING] }, 1, 0] } },
          inProgressCount: { $sum: { $cond: [{ $eq: ['$status', TICKET_STATUS.OPENED] }, 1, 0] } },
          resolvedCount: { $sum: { $cond: [{ $eq: ['$status', TICKET_STATUS.CLOSED] }, 1, 0] } },
          avgFirstResponse: {
            $avg: {
              $cond: [
                { $ne: ['$firstResponseAt', null] },
                { $subtract: ['$firstResponseAt', '$createdAt'] },
                null,
              ],
            },
          },
          avgResolution: {
            $avg: {
              $cond: [
                { $ne: ['$resolvedAt', null] },
                { $subtract: ['$resolvedAt', '$createdAt'] },
                null,
              ],
            },
          },
          categories: { $push: '$category' },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'agent',
        },
      },
      { $unwind: '$agent' },
      {
        $project: {
          agentId: '$_id',
          name: '$agent.name',
          email: '$agent.email',
          profileImage: '$agent.profileImage',
          tasks: {
            assigned: '$totalAssigned',
            open: '$openCount',
            inProgress: '$inProgressCount',
            resolved: '$resolvedCount',
            closed: '$resolvedCount',
          },
          performance: {
            avgFirstResponseTime: {
              $cond: [
                { $ne: ['$avgFirstResponse', null] },
                { $round: [{ $divide: ['$avgFirstResponse', 60000] }, 0] },
                0,
              ],
            },
            avgResolutionTime: {
              $cond: [
                { $ne: ['$avgResolution', null] },
                { $round: [{ $divide: ['$avgResolution', 60000] }, 0] },
                0,
              ],
            },
          },
          categories: 1,
        },
      },
      { $sort: { 'tasks.resolved': -1 } },
    ]);

    return agentStats.map((agent) => {
      const catCounts = {};
      (agent.categories || []).forEach((c) => {
        catCounts[c] = (catCounts[c] || 0) + 1;
      });
      const topCategories = Object.entries(catCounts)
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      return {
        agentId: agent.agentId,
        name: agent.name,
        email: agent.email,
        profileImage: agent.profileImage,
        tasks: agent.tasks,
        performance: agent.performance,
        topCategories,
      };
    });
  }
}

export default new AgentDashboardService();
