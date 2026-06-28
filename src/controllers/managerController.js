import { companyRepo, userRepo } from '../repositories/index.js';
import BaseController from './baseController.js';
import { RBAC_MATRIX, ROLES } from '../constants/index.js';
import { listAuditLogs } from '../services/auditLogService.js';
import {
  exportCallsCsv,
  exportTicketsCsv,
  exportAnalyticsSummaryCsv,
} from '../services/exportService.js';
import telegramService from '../services/telegramService.js';
import managerDashboardService from '../services/manager/managerDashboardService.js';

const ROLE_LABELS = {
  [ROLES.PLATFORM_SUPER_ADMIN]: 'Super Admin',
  [ROLES.COMPANY_OWNER]: 'Natiq Owner',
  [ROLES.COMPANY_MANAGER]: 'Company Manager',
  [ROLES.TEAM_LEADER]: 'Supervisor',
  [ROLES.AGENT]: 'Agent',
  [ROLES.CUSTOMER]: 'Customer',
};

class ManagerController extends BaseController {

  // ── Dashboard ──────────────────────────────
  getDashboardSummary = this.catchAsync(async (req, res) => {
    const dashboard = await managerDashboardService.getDashboard(req.companyId, req.query);
    res.status(200).json({ success: true, data: { dashboard } });
  });

  // ── Company Settings ────────────────────────
  getCompanySettings = this.catchAsync(async (req, res) => {
    const company = await companyRepo.model.findById(req.user.companyId);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }
    res.status(200).json({ success: true, data: company });
  });

  updateCompanySettings = this.catchAsync(async (req, res) => {
    const company = await companyRepo.model.findById(req.user.companyId);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const updates = req.body;
    if (updates.name) company.name = updates.name;
    if (updates.industry) company.industry = updates.industry;

    if (updates.channelsConfig) {
      if (updates.channelsConfig.telegram) {
        company.channelsConfig.telegram = {
          ...company.channelsConfig.telegram,
          ...updates.channelsConfig.telegram,
        };
      }
      if (updates.channelsConfig.whatsapp) {
        company.channelsConfig.whatsapp = {
          ...company.channelsConfig.whatsapp,
          ...updates.channelsConfig.whatsapp,
        };
      }
      if (updates.channelsConfig.webChat) {
        company.channelsConfig.webChat = {
          ...company.channelsConfig.webChat,
          ...updates.channelsConfig.webChat,
        };
      }
    }

    if (updates.settings) {
      company.settings = {
        ...company.settings,
        ...updates.settings,
      };
    }

    await company.save();
    res.status(200).json({ success: true, data: company });
  });

  // ── Telegram Webhook ────────────────────────
  updateTelegramWebhook = this.catchAsync(async (req, res) => {
    const { webhookUrl } = req.body || {};
    if (!webhookUrl || typeof webhookUrl !== 'string') {
      return res.status(400).json({ success: false, message: 'webhookUrl is required' });
    }

    let parsed;
    try { parsed = new URL(webhookUrl); } catch {
      return res.status(400).json({ success: false, message: 'webhookUrl must be a valid URL' });
    }

    if (parsed.protocol !== 'https:') {
      return res.status(400).json({ success: false, message: 'Telegram webhookUrl must start with https://' });
    }
    const host = (parsed.hostname || '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) {
      return res.status(400).json({ success: false, message: 'Telegram webhookUrl cannot be localhost' });
    }

    const company = await companyRepo.model.findById(req.user.companyId);
    if (!company) return res.status(404).json({ success: false, message: 'Company not found' });

    const botToken = company.channelsConfig?.telegram?.botToken;
    if (!botToken) {
      return res.status(400).json({ success: false, message: 'Telegram bot token is not configured' });
    }

    company.channelsConfig.telegram = {
      ...company.channelsConfig.telegram,
      webhookUrl,
    };
    await company.save();

    const secret = company.channelsConfig?.telegram?.webhookSecret || null;
    let tgResult;
    try {
      tgResult = await telegramService.setWebhook(botToken, webhookUrl, secret);
    } catch (err) {
      const details = err.response?.data || err.message;
      const description =
        (typeof details === 'object' && details ? details.description : null) ||
        (typeof details === 'string' ? details : null);
      return res.status(502).json({
        success: false,
        message: description ? `Failed to set Telegram webhook: ${description}` : 'Failed to set Telegram webhook',
        error: details,
      });
    }

    return res.status(200).json({
      success: true,
      data: { webhookUrl, telegram: tgResult },
      message: 'Telegram webhook updated',
    });
  });

  // ── Managers List ────────────────────────────
  listTeamLeaders = this.catchAsync(async (req, res) => {
    const teamLeaders = await userRepo.model.find({
      companyId: req.user.companyId,
      role: ROLES.TEAM_LEADER,
    }).select('-passwordHash');

    res.status(200).json({ success: true, count: teamLeaders.length, data: teamLeaders });
  });

  listAgents = this.catchAsync(async (req, res) => {
    const agents = await userRepo.model.find({
      companyId: req.user.companyId,
      role: ROLES.AGENT,
    }).select('-passwordHash').populate('teamLeaderId', 'name email');

    res.status(200).json({ success: true, count: agents.length, data: agents });
  });

  // ── Existing Manager Endpoints ──────────────
  listAuditLogs = this.catchAsync(async (req, res) => {
    const result = await listAuditLogs(req.companyId, req.query);
    this.sendSuccess(res, result, 'Audit logs retrieved');
  });

  getRbacMatrix = this.catchAsync(async (req, res) => {
    this.sendSuccess(res, { matrix: RBAC_MATRIX, roleLabels: ROLE_LABELS }, 'RBAC matrix');
  });

  exportCalls = this.catchAsync(async (req, res) => {
    const csv = await exportCallsCsv(req.companyId, req.query);
    const filename = `calls-export-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
  });

  exportTickets = this.catchAsync(async (req, res) => {
    const csv = await exportTicketsCsv(req.companyId, req.query);
    const filename = `tickets-export-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
  });

  exportAnalyticsSummary = this.catchAsync(async (req, res) => {
    const csv = await exportAnalyticsSummaryCsv(req.companyId, req.query);
    const filename = `analytics-summary-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
  });
}

export default new ManagerController();
