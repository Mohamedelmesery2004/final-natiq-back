import coachService from '../services/coachService.js';
import BaseController from './baseController.js';

class CoachController extends BaseController {
  startCoaching = this.catchAsync(async (req, res) => {
    const { ticketId } = req.params;

    const result = await coachService.startCoaching(req.companyId, ticketId);

    res.status(202).json({
      success: true,
      message: 'Coaching analysis started',
      data: result,
    });
  });

  getJob = this.catchAsync(async (req, res) => {
    const { jobId } = req.params;

    const result = await coachService.getJob(req.companyId, jobId);

    if (result.status !== 'completed') {
      return res.status(200).json({
        success: true,
        message: `Coaching analysis is ${result.status}`,
        data: result,
      });
    }

    this.sendSuccess(res, result, 'Coaching analysis retrieved successfully');
  });
}

export default new CoachController();
