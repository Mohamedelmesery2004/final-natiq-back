import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import BaseController from './baseController.js';
import authService from '../services/authService.js';

class AuthController extends BaseController {

    register = this.catchAsync(async (req, res) => {
    const data = await authService.register(req.body);
    this.sendSuccess(res, data, 'Registration successful', 201);
  });

  login = this.catchAsync(async (req, res) => {
    const data = await authService.login(req.body);
    this.sendSuccess(res, data, 'Login successful');
  });

  getMe = this.catchAsync(async (req, res) => {
    const user = await authService.getMe(req.userId);
    this.sendSuccess(res, { user });
  });

  getPublicCompanies = this.catchAsync(async (req, res) => {
    const companies = await authService.getPublicCompanies();
    this.sendSuccess(res, { companies });
  });

}

export default new AuthController();
