import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import { EventLog, ChatSession, Ticket } from '../models/index.js';
import { TICKET_STATUS, EVENT_TYPES } from '../constants/index.js';

class AnalyticsService {
  async getOverview(companyId, { from, to } = {}) {
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(to);
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const sessionFilter = { companyId };
    const ticketFilter = { companyId };
    if (hasDateFilter) {
      sessionFilter.createdAt = dateFilter;
      ticketFilter.createdAt = dateFilter;
    }

    const [
      totalSessions,  
      activeSessions,
      totalTickets,
      openTickets,
      inProgressTickets,
      resolvedTickets,
    ] = await Promise.all([
      ChatSession.countDocuments(sessionFilter),
      ChatSession.countDocuments({ ...sessionFilter, status: 'active' }),
      ticketRepo.count(ticketFilter),
      ticketRepo.count({ ...ticketFilter, status: TICKET_STATUS.PENDING }),
      ticketRepo.count({ ...ticketFilter, status: TICKET_STATUS.OPENED }),
      ticketRepo.count({ ...ticketFilter, status: TICKET_STATUS.CLOSED }),
    ]);

    const avgFirstResponseAgg = await ticketRepo.aggregate([
      {
        $match: {
          companyId,
          firstResponseAt: { $ne: null },
          ...(hasDateFilter ? { createdAt: dateFilter } : {}),
        },
      },
      {
        $project: {
          responseTime: { $subtract: ['$firstResponseAt', '$createdAt'] },
        },
      },
      {
        $group: {
          _id: null,
          avgTime: { $avg: '$responseTime' },
        },
      },
    ]);
    const avgFirstResponseTime = avgFirstResponseAgg[0]
      ? Math.round(avgFirstResponseAgg[0].avgTime / 60000)
      : 0;

    const avgResolutionAgg = await ticketRepo.aggregate([
      {
        $match: {
          companyId,
          resolvedAt: { $ne: null },
          ...(hasDateFilter ? { createdAt: dateFilter } : {}),
        },
      },
      {
        $project: {
          resolutionTime: { $subtract: ['$resolvedAt', '$createdAt'] },
        },
      },
      {
        $group: {
          _id: null,
          avgTime: { $avg: '$resolutionTime' },
        },
      },
    ]);
    const avgResolutionTime = avgResolutionAgg[0]
      ? Math.round(avgResolutionAgg[0].avgTime / 60000)
      : 0;

    const heatmapStart = new Date();
    heatmapStart.setDate(heatmapStart.getDate() - 365);

    const [chatHeatmap, ticketHeatmap] = await Promise.all([
      EventLog.aggregate([
        {
          $match: {
            companyId,
            eventType: EVENT_TYPES.CHAT_SESSION_CREATED,
            timestamp: { $gte: heatmapStart },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$timestamp' },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      EventLog.aggregate([
        {
          $match: {
            companyId,
            eventType: EVENT_TYPES.TICKET_CREATED,
            timestamp: { $gte: heatmapStart },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$timestamp' },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const topCategories = await ticketRepo.aggregate([
      { $match: ticketFilter },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    const topChannels = await ChatSession.aggregate([
      { $match: sessionFilter },
      { $group: { _id: '$channel', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const topIntents = await EventLog.aggregate([
      {
        $match: {
          companyId,
          eventType: EVENT_TYPES.CHAT_MESSAGE,
          'metadata.intent': { $ne: null },
          ...(hasDateFilter ? { timestamp: dateFilter } : {}),
        },
      },
      { $group: { _id: '$metadata.intent', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    const topAgents = await ticketRepo.aggregate([
      {
        $match: {
          companyId,
          status: TICKET_STATUS.CLOSED,
          assignedTo: { $ne: null },
          ...(hasDateFilter ? { createdAt: dateFilter } : {}),
        },
      },
      {
        $group: {
          _id: '$assignedTo',
          resolvedCount: { $sum: 1 },
        },
      },
      { $sort: { resolvedCount: -1 } },
      { $limit: 10 },
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
          resolvedCount: 1,
        },
      },
    ]);

    return {
      kpis: {
        totalSessions,
        activeSessions,
        totalTickets,
        openTickets,
        inProgressTickets,
        resolvedTickets,
        avgFirstResponseTime,
        avgResolutionTime,
      },
      heatmap: {
        chats: chatHeatmap.map((h) => ({ date: h._id, count: h.count })),
        tickets: ticketHeatmap.map((h) => ({ date: h._id, count: h.count })),
      },
      topCategories: topCategories.map((c) => ({ category: c._id, count: c.count })),
      topChannels: topChannels.map((c) => ({ channel: c._id, count: c.count })),
      topIntents: topIntents.map((i) => ({ intent: i._id, count: i.count })),
      topAgents,
    };
  }
}

export default new AnalyticsService();
