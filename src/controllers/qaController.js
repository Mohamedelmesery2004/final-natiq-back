import qaService from '../services/qaService.js';
import BaseController from './baseController.js';

class QAController extends BaseController {
  analyzeRaw = this.catchAsync(async (req, res) => {
    const result = await qaService.analyzeRaw(req.body);

    this.sendSuccess(res, result, 'QA analysis completed successfully');
  });

  analyzeById = this.catchAsync(async (req, res) => {
    const { ticketId } = req.params;

    const result = await qaService.analyzeNatiqByTicketId(req.companyId, ticketId);

    this.sendSuccess(res, result, 'QA analysis completed successfully');
  });

  analyzeNatiqById = this.catchAsync(async (req, res) => {
    const { ticketId } = req.params;
    const result = await qaService.analyzeNatiqByTicketId(req.companyId, ticketId);
    this.sendSuccess(res, result, 'Natiq analysis completed successfully');
  });

  getAutomatedResults = this.catchAsync(async (req, res) => {
    const filters = {
      page: req.query.page,
      limit: req.query.limit,
      agentId: req.query.agentId,
      sentiment: req.query.sentiment,
      status: req.query.status,
      category: req.query.category,
    };

    const result = await qaService.getAutomatedResults(req.companyId, filters);

    this.sendSuccess(res, result, 'Automated QA results retrieved successfully');
  });

  getAutomatedDetails = this.catchAsync(async (req, res) => {
    const { id } = req.params;

    const result = await qaService.getAutomatedAnalysisDetails(req.companyId, id);

    this.sendSuccess(res, result, 'Automated QA analysis details retrieved successfully');
  });
}

export default new QAController();
