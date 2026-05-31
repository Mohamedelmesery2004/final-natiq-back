import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import BaseController from './baseController.js';
import analyticsService from '../services/analyticsService.js';
import agentDashboardService from '../services/agent/agentDashboardService.js';

class AnalyticsController extends BaseController {

    getOverview = this.catchAsync(async (req, res) => {
    const { from, to } = req.query;
    const overview = await analyticsService.getOverview(req.companyId, { from, to });
    this.sendSuccess(res, { overview });
  });

  getAgentsOverview = this.catchAsync(async (req, res) => {
    const { from, to } = req.query;
    const agents = await agentDashboardService.getAgentsOverview(req.companyId, { from, to });
    this.sendSuccess(res, { agents });
  });
}

export default new AnalyticsController();
