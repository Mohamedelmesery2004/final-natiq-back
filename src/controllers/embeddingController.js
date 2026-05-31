import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import embeddingService from '../services/embeddingService.js';
import BaseController from './baseController.js';

class EmbeddingController extends BaseController {

  getStatus = this.catchAsync(async (req, res) => {
    const status = await embeddingService.getEmbeddingStatus(req.companyId);
    this.sendSuccess(res, { status });
  });

  syncEmbeddings = this.catchAsync(async (req, res) => {
    const { force = false, batchSize = 50 } = req.body || {};
    const result = await embeddingService.syncEmbeddings(req.companyId, { force, batchSize });
    this.sendSuccess(res, { result });
  });

  embedSingleItem = this.catchAsync(async (req, res) => {
    const item = await embeddingService.embedKnowledgeItem(req.params.id);
    this.sendSuccess(res, {
      itemId: item._id,
      lastEmbeddedAt: item.lastEmbeddedAt,
      embeddingModel: item.embeddingModel,
    }, 'Item embedded successfully');
  });

}

export default new EmbeddingController();
