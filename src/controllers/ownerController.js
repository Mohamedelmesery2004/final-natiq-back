import { companyRepo, userRepo } from '../repositories/index.js';
import { ROLES } from '../constants/index.js';
import telegramService from '../services/telegramService.js';
import ownerDashboardService from '../services/owner/ownerDashboardService.js';

/**
 * @desc    Get dashboard summary for company owner
 * @route   GET /api/v1/owner/dashboard
 * @access  Private (COMPANY_OWNER)
 */
const getDashboardSummary = async (req, res, next) => {
  try {
    const { companyId } = req.user;
    const dashboard = await ownerDashboardService.getDashboard(companyId, req.query);
    res.status(200).json({ success: true, data: { dashboard } });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get company settings
 * @route   GET /api/v1/owner/settings
 * @access  Private (COMPANY_OWNER)
 */
const getCompanySettings = async (req, res, next) => {
  try {
    const company = await companyRepo.model.findById(req.user.companyId);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    res.status(200).json({
      success: true,
      data: company,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update company settings
 * @route   PUT /api/v1/owner/settings
 * @access  Private (COMPANY_OWNER)
 */
const updateCompanySettings = async (req, res, next) => {
  try {
    const company = await companyRepo.model.findById(req.user.companyId);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    // Merge updates
    const updates = req.body;
    
    if (updates.name) company.name = updates.name;
    if (updates.industry) company.industry = updates.industry;
    
    if (updates.channelsConfig) {
      if (updates.channelsConfig.telegram) {
        company.channelsConfig.telegram = {
          ...company.channelsConfig.telegram,
          ...updates.channelsConfig.telegram
        };
      }
      if (updates.channelsConfig.whatsapp) {
        company.channelsConfig.whatsapp = {
          ...company.channelsConfig.whatsapp,
          ...updates.channelsConfig.whatsapp
        };
      }
      if (updates.channelsConfig.webChat) {
        company.channelsConfig.webChat = {
          ...company.channelsConfig.webChat,
          ...updates.channelsConfig.webChat
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

    res.status(200).json({
      success: true,
      data: company,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update + apply Telegram webhook URL
 * @route   POST /api/v1/owner/telegram/webhook
 * @access  Private (COMPANY_OWNER)
 */
const updateTelegramWebhook = async (req, res, next) => {
  try {
    const { webhookUrl } = req.body || {};

    if (!webhookUrl || typeof webhookUrl !== 'string') {
      return res.status(400).json({ success: false, message: 'webhookUrl is required' });
    }

    let parsed;
    try {
      parsed = new URL(webhookUrl);
    } catch {
      return res.status(400).json({ success: false, message: 'webhookUrl must be a valid URL' });
    }

    // Telegram requires a publicly reachable HTTPS webhook (no localhost/private IP).
    if (parsed.protocol !== 'https:') {
      return res.status(400).json({
        success: false,
        message: 'Telegram webhookUrl must start with https:// (use ngrok or a public domain)',
      });
    }
    const host = (parsed.hostname || '').toLowerCase();
    const isLocalHost =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local');
    if (isLocalHost) {
      return res.status(400).json({
        success: false,
        message: 'Telegram webhookUrl cannot be localhost. Use your ngrok HTTPS URL instead.',
      });
    }

    const company = await companyRepo.model.findById(req.user.companyId);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

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
      data: {
        webhookUrl,
        telegram: tgResult,
      },
      message: 'Telegram webhook updated',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    List all company managers
 * @route   GET /api/v1/owner/managers
 * @access  Private (COMPANY_OWNER)
 */
const listManagers = async (req, res, next) => {
  try {
    const managers = await userRepo.model.find({
      companyId: req.user.companyId,
      role: ROLES.COMPANY_MANAGER,
    }).select('-passwordHash');

    res.status(200).json({
      success: true,
      count: managers.length,
      data: managers,
    });
  } catch (error) {
    next(error);
  }
};

export default {
  getDashboardSummary,
  getCompanySettings,
  updateCompanySettings,
  updateTelegramWebhook,
  listManagers,
};
