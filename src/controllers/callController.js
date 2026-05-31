import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import { Call } from '../models/index.js';
import BaseController from './baseController.js';
import ApiError from '../utils/apiError.js';

class CallController extends BaseController {

  /**
   * POST /api/v1/calls
   * Save a call record after it ends (called by agent from dashboard)
   */
  saveCall = this.catchAsync(async (req, res) => {
    const {
      callId,
      customerId,
      customerName,
      status,
      startedAt,
      answeredAt,
      endedAt,
      duration,
      ticketId,
      endedBy,
    } = req.body;

    if (!callId || !customerId) {
      throw ApiError.badRequest('callId and customerId are required');
    }

    // Upsert — in case call was already partially saved
    const call = await Call.findOneAndUpdate(
      { callId, companyId: req.companyId },
      {
        callId,
        companyId: req.companyId,
        customerId,
        agentId: req.userId,
        customerName: customerName || 'Customer',
        agentName: req.user?.name || null,
        status: status || 'ended',
        startedAt: startedAt ? new Date(startedAt) : new Date(),
        answeredAt: answeredAt ? new Date(answeredAt) : null,
        endedAt: endedAt ? new Date(endedAt) : new Date(),
        duration: duration || 0,
        ticketId: ticketId || null,
        endedBy: endedBy || null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    this.sendSuccess(res, { call }, 'Call record saved');
  });

  /**
   * GET /api/v1/agent/calls
   * Get call history for the logged-in agent
   */
  getCallHistory = this.catchAsync(async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const calls = await callRepo.model.find({
      companyId: req.companyId,
      agentId: req.userId,
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('customerId', 'name email')
      .lean();

    const total = await callRepo.count({
      companyId: req.companyId,
      agentId: req.userId,
    });

    this.sendSuccess(res, { calls, total, page: parseInt(page), limit: parseInt(limit) });
  });

  /**
   * GET /api/v1/calls/company
   * Get all calls for the company (managers/admins)
   */
  getCompanyCalls = this.catchAsync(async (req, res) => {
    const { page = 1, limit = 20, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = { companyId: req.companyId };
    if (status) filter.status = status;

    const calls = await callRepo.model.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('customerId', 'name email')
      .populate('agentId', 'name email')
      .lean();

    const total = await callRepo.count(filter);

    this.sendSuccess(res, { calls, total, page: parseInt(page), limit: parseInt(limit) });
  });

  /**
   * POST /api/v1/calls/upload-recording/:callId
   * Upload audio recording for a call
   */
  uploadRecording = this.catchAsync(async (req, res) => {
    const { callId } = req.params;
    
    if (!req.file) {
      throw ApiError.badRequest('No audio file provided');
    }

    // Usually audio files go to back/uploads/calls/
    // We store the relative path to be served via express.static
    const recordingUrl = `/uploads/calls/${req.file.filename}`;

    const call = await Call.findOneAndUpdate(
      { callId, companyId: req.companyId },
      { recordingUrl },
      { new: true }
    );

    if (!call) {
      throw ApiError.notFound('Call not found');
    }

    this.sendSuccess(res, { call }, 'Recording uploaded successfully');
  });
}

export default new CallController();
