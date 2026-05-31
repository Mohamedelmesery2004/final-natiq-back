import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import ticketService from '../services/ticketService.js';
import BaseController from './baseController.js';
import { getIO } from '../sockets/index.js';
import { recordAudit } from '../services/auditLogService.js';

class AdminTicketController extends BaseController {
  listTickets = this.catchAsync(async (req, res) => {
    const result = await ticketService.getTickets(req.companyId, {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
      status: req.query.status,
      priority: req.query.priority,
      category: req.query.category,
      assignedTo: req.query.assignedTo,
      userId: req.query.userId,
    });
    this.sendSuccess(res, result);
  });

  getTicket = this.catchAsync(async (req, res) => {
    const ticket = await ticketService.getTicketById(req.companyId, req.params.ticketId);
    this.sendSuccess(res, { ticket });
  });

  updateTicket = this.catchAsync(async (req, res) => {
    const ticket = await ticketService.updateTicket(
      req.companyId,
      req.params.ticketId,
      req.body,
      req.userId
    );

    try {
      const io = getIO();
      io.of('/admin').to(`company:${req.companyId}`).emit('ticket:updated', {
        ticketId: ticket._id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        assignedTo: ticket.assignedTo,
      });
    } catch (err) {
      console.error('Socket emit error:', err.message);
    }

    await recordAudit({
      companyId: req.companyId,
      actor: req.user,
      action: 'ticket.updated',
      resourceType: 'ticket',
      targetId: ticket._id,
      details: {
        ticketNumber: ticket.ticketNumber,
        patchKeys: Object.keys(req.body || {}),
      },
    });

    this.sendSuccess(res, { ticket }, 'Ticket updated');
  });

  addNote = this.catchAsync(async (req, res) => {
    const ticket = await ticketService.addAgentNote(
      req.companyId,
      req.params.ticketId,
      req.userId,
      req.body.content
    );

    try {
      const io = getIO();
      io.of('/admin').to(`company:${req.companyId}`).emit('ticket:updated', {
        ticketId: ticket._id,
        ticketNumber: ticket.ticketNumber,
        update: 'agent_note_added',
      });
    } catch (err) {
      console.error('Socket emit error:', err.message);
    }

    await recordAudit({
      companyId: req.companyId,
      actor: req.user,
      action: 'ticket.note_added',
      resourceType: 'ticket',
      targetId: ticket._id,
      details: { ticketNumber: ticket.ticketNumber },
    });

    this.sendSuccess(res, { ticket }, 'Note added');
  });
}

export default new AdminTicketController();
