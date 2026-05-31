import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import { Company, User } from '../models/index.js';
import slugify from 'slugify';
import ApiError from '../utils/apiError.js';
import { ROLES } from '../constants/index.js';
import BaseController from './baseController.js';

class PlatformController extends BaseController {

  createCompany = this.catchAsync(async (req, res) => {
    const { name, slug, industry, channelsConfig, settings } = req.body;

    const companySlug = slug || slugify(name, { lower: true, strict: true });

    const existing = await companyRepo.findOne({ slug: companySlug });
    if (existing) {
      throw ApiError.conflict('A company with this slug already exists');
    }

    const company = await Company.create({
      name,
      slug: companySlug,
      industry,
      channelsConfig,
      settings,
    });

    this.sendSuccess(res, { company }, 'Company created successfully', 201);
  });

  listCompanies = this.catchAsync(async (req, res) => {
    const { page = 1, limit = 20, isActive, search } = req.query;

    const filter = {};
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await Company.countDocuments(filter);
    const companies = await companyRepo.model.find(filter)
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    this.sendPaginated(res, companies, {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / parseInt(limit)),
    });
  });

  getCompany = this.catchAsync(async (req, res) => {
    const company = await companyRepo.model.findById(req.params.id);
    if (!company) throw ApiError.notFound('Company not found');

    const userCounts = await User.aggregate([
      { $match: { companyId: company._id } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]);

    this.sendSuccess(res, { company, userCounts });
  });

  updateCompany = this.catchAsync(async (req, res) => {
    const company = await companyRepo.model.findById(req.params.id);
    if (!company) throw ApiError.notFound('Company not found');

    const allowed = ['name', 'industry', 'channelsConfig', 'settings', 'isActive'];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) {
        company[field] = req.body[field];
      }
    });

    await company.save();
    this.sendSuccess(res, { company }, 'Company updated successfully');
  });

  createInitialAdmin = this.catchAsync(async (req, res) => {
    const { name, email, password } = req.body;

    const company = await companyRepo.model.findById(req.params.id);
    if (!company) throw ApiError.notFound('Company not found');

    const existing = await userRepo.findOne({ companyId: company._id, email });
    if (existing) throw ApiError.conflict('User with this email already exists');

    const user = await userRepo.create({
      companyId: company._id,
      name,
      email,
      passwordHash: password,
      role: ROLES.COMPANY_MANAGER,
    });

    this.sendSuccess(res, { user: user.toJSON() }, 'Company manager created', 201);
  });

}

export default new PlatformController();
