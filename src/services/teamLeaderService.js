import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo, ticketFeedbackRepo } from '../repositories/index.js';
import { User, Ticket, ChatSession, QAAnalysis, Call } from '../models/index.js';
import { ROLES, TICKET_STATUS } from '../constants/index.js';
import ApiError from '../utils/apiError.js';
import { getIO } from '../sockets/index.js';
import { notificationRepo } from '../repositories/index.js';
import AgentDashboardService from './agent/agentDashboardService.js';
import mongoose from 'mongoose';

class TeamLeaderService {
  _isTeamLeader(role) {
    return role === ROLES.TEAM_LEADER;
  }

  async _teamAgentObjectIds(companyId, leaderUserId) {
    const agents = await userRepo.model.find({
      companyId,
      role: ROLES.AGENT,
      teamLeaderId: leaderUserId,
      isActive: true,
    })
      .select('_id')
      .lean();
    return agents.map((a) => a._id);
  }

  async getAccessContext(companyId, userRole, userId) {
    if (this._isTeamLeader(userRole)) {
      const teamAgentIds = await this._teamAgentObjectIds(companyId, userId);
      return { role: userRole, userId, teamAgentIds };
    }
    return { role: userRole, userId, teamAgentIds: null };
  }

  _mustAccessAgent(access, agentId) {
    if (!access || !this._isTeamLeader(access.role)) return;
    const teamIds = access.teamAgentIds || [];
    const ok = teamIds.some((id) => id.toString() === String(agentId));
    if (!ok) throw ApiError.forbidden('This agent is not on your team');
  }

  _ticketAccessAllowed(access, ticket) {
    if (!access || !this._isTeamLeader(access.role)) return true;
    const assigned = ticket.assignedTo;
    if (!assigned) return true;
    const aid = assigned._id || assigned;
    const teamIds = access.teamAgentIds || [];
    return teamIds.some((id) => id.toString() === aid.toString());
  }

  async getDashboardOverview(companyId, access) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const companyObjId = new mongoose.Types.ObjectId(companyId);

    const isTeamLeader = this._isTeamLeader(access?.role);
    const teamIds = isTeamLeader ? (access.teamAgentIds || []) : null;
    const hasTeam = teamIds && teamIds.length > 0;
    const skipData = isTeamLeader && !hasTeam;

    const agentFilter = isTeamLeader
      ? { companyId, role: ROLES.AGENT, teamLeaderId: access.userId, isActive: true }
      : { companyId, role: ROLES.AGENT, isActive: true };

    const ticketBase = isTeamLeader && hasTeam
      ? { companyId: companyObjId, assignedTo: { $in: teamIds } }
      : { companyId: companyObjId };

    const ticketBaseWithAssignee = isTeamLeader && hasTeam
      ? { companyId: companyObjId, assignedTo: { $in: teamIds } }
      : { companyId: companyObjId, assignedTo: { $ne: null } };

    const callFeedbackMatch = isTeamLeader && hasTeam
      ? { companyId: companyObjId, agentId: { $in: teamIds } }
      : { companyId: companyObjId };

    const [
      totalAgents,
      activeTickets,
      unassignedTickets,
      resolvedToday,
      totalResolved,
      avgFirstResponseAgg,
      callStatsAgg,
      channelDistAgg,
      feedbackAgg,
      assignedTrendAgg,
      resolvedTrendAgg,
    ] = await Promise.all([
      userRepo.count(agentFilter),

      skipData
        ? 0
        : ticketRepo.count({
            ...ticketBase,
            status: { $in: [TICKET_STATUS.PENDING, TICKET_STATUS.OPENED] },
          }),

      ticketRepo.count({
        companyId,
        status: TICKET_STATUS.PENDING,
        assignedTo: null,
      }),

      skipData
        ? 0
        : ticketRepo.count({
            ...ticketBase,
            status: TICKET_STATUS.CLOSED,
            resolvedAt: { $gte: today },
          }),

      skipData
        ? 0
        : ticketRepo.count({
            ...ticketBase,
            status: TICKET_STATUS.CLOSED,
          }),

      skipData
        ? []
        : ticketRepo.aggregate([
            { $match: { ...ticketBaseWithAssignee, firstResponseAt: { $ne: null } } },
            { $project: { responseTime: { $subtract: ['$firstResponseAt', '$createdAt'] } } },
            { $group: { _id: null, avgTime: { $avg: '$responseTime' } } },
          ]),

      skipData
        ? []
        : callRepo.aggregate([
            { $match: callFeedbackMatch },
            {
              $group: {
                _id: null,
                totalCalls: { $sum: 1 },
                answeredCalls: { $sum: { $cond: [{ $ne: ['$answeredAt', null] }, 1, 0] } },
                missedCalls: { $sum: { $cond: [{ $eq: ['$status', 'missed'] }, 1, 0] } },
                avgDuration: { $avg: '$duration' },
              },
            },
          ]),

      skipData
        ? []
        : ticketRepo.aggregate([
            { $match: ticketBase },
            { $group: { _id: '$channel', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ]),

      skipData
        ? []
        : ticketFeedbackRepo.aggregate([
            { $match: callFeedbackMatch },
            {
              $group: {
                _id: null,
                totalRatings: { $sum: 1 },
                avgRating: { $avg: '$rating' },
                satisfiedCount: { $sum: { $cond: [{ $gte: ['$rating', 4] }, 1, 0] } },
              },
            },
          ]),

      skipData
        ? []
        : ticketRepo.aggregate([
            { $match: { ...ticketBase, createdAt: { $gte: thirtyDaysAgo } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, assigned: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ]),

      skipData
        ? []
        : ticketRepo.aggregate([
            { $match: { ...ticketBase, resolvedAt: { $gte: thirtyDaysAgo } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$resolvedAt' } }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ]),
    ]);

    const avgFirstResponseTime = avgFirstResponseAgg[0]
      ? Math.round(avgFirstResponseAgg[0].avgTime / 60000)
      : 0;

    const channelTotal = channelDistAgg.reduce((sum, c) => sum + c.count, 0) || 1;
    const channelDistribution = channelDistAgg.map((c) => ({
      name: c._id ? c._id.charAt(0).toUpperCase() + c._id.slice(1) : 'Unknown',
      count: c.count,
      percent: Math.round((c.count / channelTotal) * 100),
    }));

    const feedbackData = feedbackAgg[0] || { totalRatings: 0, avgRating: 0, satisfiedCount: 0 };
    const avgFeedback = Math.round(feedbackData.avgRating * 10) / 10;
    const csatScore = feedbackData.totalRatings > 0
      ? Math.round((feedbackData.satisfiedCount / feedbackData.totalRatings) * 100)
      : 0;

    const goalTarget = 500;
    const goalPercentage = totalResolved > 0
      ? Math.min(100, Math.round((totalResolved / goalTarget) * 100))
      : 0;

    const callStatsData = callStatsAgg[0] || { totalCalls: 0, answeredCalls: 0, missedCalls: 0, avgDuration: 0 };
    const callAvgDurationMs = Math.round(callStatsData.avgDuration || 0) * 1000;
    const callAvgMinutes = Math.floor(callAvgDurationMs / 60000);
    const callAvgSeconds = Math.floor((callAvgDurationMs % 60000) / 1000);
    const avgCallDurationString = `${callAvgMinutes}:${callAvgSeconds < 10 ? '0' : ''}${callAvgSeconds}s`;

    const trendMap = {};
    assignedTrendAgg.forEach((d) => { trendMap[d._id] = { assigned: d.assigned, resolved: 0 }; });
    resolvedTrendAgg.forEach((d) => {
      if (trendMap[d._id]) trendMap[d._id].resolved = d.count;
      else trendMap[d._id] = { assigned: 0, resolved: d.count };
    });
    const trendData = Object.entries(trendMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, val]) => ({ _id: date, assigned: val.assigned, resolved: val.resolved }));

    return {
      dashboard: {
        totalAgents,
        activeTickets,
        unassignedTickets,
        resolvedToday,
        kpis: {
          avgFirstResponseTime,
        },
        uiKpis: {
          csatScore,
          avgFeedback,
          goalTickets: {
            total: goalTarget,
            current: totalResolved,
            percentageCompleted: goalPercentage,
          },
          answeredCalls: callStatsData.answeredCalls,
          totalCalls: callStatsData.totalCalls,
          missedCalls: callStatsData.missedCalls,
          avgCallDurationString,
        },
        channelDistribution,
        trendData,
      },
    };
  }

  async getAgentProfile(companyId, agentId, access) {
    this._mustAccessAgent(access, agentId);

    const agent = await userRepo.model.findOne({
      _id: agentId,
      companyId,
      role: ROLES.AGENT,
    })
      .select('-passwordHash')
      .lean();

    if (!agent) throw ApiError.notFound('Agent not found');

    try {
      const dashboard = await AgentDashboardService.getAgentDashboard(companyId, agentId);
      // Merge required metrics into the agent object
      if (dashboard) {
        agent.assignedTickets = dashboard.uiKpis?.assignedTickets;
        agent.pendingTickets = dashboard.uiKpis?.pendingTickets;
        agent.closedTickets = dashboard.uiKpis?.closedTickets;
        agent.avgFirstResponseTime = dashboard.kpis?.avgFirstResponseTime;
        agent.avgResolutionTime = dashboard.kpis?.avgResolutionTime;
        agent.avgFeedback = dashboard.uiKpis?.avgFeedback;
        agent.csatScore = dashboard.uiKpis?.csatScore;
        agent.trackerTime = dashboard.trackerTime;
      }
    } catch (err) {
      console.error('Failed to load agent dashboard metrics:', err.message);
      // Continue without merged metrics
    }

    return agent;
  }

  // Notify an agent via Socket.IO
  async notifyAgent(companyId, agentId, message, access) {
    this._mustAccessAgent(access, agentId);
    // Store notification in DB for the agent
    await notificationRepo.create({
      companyId,
      userId: agentId,
      title: 'Team Leader Notification',
      message: message,
      isRead: false,
      createdAt: new Date(),
    });
    return { sent: true };
  }


  async getTeamAgents(companyId, access) {
    let agentQuery = { companyId, role: ROLES.AGENT, isActive: true };
    if (this._isTeamLeader(access?.role)) {
      agentQuery.teamLeaderId = access.userId;
    }

    const agents = await userRepo.model.find(agentQuery)
      .select('_id name email profileImage lastLogin teamLeaderId')
      .lean();

    const agentIds = agents.map((a) => a._id);

    const activeTicketsCount = agentIds.length
      ? await ticketRepo.aggregate([
        {
          $match: {
            companyId: new mongoose.Types.ObjectId(companyId),
            assignedTo: { $in: agentIds },
            status: { $in: [TICKET_STATUS.PENDING, TICKET_STATUS.OPENED] },
          },
        },
        {
          $group: {
            _id: '$assignedTo',
            count: { $sum: 1 },
          },
        },
      ])
      : [];

    const countMap = {};
    activeTicketsCount.forEach((item) => {
      countMap[item._id.toString()] = item.count;
    });

    const io = getIO();
    let onlineAgentIds = new Set();
    if (io) {
      try {
        const activeSockets = await io.of('/admin').fetchSockets();
        activeSockets.forEach((s) => {
          if (s.user && s.user._id) {
            onlineAgentIds.add(s.user._id.toString());
          }
        });
      } catch (err) {
        console.error('Error fetching sockets for team status:', err.message);
      }
    }

    return agents.map((agent) => ({
      ...agent,
      activeTickets: countMap[agent._id.toString()] || 0,
      isOnline: onlineAgentIds.has(agent._id.toString()),
    }));
  }

  async getAgentPerformance(companyId, agentId, period = 'week', access) {
    this._mustAccessAgent(access, agentId);

    let startDate = new Date();
    let normalizedPeriod = period.toLowerCase();

    if (normalizedPeriod === 'yearly' || normalizedPeriod === 'year') {
      startDate.setFullYear(startDate.getFullYear() - 1);
    } else if (normalizedPeriod === 'monthly' || normalizedPeriod === 'month') {
      startDate.setMonth(startDate.getMonth() - 1);
    } else {
      startDate.setDate(startDate.getDate() - 7);
      normalizedPeriod = 'weekly';
    }

    const tickets = await ticketRepo.model.find({
      companyId,
      assignedTo: agentId,
      status: TICKET_STATUS.CLOSED,
      resolvedAt: { $gte: startDate },
    }).lean();

    const totalResolved = tickets.length;
    let totalResponseTime = 0;
    let totalResolutionTime = 0;
    let countWithResponseTime = 0;
    let escalatedCount = 0;

    const channelMap = {};
    const dailyMap = {};
    const monthsObj = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];

    tickets.forEach((t) => {
      if (t.createdAt && t.resolvedAt) {
        totalResolutionTime += new Date(t.resolvedAt) - new Date(t.createdAt);
      }
      if (t.createdAt && t.firstResponseAt) {
        totalResponseTime += new Date(t.firstResponseAt) - new Date(t.createdAt);
        countWithResponseTime++;
      }
      if (t.priority === 'urgent' || t.priority === 'high') {
        escalatedCount++;
      }

      const ch = t.channel || 'unknown';
      channelMap[ch] = (channelMap[ch] || 0) + 1;

      if (t.resolvedAt) {
        const d = new Date(t.resolvedAt);
        let key;
        if (normalizedPeriod === 'yearly') {
          key = monthsObj[d.getMonth()];
        } else {
          key = `${monthsObj[d.getMonth()]} ${d.getDate()}`;
        }
        dailyMap[key] = (dailyMap[key] || 0) + 1;
      }
    });

    const channelDistribution = Object.keys(channelMap).map((k) => ({
      name: k.charAt(0).toUpperCase() + k.slice(1),
      count: channelMap[k],
      percent: totalResolved > 0 ? Math.round((channelMap[k] / totalResolved) * 100) : 0,
    }));

    const trendData = Object.keys(dailyMap).map((k) => ({ label: k, value: dailyMap[k] }));

    return {
      totalResolved,
      avgResolutionTimeMs: totalResolved ? totalResolutionTime / totalResolved : 0,
      avgResponseTimeMs: countWithResponseTime ? totalResponseTime / countWithResponseTime : 0,
      escalatedCount,
      channelDistribution,
      trendData,
      period: normalizedPeriod,
    };
  }

  async bulkAssignTickets(companyId, ticketIds, agentId, access) {
    this._mustAccessAgent(access, agentId);

    const validAgent = await userRepo.findOne({
      _id: agentId,
      companyId,
      role: ROLES.AGENT,
      isActive: true,
    });
    if (!validAgent) {
      throw ApiError.badRequest('Invalid agent specified');
    }

    const result = await ticketRepo.updateMany(
      {
        _id: { $in: ticketIds },
        companyId,
      },
      {
        $set: { assignedTo: agentId },
      }
    );

    try {
      const io = getIO();
      ticketIds.forEach((id) => {
        io.of('/admin').to(`company:${companyId}`).emit('ticket:updated', {
          ticketId: id,
          assignedTo: agentId,
          update: 'bulk_assigned',
        });
      });
    } catch (err) {
      console.error('Socket emit error in bulkAssignTickets:', err.message);
    }

    return result.nModified || result.modifiedCount || 0;
  }

  _buildTicketListFilter(companyId, { status, agentId }, access) {
    const filter = { companyId };

    if (this._isTeamLeader(access?.role) && access?.teamAgentIds) {
      filter.$or = [{ assignedTo: null }, { assignedTo: { $in: access.teamAgentIds } }];
    }

    if (status) filter.status = status;
    if (agentId) {
      if (this._isTeamLeader(access?.role)) {
        this._mustAccessAgent(access, agentId);
      }
      filter.assignedTo = agentId;
      if (filter.$or) delete filter.$or;
    }

    return filter;
  }

  async getCompanyTickets(companyId, options = {}, access) {
    const { status, agentId, page = 1, limit = 30 } = options;
    const filter = this._buildTicketListFilter(companyId, { status, agentId }, access);

    const skip = (page - 1) * limit;
    const [tickets, total] = await Promise.all([
      ticketRepo.model.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('assignedTo', 'name email')
        .lean(),
      ticketRepo.count(filter),
    ]);

    return { tickets, total, page, pages: Math.ceil(total / limit) };
  }

  async getUnassignedQueue(companyId, { page = 1, limit = 50 } = {}) {
    const filter = {
      companyId,
      assignedTo: null,
      status: TICKET_STATUS.PENDING,
    };
    const skip = (page - 1) * limit;
    const [tickets, total] = await Promise.all([
      ticketRepo.model.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'name email')
        .lean(),
      ticketRepo.count(filter),
    ]);

    return {
      tickets,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getTicketMessages(companyId, ticketId, access) {
    const ticket = await ticketRepo.model.findOne({ _id: ticketId, companyId })
      .populate('assignedTo', 'name email')
      .lean();
    if (!ticket) throw ApiError.notFound('Ticket not found');

    if (!this._ticketAccessAllowed(access, ticket)) {
      throw ApiError.forbidden('You cannot access this ticket');
    }

    let messages = [];
    if (ticket.context?.sessionId) {
      const session = await chatSessionRepo.model.findOne({ sessionId: ticket.context.sessionId }).lean();
      if (session) messages = session.messages || [];
    }

    return { ticket, messages };
  }

  async appendQATeamLeaderNote(companyId, ticketId, leaderId, content, access) {
    const ticket = await ticketRepo.model.findOne({ _id: ticketId, companyId }).lean();
    if (!ticket) throw ApiError.notFound('Ticket not found');
    if (!this._ticketAccessAllowed(access, ticket)) {
      throw ApiError.forbidden('You cannot update analysis for this ticket');
    }

    const doc = await qaAnalysisRepo.model.findOneAndUpdate(
      { companyId, ticketId },
      {
        $push: {
          teamLeaderNotes: {
            leaderId,
            content: content.trim(),
            createdAt: new Date(),
          },
        },
      },
      { new: true }
    );

    if (!doc) {
      throw ApiError.badRequest('No QA analysis exists for this ticket yet. Run analysis first.');
    }

    return doc;
  }

  async getScopedCompanyCalls(companyId, { page = 1, limit = 50, status, agentId } = {}, access) {
    const filter = { companyId };
    if (status) filter.status = status;

    if (this._isTeamLeader(access?.role)) {
      const teamIds = access.teamAgentIds || [];
      if (!teamIds.length) {
        return {
          calls: [],
          total: 0,
          page: Number(page),
          limit: Number(limit),
        };
      }
      if (agentId) {
        const ok = teamIds.some((id) => id.toString() === String(agentId));
        if (!ok) {
          return {
            calls: [],
            total: 0,
            page: Number(page),
            limit: Number(limit),
          };
        }
        filter.agentId = agentId;
      } else {
        filter.agentId = { $in: teamIds };
      }
    } else if (agentId) {
      filter.agentId = agentId;
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const [calls, total] = await Promise.all([
      callRepo.model.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .populate('customerId', 'name email')
        .populate('agentId', 'name email')
        .lean(),
      callRepo.count(filter),
    ]);

    return {
      calls,
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    };
  }

  async appendAgentSupervisorNote(companyId, agentId, authorId, content, access) {
    this._mustAccessAgent(access, agentId);

    const agent = await userRepo.findOne({
      _id: agentId,
      companyId,
      role: ROLES.AGENT,
    });
    if (!agent) throw ApiError.notFound('Agent not found');

    agent.supervisorNotes.push({
      authorId,
      content: content.trim(),
      createdAt: new Date(),
    });
    await agent.save();

    return agent;
  }
}

export default new TeamLeaderService();
