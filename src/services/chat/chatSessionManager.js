import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../../repositories/index.js';
import { v4 as uuidv4 } from 'uuid';
import { ChatSession } from '../../models/index.js';
import { logEvent } from '../eventLogService.js';
import { CHAT_STATUS, EVENT_TYPES } from '../../constants/index.js';

class ChatSessionManager {
  generateSessionId() {
    const id = uuidv4().replace(/-/g, '').toUpperCase();
    // Use 16 chars for significantly lower collision probability
    return `CHAT-${id.substring(0, 4)}-${id.substring(4, 8)}-${id.substring(8, 12)}`;
  }

  async createSession(companyId, userId, channel = 'web') {
    const MAX_RETRIES = 3;
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const sessionId = this.generateSessionId();
      try {
        const session = await ChatSession.create({
          companyId,
          sessionId,
          userId,
          channel,
          status: CHAT_STATUS.ACTIVE,
          messages: [],
          messageCount: 0,
          startedAt: new Date(),
          lastActivity: new Date(),
        });

        await logEvent({
          companyId,
          eventType: EVENT_TYPES.CHAT_SESSION_CREATED,
          entityType: 'chat_session',
          entityId: session._id,
          metadata: { channel },
        });

        return session;
      } catch (err) {
        // Only retry on duplicate key error (sessionId collision)
        if (err.code === 11000 && attempt < MAX_RETRIES) {
          console.warn(`[ChatSession] sessionId collision on attempt ${attempt}, retrying...`);
          lastError = err;
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  }

  async closeSession(companyId, sessionId) {
    const session = await chatSessionRepo.findOne({ companyId, sessionId });
    if (!session) throw new Error('Session not found');

    session.status = CHAT_STATUS.CLOSED;
    session.endedAt = new Date();
    await session.save();

    return session;
  }

  async getUserSessions(companyId, userId, { page = 1, limit = 20, status } = {}) {
    const filter = { companyId, userId };
    if (status) filter.status = status;

    const total = await ChatSession.countDocuments(filter);
    const sessions = await chatSessionRepo.model.find(filter)
      .sort({ lastActivity: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('-messages');

    return {
      sessions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getAdminSessions(companyId, { page = 1, limit = 20, status, channel, userId } = {}) {
    const filter = { companyId };
    if (status) filter.status = status;
    if (channel) filter.channel = channel;
    if (userId) filter.userId = userId;

    const total = await ChatSession.countDocuments(filter);
    const sessions = await chatSessionRepo.model.find(filter)
      .sort({ lastActivity: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('-messages')
      .populate('userId', 'name email');

    return {
      sessions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getSessionById(companyId, sessionId) {
    return chatSessionRepo.model.findOne({ companyId, sessionId })
      .populate('userId', 'name email')
      .populate('summary.linkedTicketId', 'ticketNumber status')
      .populate('summary.relatedKnowledgeIds', 'title type');
  }

  async deleteSession(companyId, sessionId) {
    const session = await ChatSession.findOneAndDelete({ companyId, sessionId });
    if (!session) throw new Error('Session not found');
    return session;
  }
}

export default new ChatSessionManager();
