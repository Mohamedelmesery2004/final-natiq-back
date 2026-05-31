import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import { User } from '../models/index.js';
import ApiError from '../utils/apiError.js';
import { ROLES } from '../constants/index.js';
import BaseController from './baseController.js';
import { recordAudit } from '../services/auditLogService.js';

class AdminUserController extends BaseController {

  createUser = this.catchAsync(async (req, res) => {
    const { name, email, password, phone, role, profileImage, teamLeaderId } = req.body;

    if (req.userRole === ROLES.TEAM_LEADER && role === ROLES.COMPANY_MANAGER) {
      throw ApiError.forbidden('Team leaders cannot create company managers');
    }

    const existing = await userRepo.findOne({ companyId: req.companyId, email });
    if (existing) {
      throw ApiError.conflict('User with this email already exists in this company');
    }

    const payload = {
      companyId: req.companyId,
      name,
      email,
      passwordHash: password,
      phone: phone || null,
      role,
      profileImage: profileImage || null,
    };
    if (role === ROLES.AGENT && teamLeaderId !== undefined) {
      payload.teamLeaderId = teamLeaderId || null;
    }

    const user = await userRepo.create(payload);

    await recordAudit({
      companyId: req.companyId,
      actor: req.user,
      action: 'user.created',
      resourceType: 'user',
      targetId: user._id,
      details: { email: user.email, role: user.role },
    });

    this.sendSuccess(res, { user: user.toJSON() }, 'User created successfully', 201);
  });

  listUsers = this.catchAsync(async (req, res) => {
    const { page = 1, limit = 20, role, isActive, search } = req.query;

    const filter = { companyId: req.companyId };
    if (role) filter.role = role;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await userRepo.count(filter);
    const users = await userRepo.model.find(filter)
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .select('-passwordHash')
      .populate('teamLeaderId', 'name email');

    this.sendPaginated(res, users, {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / parseInt(limit)),
    });
  });

  getUser = this.catchAsync(async (req, res) => {
    const user = await userRepo.model.findOne({ _id: req.params.id, companyId: req.companyId })
      .select('-passwordHash')
      .populate('teamLeaderId', 'name email');
    if (!user) throw ApiError.notFound('User not found');
    this.sendSuccess(res, { user });
  });

  updateUser = this.catchAsync(async (req, res) => {
    const user = await userRepo.findOne({ _id: req.params.id, companyId: req.companyId });
    if (!user) throw ApiError.notFound('User not found');

    const allowed = ['name', 'phone', 'role', 'isActive', 'profileImage', 'teamLeaderId'];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) {
        if (field === 'teamLeaderId' && user.role !== ROLES.AGENT) {
          return;
        }
        user[field] = req.body[field];
      }
    });

    if (user.role !== ROLES.AGENT) {
      user.teamLeaderId = null;
    }

    await user.save();

    await recordAudit({
      companyId: req.companyId,
      actor: req.user,
      action: 'user.updated',
      resourceType: 'user',
      targetId: user._id,
      details: {
        email: user.email,
        updatedFields: Object.keys(req.body).filter((k) => req.body[k] !== undefined),
      },
    });

    this.sendSuccess(res, { user: user.toJSON() }, 'User updated successfully');
  });

  deleteUser = this.catchAsync(async (req, res) => {
    const user = await userRepo.findOne({ _id: req.params.id, companyId: req.companyId });
    if (!user) throw ApiError.notFound('User not found');

    user.isActive = false;
    await user.save();

    await recordAudit({
      companyId: req.companyId,
      actor: req.user,
      action: 'user.deactivated',
      resourceType: 'user',
      targetId: user._id,
      details: { email: user.email },
    });

    this.sendSuccess(res, null, 'User deactivated successfully');
  });

}

export default new AdminUserController();
