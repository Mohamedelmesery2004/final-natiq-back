import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import ticketService from '../services/ticketService.js';
import BaseController from './baseController.js';
import { ChatSession, Ticket } from '../models/index.js';
import ApiError from '../utils/apiError.js';
import { getIO } from '../sockets/index.js';

class TicketController extends BaseController {
  getMyTickets = this.catchAsync(async (req, res) => {
    const { page, limit } = req.query;
    const result = await ticketService.getCustomerTickets(req.companyId, req.userId, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
    });
    this.sendSuccess(res, result);
  });

  customerReply = this.catchAsync(async (req, res) => {
    const { ticketId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      throw ApiError.badRequest('Message content is required');
    }

    // Find the ticket and verify it belongs to this customer
    const ticket = await ticketRepo.findOne({
      _id: ticketId,
      companyId: req.companyId,
      userId: req.userId,
    });
    if (!ticket) throw ApiError.notFound('Ticket not found or does not belong to you');

    // Append the customer message to the linked ChatSession (correct data model)
    let session = null;
    if (ticket.context?.sessionId) {
      session = await chatSessionRepo.findOne({
        companyId: req.companyId,
        sessionId: ticket.context.sessionId,
      });

      if (session) {
        // Reopen session if it was closed
        if (session.status !== 'active') {
          session.status = 'active';
          session.endedAt = null;
        }
        session.messages.push({
          role: 'user',
          content: content.trim(),
          timestamp: new Date(),
          meta: { source: 'web_customer_reply', ticketId },
        });
        session.messageCount += 1;
        session.lastActivity = new Date();
        await session.save();
      }
    }

    // Update ticket's last user message context
    ticket.context = ticket.context || {};
    ticket.context.lastUserMessage = content.trim();
    await ticket.save();

    // Notify agent in real-time
    try {
      const io = getIO();
      const payload = {
        ticketId: ticket._id,
        ticketNumber: ticket.ticketNumber,
        sessionId: ticket.context?.sessionId || null,
        userId: req.userId,
        content: content.trim(),
        role: 'user',
        createdAt: new Date(),
      };
      io.of('/admin').to(`company:${req.companyId}`).emit('ticket:message:new', payload);
      io.of('/admin')
        .to(`company:${req.companyId}:ticket:${ticket._id}`)
        .emit('ticket:message:new', payload);
    } catch (err) {
      console.error('Socket emit error:', err.message);
    }

    this.sendSuccess(res, { ticket, session }, 'Reply sent');
  });

  submitFeedback = this.catchAsync(async (req, res) => {
    const { ticketId } = req.params;
    const { rating, comment } = req.body;

    const feedback = await ticketService.submitFeedback(
      req.companyId,
      ticketId,
      req.userId,
      { rating, comment }
    );

    this.sendSuccess(res, { feedback }, 'Feedback submitted successfully');
  });
}

export default new TicketController();
