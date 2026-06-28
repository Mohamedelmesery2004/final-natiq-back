import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo, ticketFeedbackRepo, notificationRepo } from '../repositories/index.js';
import { ROLES, TICKET_STATUS } from '../constants/index.js';
import ApiError from '../utils/apiError.js';
import { getIO } from '../sockets/index.js';
import AgentDashboardService from './agent/agentDashboardService.js';
import mongoose from 'mongoose';

class TeamLeaderService {
  _isTeamLeader(role) {
    return role === ROLES.TEAM_LEADER;
  }

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
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const slaDeadline = new Date(now.getTime() - 240 * 60 * 1000);
    const companyObjId = new mongoose.Types.ObjectId(companyId);
    const SLA_TARGET_MS = 240 * 60 * 1000;
    const CAPACITY_PER_AGENT = 20;

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

    const ticketAssigned = isTeamLeader && hasTeam
      ? { companyId: companyObjId, assignedTo: { $in: teamIds } }
      : { companyId: companyObjId, assignedTo: { $ne: null } };

    const agentIdFilter = isTeamLeader && hasTeam
      ? { $in: teamIds }
      : { $ne: null };

    const feedbackMatch = isTeamLeader && hasTeam
      ? { companyId: companyObjId, agentId: { $in: teamIds } }
      : { companyId: companyObjId };

    const SLA_4H_AGO = new Date(now.getTime() - SLA_TARGET_MS);

    const [
      totalAgents,
      agentsList,
      activeTickets,
      unassignedTickets,
      resolvedToday,
      totalResolved,
      avgResponseResolutionAgg,
      callStatsAgg,
      channelDistAgg,
      feedbackAgg,
      agentTicketAgg,
      agentFeedbackAgg,
      slaBreachedAgg,
      assignedTrendAgg,
      resolvedTrendAgg,
      heatmapAgg,
    ] = await Promise.all([
      // ── 1. agent count ──
      userRepo.count(agentFilter),

      // ── 2. agent list (for names/status) ──
      skipData ? [] : userRepo.model.find(agentFilter).select('_id name email lastLogin').lean(),

      // ── 3. active tickets (pending + opened) ──
      skipData ? 0 : ticketRepo.count({ ...ticketBase, status: { $in: [TICKET_STATUS.PENDING, TICKET_STATUS.OPENED] } }),

      // ── 4. unassigned tickets ──
      ticketRepo.count({ companyId, status: TICKET_STATUS.PENDING, assignedTo: null }),

      // ── 5. resolved today ──
      skipData ? 0 : ticketRepo.count({ ...ticketBase, status: TICKET_STATUS.CLOSED, resolvedAt: { $gte: today } }),

      // ── 6. total resolved (for goals) ──
      skipData ? 0 : ticketRepo.count({ ...ticketBase, status: TICKET_STATUS.CLOSED }),

      // ── 7. avg response + resolution times ──
      skipData ? [] : ticketRepo.aggregate([
        { $match: { ...ticketAssigned, firstResponseAt: { $ne: null } } },
        {
          $group: {
            _id: null,
            avgResponseTime: { $avg: { $subtract: ['$firstResponseAt', '$createdAt'] } },
            avgResolutionTime: {
              $avg: {
                $cond: [
                  { $ne: ['$resolvedAt', null] },
                  { $subtract: ['$resolvedAt', '$createdAt'] },
                  null,
                ],
              },
            },
          },
        },
      ]),

      // ── 8. call stats ──
      skipData ? [] : callRepo.aggregate([
        { $match: feedbackMatch },
        {
          $group: {
            _id: null,
            totalCalls: { $sum: 1 },
            answered: { $sum: { $cond: [{ $in: ['$status', ['active', 'ended']] }, 1, 0] } },
            missed: { $sum: { $cond: [{ $eq: ['$status', 'missed'] }, 1, 0] } },
            avgDuration: { $avg: '$duration' },
            totalDuration: { $sum: '$duration' },
          },
        },
      ]),

      // ── 9. channel distribution ──
      skipData ? [] : ticketRepo.aggregate([
        { $match: ticketBase },
        { $group: { _id: '$channel', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // ── 10. overall feedback / CSAT ──
      skipData ? [] : ticketFeedbackRepo.aggregate([
        { $match: feedbackMatch },
        {
          $group: {
            _id: null,
            totalRatings: { $sum: 1 },
            avgRating: { $avg: '$rating' },
            satisfiedCount: { $sum: { $cond: [{ $gte: ['$rating', 4] }, 1, 0] } },
          },
        },
      ]),

      // ── 11. per-agent ticket stats ──
      skipData ? [] : ticketRepo.aggregate([
        { $match: { companyId: companyObjId, assignedTo: { $ne: null } } },
        {
          $group: {
            _id: '$assignedTo',
            activeTickets: {
              $sum: { $cond: [{ $in: ['$status', [TICKET_STATUS.PENDING, TICKET_STATUS.OPENED]] }, 1, 0] },
            },
            resolvedTickets: { $sum: { $cond: [{ $eq: ['$status', TICKET_STATUS.CLOSED] }, 1, 0] } },
            avgResponseTime: {
              $avg: {
                $cond: [
                  { $ne: ['$firstResponseAt', null] },
                  { $subtract: ['$firstResponseAt', '$createdAt'] },
                  null,
                ],
              },
            },
            avgResolutionTime: {
              $avg: {
                $cond: [
                  { $ne: ['$resolvedAt', null] },
                  { $subtract: ['$resolvedAt', '$createdAt'] },
                  null,
                ],
              },
            },
          },
        },
      ]),

      // ── 12. per-agent feedback ──
      skipData ? [] : ticketFeedbackRepo.aggregate([
        { $match: { companyId: companyObjId, agentId: { $ne: null } } },
        {
          $group: {
            _id: '$agentId',
            totalRatings: { $sum: 1 },
            avgRating: { $avg: '$rating' },
            satisfiedCount: { $sum: { $cond: [{ $gte: ['$rating', 4] }, 1, 0] } },
          },
        },
      ]),

      // ── 13. SLA breached count ──
      skipData ? [] : ticketRepo.aggregate([
        {
          $match: {
            ...ticketBase,
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

      // ── 14. trend: assigned per day (30 days) ──
      skipData ? [] : ticketRepo.aggregate([
        { $match: { ...ticketBase, createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      ]),

      // ── 15. trend: resolved per day (30 days) ──
      skipData ? [] : ticketRepo.aggregate([
        { $match: { ...ticketBase, resolvedAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$resolvedAt' } }, count: { $sum: 1 } } },
      ]),

      // ── 16. heatmap: tickets by hour (30 days) ──
      skipData ? [] : ticketRepo.aggregate([
        { $match: { ...ticketBase, createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $hour: '$createdAt' }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    // ─────────────────────────────────────────────
    // DERIVE & COMPUTE ALL SECTIONS
    // ─────────────────────────────────────────────

    // ── 1. TEAM STATS ──
    const agentMap = {};
    (agentsList || []).forEach((a) => {
      agentMap[a._id.toString()] = { name: a.name, email: a.email, lastLogin: a.lastLogin };
    });

    let overloadedCount = 0;
    let onlineCount = 0;
    let idleCount = 0;

    const agentTicketMap = {};
    (agentTicketAgg || []).forEach((a) => {
      const id = a._id.toString();
      agentTicketMap[id] = a;
      if (a.activeTickets > 15) overloadedCount++;
      if (a.activeTickets > 0) onlineCount++;
    });

    // Build agentPerformance list
    const agentFeedbackMap = {};
    (agentFeedbackAgg || []).forEach((f) => {
      agentFeedbackMap[f._id.toString()] = f;
    });

    const agentsPerformance = [];
    (agentsList || []).forEach((agent) => {
      const id = agent._id.toString();
      const t = agentTicketMap[id] || { activeTickets: 0, resolvedTickets: 0, avgResponseTime: null, avgResolutionTime: null };
      const fb = agentFeedbackMap[id] || { totalRatings: 0, avgRating: 0, satisfiedCount: 0 };

      const avgResponseTime = t.avgResponseTime ? Math.round(t.avgResponseTime / 60000) : 0;
      const avgResolutionTime = t.avgResolutionTime ? Math.round(t.avgResolutionTime / 60000) : 0;
      const csat = fb.totalRatings > 0 ? Math.round((fb.satisfiedCount / fb.totalRatings) * 100) : 0;

      let workload = 'low';
      if (t.activeTickets >= 12) workload = 'high';
      else if (t.activeTickets >= 5) workload = 'normal';

      let performance = 'average';
      if (csat >= 80 && avgResponseTime <= 5 && avgResolutionTime <= 90) performance = 'good';
      else if (csat < 60 || avgResponseTime > 10 || avgResolutionTime > 200) performance = 'bad';

      agentsPerformance.push({
        agentId: id,
        name: agent.name,
        status: t.activeTickets > 0 ? 'online' : 'offline',
        activeTickets: t.activeTickets,
        resolvedTickets: t.resolvedTickets,
        avgResponseTime,
        avgResolutionTime,
        csat,
        workload,
        performance,
      });

      if (t.activeTickets === 0) idleCount++;
    });

    onlineCount = agentsPerformance.filter((a) => a.status === 'online').length;
    idleCount = agentsPerformance.filter((a) => a.activeTickets === 0 && a.status === 'online').length;
    // If an agent has 0 tickets but we haven't set them online from activity, adjust
    // We'll mark agents with resolved tickets as potentially online too
    agentsPerformance.forEach((a) => {
      if (a.resolvedTickets > 0 && a.status === 'offline') a.status = 'online';
    });
    onlineCount = agentsPerformance.filter((a) => a.status === 'online').length;
    idleCount = agentsPerformance.filter((a) => a.status === 'online' && a.activeTickets === 0).length;
    overloadedCount = agentsPerformance.filter((a) => a.activeTickets > 15).length;

    const teamStats = {
      totalAgents,
      onlineAgents: onlineCount,
      idleAgents: idleCount,
      overloadedAgents: overloadedCount,
    };

    // ── 2. KPIs ──
    const avgData = avgResponseResolutionAgg[0] || {};
    const avgFirstResponseTime = avgData.avgResponseTime ? Math.round(avgData.avgResponseTime / 60000) : 0;
    const avgResolutionTime = avgData.avgResolutionTime ? Math.round(avgData.avgResolutionTime / 60000) : 0;

    const fbData = feedbackAgg[0] || { totalRatings: 0, avgRating: 0, satisfiedCount: 0 };
    const csatScore = fbData.totalRatings > 0
      ? Math.round((fbData.satisfiedCount / fbData.totalRatings) * 100)
      : 0;

    const kpis = {
      activeTickets,
      unassignedTickets,
      resolvedToday,
      avgFirstResponseTime,
      avgResolutionTime,
      csatScore,
    };

    // ── 3. GOALS ──
    const goalTarget = 500;
    const goalPercentage = totalResolved > 0
      ? Math.min(100, Math.round((totalResolved / goalTarget) * 100))
      : 0;

    const goals = {
      tickets: {
        total: goalTarget,
        current: totalResolved,
        percentageCompleted: goalPercentage,
      },
    };

    // ── 4. CALL PERFORMANCE ──
    const callData = callStatsAgg[0] || { totalCalls: 0, answered: 0, missed: 0, avgDuration: 0, totalDuration: 0 };
    const avgCallDur = callData.totalCalls > 0 ? Math.round(callData.totalDuration / callData.totalCalls) : 0;
    const answerRate = callData.totalCalls > 0 ? Math.round((callData.answered / callData.totalCalls) * 100) : 0;

    const callPerformance = {
      totalCalls: callData.totalCalls,
      answered: callData.answered,
      missed: callData.missed,
      avgDuration: avgCallDur,
      answerRate,
    };

    // ── 5. CHANNEL DISTRIBUTION ──
    const channelTotal = channelDistAgg.reduce((s, c) => s + c.count, 0) || 1;
    const channelDistribution = channelDistAgg.map((c) => ({
      name: c._id ? c._id.charAt(0).toUpperCase() + c._id.slice(1) : 'Unknown',
      count: c.count,
      percentage: Math.round((c.count / channelTotal) * 100),
    }));

    // ── 6. AGENTS PERFORMANCE (already built above) ──
    // ── 7. TOP & LOW PERFORMERS ──
    const sorted = [...agentsPerformance].sort((a, b) => b.csat - a.csat || b.resolvedTickets - a.resolvedTickets);
    const topAgents = sorted.slice(0, 3).map((a) => ({
      agentId: a.agentId,
      name: a.name,
      score: Math.round((a.csat + Math.max(0, 100 - a.avgResponseTime * 5) + Math.max(0, 100 - a.avgResolutionTime)) / 3),
      resolvedTickets: a.resolvedTickets,
      csat: a.csat,
    }));

    const lowPerformers = sorted
      .filter((a) => a.performance === 'bad' || a.csat < 60)
      .slice(0, 3)
      .map((a) => {
        const issues = [];
        if (a.avgResponseTime > 10) issues.push('high response time');
        if (a.avgResolutionTime > 200) issues.push('high resolution time');
        if (a.csat < 60) issues.push('low CSAT');
        if (!issues.length) issues.push('below average performance');
        return {
          agentId: a.agentId,
          name: a.name,
          score: Math.round((a.csat + Math.max(0, 100 - a.avgResponseTime * 5) + Math.max(0, 100 - a.avgResolutionTime)) / 3),
          resolvedTickets: a.resolvedTickets,
          csat: a.csat,
          issues,
        };
      });

    // ── 8. WORKLOAD DISTRIBUTION ──
    const totalCapacity = totalAgents * CAPACITY_PER_AGENT;
    const usedCapacity = agentsPerformance.reduce((s, a) => s + a.activeTickets, 0);
    const workloadPct = totalCapacity > 0 ? Math.min(100, Math.round((usedCapacity / totalCapacity) * 100)) : 0;
    let workloadLevel = 'normal';
    if (workloadPct >= 80) workloadLevel = 'high';
    else if (workloadPct <= 30) workloadLevel = 'low';

    const workload = {
      totalCapacity,
      used: usedCapacity,
      percentage: workloadPct,
      level: workloadLevel,
    };

    // ── 9. SLA METRICS ──
    const overdueCount = activeTickets > 0
      ? agentsPerformance.reduce((s, a) => s + a.activeTickets, 0)
      : 0;
    // More precise overdue: tickets not closed with createdAt < SLA deadline
    // We already have activeTickets, but for overdue we need count filtered by time
    // Use the SLA approach from agent dashboard
    const overdueTickets = skipData ? 0 : await ticketRepo.count({
      ...ticketBase,
      status: { $ne: TICKET_STATUS.CLOSED },
      createdAt: { $lt: SLA_4H_AGO },
    });

    const breachedCount = slaBreachedAgg[0]?.count || 0;
    const withinSla = Math.max(0, totalResolved - breachedCount);
    const totalTicketsWithSla = totalResolved + (activeTickets || 0);
    const slaCompliance = totalTicketsWithSla > 0
      ? Math.round((withinSla / totalTicketsWithSla) * 100)
      : 100;

    const sla = {
      overdueTickets,
      breachedTickets: breachedCount,
      withinSla,
      slaCompliancePercentage: slaCompliance,
    };

    // ── 10. INSIGHTS ──
    const insights = [];
    if (unassignedTickets > 10) {
      insights.push({
        type: 'warning',
        metric: 'unassignedTickets',
        message: `${unassignedTickets} tickets unassigned — exceeding recommended threshold`,
        severity: 'high',
      });
    }
    if (avgFirstResponseTime > 5) {
      insights.push({
        type: 'warning',
        metric: 'avgResponseTime',
        message: `Average response time (${avgFirstResponseTime} min) is above the 5 min target`,
        severity: 'medium',
      });
    }
    if (csatScore > 0 && csatScore < 60) {
      insights.push({
        type: 'critical',
        metric: 'csatScore',
        message: `CSAT score (${csatScore}%) is critically low, below 60% threshold`,
        severity: 'high',
      });
    }
    if (overloadedCount > 0) {
      insights.push({
        type: 'warning',
        metric: 'overloadedAgents',
        message: `${overloadedCount} agents are overloaded with more than 15 active tickets`,
        severity: 'high',
      });
    }
    if (idleCount > 0 && activeTickets > 0) {
      insights.push({
        type: 'info',
        metric: 'idleAgents',
        message: `${idleCount} agents are idle while ${activeTickets} tickets need attention`,
        severity: 'medium',
      });
    }
    if (overdueTickets > 0) {
      insights.push({
        type: 'critical',
        metric: 'overdueTickets',
        message: `${overdueTickets} tickets have breached SLA deadline and need immediate action`,
        severity: 'high',
      });
    }
    if (agentsPerformance.every((a) => a.activeTickets === 0)) {
      insights.push({
        type: 'info',
        metric: 'agentActivity',
        message: 'All agents are currently idle with no active tickets',
        severity: 'low',
      });
    }
    if (totalResolved === 0) {
      insights.push({
        type: 'info',
        metric: 'resolvedToday',
        message: 'No tickets have been resolved yet today',
        severity: 'low',
      });
    }

    // ── 11. SUGGESTIONS ──
    const suggestions = [];
    if (overloadedCount > 0 && idleCount > 0) {
      suggestions.push({
        type: 'optimization',
        action: 'reassign',
        message: `Reassign tickets from ${overloadedCount} overloaded agents to ${idleCount} idle agents`,
        priority: 'high',
      });
    }
    if (unassignedTickets > 5) {
      suggestions.push({
        type: 'assignment',
        action: 'assign',
        message: `Assign ${unassignedTickets} unassigned tickets to available agents to reduce queue`,
        priority: 'high',
      });
    }
    if (avgFirstResponseTime > 5) {
      suggestions.push({
        type: 'performance',
        action: 'coach',
        message: 'Response time is above target; consider coaching agents on faster initial replies',
        priority: 'medium',
      });
    }
    if (csatScore > 0 && csatScore < 70) {
      suggestions.push({
        type: 'quality',
        action: 'train',
        message: 'CSAT score is below target; schedule quality training for low-performing agents',
        priority: 'medium',
      });
    }
    if (agentTicketAgg && agentTicketAgg.length > 0 && totalAgents > 0) {
      const utilization = Math.round((usedCapacity / (totalAgents * CAPACITY_PER_AGENT)) * 100);
      if (utilization < 30) {
        suggestions.push({
          type: 'optimization',
          action: 'redistribute',
          message: 'Team is underutilized; consider redistributing workload or reducing team size',
          priority: 'low',
        });
      } else if (utilization > 85) {
        suggestions.push({
          type: 'staffing',
          action: 'hire',
          message: 'Team is near full capacity; consider adding more agents during peak hours',
          priority: 'high',
        });
      }
    }

    // ── 12. TREND DATA (gap-filled, 30 days) ──
    const trendMap = {};
    assignedTrendAgg.forEach((d) => { trendMap[d._id] = { assigned: d.count, resolved: 0 }; });
    resolvedTrendAgg.forEach((d) => {
      if (trendMap[d._id]) trendMap[d._id].resolved = d.count;
      else trendMap[d._id] = { assigned: 0, resolved: d.count };
    });

    const trendStart = new Date(thirtyDaysAgo);
    trendStart.setUTCHours(0, 0, 0, 0);
    const trendEnd = new Date(now);
    trendEnd.setUTCHours(23, 59, 59, 999);
    const trendData = [];
    const cursor = new Date(trendStart);
    while (cursor <= trendEnd) {
      const key = cursor.toISOString().slice(0, 10);
      const val = trendMap[key] || { assigned: 0, resolved: 0 };
      trendData.push({ date: key, assigned: val.assigned, resolved: val.resolved });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    // ── 13. HEATMAP (all 24 hours filled) ──
    const heatMap = {};
    (heatmapAgg || []).forEach((h) => { heatMap[h._id] = h.count; });
    const heatmap = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      load: heatMap[i] || 0,
    }));

    // ── 14. TEAM SCORE ──
    const responseScore = Math.max(0, 100 - avgFirstResponseTime * 5);
    const resolutionScore = Math.max(0, 100 - avgResolutionTime * 0.5);
    const overallScore = Math.round(csatScore * 0.40 + responseScore * 0.30 + resolutionScore * 0.30);
    let grade = 'C';
    if (overallScore >= 90) grade = 'A';
    else if (overallScore >= 80) grade = 'B+';
    else if (overallScore >= 70) grade = 'B';
    else if (overallScore >= 60) grade = 'C+';

    const teamScore = {
      overall: overallScore,
      breakdown: {
        csatScore: { value: csatScore, weight: 0.40, contribution: Math.round(csatScore * 0.40) },
        responseTime: { value: responseScore, weight: 0.30, contribution: Math.round(responseScore * 0.30) },
        resolutionTime: { value: resolutionScore, weight: 0.30, contribution: Math.round(resolutionScore * 0.30) },
      },
      grade,
    };

    // ─────────────────────────────────────────────
    // FINAL RESPONSE
    // ─────────────────────────────────────────────
    return {
      dashboard: {
        teamStats,
        kpis,
        goals,
        callPerformance,
        channelDistribution,
        agentsPerformance,
        topAgents,
        lowPerformers,
        workload,
        sla,
        insights,
        suggestions,
        trendData,
        heatmap,
        teamScore,
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

    const companyObjId = new mongoose.Types.ObjectId(companyId);
    const agentObjId = new mongoose.Types.ObjectId(agentId);

    const [
      dashboard,
      activeTickets,
      recentResolved,
      recentCalls,
      feedbackAgg,
      eventActivity,
    ] = await Promise.all([
      AgentDashboardService.getAgentDashboard(companyId, agentId).catch(() => null),
      ticketRepo.model.find({
        companyId: companyObjId,
        assignedTo: agentObjId,
        status: { $in: [TICKET_STATUS.PENDING, TICKET_STATUS.OPENED] },
      })
        .sort({ createdAt: -1 })
        .limit(20)
        .populate('userId', 'name email')
        .select('subject status priority channel category createdAt context')
        .lean(),
      ticketRepo.model.find({
        companyId: companyObjId,
        assignedTo: agentObjId,
        status: TICKET_STATUS.CLOSED,
      })
        .sort({ resolvedAt: -1 })
        .limit(10)
        .populate('userId', 'name email')
        .select('subject status priority channel category createdAt resolvedAt firstResponseAt')
        .lean(),
      callRepo.model.find({ companyId: companyObjId, agentId: agentObjId })
        .sort({ startedAt: -1 })
        .limit(10)
        .populate('customerId', 'name phone')
        .select('status duration startedAt customerPhone notes')
        .lean(),
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
      eventLogRepo.aggregate([
        {
          $match: {
            companyId: companyObjId,
            'metadata.agentId': agentId,
            eventType: {
              $in: ['ticket_claimed', 'ticket_resolved', 'ticket_closed', 'agent_replied', 'ticket_created'],
            },
            timestamp: { $gte: new Date(Date.now() - 72 * 60 * 60 * 1000) },
          },
        },
        { $sort: { timestamp: -1 } },
        { $limit: 15 },
        { $project: { eventType: 1, entityId: 1, timestamp: 1, _id: 0 } },
      ]),
    ]);

    const fb = feedbackAgg[0] || { totalRatings: 0, avgRating: 0, satisfiedCount: 0, count1: 0, count2: 0, count3: 0, count4: 0, count5: 0 };
    const csat = fb.totalRatings > 0 ? Math.round((fb.satisfiedCount / fb.totalRatings) * 100) : 0;

    const kpis = dashboard?.kpis || {};
    const todayStats = dashboard?.todayStats || {};
    const slaStats = dashboard?.slaStats || {};
    const callPerf = dashboard?.callPerformance || {};

    const now = Date.now();
    const activeTicketsMapped = activeTickets.map((t) => ({
      _id: t._id,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      channel: t.channel,
      category: t.category,
      customer: t.userId ? { _id: t.userId._id, name: t.userId.name, email: t.userId.email } : null,
      createdAt: t.createdAt,
      hoursSinceCreation: t.createdAt ? Math.round((now - new Date(t.createdAt).getTime()) / 3600000) : 0,
      hasSlaBreach: t.createdAt && (now - new Date(t.createdAt).getTime()) > 4 * 3600000,
    }));

    const recentResolvedMapped = recentResolved.map((t) => ({
      _id: t._id,
      subject: t.subject,
      channel: t.channel,
      priority: t.priority,
      customer: t.userId ? { _id: t.userId._id, name: t.userId.name, email: t.userId.email } : null,
      createdAt: t.createdAt,
      resolvedAt: t.resolvedAt,
      resolutionHours: t.createdAt && t.resolvedAt
        ? Math.round((new Date(t.resolvedAt) - new Date(t.createdAt)) / 3600000)
        : 0,
      responseTimeMin: t.createdAt && t.firstResponseAt
        ? Math.round((new Date(t.firstResponseAt) - new Date(t.createdAt)) / 60000)
        : null,
    }));

    const recentCallsMapped = recentCalls.map((c) => ({
      _id: c._id,
      customer: c.customerId ? { _id: c.customerId._id, name: c.customerId.name, phone: c.customerId.phone } : null,
      customerPhone: c.customerPhone,
      status: c.status,
      duration: c.duration,
      notes: c.notes,
      startedAt: c.startedAt,
    }));

    const typeLabels = {
      ticket_claimed: 'Claimed ticket',
      ticket_resolved: 'Resolved ticket',
      ticket_closed: 'Closed ticket',
      agent_replied: 'Replied to ticket',
      ticket_created: 'Created ticket',
    };
    const recentActivity = eventActivity.map((e) => ({
      type: e.eventType,
      ticketId: e.entityId,
      label: `${typeLabels[e.eventType] || e.eventType} #${e.entityId?.toString().slice(-6) || ''}`,
      timeAgo: e.timestamp ? this._timeAgo(e.timestamp) : '',
    }));

    return {
      agent: {
        _id: agent._id,
        companyId: agent.companyId,
        name: agent.name,
        email: agent.email,
        phone: agent.phone,
        profileImage: agent.profileImage,
        isActive: agent.isActive,
        lastLogin: agent.lastLogin,
        teamLeaderId: agent.teamLeaderId,
        onboardingStep: agent.onboardingStep,
        supervisorNotes: agent.supervisorNotes,
      },
      performance: {
        assignedTickets: kpis.assignedTickets || 0,
        pendingTickets: kpis.pendingTickets || 0,
        inProgressTickets: kpis.inProgressTickets || 0,
        resolvedTickets: kpis.resolvedTickets || 0,
        avgFirstResponseTime: kpis.avgFirstResponseTime || 0,
        avgResolutionTime: kpis.avgResolutionTime || 0,
        csatScore: kpis.csatScore || 0,
        todayTickets: todayStats.ticketsToday || 0,
        todayResolved: todayStats.resolvedToday || 0,
        todayAvgResponse: todayStats.avgResponseToday || 0,
        todayAvgResolution: todayStats.avgResolutionToday || 0,
      },
      sla: {
        overdueTickets: slaStats.overdueTickets || 0,
        dueSoon: slaStats.dueSoon || 0,
        breachedTickets: slaStats.breachedTickets || 0,
      },
      calls: {
        total: callPerf.totalCalls || 0,
        answered: callPerf.answered || 0,
        missed: callPerf.missed || 0,
        avgDuration: callPerf.avgDuration || 0,
        answerRate: callPerf.answerRate || 0,
        recent: recentCallsMapped,
      },
      activeTickets: activeTicketsMapped,
      recentResolved: recentResolvedMapped,
      feedback: {
        totalRatings: fb.totalRatings,
        avgRating: fb.totalRatings > 0 ? Math.round(fb.avgRating * 10) / 10 : 0,
        csat,
        ratingBreakdown: { 1: fb.count1, 2: fb.count2, 3: fb.count3, 4: fb.count4, 5: fb.count5 },
      },
      recentActivity,
    };
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

    // ── Weekly heatmap: day-of-week × hour-of-day grid ──
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const heatGrid = Array.from({ length: 7 }, () => Array(24).fill(0));
    let maxIntensity = 0;

    tickets.forEach((t) => {
      if (!t.resolvedAt) return;
      const d = new Date(t.resolvedAt);
      const dayIdx = d.getDay();
      const hour = d.getHours();
      heatGrid[dayIdx][hour]++;
      const val = heatGrid[dayIdx][hour];
      if (val > maxIntensity) maxIntensity = val;
    });

    const weeklyHeatmap = {
      noActivity: totalResolved === 0,
      maxIntensity,
      days: DAY_NAMES.map((name, dayIdx) => ({
        day: name,
        dayIndex: dayIdx,
        hours: heatGrid[dayIdx],
      })),
    };

    return {
      totalResolved,
      avgResolutionTimeMs: totalResolved ? totalResolutionTime / totalResolved : 0,
      avgResponseTimeMs: countWithResponseTime ? totalResponseTime / countWithResponseTime : 0,
      escalatedCount,
      channelDistribution,
      trendData,
      weeklyHeatmap,
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
