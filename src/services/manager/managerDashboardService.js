import mongoose from 'mongoose';
import { ticketRepo, eventLogRepo, ticketFeedbackRepo, callRepo, userRepo, companyRepo } from '../../repositories/index.js';
import { ChatSession } from '../../models/index.js';
import { ROLES, TICKET_STATUS, CHAT_STATUS, EVENT_TYPES } from '../../constants/index.js';

const SLA_TARGET_MINUTES = 240;
const SLA_TARGET_MS = SLA_TARGET_MINUTES * 60 * 1000;
const DUE_SOON_WINDOW_MINUTES = 60;
const DEFAULT_RANGE_DAYS = 30;
const ACTIVITY_FEED_LIMIT = 10;
const CAPACITY_PER_AGENT = 20;

class ManagerDashboardService {

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

  _percentageDelta(current, previous) {
    if (!previous && !current) return 0;
    if (!previous) return 100;
    return Math.round(((current - previous) / previous) * 100);
  }

  _computeCsatUI(feedbackStats) {
    const percentage = feedbackStats.csat || 0;
    let label, color;
    if (percentage >= 75) { label = 'Good'; color = 'green'; }
    else if (percentage >= 50) { label = 'Average'; color = 'orange'; }
    else { label = 'Bad'; color = 'red'; }
    return { percentage, label, color, trend: 0 };
  }

  _computeWorkload(kpis, goalProgress) {
    const used = kpis.activeTickets || 0;
    const total = goalProgress.total || 1;
    const percentage = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
    let level;
    if (percentage >= 70) level = 'high';
    else if (percentage >= 40) level = 'medium';
    else level = 'low';
    return { used, total, percentage, level };
  }

  async _computeOverview(companyId, companyObjId, kpis, agentsCount, activeManagers, answerRate, csatScore) {
    const resolutionRate = kpis.totalTickets > 0
      ? Math.round((kpis.resolvedTickets / kpis.totalTickets) * 100) : 0;

    let healthScore = 0;
    if (resolutionRate >= 80) healthScore += 30;
    else if (resolutionRate >= 50) healthScore += 15;

    const capacity = agentsCount * CAPACITY_PER_AGENT;
    const activeTickets = kpis.openTickets || 0;
    if (activeTickets <= capacity * 0.3) healthScore += 25;
    else if (activeTickets <= capacity * 0.6) healthScore += 15;
    else healthScore += 5;

    if (activeManagers > 0) healthScore += 15;
    else healthScore += 0;

    if (answerRate >= 80) healthScore += 15;
    else if (answerRate >= 50) healthScore += 8;

    if (csatScore >= 70) healthScore += 15;
    else if (csatScore >= 50) healthScore += 8;

    healthScore = Math.min(100, Math.max(0, healthScore));

    let status;
    if (healthScore > 75) status = 'excellent';
    else if (healthScore > 45) status = 'good';
    else status = 'critical';

    const workloadPct = capacity > 0 ? Math.round((activeTickets / capacity) * 100) : 0;
    let workloadLevel;
    if (workloadPct >= 70) workloadLevel = 'high';
    else if (workloadPct >= 35) workloadLevel = 'medium';
    else workloadLevel = 'low';

    let riskLevel;
    if (activeManagers === 0 || csatScore < 40) riskLevel = 'high';
    else if (resolutionRate < 50 || answerRate < 50) riskLevel = 'moderate';
    else riskLevel = 'none';

    return { healthScore, status, workloadLevel, riskLevel };
  }

  async _computeKPIs(companyId) {
    const companyObjId = this._toObjectId(companyId);
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const match = { companyId: companyObjId };

    const [totalTickets, openTickets, resolvedTickets, ticketsToday, ticketsLast7Days, ticketsPrev7Days, avgFrtAgg, avgRtAgg] = await Promise.all([
      ticketRepo.count(match),
      ticketRepo.count({ ...match, status: { $in: [TICKET_STATUS.PENDING, TICKET_STATUS.OPENED] } }),
      ticketRepo.count({ ...match, status: TICKET_STATUS.CLOSED }),
      ticketRepo.count({ ...match, createdAt: { $gte: today } }),
      ticketRepo.count({ ...match, createdAt: { $gte: sevenDaysAgo } }),
      ticketRepo.count({ ...match, createdAt: { $gte: fourteenDaysAgo, $lt: sevenDaysAgo } }),
      ticketRepo.aggregate([
        { $match: { ...match, firstResponseAt: { $ne: null } } },
        { $project: { responseTime: { $subtract: ['$firstResponseAt', '$createdAt'] } } },
        { $group: { _id: null, avgTime: { $avg: '$responseTime' } } },
      ]),
      ticketRepo.aggregate([
        { $match: { ...match, status: TICKET_STATUS.CLOSED, resolvedAt: { $ne: null } } },
        { $project: { resolutionTime: { $subtract: ['$resolvedAt', '$createdAt'] } } },
        { $group: { _id: null, avgTime: { $avg: '$resolutionTime' } } },
      ]),
    ]);

    const resolutionRate = totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 0;

    return {
      totalTickets,
      openTickets,
      resolvedTickets,
      ticketsToday,
      ticketsLast7Days,
      ticketsDelta: this._percentageDelta(ticketsLast7Days, ticketsPrev7Days),
      resolutionRate,
      avgFirstResponseTime: this._minutesFromMs(avgFrtAgg[0]?.avgTime),
      avgResolutionTime: this._minutesFromMs(avgRtAgg[0]?.avgTime),
    };
  }

  async _computeTodayStats(companyId) {
    const companyObjId = this._toObjectId(companyId);
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const todayEnd = new Date(todayStart.getTime() + 86400000);

    const [ticketsToday, resolvedToday, avgResponseAgg, avgResolutionAgg] = await Promise.all([
      ticketRepo.count({ companyId: companyObjId, createdAt: { $gte: todayStart, $lt: todayEnd } }),
      ticketRepo.count({ companyId: companyObjId, resolvedAt: { $gte: todayStart, $lt: todayEnd } }),
      ticketRepo.aggregate([
        { $match: { companyId: companyObjId, firstResponseAt: { $ne: null }, createdAt: { $gte: todayStart, $lt: todayEnd } } },
        { $project: { responseTime: { $subtract: ['$firstResponseAt', '$createdAt'] } } },
        { $group: { _id: null, avgTime: { $avg: '$responseTime' } } },
      ]),
      ticketRepo.aggregate([
        { $match: { companyId: companyObjId, resolvedAt: { $gte: todayStart, $lt: todayEnd } } },
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

  async _computeSLAStats(companyId) {
    const companyObjId = this._toObjectId(companyId);
    const now = new Date();
    const slaDeadline = new Date(now.getTime() - SLA_TARGET_MS);
    const warningThreshold = new Date(slaDeadline.getTime() + DUE_SOON_WINDOW_MINUTES * 60 * 1000);

    const [overdueTickets, dueSoonTickets, breachedAgg] = await Promise.all([
      ticketRepo.count({
        companyId: companyObjId,
        status: { $ne: TICKET_STATUS.CLOSED },
        createdAt: { $lt: slaDeadline },
      }),
      ticketRepo.count({
        companyId: companyObjId,
        status: { $ne: TICKET_STATUS.CLOSED },
        createdAt: { $gte: slaDeadline, $lt: warningThreshold },
      }),
      ticketRepo.aggregate([
        { $match: { companyId: companyObjId, status: TICKET_STATUS.CLOSED, resolvedAt: { $ne: null } } },
        { $project: { resolutionTime: { $subtract: ['$resolvedAt', '$createdAt'] } } },
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

  async _computeProductivity(companyId) {
    const companyObjId = this._toObjectId(companyId);

    const allAgents = await userRepo.model.find({
      companyId,
      role: ROLES.AGENT,
      isActive: true,
    }).select('lastLogin').lean();

    const activeTimeSec = allAgents.reduce((sum, a) => {
      if (!a.lastLogin) return sum;
      return sum + Math.floor((Date.now() - new Date(a.lastLogin).getTime()) / 1000);
    }, 0);

    const resolvedAgg = await ticketRepo.aggregate([
      { $match: { companyId: companyObjId, status: TICKET_STATUS.CLOSED } },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]);
    const resolvedCount = resolvedAgg[0]?.count || 0;

    const activeHours = activeTimeSec / 3600;
    const ticketsPerHour = activeHours > 0 ? this._round(resolvedCount / activeHours, 2) : 0;

    const avgRtAgg = await ticketRepo.aggregate([
      { $match: { companyId: companyObjId, status: TICKET_STATUS.CLOSED, resolvedAt: { $ne: null } } },
      { $project: { resolutionTime: { $subtract: ['$resolvedAt', '$createdAt'] } } },
      { $group: { _id: null, avgTime: { $avg: '$resolutionTime' } } },
    ]);

    return {
      ticketsPerHour,
      avgHandlingTime: this._minutesFromMs(avgRtAgg[0]?.avgTime),
      activeTimeSec,
    };
  }

  async _computePerformanceTrend(companyId, dateFilter) {
    const companyObjId = this._toObjectId(companyId);
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
        { $match: { companyId: companyObjId, createdAt: rangeFilter } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      ]),
      ticketRepo.aggregate([
        { $match: { companyId: companyObjId, status: TICKET_STATUS.CLOSED, resolvedAt: { $ne: null, ...rangeFilter } } },
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

  async _computeCallPerformance(companyId) {
    const companyObjId = this._toObjectId(companyId);

    const [callAgg] = await Promise.all([
      callRepo.aggregate([
        { $match: { companyId: companyObjId } },
        {
          $group: {
            _id: null,
            totalCalls: { $sum: 1 },
            answered: { $sum: { $cond: [{ $in: ['$status', ['active', 'ended']] }, 1, 0] } },
            missed: { $sum: { $cond: [{ $eq: ['$status', 'missed'] }, 1, 0] } },
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

  async _computeChannelDistribution(companyId) {
    const companyObjId = this._toObjectId(companyId);

    const channelAgg = await ticketRepo.aggregate([
      { $match: { companyId: companyObjId } },
      { $group: { _id: '$channel', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const total = channelAgg.reduce((s, c) => s + c.count, 0) || 1;

    return channelAgg.map(c => ({
      name: c._id ? c._id.charAt(0).toUpperCase() + c._id.slice(1) : 'Unknown',
      count: c.count,
      percentage: Math.round((c.count / total) * 100),
    }));
  }

  async _computeFeedbackStats(companyId) {
    const companyObjId = this._toObjectId(companyId);

    const feedbackAgg = await ticketFeedbackRepo.aggregate([
      { $match: { companyId: companyObjId } },
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
      ratingBreakdown: { 1: f.count1, 2: f.count2, 3: f.count3, 4: f.count4, 5: f.count5 },
    };
  }

  async _computeRecentActivity(companyId) {
    const companyObjId = this._toObjectId(companyId);
    const recentCutoff = new Date(Date.now() - 72 * 60 * 60 * 1000);

    const events = await eventLogRepo.aggregate([
      {
        $match: {
          companyId: companyObjId,
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
      { $project: { _id: 0, eventType: 1, entityId: 1, timestamp: 1, metadata: 1 } },
    ]);

    const typeLabels = {
      [EVENT_TYPES.TICKET_CLAIMED]: 'Claimed ticket',
      [EVENT_TYPES.TICKET_RESOLVED]: 'Resolved ticket',
      [EVENT_TYPES.TICKET_CLOSED]: 'Closed ticket',
      [EVENT_TYPES.AGENT_REPLIED]: 'Replied to ticket',
      [EVENT_TYPES.TICKET_CREATED]: 'Created ticket',
    };

    return events.map(e => ({
      type: e.eventType,
      ticketId: e.entityId,
      label: `${typeLabels[e.eventType] || e.eventType} #${e.entityId?.toString().slice(-6) || ''}`,
      timeAgo: this._timeAgo(e.timestamp),
    }));
  }

  async _computeTopCategories(companyId) {
    const companyObjId = this._toObjectId(companyId);

    const categoryAgg = await ticketRepo.aggregate([
      { $match: { companyId: companyObjId } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    return categoryAgg.map(c => ({ name: c._id, count: c.count }));
  }

  async _computeGoalProgress(companyId) {
    const companyObjId = this._toObjectId(companyId);
    const goalTarget = 500;

    const resolvedAgg = await ticketRepo.aggregate([
      { $match: { companyId: companyObjId, status: TICKET_STATUS.CLOSED } },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]);
    const resolvedCount = resolvedAgg[0]?.count || 0;

    const assignedAgg = await ticketRepo.aggregate([
      { $match: { companyId: companyObjId } },
      { $group: { _id: null, minDate: { $min: '$createdAt' }, maxDate: { $max: '$createdAt' } } },
    ]);

    let daysInPeriod;
    if (assignedAgg[0]?.minDate && assignedAgg[0]?.maxDate) {
      daysInPeriod = Math.max(1, Math.ceil(
        (assignedAgg[0].maxDate - assignedAgg[0].minDate) / (1000 * 60 * 60 * 24)
      ));
    } else {
      daysInPeriod = DEFAULT_RANGE_DAYS;
    }

    const avgDailyResolved = resolvedCount / daysInPeriod;
    const dailyTarget = Math.max(1, Math.round(avgDailyResolved * 1.2));
    const total = Math.max(goalTarget, dailyTarget * daysInPeriod);
    const percentage = total > 0 ? Math.min(100, Math.round((resolvedCount / total) * 100)) : 0;

    return { total, current: resolvedCount, percentage, dailyTarget };
  }

  _generateInsights(kpis, callPerformance, feedbackStats, slaStats, todayStats, agentsCount, activeManagers, totalManagers, company) {
    const insights = [];
    const activeChannels = [
      company?.channelsConfig?.telegram?.isActive,
      company?.channelsConfig?.whatsapp?.isActive,
      company?.channelsConfig?.webChat?.isActive,
    ].filter(Boolean).length;

    if (kpis.openTickets === 0) {
      insights.push({ type: 'info', metric: 'activeTickets', message: 'No active tickets — team is idle', severity: 'low' });
    }
    if (kpis.workloadPerAgent > 5) {
      insights.push({ type: 'warning', metric: 'workloadPerAgent', message: `High workload per agent (${kpis.workloadPerAgent} tickets each)`, severity: 'high' });
    }
    if (kpis.resolutionRate === 100 && kpis.totalTickets > 0) {
      insights.push({ type: 'positive', metric: 'resolutionRate', message: 'Excellent resolution performance — all tickets resolved', severity: 'low' });
    }
    if (activeManagers === 0 && totalManagers > 0) {
      insights.push({ type: 'critical', metric: 'activeManagers', message: 'No active managers — operational risk detected', severity: 'high' });
    }
    if (activeChannels < 2) {
      insights.push({ type: 'info', metric: 'activeChannels', message: `Only ${activeChannels} channel(s) active — consider enabling more`, severity: 'medium' });
    }
    if (slaStats.overdueTickets > 0) {
      insights.push({ type: 'critical', metric: 'overdueTickets', message: `${slaStats.overdueTickets} tickets past SLA deadline`, severity: 'high' });
    }
    if (slaStats.breachedTickets > 0) {
      insights.push({ type: 'warning', metric: 'breachedTickets', message: `${slaStats.breachedTickets} tickets breached SLA`, severity: 'medium' });
    }
    if (callPerformance.answerRate < 60 && callPerformance.totalCalls > 0) {
      insights.push({ type: 'warning', metric: 'answerRate', message: `Call answer rate is low (${callPerformance.answerRate}%)`, severity: 'high' });
    }
    if (feedbackStats.csat > 0 && feedbackStats.csat < 50) {
      insights.push({ type: 'critical', metric: 'csatScore', message: `CSAT score critically low (${feedbackStats.csat}%)`, severity: 'high' });
    }
    if (kpis.resolutionRate < 50 && kpis.totalTickets > 0) {
      insights.push({ type: 'warning', metric: 'resolutionRate', message: `Resolution rate is low (${kpis.resolutionRate}%)`, severity: 'high' });
    }
    if (todayStats.resolvedToday === 0) {
      insights.push({ type: 'info', metric: 'resolvedToday', message: 'No tickets resolved yet today', severity: 'low' });
    }

    return insights;
  }

  _generateSuggestions(kpis, callPerformance, feedbackStats, insights, agentsCount, activeManagers) {
    const suggestions = [];

    if (kpis.workloadPerAgent > 5) {
      suggestions.push({ type: 'staffing', action: 'hire', message: 'Hire more agents or redistribute tickets to reduce workload', priority: 'high' });
    }
    if (kpis.openTickets === 0 && agentsCount > 0) {
      suggestions.push({ type: 'optimization', action: 'reschedule', message: 'Agents are idle — consider reducing shifts or scheduling training', priority: 'medium' });
    }
    if (kpis.resolutionRate > 0 && kpis.resolutionRate < 50) {
      suggestions.push({ type: 'quality', action: 'train', message: 'Improve resolution quality through agent training and knowledge base updates', priority: 'high' });
    }
    if (activeManagers === 0) {
      suggestions.push({ type: 'staffing', action: 'activate', message: 'Assign or activate managers to mitigate operational risk', priority: 'high' });
    }
    if (callPerformance.answerRate < 60 && callPerformance.totalCalls > 0) {
      suggestions.push({ type: 'optimization', action: 'coach', message: 'Coach agents on call handling to improve answer rate', priority: 'medium' });
    }
    if (feedbackStats.csat > 0 && feedbackStats.csat < 60) {
      suggestions.push({ type: 'quality', action: 'train', message: 'Schedule CSAT improvement training for low-rated agents', priority: 'high' });
    }

    return suggestions;
  }

  async getDashboard(companyId, { from, to } = {}) {
    const companyObjId = this._toObjectId(companyId);
    const dateFilter = this._buildDateFilter({ from, to });

    const companyDoc = await companyRepo.model.findById(companyId).select('channelsConfig').lean() || {};

    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const [
      agentsCount,
      totalManagers,
      totalTeamLeaders,
      activeManagers,
      totalChats,
      activeChats,
      chatsLast7Days,
      chatsPrev7Days,
      kpis,
      todayStats,
      slaStats,
      productivity,
      performanceTrend,
      callPerformance,
      channelDistribution,
      feedbackStats,
      recentActivity,
      topCategories,
      goalProgress,
    ] = await Promise.all([
      userRepo.count({ companyId, role: ROLES.AGENT }),
      userRepo.count({ companyId, role: ROLES.COMPANY_MANAGER }),
      userRepo.count({ companyId, role: ROLES.TEAM_LEADER }),
      userRepo.count({ companyId, role: ROLES.COMPANY_MANAGER, isActive: true }),
      ChatSession.countDocuments({ companyId }),
      ChatSession.countDocuments({ companyId, status: CHAT_STATUS.ACTIVE }),
      ChatSession.countDocuments({ companyId, createdAt: { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } }),
      ChatSession.countDocuments({ companyId, createdAt: { $gte: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000), $lt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } }),
      this._computeKPIs(companyId),
      this._computeTodayStats(companyId),
      this._computeSLAStats(companyId),
      this._computeProductivity(companyId),
      this._computePerformanceTrend(companyId, dateFilter),
      this._computeCallPerformance(companyId),
      this._computeChannelDistribution(companyId),
      this._computeFeedbackStats(companyId),
      this._computeRecentActivity(companyId),
      this._computeTopCategories(companyId),
      this._computeGoalProgress(companyId),
    ]);

    const overview = await this._computeOverview(
      companyId, companyObjId, kpis, agentsCount, activeManagers,
      callPerformance.answerRate, feedbackStats.csat
    );

    const csatUI = this._computeCsatUI(feedbackStats);
    const workload = this._computeWorkload(kpis, goalProgress);

    const insights = this._generateInsights(
      kpis, callPerformance, feedbackStats, slaStats, todayStats,
      agentsCount, activeManagers, totalManagers, companyDoc
    );

    const suggestions = this._generateSuggestions(
      kpis, callPerformance, feedbackStats, insights,
      agentsCount, activeManagers
    );

    return {
      overview,
      kpis: {
        totalAgents: agentsCount,
        totalManagers,
        totalTeamLeaders,
        totalWorkforce: agentsCount + totalManagers + totalTeamLeaders,
        totalTickets: kpis.totalTickets,
        openTickets: kpis.openTickets,
        resolvedTickets: kpis.resolvedTickets,
        ticketsToday: kpis.ticketsToday,
        ticketsLast7Days: kpis.ticketsLast7Days,
        ticketsDelta: kpis.ticketsDelta,
        resolutionRate: kpis.resolutionRate,
        workloadPerAgent: agentsCount > 0 ? Math.round(kpis.openTickets / agentsCount) : 0,
        activeManagers,
        managerActivationRate: totalManagers > 0 ? Math.round((activeManagers / totalManagers) * 100) : 0,
        activeChats,
        totalChats,
        chatLoadPerAgent: agentsCount > 0 ? Math.round(activeChats / agentsCount) : 0,
        agentUtilization: agentsCount > 0 ? Math.min(100, Math.round((kpis.openTickets / (agentsCount * CAPACITY_PER_AGENT)) * 100)) : 0,
        avgFirstResponseTime: kpis.avgFirstResponseTime,
        avgResolutionTime: kpis.avgResolutionTime,
      },
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
      insights,
      suggestions,
    };
  }
}

export default new ManagerDashboardService();
