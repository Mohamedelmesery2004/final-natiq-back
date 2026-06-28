import BaseController from './baseController.js';
import ownerBillingService from '../services/owner/ownerBillingService.js';
import ownerAnalyticsService from '../services/owner/ownerAnalyticsService.js';
import { companyRepo, userRepo } from '../repositories/index.js';
import { ROLES } from '../constants/index.js';

class OwnerController extends BaseController {

  // ─── Subscription Plans ──────────────────────

  listPlans = this.catchAsync(async (req, res) => {
    const plans = await ownerBillingService.listPlans(req.query);
    this.sendSuccess(res, { plans }, 'Subscription plans retrieved');
  });

  getPlan = this.catchAsync(async (req, res) => {
    const plan = await ownerBillingService.getPlan(req.params.planId);
    this.sendSuccess(res, { plan });
  });

  createPlan = this.catchAsync(async (req, res) => {
    const plan = await ownerBillingService.createPlan(req.body);
    this.sendSuccess(res, { plan }, 'Subscription plan created', 201);
  });

  updatePlan = this.catchAsync(async (req, res) => {
    const plan = await ownerBillingService.updatePlan(req.params.planId, req.body);
    this.sendSuccess(res, { plan }, 'Subscription plan updated');
  });

  deletePlan = this.catchAsync(async (req, res) => {
    await ownerBillingService.deletePlan(req.params.planId);
    this.sendSuccess(res, null, 'Subscription plan deleted');
  });

  togglePlanActive = this.catchAsync(async (req, res) => {
    const plan = await ownerBillingService.togglePlanActive(req.params.planId);
    this.sendSuccess(res, { plan }, `Plan ${plan.isActive ? 'activated' : 'deactivated'}`);
  });

  // ─── Company Subscriptions ────────────────────

  listCompanySubscriptions = this.catchAsync(async (req, res) => {
    const result = await ownerBillingService.listCompanySubscriptions(req.query);
    this.sendPaginated(res, result.data, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      pages: result.pages,
    });
  });

  getCompanySubscription = this.catchAsync(async (req, res) => {
    const company = await ownerBillingService.getCompanySubscription(req.params.companyId);
    this.sendSuccess(res, { company });
  });

  assignPlanToCompany = this.catchAsync(async (req, res) => {
    const { planId, startDate, endDate, trialEndDate, autoRenew } = req.body;
    const company = await ownerBillingService.assignPlanToCompany(
      req.params.companyId, planId, { startDate, endDate, trialEndDate, autoRenew }
    );
    this.sendSuccess(res, { company }, 'Plan assigned to company');
  });

  updateCompanySubscription = this.catchAsync(async (req, res) => {
    const company = await ownerBillingService.updateCompanySubscription(req.params.companyId, req.body);
    this.sendSuccess(res, { company }, 'Company subscription updated');
  });

  cancelCompanySubscription = this.catchAsync(async (req, res) => {
    const company = await ownerBillingService.cancelCompanySubscription(req.params.companyId);
    this.sendSuccess(res, { company }, 'Company subscription canceled');
  });

  // ─── Billing / Invoices ───────────────────────

  addInvoice = this.catchAsync(async (req, res) => {
    const invoice = await ownerBillingService.addInvoice(req.params.companyId, req.body);
    this.sendSuccess(res, { invoice }, 'Invoice added', 201);
  });

  listInvoices = this.catchAsync(async (req, res) => {
    const result = await ownerBillingService.listInvoices(req.params.companyId, req.query);
    this.sendPaginated(res, result.data, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      pages: result.pages,
    });
  });

  updateInvoice = this.catchAsync(async (req, res) => {
    const invoice = await ownerBillingService.updateInvoice(req.params.companyId, req.params.invoiceId, req.body);
    this.sendSuccess(res, { invoice }, 'Invoice updated');
  });

  // ─── Billing Info ──────────────────────────────

  updateBillingInfo = this.catchAsync(async (req, res) => {
    const company = await ownerBillingService.updateBillingInfo(req.params.companyId, req.body);
    this.sendSuccess(res, { company }, 'Billing info updated');
  });

  // ─── Dashboard ─────────────────────────────────

  getOwnerDashboard = this.catchAsync(async (req, res) => {
    const dashboard = await ownerBillingService.getOwnerDashboard();
    this.sendSuccess(res, { dashboard });
  });

  // ─── All Companies (Owner platform view) ──────

  listAllCompanies = this.catchAsync(async (req, res) => {
    const { page = 1, limit = 20, isActive, search } = req.query;
    const filter = {};
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await companyRepo.count(filter);
    const companies = await companyRepo.model.find(filter)
      .populate('subscription.planId', 'name code price currency interval')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .select('-invoices')
      .lean();

    this.sendPaginated(res, companies, {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / parseInt(limit)),
    });
  });

  getCompanyDetail = this.catchAsync(async (req, res) => {
    const data = await ownerBillingService.getCompanyDetailPage(req.params.companyId);
    this.sendSuccess(res, { company: data });
  });

  // ─── Analytics (Platform-wide) ─────────────────

  getAnalyticsOverview = this.catchAsync(async (req, res) => {
    const { from, to } = req.query;
    const overview = await ownerAnalyticsService.getPlatformOverview({ from, to });
    this.sendSuccess(res, { overview });
  });

  // ─── Owner Profile / Settings ─────────────────

  getOwnerSettings = this.catchAsync(async (req, res) => {
    const owner = await userRepo.model.findById(req.userId)
      .select('-passwordHash')
      .lean();
    if (!owner) return res.status(404).json({ success: false, message: 'Owner not found' });
    this.sendSuccess(res, { settings: owner });
  });

  updateOwnerSettings = this.catchAsync(async (req, res) => {
    const allowed = ['name', 'email', 'phone', 'profileImage'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields to update' });
    }

    const owner = await userRepo.model.findByIdAndUpdate(req.userId, updates, { new: true })
      .select('-passwordHash');
    if (!owner) throw ApiError.notFound('Owner not found');
    this.sendSuccess(res, { settings: owner }, 'Settings updated');
  });

  // ─── Managers (backward compat) ─────────────────

  listManagers = this.catchAsync(async (req, res) => {
    const filter = { role: ROLES.COMPANY_MANAGER };
    if (req.query.companyId) {
      filter.companyId = req.query.companyId;
    }
    const managers = await userRepo.model.find(filter)
      .populate('companyId', 'name slug')
      .select('-passwordHash')
      .sort({ companyId: 1, name: 1 });

    res.status(200).json({ success: true, count: managers.length, data: managers });
  });
}

export default new OwnerController();
