import { ticketRepo, eventLogRepo } from '../../repositories/index.js';
import { ChatSession, EventLog } from '../../models/index.js';
import { TICKET_STATUS, EVENT_TYPES } from '../../constants/index.js';

class OwnerAnalyticsService {
  async getPlatformOverview({ from, to } = {}) {
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(to);
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const sessionFilter = hasDateFilter ? { createdAt: dateFilter } : {};
    const ticketFilter = hasDateFilter ? { createdAt: dateFilter } : {};

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

    const heatmapStart = new Date();
    heatmapStart.setDate(heatmapStart.getDate() - 365);

    const [chatHeatmap, ticketHeatmap] = await Promise.all([
      EventLog.aggregate([
        {
          $match: {
            eventType: EVENT_TYPES.CHAT_SESSION_CREATED,
            timestamp: { $gte: heatmapStart },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      EventLog.aggregate([
        {
          $match: {
            eventType: EVENT_TYPES.TICKET_CREATED,
            timestamp: { $gte: heatmapStart },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
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
          eventType: EVENT_TYPES.CHAT_MESSAGE,
          'metadata.intent': { $ne: null },
          ...(hasDateFilter ? { timestamp: dateFilter } : {}),
        },
      },
      { $group: { _id: '$metadata.intent', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    const topCompanies = await ticketRepo.aggregate([
      { $match: ticketFilter },
      {
        $group: {
          _id: '$companyId',
          ticketCount: { $sum: 1 },
          resolvedCount: { $sum: { $cond: [{ $eq: ['$status', TICKET_STATUS.CLOSED] }, 1, 0] } },
        },
      },
      { $sort: { ticketCount: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'companies',
          localField: '_id',
          foreignField: '_id',
          as: 'company',
        },
      },
      { $unwind: '$company' },
      {
        $project: {
          companyId: '$_id',
          name: '$company.name',
          slug: '$company.slug',
          industry: '$company.industry',
          ticketCount: 1,
          resolvedCount: 1,
        },
      },
    ]);

    const companyActivityAgg = await ticketRepo.aggregate([
      { $match: ticketFilter },
      {
        $group: {
          _id: '$companyId',
          total: { $sum: 1 },
          resolved: { $sum: { $cond: [{ $eq: ['$status', TICKET_STATUS.CLOSED] }, 1, 0] } },
          uniqueCustomers: { $addToSet: '$userId' },
        },
      },
      {
        $project: {
          _id: 1,
          total: 1,
          resolved: 1,
          customerCount: { $size: '$uniqueCustomers' },
        },
      },
      { $sort: { total: -1 } },
      {
        $lookup: {
          from: 'companies',
          localField: '_id',
          foreignField: '_id',
          as: 'company',
        },
      },
      { $unwind: '$company' },
      {
        $project: {
          companyId: '$_id',
          name: '$company.name',
          slug: '$company.slug',
          totalTickets: '$total',
          resolvedTickets: '$resolved',
          resolutionRate: {
            $cond: [{ $gt: ['$total', 0] }, { $multiply: [{ $divide: ['$resolved', '$total'] }, 100] }, 0],
          },
          customerCount: 1,
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
        resolutionRate: totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 0,
      },
      heatmap: {
        chats: chatHeatmap.map(h => ({ date: h._id, count: h.count })),
        tickets: ticketHeatmap.map(h => ({ date: h._id, count: h.count })),
      },
      topCategories: topCategories.map(c => ({ category: c._id, count: c.count })),
      topChannels: topChannels.map(c => ({ channel: c._id, count: c.count })),
      topIntents: topIntents.map(i => ({ intent: i._id, count: i.count })),
      topCompanies,
      companyActivity: companyActivityAgg,
    };
  }
}

export default new OwnerAnalyticsService();
