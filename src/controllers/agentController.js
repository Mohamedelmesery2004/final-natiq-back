import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import axios from 'axios';
import path from 'path';
import agentDashboardService from '../services/agent/agentDashboardService.js';
import agentProfileService from '../services/agent/agentProfileService.js';
import agentTicketService from '../services/agent/agentTicketService.js';
import agentAnalyticsService from '../services/agent/agentAnalyticsService.js';
import { User, Company, ChatSession } from '../models/index.js';
import { generateToken } from '../middlewares/authMiddleware.js';
import { ROLES, CHANNELS } from '../constants/index.js';
import ApiError from '../utils/apiError.js';
import { getIO } from '../sockets/index.js';
import config from '../config/index.js';
import BaseController from './baseController.js';

class AgentController extends BaseController {

  login = this.catchAsync(async (req, res) => {
    const { email, password, companySlug } = req.body;

    const company = await companyRepo.findOne({ slug: companySlug, isActive: true });
    if (!company) throw ApiError.unauthorized('Invalid company or credentials');

    const user = await userRepo.findOne({ companyId: company._id, email });
    if (!user) throw ApiError.unauthorized('Invalid email or password');
    if (!user.isActive) throw ApiError.unauthorized('Account is deactivated');
    if (
      user.role !== ROLES.AGENT &&
      user.role !== ROLES.TEAM_LEADER &&
      user.role !== ROLES.COMPANY_MANAGER &&
      user.role !== ROLES.COMPANY_OWNER
    ) {
      throw ApiError.forbidden('This login is for agents, team leaders, managers, and company owners');
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) throw ApiError.unauthorized('Invalid email or password');

    user.lastLogin = new Date();
    await user.save();

    const token = generateToken(user);
    this.sendSuccess(res, { user: user.toJSON(), token }, 'Agent login successful');
  });

  getProfile = this.catchAsync(async (req, res) => {
    const user = await userRepo.model.findById(req.userId)
      .select('-passwordHash')
      .populate('companyId', 'name slug');
    if (!user) throw ApiError.notFound('User not found');
    this.sendSuccess(res, { user });
  });

  updateProfile = this.catchAsync(async (req, res) => {
    const updateData = req.body || {};

    if (req.file) {
      updateData.profileImage = `/uploads/${req.file.filename}`;
    }

    if (!Object.keys(updateData).length) {
      throw ApiError.badRequest('No fields to update');
    }

    if (updateData.password) {
      if (!updateData.currentPassword) {
        throw ApiError.badRequest('Current password is required to set a new password');
      }
      const userWithPassword = await userRepo.model.findById(req.userId);
      const isMatch = await userWithPassword.comparePassword(updateData.currentPassword);
      if (!isMatch) throw ApiError.badRequest('Current password is incorrect');
    }

    const updatedUser = await agentProfileService.updateAgentProfile(req.userId, updateData);
    this.sendSuccess(res, { user: updatedUser }, 'Profile updated');
  });

  claimTicket = this.catchAsync(async (req, res) => {
    const ticket = await agentTicketService.claimTicket(req.companyId, req.params.ticketId, req.userId);

    if (ticket.context?.sessionId) {
      const session = await chatSessionRepo.findOne({
        companyId: req.companyId,
        sessionId: ticket.context.sessionId,
      });

      if (session) {
        const customer = await userRepo.model.findById(session.userId);
        const company = await companyRepo.model.findById(req.companyId);

        if (session.channel === CHANNELS.TELEGRAM && customer?.telegramChatId) {
          const botToken = company?.channelsConfig?.telegram?.botToken;
          if (botToken) {
            try {
              await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                chat_id: customer.telegramChatId,
                text: `An agent (*${req.user.name}*) has picked up your ticket *#${ticket.ticketNumber}* and will assist you shortly. Please stay connected!`,
                parse_mode: 'Markdown',
              });
            } catch (err) {
              console.error('Telegram claim notify error:', err.response?.data || err.message);
            }
          }
        }

        if (session.channel === CHANNELS.WEB) {
          try {
            const io = getIO();
            io.of('/webchat').to(`session:${session.sessionId}`).emit('chat:message', {
              sessionId: session.sessionId,
              message: {
                role: 'system',
                content: `Agent ${req.user.name} has joined the conversation and will assist you.`,
                timestamp: new Date(),
                meta: { type: 'agent_claimed', agentId: req.userId, agentName: req.user.name },
              },
            });
          } catch (err) {
            console.error('Socket emit error:', err.message);
          }
        }
      }
    }

    try {
      const io = getIO();
      io.of('/admin').to(`company:${req.companyId}`).emit('ticket:assigned', {
        ticketId: ticket._id,
        ticketNumber: ticket.ticketNumber,
        agentId: req.userId,
        agentName: req.user.name,
      });
    } catch (err) {
      console.error('Socket emit error:', err.message);
    }

    this.sendSuccess(res, { ticket }, 'Ticket claimed');
  });

  replyToTicket = this.catchAsync(async (req, res) => {
    const { ticket, session } = await agentTicketService.agentReplyToTicket(
      req.companyId,
      req.params.ticketId,
      req.userId,
      req.body.content
    );

    if (session) {
      if (session.channel === CHANNELS.WEB) {
        try {
          const io = getIO();
          io.of('/webchat').to(`session:${session.sessionId}`).emit('chat:message', {
            sessionId: session.sessionId,
            message: {
              role: 'agent',
              content: req.body.content,
              timestamp: new Date(),
              meta: { agentId: req.userId, agentName: req.user.name },
            },
          });
        } catch (err) {
          console.error('Socket emit error:', err.message);
        }
      }
    }

    try {
      const io = getIO();
      const payload = {
        ticketId: ticket._id,
        ticketNumber: ticket.ticketNumber,
        sessionId: session?.sessionId || null,
        agentId: req.userId,
        agentName: req.user.name,
        content: req.body.content,
        role: 'agent',
        createdAt: new Date(),
      };
      io.of('/admin').to(`company:${req.companyId}:ticket:${ticket._id}`).emit('ticket:message:new', payload);
      io.of('/admin').to(`company:${req.companyId}`).emit('ticket:message:new', payload);
    } catch (err) {
      console.error('Socket emit error:', err.message);
    }

    this.sendSuccess(res, { ticket }, 'Reply sent');
  });

  replyMediaToTicket = this.catchAsync(async (req, res) => {
    const { ticketId } = req.params;
    const { content } = req.body;

    if (!req.file) {
      throw ApiError.badRequest('No media file provided');
    }

    const mediaType = req.file.mimetype.startsWith('image/') ? 'image' :
                     req.file.mimetype.startsWith('video/') ? 'video' :
                     req.file.mimetype.startsWith('audio/') ? 'audio' : 'file';

    const relativePath = path.relative(process.cwd(), req.file.path);
    const mediaUrl = `/${relativePath.replace(/\\/g, '/')}`;

    const media = {
      url: mediaUrl,
      type: mediaType,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
    };

    const { ticket, session } = await agentTicketService.agentReplyToTicket(
      req.companyId,
      ticketId,
      req.userId,
      content || `[Sent a ${mediaType}: ${req.file.originalname}]`,
      media
    );

    if (session && session.channel === CHANNELS.WEB) {
      try {
        const io = getIO();
        io.of('/webchat').to(`session:${session.sessionId}`).emit('chat:message', {
          sessionId: session.sessionId,
          message: {
            role: 'agent',
            content: content,
            ...media,
            timestamp: new Date(),
            meta: { agentId: req.userId, agentName: req.user.name },
          },
        });
      } catch (err) {
        console.error('Socket emit error:', err.message);
      }
    }

    try {
      const io = getIO();
      const payload = {
        ticketId: ticket._id,
        ticketNumber: ticket.ticketNumber,
        sessionId: session?.sessionId || null,
        agentId: req.userId,
        agentName: req.user.name,
        content: content,
        ...media,
        role: 'agent',
        createdAt: new Date(),
      };
      io.of('/admin').to(`company:${req.companyId}:ticket:${ticket._id}`).emit('ticket:message:new', payload);
      io.of('/admin').to(`company:${req.companyId}`).emit('ticket:message:new', payload);
    } catch (err) {
      console.error('Socket emit error:', err.message);
    }

    this.sendSuccess(res, { ticket }, 'Media reply sent');
  });

  resolveTicket = this.catchAsync(async (req, res) => {
    const ticket = await agentTicketService.resolveTicket(req.companyId, req.params.ticketId, req.userId);

    try {
      const io = getIO();
      io.of('/admin').to(`company:${req.companyId}`).emit('ticket:status:changed', {
        ticketId: ticket._id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        agentId: req.userId,
      });
    } catch (err) {
      console.error('Socket emit error:', err.message);
    }

    this.sendSuccess(res, { ticket }, 'Ticket resolved');
  });

  closeTicket = this.catchAsync(async (req, res) => {
    const ticket = await agentTicketService.closeTicket(req.companyId, req.params.ticketId, req.userId);

    try {
      const io = getIO();
      io.of('/admin').to(`company:${req.companyId}`).emit('ticket:status:changed', {
        ticketId: ticket._id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        agentId: req.userId,
      });
    } catch (err) {
      console.error('Socket emit error:', err.message);
    }

    this.sendSuccess(res, { ticket }, 'Ticket closed');
  });

  listTickets = this.catchAsync(async (req, res) => {
    const result = await agentTicketService.getAgentTickets(req.companyId, req.userId, req.query);
    this.sendSuccess(res, result);
  });

  getTicket = this.catchAsync(async (req, res) => {
    const ticket = await agentTicketService.getAgentTicketById(req.companyId, req.params.ticketId, req.userId);
    this.sendSuccess(res, { ticket });
  });

  getTicketMessages = this.catchAsync(async (req, res) => {
    const data = await agentTicketService.getTicketMessages(req.companyId, req.params.ticketId, req.userId);
    this.sendSuccess(res, data);
  });

  getDashboard = this.catchAsync(async (req, res) => {
    const dashboard = await agentDashboardService.getAgentDashboard(req.companyId, req.userId, req.query);
    this.sendSuccess(res, { dashboard });
  });

  getChatHistory = this.catchAsync(async (req, res) => {
    const { sessionId } = req.params;
    const history = await agentTicketService.getChatHistory(
      req.companyId, 
      sessionId, 
      req.userId, 
      req.query
    );
    this.sendSuccess(res, history);
  });

  getAnalyticsOverview = this.catchAsync(async (req, res) => {
    const data = await agentAnalyticsService.getOverview(req.companyId, req.userId, req.query);
    this.sendSuccess(res, { analytics: data });
  });

  getTicketAnalytics = this.catchAsync(async (req, res) => {
    const data = await agentAnalyticsService.getTicketAnalytics(req.companyId, req.userId, req.query);
    this.sendSuccess(res, { analytics: data });
  });

  getTimeSeries = this.catchAsync(async (req, res) => {
    const data = await agentAnalyticsService.getTimeSeries(req.companyId, req.userId, req.query);
    this.sendSuccess(res, { analytics: data });
  });

  getQualityMetrics = this.catchAsync(async (req, res) => {
    const data = await agentAnalyticsService.getQualityMetrics(req.companyId, req.userId);
    this.sendSuccess(res, { analytics: data });
  });

  getInsights = this.catchAsync(async (req, res) => {
    const data = await agentAnalyticsService.getInsights(req.companyId, req.userId);
    this.sendSuccess(res, { analytics: data });
  });

}

export default new AgentController();
