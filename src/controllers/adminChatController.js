import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import axios from 'axios';
import chatSessionManager from '../services/chat/chatSessionManager.js';
import { ChatSession, User, Company } from '../models/index.js';
import { logEvent } from '../services/eventLogService.js';
import { EVENT_TYPES, CHANNELS } from '../constants/index.js';
import ApiError from '../utils/apiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import config from '../config/index.js';
import { getIO } from '../sockets/index.js';
import { recordAudit } from '../services/auditLogService.js';

const listSessions = asyncHandler(async (req, res) => {
  const { page, limit, status, channel, userId } = req.query;
  const result = await chatSessionManager.getAdminSessions(req.companyId, {
    page: parseInt(page),
    limit: parseInt(limit),
    status,
    channel,
    userId,
  });
  sendSuccess(res, result);
});

const getSessionDetails = asyncHandler(async (req, res) => {
  const session = await chatSessionManager.getSessionById(req.companyId, req.params.sessionId);
  if (!session) {
    throw ApiError.notFound('Session not found');
  }
  sendSuccess(res, { session });
});

const deleteSession = asyncHandler(async (req, res) => {
  await chatSessionManager.deleteSession(req.companyId, req.params.sessionId);
  await recordAudit({
    companyId: req.companyId,
    actor: req.user,
    action: 'chat_session.deleted',
    resourceType: 'chat_session',
    targetId: null,
    details: { sessionId: req.params.sessionId },
  });
  sendSuccess(res, null, 'Session deleted');
});

const takeoverSession = asyncHandler(async (req, res) => {
  const session = await chatSessionRepo.findOne({
    companyId: req.companyId,
    sessionId: req.params.sessionId,
  });
  if (!session) {
    throw ApiError.notFound('Session not found');
  }

  if (session.status !== 'active') {
    session.status = 'active';
    session.endedAt = null;
  }

  session.isAgentHandling = true;
  session.assignedAgent = req.user._id;
  session.messages.push({
    role: 'system',
    content: `Agent ${req.user.name} has taken over this conversation.`,
    timestamp: new Date(),
    meta: { agentId: req.user._id },
  });
  session.lastActivity = new Date();
  await session.save();

  await logEvent({
    companyId: req.companyId,
    eventType: EVENT_TYPES.AGENT_REPLIED,
    entityType: 'chat_session',
    entityId: session._id,
    metadata: { action: 'takeover', agentId: req.user._id },
  });

  const company = await companyRepo.model.findById(req.companyId);
  const customer = await userRepo.model.findById(session.userId);

  if (session.channel === CHANNELS.TELEGRAM && customer?.telegramChatId) {
    const botToken = company?.channelsConfig?.telegram?.botToken;
    try {
      await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: customer.telegramChatId,
        text: `🧑‍💼 Agent *${req.user.name}* has joined the conversation. You're now speaking with a human agent.`,
        parse_mode: 'Markdown',
      });
    } catch (err) {
      console.error('Telegram send error:', err.message);
    }
  }

  sendSuccess(res, { session }, 'Session taken over successfully');
});

const agentReply = asyncHandler(async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    throw ApiError.badRequest('Message is required');
  }

  let session = await chatSessionRepo.findOne({
    companyId: req.companyId,
    sessionId: req.params.sessionId,
  });
  if (!session) {
    throw ApiError.notFound('Session not found');
  }

  if (session.status !== 'active') {
    session.status = 'active';
    session.endedAt = null;
  }

  if (!session.isAgentHandling) {
    session.isAgentHandling = true;
    session.assignedAgent = req.user._id;
  }

  session.messages.push({
    role: 'agent',
    content: message.trim(),
    timestamp: new Date(),
    meta: { agentId: req.user._id, agentName: req.user.name },
  });
  session.messageCount += 1;
  session.lastActivity = new Date();
  await session.save();

  await logEvent({
    companyId: req.companyId,
    eventType: EVENT_TYPES.AGENT_REPLIED,
    entityType: 'chat_session',
    entityId: session._id,
    metadata: { agentId: req.user._id, message: message.substring(0, 200) },
  });

  const company = await companyRepo.model.findById(req.companyId);
  const customer = await userRepo.model.findById(session.userId);

  if (session.channel === CHANNELS.TELEGRAM && customer?.telegramChatId) {
    const botToken = company?.channelsConfig?.telegram?.botToken;
    try {
      await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: customer.telegramChatId,
        text: message.trim(),
        parse_mode: 'Markdown',
      });
    } catch (err) {
      console.error('Telegram send error:', err.message);
    }
  }

  try {
    const io = getIO();
    io.of('/admin').to(`company:${req.companyId}`).emit('chat:agentReply', {
      sessionId: session.sessionId,
      agentId: req.user._id,
      message: message.trim(),
    });
  } catch (err) {
    console.error('Socket emit error:', err.message);
  }

  sendSuccess(res, { session }, 'Message sent');
});

const releaseSession = asyncHandler(async (req, res) => {
  const session = await chatSessionRepo.findOne({
    companyId: req.companyId,
    sessionId: req.params.sessionId,
  });
  if (!session) {
    throw ApiError.notFound('Session not found');
  }

  if (session.status !== 'active') {
    session.status = 'active';
    session.endedAt = null;
  }

  session.isAgentHandling = false;
  session.assignedAgent = null;
  session.messages.push({
    role: 'system',
    content: `Agent ${req.user.name} has left the conversation. AI assistant is now handling.`,
    timestamp: new Date(),
  });
  session.lastActivity = new Date();
  await session.save();

  const company = await companyRepo.model.findById(req.companyId);
  const customer = await userRepo.model.findById(session.userId);

  if (session.channel === CHANNELS.TELEGRAM && customer?.telegramChatId) {
    const botToken = company?.channelsConfig?.telegram?.botToken;
    try {
      await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: customer.telegramChatId,
        text: '🤖 You are now back with the AI assistant. How else can I help you?',
        parse_mode: 'Markdown',
      });
    } catch (err) {
      console.error('Telegram send error:', err.message);
    }
  }

  sendSuccess(res, { session }, 'Session released back to AI');
});

export { listSessions, getSessionDetails, deleteSession, takeoverSession, agentReply, releaseSession };
