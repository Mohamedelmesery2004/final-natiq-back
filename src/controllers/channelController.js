import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import BaseController from './baseController.js';
import telegramWebhookService from '../services/channels/telegramWebhookService.js';
import whatsappWebhookService from '../services/channels/whatsappWebhookService.js';

class ChannelController extends BaseController {

  telegramWebhook = this.catchAsync(async (req, res) => {
    const result = await telegramWebhookService.processWebhook(req.body, req.query, req.headers);
    return res.status(200).json(result);
  });

  whatsappMockWebhook = this.catchAsync(async (req, res) => {
    const result = await whatsappWebhookService.processWebhook(req.body);
    if (!result.success) {
      return this.sendSuccess(res, null, result.message, 200);
    }
    return this.sendSuccess(res, { replies: result.replies }, 'WhatsApp mock webhook processed');
  });

}

export default new ChannelController();
