import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import { User, Ticket, ChatSession, QAAnalysis, Call } from '../models/index.js';
import { ROLES, TICKET_STATUS } from '../constants/index.js';
import ApiError from '../utils/apiError.js';
import { getIO } from '../sockets/index.js';
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

    if (!this._isTeamLeader(access?.role)) {
      const [
        totalAgents,
        activeTickets,
        unassignedTickets,
        resolvedToday,
      ] = await Promise.all([
        userRepo.count({ companyId, role: ROLES.AGENT, isActive: true }),
        ticketRepo.count({
          companyId,
          status: { $in: [TICKET_STATUS.PENDING, TICKET_STATUS.OPENED] },
        }),
        ticketRepo.count({
          companyId,
          status: TICKET_STATUS.PENDING,
          assignedTo: null,
        }),
        ticketRepo.count({
          companyId,
          status: TICKET_STATUS.CLOSED,
          resolvedAt: { $gte: today },
        }),
      ]);

      return {
        totalAgents,
        activeTickets,
        unassignedTickets,
        resolvedToday,
      };
    }

    const teamIds = access.teamAgentIds || [];

    const [
      totalAgents,
      activeTickets,
      unassignedTickets,
      resolvedToday,
    ] = await Promise.all([
      userRepo.count({
        companyId,
        role: ROLES.AGENT,
        teamLeaderId: access.userId,
        isActive: true,
      }),
      teamIds.length
        ? ticketRepo.count({
            companyId,
            assignedTo: { $in: teamIds },
            status: { $in: [TICKET_STATUS.PENDING, TICKET_STATUS.OPENED] },
          })
        : 0,
      ticketRepo.count({
        companyId,
        status: TICKET_STATUS.PENDING,
        assignedTo: null,
      }),
      teamIds.length
        ? ticketRepo.count({
            companyId,
            assignedTo: { $in: teamIds },
            status: TICKET_STATUS.CLOSED,
            resolvedAt: { $gte: today },
          })
        : 0,
    ]);

    return {
      totalAgents,
      activeTickets,
      unassignedTickets,
      resolvedToday,
    };
  }

  async getAgentProfile(companyId, agentId, access) {
    this._mustAccessAgent(access, agentId);

    const agent = await userRepo.findOne({
      _id: agentId,
      companyId,
      role: ROLES.AGENT,
    })
      .select('-passwordHash')
      .lean();

    if (!agent) throw ApiError.notFound('Agent not found');
    return agent;
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
