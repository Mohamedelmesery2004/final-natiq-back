import mongoose from 'mongoose';
import { ticketRepo, qaAnalysisRepo, eventLogRepo, ticketFeedbackRepo } from '../../repositories/index.js';
import { TicketFeedback, EventLog } from '../../models/index.js';
import { TICKET_STATUS, EVENT_TYPES } from '../../constants/index.js';
import ApiError from '../../utils/apiError.js';

const INSIGHT_THRESHOLDS = {
  FAST_RESPONSE_MIN: 5,
  SLOW_RESPONSE_MIN: 30,
  FAST_RESOLUTION_MIN: 60,
  SLOW_RESOLUTION_MIN: 180,
  HIGH_CSAT_PCT: 80,
  LOW_CSAT_PCT: 60,
  HIGH_REOPEN_PCT: 20,
  LOW_REOPEN_PCT: 5,
  HIGH_QA_SCORE: 80,
  LOW_QA_SCORE: 60,
};

class AgentAnalyticsService {
  _buildDateMatch(companyId, agentId, { from, to, channel } = {}) {
    const match = {
      companyId: new mongoose.Types.ObjectId(companyId),
      assignedTo: new mongoose.Types.ObjectId(agentId),
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

  _fillDateRange(labels, datasets, from, to) {
    const start = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
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

  async getOverview(companyId, agentId, filters = {}) {
    const match = this._buildDateMatch(companyId, agentId, filters);
    const dateFilter = this._buildDateFilter(filters);
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const closedMatch = {
      ...match,
      status: TICKET_STATUS.CLOSED,
    };

    const resolvedMatch = {
      ...match,
      resolvedAt: { $ne: null },
    };

    const [
      totalAssigned,
      pendingCount,
      openedCount,
      closedCount,
      avgFirstResponseAgg,
      avgResolutionAgg,
      reopenedAgg,
      channelAgg,
    ] = await Promise.all([
      ticketRepo.count(match),
      ticketRepo.count({ ...match, status: TICKET_STATUS.PENDING }),
      ticketRepo.count({ ...match, status: TICKET_STATUS.OPENED }),
      ticketRepo.count(closedMatch),
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
      this._getReopenCount(companyId, agentId, filters),
      ticketRepo.aggregate([
        { $match: match },
        { $group: { _id: '$channel', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const avgFirstResponseMs = avgFirstResponseAgg[0] ? avgFirstResponseAgg[0].avgTime : 0;
    const avgFirstResponseMin = Math.round(avgFirstResponseMs / 60000);
    const avgResolutionMs = avgResolutionAgg[0] ? avgResolutionAgg[0].avgTime : 0;
    const avgResolutionMin = Math.round(avgResolutionMs / 60000);

    const reopenedTotal = reopenedAgg[0]?.count || 0;
    const resolvedTotal = reopenedAgg[0]?.resolved || 0;
    const reopenRate = resolvedTotal > 0 ? Math.round((reopenedTotal / resolvedTotal) * 100) : 0;

    const channelTotal = channelAgg.reduce((s, c) => s + c.count, 0) || 1;

    return {
      summary: {
        totalAssigned,
        pending: pendingCount,
        inProgress: openedCount,
        resolved: closedCount,
        unresolved: pendingCount + openedCount,
      },
      performance: {
        avgFirstResponseTime: avgFirstResponseMin,
        avgFirstResponseMinutes: avgFirstResponseMin,
        avgResolutionTime: avgResolutionMin,
        avgResolutionMinutes: avgResolutionMin,
        reopenRate,
        reopenedCount: reopenedTotal,
      },
      channels: channelAgg.map((c) => ({
        channel: c._id,
        count: c.count,
        percentage: Math.round((c.count / channelTotal) * 100),
      })),
    };
  }

  async _getReopenCount(companyId, agentId, filters = {}) {
    const dateFilter = this._buildDateFilter(filters);
    const match = {
      companyId: new mongoose.Types.ObjectId(companyId),
      eventType: EVENT_TYPES.TICKET_CLOSED,
      'metadata.agentId': new mongoose.Types.ObjectId(agentId),
      entityType: 'ticket',
    };
    if (Object.keys(dateFilter).length > 0) match.timestamp = dateFilter;

    const closedTickets = await eventLogRepo.aggregate([
      { $match: match },
      { $group: { _id: '$entityId' } },
      { $project: { _id: 1 } },
    ]);

    const closedTicketIds = closedTickets.map((t) => t._id);
    if (closedTicketIds.length === 0) return [{ count: 0, resolved: 0 }];

    const reopened = await ticketRepo.count({
      _id: { $in: closedTicketIds },
      status: { $ne: TICKET_STATUS.CLOSED },
    });

    return [{ count: reopened, resolved: closedTicketIds.length }];
  }

  async getTicketAnalytics(companyId, agentId, filters = {}) {
    const match = this._buildDateMatch(companyId, agentId, filters);
    const { from, to, channel } = filters;

    const statusMatch = { ...match };
    if (channel) statusMatch.channel = channel;

    const categoryAgg = await ticketRepo.aggregate([
      { $match: statusMatch },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const priorityAgg = await ticketRepo.aggregate([
      { $match: statusMatch },
      { $group: { _id: '$priority', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const topCustomers = await ticketRepo.aggregate([
      { $match: statusMatch },
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
    ]);

    const categoryTotal = categoryAgg.reduce((s, c) => s + c.count, 0) || 1;

    return {
      categories: categoryAgg.map((c) => ({
        category: c._id,
        count: c.count,
        percentage: Math.round((c.count / categoryTotal) * 100),
      })),
      priorities: priorityAgg.map((p) => ({
        priority: p._id,
        count: p.count,
      })),
      topCustomers,
    };
  }

  async getTimeSeries(companyId, agentId, filters = {}) {
    const { from, to, channel } = filters;
    const dateFilter = this._buildDateFilter(filters);

    const baseMatch = {
      companyId: new mongoose.Types.ObjectId(companyId),
      assignedTo: new mongoose.Types.ObjectId(agentId),
    };
    if (Object.keys(dateFilter).length > 0) baseMatch.createdAt = dateFilter;
    if (channel) baseMatch.channel = channel;

    const [assignedPerDay, resolvedPerDay, responseTimeTrend] = await Promise.all([
      ticketRepo.aggregate([
        { $match: baseMatch },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      ticketRepo.aggregate([
        { $match: { ...baseMatch, status: TICKET_STATUS.CLOSED } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$updatedAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      ticketRepo.aggregate([
        { $match: { ...baseMatch, firstResponseAt: { $ne: null } } },
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
    ]);

    const assignedLabels = assignedPerDay.map((d) => d._id);
    const assignedData = assignedPerDay.map((d) => d.count);
    const resolvedLabels = resolvedPerDay.map((d) => d._id);
    const resolvedData = resolvedPerDay.map((d) => d.count);
    const responseLabels = responseTimeTrend.map((d) => d._id);
    const responseData = responseTimeTrend.map((d) => d.avgResponseMin);

    const assigned = this._fillDateRange(assignedLabels, [{ label: 'Assigned Tickets', data: assignedData }], from, to);
    const resolved = this._fillDateRange(resolvedLabels, [{ label: 'Resolved Tickets', data: resolvedData }], from, to);
    const responseTime = this._fillDateRange(responseLabels, [{ label: 'Avg Response Time (min)', data: responseData }], from, to);

    return { assigned, resolved, responseTime };
  }

  async getQualityMetrics(companyId, agentId) {
    const companyObjId = new mongoose.Types.ObjectId(companyId);
    const agentObjId = new mongoose.Types.ObjectId(agentId);

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
      TicketFeedback.aggregate([
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

    const qa = qaAgg[0] || {
      totalEvaluations: 0,
      avgProfessionalism: 0,
      avgEmpathy: 0,
      avgQuality: 0,
      overallAvg: 0,
    };

    const feedback = feedbackAgg[0] || {
      totalRatings: 0,
      avgRating: 0,
      satisfiedCount: 0,
      count1: 0, count2: 0, count3: 0, count4: 0, count5: 0,
    };

    const avgRating = Math.round(feedback.avgRating * 10) / 10;
    const csat = feedback.totalRatings > 0
      ? Math.round((feedback.satisfiedCount / feedback.totalRatings) * 100)
      : 0;

    const overallQa = Math.round(qa.overallAvg * 10) / 10;

    return {
      qa: {
        totalEvaluations: qa.totalEvaluations,
        averageScores: {
          professionalism: Math.round(qa.avgProfessionalism * 10) / 10,
          empathy: Math.round(qa.avgEmpathy * 10) / 10,
          quality: Math.round(qa.avgQuality * 10) / 10,
          overall: overallQa,
        },
      },
      satisfaction: {
        totalRatings: feedback.totalRatings,
        avgRating,
        csat,
        ratingDistribution: {
          1: feedback.count1,
          2: feedback.count2,
          3: feedback.count3,
          4: feedback.count4,
          5: feedback.count5,
        },
      },
    };
  }

  async getInsights(companyId, agentId) {
    const overview = await this.getOverview(companyId, agentId);
    const quality = await this.getQualityMetrics(companyId, agentId);

    const { performance, summary } = overview;
    const { qa, satisfaction } = quality;

    const strengths = [];
    const weaknesses = [];
    const recommendations = [];

    if (performance.avgFirstResponseMinutes <= INSIGHT_THRESHOLDS.FAST_RESPONSE_MIN) {
      strengths.push({ area: 'response_time', label: 'Fast response time', detail: `Average first response in ${performance.avgFirstResponseMinutes} min` });
    } else if (performance.avgFirstResponseMinutes >= INSIGHT_THRESHOLDS.SLOW_RESPONSE_MIN) {
      weaknesses.push({ area: 'response_time', label: 'Slow response time', detail: `Average first response takes ${performance.avgFirstResponseMinutes} min` });
      recommendations.push({ area: 'response_time', label: 'Prioritize faster replies', detail: 'Try to respond within 5 minutes to improve customer satisfaction' });
    } else if (performance.avgFirstResponseMinutes > INSIGHT_THRESHOLDS.FAST_RESPONSE_MIN) {
      recommendations.push({ area: 'response_time', label: 'Opportunity to improve response speed', detail: `Current ${performance.avgFirstResponseMinutes} min response time can be reduced` });
    }

    if (performance.avgResolutionMinutes <= INSIGHT_THRESHOLDS.FAST_RESOLUTION_MIN) {
      strengths.push({ area: 'resolution_time', label: 'Quick resolution time', detail: `Average resolution in ${performance.avgResolutionMinutes} min` });
    } else if (performance.avgResolutionMinutes >= INSIGHT_THRESHOLDS.SLOW_RESOLUTION_MIN) {
      weaknesses.push({ area: 'resolution_time', label: 'High resolution time', detail: `Average resolution takes ${performance.avgResolutionMinutes} min` });
      recommendations.push({ area: 'resolution_time', label: 'Work on faster resolutions', detail: 'Aim to resolve tickets within 60 minutes on average' });
    } else {
      recommendations.push({ area: 'resolution_time', label: 'Monitor resolution efficiency', detail: `Current ${performance.avgResolutionMinutes} min is acceptable but can improve` });
    }

    if (performance.reopenRate <= INSIGHT_THRESHOLDS.LOW_REOPEN_PCT) {
      strengths.push({ area: 'reopen_rate', label: 'Low reopen rate', detail: `Only ${performance.reopenRate}% of resolved tickets were reopened` });
    } else if (performance.reopenRate >= INSIGHT_THRESHOLDS.HIGH_REOPEN_PCT) {
      weaknesses.push({ area: 'reopen_rate', label: 'High reopen rate', detail: `${performance.reopenRate}% of resolved tickets were reopened` });
      recommendations.push({ area: 'reopen_rate', label: 'Reduce ticket reopens', detail: 'Ensure complete resolution before closing tickets to avoid reopens' });
    }

    if (satisfaction.csat >= INSIGHT_THRESHOLDS.HIGH_CSAT_PCT) {
      strengths.push({ area: 'csat', label: 'Excellent customer satisfaction', detail: `${satisfaction.csat}% CSAT score` });
    } else if (satisfaction.csat <= INSIGHT_THRESHOLDS.LOW_CSAT_PCT && satisfaction.csat > 0) {
      weaknesses.push({ area: 'csat', label: 'Low customer satisfaction', detail: `${satisfaction.csat}% CSAT score` });
      recommendations.push({ area: 'csat', label: 'Improve customer satisfaction', detail: 'Focus on empathy and clear communication with customers' });
    }

    if (qa.averageScores.overall >= INSIGHT_THRESHOLDS.HIGH_QA_SCORE) {
      strengths.push({ area: 'qa_score', label: 'Strong QA performance', detail: `Overall QA score of ${qa.averageScores.overall}` });
    } else if (qa.averageScores.overall <= INSIGHT_THRESHOLDS.LOW_QA_SCORE && qa.averageScores.overall > 0) {
      weaknesses.push({ area: 'qa_score', label: 'QA score needs improvement', detail: `Overall QA score of ${qa.averageScores.overall}` });
      recommendations.push({ area: 'qa_score', label: 'Focus on QA improvement areas', detail: 'Review QA feedback to identify specific skill gaps' });
    }

    if (summary.resolved > 0 && summary.totalAssigned > 0) {
      const resolutionRate = Math.round((summary.resolved / summary.totalAssigned) * 100);
      if (resolutionRate >= 80) {
        strengths.push({ area: 'resolution_rate', label: 'High resolution rate', detail: `${resolutionRate}% of assigned tickets resolved` });
      } else if (resolutionRate < 50) {
        weaknesses.push({ area: 'resolution_rate', label: 'Low resolution rate', detail: `Only ${resolutionRate}% of assigned tickets resolved` });
        recommendations.push({ area: 'resolution_rate', label: 'Increase resolution rate', detail: 'Focus on completing open tickets before taking new assignments' });
      }
    }

    if (qa.averageScores.professionalism > qa.averageScores.empathy) {
      recommendations.push({ area: 'empathy', label: 'Enhance customer empathy', detail: `Empathy score (${qa.averageScores.empathy}) is lower than professionalism (${qa.averageScores.professionalism})` });
    } else if (qa.averageScores.empathy > qa.averageScores.professionalism) {
      strengths.push({ area: 'empathy', label: 'Strong customer empathy', detail: `Empathy score of ${qa.averageScores.empathy}` });
    }

    return { strengths, weaknesses, recommendations };
  }
}

export default new AgentAnalyticsService();
