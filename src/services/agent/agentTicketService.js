import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../../repositories/index.js';
import { Ticket, User, ChatSession, Company } from '../../models/index.js';
import { getIO } from '../../sockets/index.js';
import { logEvent } from '../eventLogService.js';
import { TICKET_STATUS, EVENT_TYPES, CHANNELS } from '../../constants/index.js';
import ApiError from '../../utils/apiError.js';
import telegramService from '../telegramService.js';
import config from '../../config/index.js';
import qaService from '../qaService.js';

class AgentTicketService {
  async claimTicket(companyId, ticketId, agentId) {
    const ticket = await Ticket.findOneAndUpdate(
      {
        _id: ticketId,
        companyId,
        assignedTo: null,
        status: TICKET_STATUS.PENDING,
      },
      {
        $set: {
          assignedTo: agentId,
          status: TICKET_STATUS.OPENED,
        },
      },
      { new: true }
    )
      .populate('userId', 'name email phone')
      .populate('assignedTo', 'name email');

    if (!ticket) {
      const existing = await ticketRepo.findOne({ _id: ticketId, companyId });
      if (!existing) throw ApiError.notFound('Ticket not found');
      if (existing.assignedTo) throw ApiError.conflict('Ticket is already assigned to another agent');
      if (existing.status !== TICKET_STATUS.PENDING) throw ApiError.conflict(`Ticket status is '${existing.status}', cannot claim`);
      throw ApiError.conflict('Ticket cannot be claimed');
    }

    if (ticket.channel === CHANNELS.TELEGRAM && ticket.userId) {
      try {
        const company = await companyRepo.model.findById(companyId);
        const botToken = company.channelsConfig?.telegram?.botToken;
        const user = await userRepo.model.findById(ticket.userId._id);

                if (user && user.telegramChatId && botToken) {
          await telegramService.sendMessage(
            botToken,
            user.telegramChatId,
            `تم استلام استفسارك/مشكلتك. سيتواصل معك فريق الدعم قريبا. الموظف (${ticket.assignedTo.name}) دخل المحادثة الآن لمساعدتك.`
          );
        }
      } catch (err) {
        console.error('Failed to send Telegram claim notification:', err.message);
      }
    }

    await logEvent({
      companyId,
      eventType: EVENT_TYPES.TICKET_CLAIMED,
      entityType: 'ticket',
      entityId: ticket._id,
      metadata: { agentId, ticketNumber: ticket.ticketNumber },
    });

    if (ticket.context?.sessionId) {
      const claimMsgContent = `تم استلام استفسارك. الموظف (${ticket.assignedTo.name}) دخل المحادثة الآن لمساعدتك.`;
      const claimMsg = {
        role: 'system',
        content: claimMsgContent,
        timestamp: new Date()
      };

      await ChatSession.findOneAndUpdate(
        { companyId, sessionId: ticket.context.sessionId },
        {
          $set: {
            isAgentHandling: true,
            assignedAgent: agentId,
          },
          $push: {
            messages: claimMsg
          },
          $inc: { messageCount: 1 }
        }
      );

      if (ticket.channel === CHANNELS.WEB) {
        try {
          getIO().of('/webchat').to(`session:${ticket.context.sessionId}`).emit('chat:message', {
            sessionId: ticket.context.sessionId,
            message: claimMsg,
          });
        } catch (err) {
          console.error('Failed to emit Web Chat claim notification:', err.message);
        }
      }
    }

    return ticket;
  }

  async agentReplyToTicket(companyId, ticketId, agentId, content, media = null) {
    const ticket = await ticketRepo.findOne({ _id: ticketId, companyId, assignedTo: agentId });
    if (!ticket) throw ApiError.forbidden('You can only reply to tickets assigned to you');

    ticket.agentNotes.push({
      agentId,
      content,
      createdAt: new Date(),
    });

    if (!ticket.firstResponseAt) {
      ticket.firstResponseAt = new Date();
    }

    if (ticket.status === TICKET_STATUS.PENDING) {
      ticket.status = TICKET_STATUS.OPENED;
    }

    await ticket.save();

    let session = null;
    if (ticket.context?.sessionId) {
      session = await chatSessionRepo.findOne({ companyId, sessionId: ticket.context.sessionId });
      if (session) {
        if (!session.isAgentHandling) {
          session.isAgentHandling = true;
          session.assignedAgent = agentId;
        }
        if (session.status !== 'active') {
          session.status = 'active';
          session.endedAt = null;
        }
        const msg = {
          role: 'agent',
          content,
          timestamp: new Date(),
          meta: { agentId, fromTicket: ticketId },
        };

        if (media) {
          msg.mediaUrl = media.url;
          msg.mediaType = media.type;
          msg.fileName = media.fileName;
          msg.fileSize = media.fileSize;
          msg.mimeType = media.mimeType;
        }

        session.messages.push(msg);
        session.messageCount += 1;
        session.lastActivity = new Date();
        await session.save();

        if (session.channel === CHANNELS.TELEGRAM) {
          const company = await companyRepo.model.findById(companyId);
          const botToken = company.channelsConfig?.telegram?.botToken;
          const user = await userRepo.model.findById(session.userId);

          if (user?.telegramChatId && botToken) {
            if (media) {
              await telegramService.sendMedia(botToken, user.telegramChatId, media.url, content, media.type);
            } else {
              await telegramService.sendMessage(botToken, user.telegramChatId, content);
            }
          }
        }
      }
    }

    await logEvent({
      companyId,
      eventType: EVENT_TYPES.AGENT_REPLIED,
      entityType: 'ticket',
      entityId: ticket._id,
      metadata: { agentId, message: content.substring(0, 200) },
    });

    return { ticket, session };
  }

  async getTicketMessages(companyId, ticketId, agentId) {
    const ticket = await ticketRepo.findOne({
      _id: ticketId,
      companyId,
      $or: [
        { assignedTo: agentId },
        { assignedTo: null }
      ]
    });
    if (!ticket) throw ApiError.notFound('Ticket not found or not accessible');

    if (!ticket.context?.sessionId) {
      return { messages: [], sessionId: null };
    }

    const session = await chatSessionRepo.model.findOne({
      companyId,
      sessionId: ticket.context.sessionId,
    }).populate('userId', 'name email');

    if (!session) {
      return { messages: [], sessionId: ticket.context.sessionId };
    }

    return {
      messages: session.messages,
      sessionId: session.sessionId,
      channel: session.channel,
      customer: session.userId,
      status: session.status,
      isAgentHandling: session.isAgentHandling,
    };
  }

  async getChatHistory(companyId, sessionId, agentId, options = {}) {
    const { page = 1, limit = 50, before, after, messageType } = options;

    const session = await chatSessionRepo.findOne({
      companyId,
      sessionId,
    }).populate('userId', 'name email');

    if (!session) {
      throw ApiError.notFound('Chat session not found');
    }

    const linkedTicket = await ticketRepo.findOne({
      companyId,
      'context.sessionId': sessionId,
      assignedTo: agentId,
    });

    if (!linkedTicket) {
      throw ApiError.forbidden('Access denied: this session is not linked to one of your tickets');
    }

    const messageQuery = {};
    if (before) {
      messageQuery.timestamp = { $lt: new Date(before) };
    }
    if (after) {
      messageQuery.timestamp = { ...messageQuery.timestamp, $gt: new Date(after) };
    }
    if (messageType) {
      messageQuery.role = messageType;
    }

    let messages = session.messages;

    if (Object.keys(messageQuery).length > 0) {
      messages = messages.filter(msg => {
        if (messageQuery.timestamp) {
          if (messageQuery.timestamp.$lt && msg.timestamp >= messageQuery.timestamp.$lt) return false;
          if (messageQuery.timestamp.$gt && msg.timestamp <= messageQuery.timestamp.$gt) return false;
        }
        if (messageQuery.role && msg.role !== messageQuery.role) return false;
        return true;
      });
    }

    messages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const total = messages.length;
    const startIndex = (page - 1) * limit;
    const paginatedMessages = messages.slice(startIndex, startIndex + limit);

    paginatedMessages.reverse();

    return {
      messages: paginatedMessages,
      session: {
        sessionId: session.sessionId,
        channel: session.channel,
        customer: session.userId,
        status: session.status,
        isAgentHandling: session.isAgentHandling,
        assignedAgent: session.assignedAgent,
        messageCount: session.messageCount,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
      },
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasMore: startIndex + limit < total,
      },
      linkedTicket: linkedTicket ? {
        ticketId: linkedTicket._id,
        ticketNumber: linkedTicket.ticketNumber,
        status: linkedTicket.status,
        priority: linkedTicket.priority,
        category: linkedTicket.category,
      } : null,
    };
  }

  async resolveTicket(companyId, ticketId, agentId) {
    const ticket = await ticketRepo.findOne({ _id: ticketId, companyId, assignedTo: agentId });
    if (!ticket) throw ApiError.forbidden('You can only resolve tickets assigned to you');

    if (ticket.status === TICKET_STATUS.CLOSED || ticket.status === TICKET_STATUS.CLOSED) {
      throw ApiError.badRequest(`Ticket is already ${ticket.status}`);
    }

    ticket.status = TICKET_STATUS.CLOSED;
    if (!ticket.resolvedAt) ticket.resolvedAt = new Date();
    if (!ticket.context) ticket.context = {};
    ticket.context.analysisStatus = 'pending';
    await ticket.save();

    await logEvent({
      companyId,
      eventType: EVENT_TYPES.TICKET_RESOLVED,
      entityType: 'ticket',
      entityId: ticket._id,
      metadata: { agentId, ticketNumber: ticket.ticketNumber },
    });

    qaService.analyzeAndSaveByTicketId(companyId, ticketId).catch((err) => {
      console.error(`[QA Automation] Resolve trigger failed for ticket ${ticket.ticketNumber}:`, err.message);
    });

    await this.sendFeedbackPromptToCustomer(ticket, companyId);

    return ticket;
  }

  async closeTicket(companyId, ticketId, agentId) {
    const ticket = await ticketRepo.findOne({ _id: ticketId, companyId, assignedTo: agentId });
    if (!ticket) throw ApiError.forbidden('You can only close tickets assigned to you');

    if (ticket.status === TICKET_STATUS.CLOSED) {
      throw ApiError.badRequest('Ticket is already closed');
    }

    ticket.status = TICKET_STATUS.CLOSED;
    if (!ticket.resolvedAt) ticket.resolvedAt = new Date();
    await ticket.save();

    // Close the linked ChatSession to keep data consistent
    if (ticket.context?.sessionId) {
      await ChatSession.findOneAndUpdate(
        { companyId, sessionId: ticket.context.sessionId, status: 'active' },
        {
          $set: {
            status: 'closed',
            endedAt: new Date(),
            isAgentHandling: false,
          },
        }
      );
    }

    await logEvent({
      companyId,
      eventType: EVENT_TYPES.TICKET_CLOSED,
      entityType: 'ticket',
      entityId: ticket._id,
      metadata: { agentId, ticketNumber: ticket.ticketNumber },
    });

    await this.sendFeedbackPromptToCustomer(ticket, companyId);

    // Trigger auto-analysis in the background
    qaService.analyzeAndSaveByTicketId(companyId, ticketId)
      .catch(err => console.error(`Failed to auto-analyze ticket ${ticketId} on close:`, err.message));

    return ticket;
  }

  async sendFeedbackPromptToCustomer(ticket, companyId) {
    if (!ticket.context?.sessionId) return;
    const session = await chatSessionRepo.findOne({ sessionId: ticket.context.sessionId });
    if (!session) return;
    const company = await companyRepo.model.findById(companyId);
    if (!company) return;

    const promptText = `Your ticket #${ticket.ticketNumber} has been resolved.\nPlease rate your support experience from 1 to 5.`;

    if (session.channel === CHANNELS.TELEGRAM) {
      const customer = await userRepo.model.findById(session.userId);
      if (!customer?.telegramChatId) return;

      const botToken = company.channelsConfig?.telegram?.botToken;
      const axios = (await import('axios')).default;
      try {
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          chat_id: customer.telegramChatId,
          text: promptText,
          reply_markup: {
            inline_keyboard: [
              [
                { text: '1 ⭐', callback_data: `feedback:${ticket._id}:1` },
                { text: '2 ⭐', callback_data: `feedback:${ticket._id}:2` },
                { text: '3 ⭐', callback_data: `feedback:${ticket._id}:3` },
                { text: '4 ⭐', callback_data: `feedback:${ticket._id}:4` },
                { text: '5 ⭐', callback_data: `feedback:${ticket._id}:5` },
              ]
            ]
          }
        });
      } catch (err) {
        console.error('Telegram feedback prompt error:', err.response?.data || err.message);
      }
    }

    if (session.channel === CHANNELS.WEB) {
      try {
        const io = getIO();

        io.of('/webchat').to(`session:${session.sessionId}`).emit('chat:message', {
          sessionId: session.sessionId,
          message: {
            role: 'system',
            content: promptText,
            timestamp: new Date(),
            meta: {
              type: 'feedback_request',
              ticketId: ticket._id
            },
          },
        });
      } catch (err) {
        console.error('Webchat feedback socket error:', err.message);
      }
    }
  }

  async getAgentTickets(companyId, agentId, filters = {}) {
    const { page = 1, limit = 20, status, priority, category, queue, channel, exclude_channel } = filters;

    const query = { companyId };

    if (queue === 'unassigned') {
      query.assignedTo = null;
      query.status = TICKET_STATUS.PENDING;
    } else {
      query.assignedTo = agentId;
    }

    if (status && queue !== 'unassigned') query.status = status;
    if (priority) {
      const priorities = priority.split(',');
      if (priorities.length > 1) query.priority = { $in: priorities };
      else query.priority = priority;
    }
    if (category) query.category = category;
    
    if (channel && channel !== 'all') {
      query.channel = channel;
    } else if (exclude_channel) {
      query.channel = { $ne: exclude_channel };
    }

    const total = await ticketRepo.count(query);
    const tickets = await ticketRepo.model.find(query)
      .select('-agentNotes')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('userId', 'name email')
      .populate('assignedTo', 'name email');

    return {
      tickets,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getAgentTicketById(companyId, ticketId, agentId) {
    const ticket = await ticketRepo.model.findOne({ _id: ticketId, companyId, assignedTo: agentId })
      .populate('userId', 'name email phone')
      .populate('assignedTo', 'name email')
      .populate('agentNotes.agentId', 'name email');

    if (!ticket) throw ApiError.notFound('Ticket not found or not assigned to you');
    return ticket;
  }
}

export default new AgentTicketService();
