import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import BaseController from './baseController.js';
import teamLeaderService from '../services/teamLeaderService.js';
import ApiError from '../utils/apiError.js';

class TeamLeaderController extends BaseController {
  getDashboard = this.catchAsync(async (req, res) => {
    const access = await teamLeaderService.getAccessContext(
      req.companyId,
      req.userRole,
      req.userId
    );
    const dashboard = await teamLeaderService.getDashboardOverview(req.companyId, access);
    this.sendSuccess(res, dashboard, 'Dashboard overview retrieved successfully');
  });

  getCalls = this.catchAsync(async (req, res) => {
    const access = await teamLeaderService.getAccessContext(
      req.companyId,
      req.userRole,
      req.userId
    );
    const { page, limit, status, agentId } = req.query;
    const result = await teamLeaderService.getScopedCompanyCalls(
      req.companyId,
      { page, limit, status, agentId },
      access
    );
    this.sendSuccess(res, result, 'Calls retrieved successfully');
  });

  getAgents = this.catchAsync(async (req, res) => {
    const access = await teamLeaderService.getAccessContext(
      req.companyId,
      req.userRole,
      req.userId
    );
    const agents = await teamLeaderService.getTeamAgents(req.companyId, access);
    this.sendSuccess(res, agents, 'Team agents retrieved successfully');
  });

  getAgentProfile = this.catchAsync(async (req, res) => {
    const { agentId } = req.params;
    const access = await teamLeaderService.getAccessContext(
      req.companyId,
      req.userRole,
      req.userId
    );
    const agent = await teamLeaderService.getAgentProfile(req.companyId, agentId, access);
    this.sendSuccess(res, { agent }, 'Agent profile retrieved successfully');
  });

  // Notify an agent
  notifyAgent = this.catchAsync(async (req, res) => {
    const { agentId } = req.params;
    const { message } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      throw ApiError.badRequest('message is required');
    }
    const access = await teamLeaderService.getAccessContext(
      req.companyId,
      req.userRole,
      req.userId
    );
    const result = await teamLeaderService.notifyAgent(
      req.companyId,
      agentId,
      message.trim(),
      access
    );
    this.sendSuccess(res, result, 'Notification sent successfully');
  });

  getAgentPerformance = this.catchAsync(async (req, res) => {
    const { agentId } = req.params;
    const { period } = req.query;
    const access = await teamLeaderService.getAccessContext(
      req.companyId,
      req.userRole,
      req.userId
    );
    const performance = await teamLeaderService.getAgentPerformance(
      req.companyId,
      agentId,
      period,
      access
    );
    this.sendSuccess(res, performance, 'Agent performance retrieved successfully');
  });

  assignTickets = this.catchAsync(async (req, res) => {
    const { ticketIds, agentId } = req.body;

    if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
      throw ApiError.badRequest('Must provide an array of ticketIds');
    }
    if (!agentId) {
      throw ApiError.badRequest('Must provide an agentId');
    }

    const access = await teamLeaderService.getAccessContext(
      req.companyId,
      req.userRole,
      req.userId
    );
    const modifiedCount = await teamLeaderService.bulkAssignTickets(
      req.companyId,
      ticketIds,
      agentId,
      access
    );

    this.sendSuccess(res, { assignedCount: modifiedCount }, 'Tickets assigned successfully');
  });

  getCompanyTickets = this.catchAsync(async (req, res) => {
    const { status, agentId, page, limit } = req.query;
    const access = await teamLeaderService.getAccessContext(
      req.companyId,
      req.userRole,
      req.userId
    );
    const result = await teamLeaderService.getCompanyTickets(
      req.companyId,
      { status, agentId, page: +page || 1, limit: +limit || 30 },
      access
    );
    this.sendSuccess(res, result, 'Company tickets retrieved successfully');
  });

  getUnassignedQueue = this.catchAsync(async (req, res) => {
    const { page, limit } = req.query;
    const result = await teamLeaderService.getUnassignedQueue(req.companyId, {
      page: +page || 1,
      limit: +limit || 50,
    });
    this.sendSuccess(res, result, 'Unassigned queue retrieved successfully');
  });

  getTicketMessages = this.catchAsync(async (req, res) => {
    const { ticketId } = req.params;
    const access = await teamLeaderService.getAccessContext(
      req.companyId,
      req.userRole,
      req.userId
    );
    const result = await teamLeaderService.getTicketMessages(req.companyId, ticketId, access);
    this.sendSuccess(res, result, 'Ticket messages retrieved successfully');
  });

  appendTicketQANote = this.catchAsync(async (req, res) => {
    const { ticketId } = req.params;
    const { content } = req.body;
    if (!content || typeof content !== 'string' || !content.trim()) {
      throw ApiError.badRequest('content is required');
    }
    const access = await teamLeaderService.getAccessContext(
      req.companyId,
      req.userRole,
      req.userId
    );
    const doc = await teamLeaderService.appendQATeamLeaderNote(
      req.companyId,
      ticketId,
      req.userId,
      content,
      access
    );
    this.sendSuccess(res, { analysis: doc }, 'Note added to ticket QA');
  });

  appendAgentSupervisorNote = this.catchAsync(async (req, res) => {
    const { agentId } = req.params;
    const { content } = req.body;
    if (!content || typeof content !== 'string' || !content.trim()) {
      throw ApiError.badRequest('content is required');
    }
    const access = await teamLeaderService.getAccessContext(
      req.companyId,
      req.userRole,
      req.userId
    );
    const user = await teamLeaderService.appendAgentSupervisorNote(
      req.companyId,
      agentId,
      req.userId,
      content,
      access
    );
    this.sendSuccess(res, { user: user.toJSON() }, 'Supervisor note saved');
  });
}

export default new TeamLeaderController();
