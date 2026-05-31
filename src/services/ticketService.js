import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import { Ticket, TicketFeedback, ChatSession } from '../models/index.js';
import { logEvent } from './eventLogService.js';
import qaService from './qaService.js';
import { EVENT_TYPES, TICKET_STATUS } from '../constants/index.js';
import ApiError from '../utils/apiError.js';

class TicketService {
  async getTickets(companyId, filters = {}) {
    const {
      page = 1,
      limit = 20,
      status,
      priority,
      category,
      assignedTo,
      userId,
    } = filters;

    const query = { companyId };
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (category) query.category = category;
    if (assignedTo) query.assignedTo = assignedTo;
    if (userId) query.userId = userId;

    const total = await ticketRepo.count(query);
    const tickets = await ticketRepo.model.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('userId', 'name email')
      .populate('assignedTo', 'name email');

    return {
      tickets,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getTicketById(companyId, ticketId) {
    const ticket = await ticketRepo.model.findOne({ companyId, _id: ticketId })
      .populate('userId', 'name email phone')
      .populate('assignedTo', 'name email')
      .populate('agentNotes.agentId', 'name email');

    if (!ticket) throw ApiError.notFound('Ticket not found');
    return ticket;
  }

  async updateTicket(companyId, ticketId, updateData, agentId) {
    const ticket = await ticketRepo.findOne({ companyId, _id: ticketId });
    if (!ticket) throw ApiError.notFound('Ticket not found');

    const previousStatus = ticket.status;

    if (updateData.status) ticket.status = updateData.status;
    if (updateData.priority) ticket.priority = updateData.priority;
    if (updateData.category) ticket.category = updateData.category;
    if (updateData.assignedTo !== undefined) ticket.assignedTo = updateData.assignedTo;

    if (updateData.status === TICKET_STATUS.CLOSED && !ticket.resolvedAt) {
      ticket.resolvedAt = new Date();
    }

    if (!ticket.firstResponseAt && ticket.assignedTo) {
      ticket.firstResponseAt = new Date();
    }

    await ticket.save();

    const eventType =
      updateData.status === TICKET_STATUS.CLOSED
        ? EVENT_TYPES.TICKET_RESOLVED
        : EVENT_TYPES.TICKET_UPDATED;

    await logEvent({
      companyId,
      eventType,
      entityType: 'ticket',
      entityId: ticket._id,
      metadata: {
        previousStatus,
        newStatus: ticket.status,
        agentId,
        category: ticket.category,
      },
    });

    // Trigger automated QA analysis asynchronously when resolved
    if (updateData.status === TICKET_STATUS.CLOSED) {
      qaService.analyzeAndSaveByTicketId(companyId, ticketId).catch((err) => {
        console.error(`[QA Automation] Trigger failed for ticket ${ticket.ticketNumber}:`, err.message);
      });

      // Trigger Telegram feedback request if applicable
      if (ticket.channel === 'telegram') {
        import('./channels/telegramWebhookService.js').then(({ default: tgService }) => {
          tgService.sendFeedbackRequest(companyId, ticketId);
        }).catch((err) => {
          console.error(`[Feedback] Telegram feedback trigger failed for ticket ${ticket.ticketNumber}:`, err.message);
        });
      }
    }

    return ticket;
  }

  async addAgentNote(companyId, ticketId, agentId, content) {
    const ticket = await ticketRepo.findOne({ companyId, _id: ticketId });
    if (!ticket) throw ApiError.notFound('Ticket not found');

    ticket.agentNotes.push({
      agentId,
      content,
      createdAt: new Date(),
    });

    if (!ticket.firstResponseAt) {
      ticket.firstResponseAt = new Date();
    }

    await ticket.save();

    await logEvent({
      companyId,
      eventType: EVENT_TYPES.AGENT_REPLIED,
      entityType: 'ticket',
      entityId: ticket._id,
      metadata: { agentId },
    });

    return ticket;
  }

  async getCustomerTickets(companyId, userId, { page = 1, limit = 20 } = {}) {
    const query = { companyId, userId };
    const total = await ticketRepo.count(query);
    const tickets = await ticketRepo.model.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('assignedTo', 'name');

    return {
      tickets,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async submitFeedback(companyId, ticketId, userId, { rating, comment }) {
    const ticket = await ticketRepo.findOne({ _id: ticketId, companyId, userId });
    if (!ticket) throw ApiError.notFound('Ticket not found or does not belong to you');

    if (ticket.status !== TICKET_STATUS.CLOSED && ticket.status !== TICKET_STATUS.CLOSED) {
      throw ApiError.badRequest('Feedback can only be submitted for resolved or closed tickets');
    }

    // Prevent agent from rating their own ticket
    if (ticket.assignedTo && ticket.assignedTo.toString() === userId.toString()) {
      throw ApiError.forbidden('Agents cannot rate their own tickets');
    }

    const existingFeedback = await TicketFeedback.findOne({ ticketId, userId });
    if (existingFeedback) {
      throw ApiError.conflict('Feedback has already been submitted for this ticket');
    }

    const feedback = await TicketFeedback.create({
      companyId,
      ticketId,
      // agentId is null for AI-only tickets — that's valid and intentional
      agentId: ticket.assignedTo || null,
      userId,
      rating,
      comment,
      channel: ticket.channel,
    });

    return feedback;
  }
}

export default new TicketService();
