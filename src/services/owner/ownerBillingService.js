import mongoose from 'mongoose';
import { companyRepo, subscriptionPlanRepo, userRepo, ticketRepo, knowledgeItemRepo, ticketFeedbackRepo } from '../../repositories/index.js';
import { ChatSession, Call, EventLog, TicketFeedback } from '../../models/index.js';
import ApiError from '../../utils/apiError.js';
import { SUBSCRIPTION_STATUS, INVOICE_STATUS, ROLES, TICKET_STATUS, CHAT_STATUS, CHANNELS, EVENT_TYPES } from '../../constants/index.js';

class OwnerBillingService {

  // ─── Subscription Plans ───────────────────────

  async listPlans({ isActive } = {}) {
    const filter = {};
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    return await subscriptionPlanRepo.model.find(filter).sort({ sortOrder: 1, name: 1 });
  }

  async getPlan(planId) {
    const plan = await subscriptionPlanRepo.findById(planId);
    if (!plan) throw ApiError.notFound('Subscription plan not found');
    return plan;
  }

  async createPlan(data) {
    const existing = await subscriptionPlanRepo.findOne({ code: data.code });
    if (existing) throw ApiError.conflict(`Plan with code '${data.code}' already exists`);

    const plan = await subscriptionPlanRepo.create(data);
    return plan;
  }

  async updatePlan(planId, data) {
    const plan = await subscriptionPlanRepo.findById(planId);
    if (!plan) throw ApiError.notFound('Subscription plan not found');

    if (data.code && data.code !== plan.code) {
      const existing = await subscriptionPlanRepo.findOne({ code: data.code });
      if (existing) throw ApiError.conflict(`Plan with code '${data.code}' already exists`);
    }

    Object.assign(plan, data);
    await plan.save();
    return plan;
  }

  async deletePlan(planId) {
    const plan = await subscriptionPlanRepo.findById(planId);
    if (!plan) throw ApiError.notFound('Subscription plan not found');

    const companiesUsing = await companyRepo.count({ 'subscription.planId': plan._id });
    if (companiesUsing > 0) {
      throw ApiError.conflict(`Cannot delete plan: ${companiesUsing} company(ies) are subscribed to it. Deactivate it instead.`);
    }

    await subscriptionPlanRepo.delete(planId);
    return { deleted: true };
  }

  async togglePlanActive(planId) {
    const plan = await subscriptionPlanRepo.findById(planId);
    if (!plan) throw ApiError.notFound('Subscription plan not found');
    plan.isActive = !plan.isActive;
    await plan.save();
    return plan;
  }

  // ─── Company Subscriptions ─────────────────────

  async listCompanySubscriptions({ status, planId, search, page = 1, limit = 20 } = {}) {
    const filter = {};
    if (status) filter['subscription.status'] = status;
    if (planId) filter['subscription.planId'] = planId;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } },
        { 'billingInfo.email': { $regex: search, $options: 'i' } },
      ];
    }

    const total = await companyRepo.count(filter);
    const companies = await companyRepo.model.find(filter)
      .populate('subscription.planId', 'name code price currency interval')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const data = companies.map(c => ({
      _id: c._id,
      name: c.name,
      slug: c.slug,
      industry: c.industry,
      isActive: c.isActive,
      subscription: c.subscription,
      billingInfo: c.billingInfo,
      invoiceCount: c.invoices?.length || 0,
      createdAt: c.createdAt,
    }));

    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getCompanySubscription(companyId) {
    const company = await companyRepo.model.findById(companyId)
      .populate('subscription.planId', 'name code price currency interval description features limits')
      .select('name slug industry isActive subscription billingInfo invoices')
      .lean();

    if (!company) throw ApiError.notFound('Company not found');
    return company;
  }

  async assignPlanToCompany(companyId, planId, { startDate, endDate, trialEndDate, autoRenew } = {}) {
    const company = await companyRepo.findById(companyId);
    if (!company) throw ApiError.notFound('Company not found');

    const plan = await subscriptionPlanRepo.findById(planId);
    if (!plan) throw ApiError.notFound('Subscription plan not found');
    if (!plan.isActive) throw ApiError.badRequest('Cannot assign an inactive plan');

    const now = new Date();
    company.subscription = {
      planId: plan._id,
      status: trialEndDate ? SUBSCRIPTION_STATUS.TRIALING : SUBSCRIPTION_STATUS.ACTIVE,
      startDate: startDate || now,
      endDate: endDate || null,
      trialEndDate: trialEndDate || null,
      autoRenew: autoRenew !== undefined ? autoRenew : true,
    };

    await company.save();
    return company;
  }

  async updateCompanySubscription(companyId, updates) {
    const company = await companyRepo.findById(companyId);
    if (!company) throw ApiError.notFound('Company not found');

    if (updates.planId) {
      const plan = await subscriptionPlanRepo.findById(updates.planId);
      if (!plan) throw ApiError.notFound('Subscription plan not found');
      company.subscription.planId = plan._id;
    }
    if (updates.status) company.subscription.status = updates.status;
    if (updates.startDate) company.subscription.startDate = new Date(updates.startDate);
    if (updates.endDate) company.subscription.endDate = new Date(updates.endDate);
    if (updates.trialEndDate) company.subscription.trialEndDate = new Date(updates.trialEndDate);
    if (updates.autoRenew !== undefined) company.subscription.autoRenew = updates.autoRenew;

    await company.save();
    return company;
  }

  async cancelCompanySubscription(companyId) {
    const company = await companyRepo.findById(companyId);
    if (!company) throw ApiError.notFound('Company not found');
    company.subscription.status = SUBSCRIPTION_STATUS.CANCELED;
    company.subscription.autoRenew = false;
    await company.save();
    return company;
  }

  // ─── Billing / Invoices ────────────────────────

  async addInvoice(companyId, invoiceData) {
    const company = await companyRepo.findById(companyId);
    if (!company) throw ApiError.notFound('Company not found');

    company.invoices.push({
      invoiceNumber: invoiceData.invoiceNumber,
      amount: invoiceData.amount,
      currency: invoiceData.currency || 'USD',
      status: invoiceData.status || INVOICE_STATUS.PENDING,
      planId: invoiceData.planId || company.subscription?.planId || null,
      planName: invoiceData.planName || '',
      periodStart: invoiceData.periodStart ? new Date(invoiceData.periodStart) : undefined,
      periodEnd: invoiceData.periodEnd ? new Date(invoiceData.periodEnd) : undefined,
      paidAt: invoiceData.paidAt ? new Date(invoiceData.paidAt) : undefined,
      dueDate: invoiceData.dueDate ? new Date(invoiceData.dueDate) : undefined,
      paymentMethod: invoiceData.paymentMethod || '',
      notes: invoiceData.notes || '',
    });

    await company.save();
    return company.invoices[company.invoices.length - 1];
  }

  async listInvoices(companyId, { page = 1, limit = 20 } = {}) {
    const company = await companyRepo.model.findById(companyId)
      .select('invoices')
      .lean();

    if (!company) throw ApiError.notFound('Company not found');

    const invoices = (company.invoices || [])
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const total = invoices.length;
    const skip = (page - 1) * limit;
    const paginated = invoices.slice(skip, skip + limit);

    return { data: paginated, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async updateInvoice(companyId, invoiceId, updates) {
    const company = await companyRepo.findById(companyId);
    if (!company) throw ApiError.notFound('Company not found');

    const invoice = company.invoices.id(invoiceId);
    if (!invoice) throw ApiError.notFound('Invoice not found');

    const allowed = ['amount', 'currency', 'status', 'paidAt', 'dueDate', 'paymentMethod', 'notes'];
    allowed.forEach(f => {
      if (updates[f] !== undefined) {
        invoice[f] = updates[f];
      }
    });

    await company.save();
    return invoice;
  }

  // ─── Company Detail Page ──────────────────────

  async getCompanyDetailPage(companyId) {
    const company = await companyRepo.model.findById(companyId)
      .populate('subscription.planId', 'name code price currency interval description features limits')
      .lean();
    if (!company) throw ApiError.notFound('Company not found');

    const [
      users,
      tickets,
      chatSessions,
      knowledgeItems,
      calls,
      recentEvents,
    ] = await Promise.all([
      userRepo.model.find({ companyId })
        .select('-passwordHash')
        .sort({ role: 1, name: 1 })
        .lean(),
      ticketRepo.model.find({ companyId })
        .populate('assignedTo', 'name email')
        .populate('userId', 'name email')
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      ChatSession.find({ companyId })
        .sort({ lastActivity: -1 })
        .limit(20)
        .lean(),
      knowledgeItemRepo.model.find({ companyId })
        .sort({ type: 1, title: 1 })
        .lean(),
      Call.find({ companyId })
        .sort({ startedAt: -1 })
        .limit(20)
        .lean(),
      EventLog.find({ companyId })
        .sort({ timestamp: -1 })
        .limit(30)
        .lean(),
    ]);

    const usersByRole = {
      [ROLES.COMPANY_MANAGER]: [],
      [ROLES.TEAM_LEADER]: [],
      [ROLES.AGENT]: [],
      [ROLES.CUSTOMER]: [],
    };
    users.forEach(u => {
      if (usersByRole[u.role]) usersByRole[u.role].push(u);
    });

    const totalInvoices = company.invoices?.length || 0;
    const totalPaid = (company.invoices || [])
      .filter(i => i.status === 'paid')
      .reduce((sum, i) => sum + i.amount, 0);
    const totalPending = (company.invoices || [])
      .filter(i => i.status === 'pending' || i.status === 'overdue')
      .reduce((sum, i) => sum + i.amount, 0);

    const ticketStats = {
      total: tickets.length,
      closed: tickets.filter(t => t.status === 'closed').length,
      opened: tickets.filter(t => t.status === 'opened').length,
      pending: tickets.filter(t => t.status === 'pending').length,
    };

    const chatStats = {
      total: chatSessions.length,
      active: chatSessions.filter(s => s.status === 'active').length,
      closed: chatSessions.filter(s => s.status === 'closed').length,
    };

    const callStats = {
      total: calls.length,
      answered: calls.filter(c => c.status === 'ended' || c.status === 'active').length,
      missed: calls.filter(c => c.status === 'missed').length,
    };

    return {
      company,
      users: {
        total: users.length,
        byRole: usersByRole,
      },
      tickets: {
        stats: ticketStats,
        list: tickets,
      },
      chatSessions: {
        stats: chatStats,
        list: chatSessions,
      },
      knowledgeItems: {
        total: knowledgeItems.length,
        list: knowledgeItems,
      },
      calls: {
        stats: callStats,
        list: calls,
      },
      billing: {
        totalInvoices,
        totalPaid,
        totalPending,
        invoices: company.invoices || [],
      },
      recentEvents,
    };
  }

  // ─── Billing Info Update ───────────────────────

  async updateBillingInfo(companyId, billingData) {
    const company = await companyRepo.findById(companyId);
    if (!company) throw ApiError.notFound('Company not found');

    if (billingData.email !== undefined) company.billingInfo.email = billingData.email;
    if (billingData.phone !== undefined) company.billingInfo.phone = billingData.phone;
    if (billingData.address) {
      company.billingInfo.address = {
        ...company.billingInfo.address,
        ...billingData.address,
      };
    }

    await company.save();
    return company;
  }

  // ─── Dashboard Stats (Aggregated across all companies) ──

  async getOwnerDashboard() {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const [
      totalCompanies,
      activeCompanies,
      totalPlans,
      activePlans,
      subscriptionStatusCounts,
      planDistribution,
      recentCompanies,
      totalTickets,
      resolvedTickets,
      ticketsToday,
      revenueAgg,
      activeSubscriptions,
      trialingCompanies,
      canceledCompanies,
    ] = await Promise.all([
      companyRepo.count({}),
      companyRepo.count({ isActive: true }),
      subscriptionPlanRepo.count({}),
      subscriptionPlanRepo.count({ isActive: true }),
      companyRepo.model.aggregate([
        { $group: { _id: '$subscription.status', count: { $sum: 1 } } },
      ]),
      companyRepo.model.aggregate([
        { $match: { 'subscription.planId': { $ne: null } } },
        {
          $group: {
            _id: '$subscription.planId',
            count: { $sum: 1 },
            companies: { $push: { name: '$name', slug: '$slug', status: '$subscription.status' } },
          },
        },
        { $sort: { count: -1 } },
        {
          $lookup: {
            from: 'subscriptionplans',
            localField: '_id',
            foreignField: '_id',
            as: 'plan',
          },
        },
        { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            planId: '$_id',
            planName: '$plan.name',
            planCode: '$plan.code',
            price: '$plan.price',
            interval: '$plan.interval',
            companyCount: '$count',
            companies: 1,
          },
        },
      ]),
      companyRepo.model.find({})
        .populate('subscription.planId', 'name code price interval')
        .sort({ createdAt: -1 })
        .limit(10)
        .select('name slug subscription isActive createdAt')
        .lean(),
      ticketRepo.count({}),
      ticketRepo.count({ status: TICKET_STATUS.CLOSED }),
      ticketRepo.count({ createdAt: { $gte: today } }),
      companyRepo.model.aggregate([
        { $unwind: '$invoices' },
        { $match: { 'invoices.status': 'paid', 'invoices.currency': 'USD' } },
        {
          $group: {
            _id: null,
            total: { $sum: '$invoices.amount' },
            monthly: {
              $sum: {
                $cond: [
                  { $in: ['$invoices.planName', ['Starter', 'Growth', 'Enterprise']] },
                  '$invoices.amount',
                  0,
                ],
              },
            },
            yearly: {
              $sum: {
                $cond: [
                  { $eq: ['$invoices.planName', 'Enterprise Yearly'] },
                  '$invoices.amount',
                  0,
                ],
              },
            },
          },
        },
      ]),
      companyRepo.count({ 'subscription.status': SUBSCRIPTION_STATUS.ACTIVE, isActive: true }),
      companyRepo.count({ 'subscription.status': SUBSCRIPTION_STATUS.TRIALING }),
      companyRepo.count({ 'subscription.status': SUBSCRIPTION_STATUS.CANCELED }),
    ]);

    const subscriptionStatusBreakdown = {};
    subscriptionStatusCounts.forEach(s => {
      subscriptionStatusBreakdown[s._id || 'none'] = s.count;
    });

    const rev = revenueAgg[0] || { total: 0, monthly: 0, yearly: 0 };
    const totalRevenue = rev.total;

    const planDistributionMapped = planDistribution.map(p => ({
      planId: p.planId,
      planName: p.planName || 'Unknown',
      planCode: p.planCode || '',
      price: p.price || 0,
      interval: p.interval || 'monthly',
      companyCount: p.companyCount,
      companies: p.companies,
    }));

    const subscriptionRate = totalCompanies > 0
      ? Math.round((activeSubscriptions / totalCompanies) * 100) : 0;
    const trialConversionRate = trialingCompanies + activeSubscriptions > 0
      ? Math.round((activeSubscriptions / (trialingCompanies + activeSubscriptions)) * 100) : 0;

    const insights = [];
    if (trialingCompanies > 0) {
      insights.push({ type: 'info', metric: 'trials', message: `${trialingCompanies} compan${trialingCompanies > 1 ? 'ies' : 'y'} on trial — ${trialConversionRate}% conversion rate`, severity: 'medium' });
    }
    if (canceledCompanies > 0) {
      insights.push({ type: 'warning', metric: 'churn', message: `${canceledCompanies} compan${canceledCompanies > 1 ? 'ies' : 'y'} canceled`, severity: 'high' });
    }
    if (subscriptionRate < 60) {
      insights.push({ type: 'warning', metric: 'subscription rate', message: `${subscriptionRate}% subscription rate — target: 60%+`, severity: 'high' });
    }
    if (totalRevenue === 0 && totalCompanies > 0) {
      insights.push({ type: 'info', metric: 'revenue', message: 'No paid invoices yet', severity: 'low' });
    }

    return {
      overview: {
        totalCompanies,
        activeCompanies,
        totalRevenue,
        subscriptionStatusBreakdown,
        planDistribution: planDistributionMapped,
        subscriptionRate,
        trialConversionRate,
      },
      revenue: {
        total: totalRevenue,
        monthly: rev.monthly,
        yearly: rev.yearly,
        currency: 'USD',
      },
      subscriptionMetrics: {
        activeSubscriptions,
        trialing: trialingCompanies,
        canceled: canceledCompanies,
        subscriptionRate,
        trialConversionRate,
        statusBreakdown: subscriptionStatusBreakdown,
      },
      tickets: {
        total: totalTickets,
        resolved: resolvedTickets,
        today: ticketsToday,
        resolutionRate: totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 0,
      },
      plans: {
        total: totalPlans,
        active: activePlans,
        distribution: planDistributionMapped,
      },
      recentCompanies,
      insights,
    };
  }
}

export default new OwnerBillingService();
