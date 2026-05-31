import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../../repositories/index.js';
import { Company, User, ChatSession } from '../../models/index.js';
import chatSessionManager from '../chat/chatSessionManager.js';
import messageProcessor from '../chat/messageProcessor.js';
import { logEvent } from '../eventLogService.js';
import { ROLES, EVENT_TYPES, CHANNELS } from '../../constants/index.js';
import { getIO } from '../../sockets/index.js';

class WhatsappWebhookService {
  async processWebhook(body) {
    const { companySlug, entry } = body;

    const company = await companyRepo.findOne({ slug: companySlug, isActive: true });
    if (!company) {
      return { success: false, message: 'Company not found', data: null };
    }

    const results = [];

    for (const e of entry) {
      for (const change of e.changes) {
        const messages = change.value?.messages || [];
        const contacts = change.value?.contacts || [];

        for (const msg of messages) {
          const phone = msg.from;
          const text = msg.text?.body;
          if (!text) continue;

          const contactName =
            contacts.find((c) => c.wa_id === phone)?.profile?.name || `WhatsApp ${phone}`;

          let user = await userRepo.findOne({ companyId: company._id, phone });
          if (!user) {
            user = await userRepo.create({
              companyId: company._id,
              name: contactName,
              email: `wa_${phone}@whatsapp.placeholder`,
              passwordHash: `wa_${Date.now()}_${Math.random().toString(36)}`,
              role: ROLES.CUSTOMER,
              phone,
            });
          }

          let session = await chatSessionRepo.findOne({
            companyId: company._id,
            userId: user._id,
            channel: CHANNELS.WHATSAPP_MOCK,
            status: 'active',
          });

          if (!session) {
            session = await chatSessionManager.createSession(
              company._id,
              user._id,
              CHANNELS.WHATSAPP_MOCK
            );
          }

          await logEvent({
            companyId: company._id,
            eventType: EVENT_TYPES.CHANNEL_INBOUND,
            entityType: 'chat_session',
            entityId: session._id,
            metadata: { channel: 'whatsapp_mock', message: text.substring(0, 200) },
          });

          const result = await messageProcessor.processMessage(
            company._id,
            session.sessionId,
            text,
            CHANNELS.WHATSAPP_MOCK
          );

          results.push({
            to: phone,
            type: 'text',
            text: { body: result.aiResponse.answer },
            meta: {
              intent: result.aiResponse.detectedIntent,
              confidence: result.aiResponse.confidence,
              escalated: result.escalated,
              ticketNumber: result.ticket?.ticketNumber || null,
            },
          });

          if (result.shouldClose) {
            session.status = 'closed';
            session.endedAt = new Date();
            await session.save();

            if (session.summary?.linkedTicketId) {
              const { Ticket } = await import('../../models/index.js');
              const ticket = await ticketRepo.model.findById(session.summary.linkedTicketId);
              if (ticket && ticket.status !== 'resolved') {
                ticket.status = 'resolved';
                ticket.resolvedAt = new Date();
                await ticket.save();
              }
            }
          }

          try {
            const io = getIO();
            if (result.ticket) {
              io.of('/admin').to(`company:${company._id}`).emit('ticket:new', {
                ticket: result.ticket,
                channel: 'whatsapp_mock',
              });
            }
          } catch (socketErr) {
            console.error('Socket emit error:', socketErr.message);
          }
        }
      }
    }

    return { success: true, replies: results };
  }
}

export default new WhatsappWebhookService();
