import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../../repositories/index.js';
import axios from 'axios';
import { Company, User, ChatSession, Ticket } from '../../models/index.js';
import chatSessionManager from '../chat/chatSessionManager.js';
import messageProcessor from '../chat/messageProcessor.js';
import telegramService from '../telegramService.js';
import qaService from '../qaService.js';
import { logEvent } from '../eventLogService.js';
import { ROLES, EVENT_TYPES, CHANNELS, TICKET_PRIORITY, TICKET_STATUS } from '../../constants/index.js';
import config from '../../config/index.js';
import { getIO } from '../../sockets/index.js';

class TelegramWebhookService {
  async sendTelegramMessage(botToken, chatId, text, replyMarkup = null) {
    try {
      const payload = {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
      };
      if (replyMarkup) payload.reply_markup = replyMarkup;
      await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, payload);
    } catch (err) {
      console.error('Telegram send error:', err.response?.data || err.message);
      try {
        const payload = { chat_id: chatId, text };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, payload);
      } catch (retryErr) {
        console.error('Telegram send retry error:', retryErr.response?.data || retryErr.message);
      }
    }
  }

  async processWebhook(body, query, headers) {
    const { message, callback_query } = body;

    // Support multiple webhook providers:
    // - query ?companySlug=...
    // - header x-company-slug
    // - body.companySlug (some relay/proxy setups)
    const providedSlug =
      query?.companySlug ||
      headers?.['x-company-slug'] ||
      body?.companySlug ||
      null;

    let company = null;
    if (providedSlug) {
      company = await companyRepo.findOne({ slug: providedSlug, isActive: true });
      if (!company) {
        return { ok: true, error: 'Company not found' };
      }
    } else {
      // Fallback: if only one active company has Telegram configured, use it.
      // This avoids "silent no reply" when webhook URL misses companySlug.
      const fallbackCompanies = await companyRepo.model.find({
        isActive: true,
        'channelsConfig.telegram.isActive': true,
        'channelsConfig.telegram.botToken': { $exists: true, $ne: '' },
      })
        .select('_id slug channelsConfig.telegram.botToken')
        .limit(2);

      if (fallbackCompanies.length === 1) {
        company = fallbackCompanies[0];
      } else {
        console.warn(
          '[TelegramWebhook] Missing companySlug and cannot resolve unique company. ' +
            `Candidates: ${fallbackCompanies.length}`
        );
        return { ok: true, error: 'No company slug provided' };
      }
    }

    const botToken = company.channelsConfig?.telegram?.botToken;
    if (!botToken) return { ok: true, error: 'Telegram bot token not configured' };

    if (callback_query) {
      const data = callback_query.data;
      const chatId = callback_query.message.chat.id.toString();

      let user = await userRepo.findOne({ companyId: company._id, telegramChatId: chatId });

      if (data && data.startsWith('feedback:')) {
        const parts = data.split(':');
        if (parts.length === 3) {
          const ticketId = parts[1];
          const rating = parseInt(parts[2], 10);
          if (user) {
            try {
              const { default: ticketService } = await import('../ticketService.js');
              await ticketService.submitFeedback(company._id, ticketId, user._id, { rating });
              await this.sendTelegramMessage(botToken, chatId, `شكراً لك! تم تسجيل تقييمك (${rating} ⭐) بنجاح.`, { remove_keyboard: true });
            } catch (err) {
              console.error('[Feedback Callback Error]:', err.message);
            }
          }
        }
      } 
      try {
        await axios.post(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, { callback_query_id: callback_query.id });
      } catch(e) {}

            return { ok: true };
    }

    if (!message || (!message.text && !message.photo && !message.voice && !message.audio && !message.document)) {
      return { ok: true };
    }

    const chatId = message.chat.id.toString();
    const text = message.text ? message.text.trim() : (message.caption || '').trim();
    const from = message.from;

    const photo = message.photo;
    const voice = message.voice || message.audio;
    const document = message.document;

    let user = await userRepo.findOne({ companyId: company._id, telegramChatId: chatId });

    if (!user) {
      const telegramName = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'Telegram User';
      const email = `tg_${chatId}@telegram.placeholder`;

      user = await userRepo.create({
        companyId: company._id,
        name: telegramName,
        email,
        passwordHash: `tg_${Date.now()}_${Math.random().toString(36)}`,
        role: ROLES.CUSTOMER,
        telegramChatId: chatId,
        onboardingStep: 0,
      });
    }

    if (text === '/start') {
      const activeSession = await chatSessionRepo.findOne({
        companyId: company._id,
        userId: user._id,
        channel: CHANNELS.TELEGRAM,
        status: 'active',
      });

      if (activeSession) {
        activeSession.status = 'closed';
        activeSession.isAgentHandling = false;
        activeSession.endedAt = new Date();
        await activeSession.save();
      }

      user.onboardingStep = 0;
      await user.save();

      const menuMarkup = {
        keyboard: [
          [{ text: '💬 تحدث مع المساعد الذكي' }],
          [{ text: '🎫 تذكرة دعم فني' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };

      await this.sendTelegramMessage(
        botToken,
        chatId,
        `أهلاً بيك يا ${from.first_name || ''}! منور برايم ستور ⚽\nتحب أساعدك إزاي؟`,
        menuMarkup
      );
      return { ok: true };
    }

    if (text === '❌ إنهاء المحادثة') {
      user.onboardingStep = 5;
      await user.save();
      await this.sendTelegramMessage(
        botToken,
        chatId,
        "هل أنت متأكد من أنك تريد إنهاء هذه المحادثة وإغلاق التذكرة؟",
        {
          keyboard: [
            [{ text: '✅ نعم، إنهاء المحادثة' }, { text: '🚫 لا، أريد الاستمرار' }]
          ],
          resize_keyboard: true,
          one_time_keyboard: true
        }
      );
      return { ok: true };
    }

    if (user.onboardingStep === 5) {
      if (text === '✅ نعم، إنهاء المحادثة') {
        const activeSession = await chatSessionRepo.findOne({
          companyId: company._id,
          userId: user._id,
          channel: CHANNELS.TELEGRAM,
          status: 'active',
        });

        if (activeSession) {
          activeSession.status = 'closed';
          activeSession.isAgentHandling = false;
          activeSession.endedAt = new Date();
          await activeSession.save();
        }

        const ticketsToResolve = await ticketRepo.model.find({
          companyId: company._id,
          userId: user._id,
          status: { $in: [TICKET_STATUS.PENDING, TICKET_STATUS.OPENED] }
        });

        if (ticketsToResolve.length > 0) {
          const messages = activeSession?.messages || [];
          
          for (const t of ticketsToResolve) {
            t.status = TICKET_STATUS.CLOSED;
            t.resolvedAt = new Date();
            t.context.analysisStatus = 'pending';
            if (messages.length > 0) {
              t.context.conversationSnapshot = messages;
            }
            await t.save();
            
            // Trigger automated QA analysis
            qaService.analyzeAndSaveByTicketId(company._id, t._id).catch((err) => {
              console.error(`[QA Auto] Failed for ticket ${t.ticketNumber}:`, err.message);
            });
            this.sendFeedbackRequest(company._id, t._id).catch((err) => {
              console.error(`[Feedback] Failed for ticket ${t.ticketNumber}:`, err.message);
            });
          }
        }

                user.onboardingStep = 0;
        await user.save();

        await this.sendTelegramMessage(botToken, chatId, "تم إنهاء المحادثة وإغلاق التذكرة. لبدء محادثة جديدة، اضغط على /start", { remove_keyboard: true });
        return { ok: true };
      } else if (text === '🚫 لا، أريد الاستمرار') {
        user.onboardingStep = 4;
        await user.save();
        await this.sendTelegramMessage(botToken, chatId, "تم التراجع. يمكنك متابعة المحادثة الآن. 😊", {
          keyboard: [[{ text: '❌ إنهاء المحادثة' }]],
          resize_keyboard: true
        });
        return { ok: true };
      } else {
        await this.sendTelegramMessage(botToken, chatId, "يرجى الاختيار من القائمة لتأكيد أو إلغاء إنهاء المحادثة.");
        return { ok: true };
      }
    }

    if (user.onboardingStep === 0) {
      if (text === '💬 تحدث مع المساعد الذكي') {
        user.onboardingStep = 4;
        await user.save();
        await this.sendTelegramMessage(
          botToken, 
          chatId, 
          "أنا المساعد الذكي لـ برايم ستور، هساعدك تلاقي التيشرت أو الشوز اللي بتدور عليه.. اسألني في أي حاجة معاك!", 
          {
            keyboard: [[{ text: '❌ إنهاء المحادثة' }]],
            resize_keyboard: true
          }
        );
        return { ok: true };
      } else if (text === '🎫 تذكرة دعم فني') {
        const activeTicket = await ticketRepo.findOne({
          companyId: company._id,
          userId: user._id,
          status: { $in: [TICKET_STATUS.PENDING, TICKET_STATUS.OPENED] }
        });

        if (activeTicket) {
          user.onboardingStep = 4;
          await user.save();
          await this.sendTelegramMessage(
            botToken, 
            chatId, 
            `لديك بالفعل تذكرة مفتوحة قيد المعالجة (رقم التذكرة: ${activeTicket.ticketNumber}). لقد تمت إعادتك للمحادثة الحالية. \nيمكنك استخدام زر إنهاء المحادثة أدناه إذا أردت إغلاقها وفتح تذكرة جديدة.`,
            {
              keyboard: [[{ text: '❌ إنهاء المحادثة' }]],
              resize_keyboard: true
            }
          );
          return { ok: true };
        }

        user.onboardingStep = 1;
        await user.save();
        await this.sendTelegramMessage(botToken, chatId, "مرحباً بك! لفتح تذكرة دعم فني، من فضلك أدخل اسمك الكامل:", { remove_keyboard: true });
        return { ok: true };
      }

      await this.sendTelegramMessage(botToken, chatId, "يرجى اختيار أحد الخيارات من القائمة، أو الضغط على /start للبدء من جديد.", {
        keyboard: [
          [{ text: '💬 تحدث مع المساعد الذكي' }],
          [{ text: '🎫 تذكرة دعم فني' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      });
      return { ok: true };
    }

    if (user.onboardingStep === 1) {
      user.name = text;
      user.onboardingStep = 2;
      await user.save();
      await this.sendTelegramMessage(botToken, chatId, `شكراً يا ${user.name}، يرجى إدخال رقم هاتفك المحمول:`);
      return { ok: true };
    }

    if (user.onboardingStep === 2) {
      const phoneRegex = /^(?:\+20|0)?(10|11|12|15)\d{8}$/;
      if (!phoneRegex.test(text)) {
        await this.sendTelegramMessage(botToken, chatId, 'الرقم غير صحيح! يرجى التأكد من إدخال رقم موبايل مصري مكون من 11 رقم (يجب أن يبدأ بـ 01).');
        return { ok: true };
      }
      user.phone = text;
      user.onboardingStep = 3;
      await user.save();

      const categoryMarkup = {
        keyboard: [
          [{ text: '👕 تيشرتات رياضية' }, { text: '👟 أحذية كرة قدم' }],
          [{ text: '📦 متابعة طلب' }, { text: '⚙️ أخرى' }],
          [{ text: '❌ إلغاء' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      };
      await this.sendTelegramMessage(botToken, chatId, 'ممتاز! من فضلك اختر القسم المتعلق بمشكلتك:', categoryMarkup);
      return { ok: true };
    }

    if (user.onboardingStep === 3) {
      if (text === '❌ إلغاء' || text === '❌ Cancel') {
        user.onboardingStep = 0;
        await user.save();
        await this.sendTelegramMessage(botToken, chatId, "تم الإلغاء. يمكنك البدء من جديد بكتابة /start", { remove_keyboard: true });
        return { ok: true };
      }

            const validCategories = ['👕 تيشرتات رياضية', '👟 أحذية كرة قدم', '📦 متابعة طلب', '⚙️ أخرى'];
      if (!validCategories.includes(text)) {
        await this.sendTelegramMessage(botToken, chatId, 'يرجى اختيار أحد الأقسام من القائمة أو الضغط على إلغاء.');
        return { ok: true };
      }

      user.onboardingStep = 4;
      user.tempCategory = text;
      await user.save();

      const chatMarkup = {
        keyboard: [
          [{ text: '❌ إنهاء المحادثة' }]
        ],
        resize_keyboard: true
      };

      const categoryMap = {
        '👕 تيشرتات رياضية': 'tshirts',
        '👟 أحذية كرة قدم': 'shoes',
        '📦 متابعة طلب': 'orders',
        '⚙️ أخرى': 'other'
      };
      const mappedCategory = categoryMap[text] || 'other';

      const ticketNumber = await messageProcessor.generateTicketNumber(company._id);
      const ticket = await ticketRepo.create({
        companyId: company._id,
        ticketNumber,
        userId: user._id,
        channel: CHANNELS.TELEGRAM,
        category: mappedCategory,
        priority: TICKET_PRIORITY.MEDIUM,
        status: TICKET_STATUS.PENDING,
        context: {
          sessionId: null, 
          lastUserMessage: 'Initial Ticket Category Selection',
          aiSummary: `Ticket created for category: ${text}`,
        },
      });

      await this.sendTelegramMessage(
        botToken, 
        chatId, 
        `تم اختيار قسم "${text}" وجاري توجيهك. \nرقم تذكرتك الدائم هو (${ticket.ticketNumber}).\n\nمرحباً بك يا ${user.name}، أنا هنا لمساعدتك! ما هي تفاصيل استفسارك أو مشكلتك؟\n\n💡ملاحظة: يمكنك التحدث مع موظف خدمة العملاء في أي وقت بكتابة "حولني لموظف".`,
        chatMarkup
      );
      return { ok: true };
    }

    let session = await chatSessionRepo.findOne({
      companyId: company._id,
      userId: user._id,
      channel: CHANNELS.TELEGRAM,
      status: 'active',
    });

    if (!session) {
      session = await chatSessionManager.createSession(company._id, user._id, CHANNELS.TELEGRAM);
      const latestTicket = await ticketRepo.model.findOne({
        companyId: company._id,
        userId: user._id,
        status: { $in: [TICKET_STATUS.PENDING, TICKET_STATUS.OPENED] }
      }).sort({ createdAt: -1 });

      if (latestTicket) {
        latestTicket.context.sessionId = session.sessionId;
        await latestTicket.save();
        session.summary = session.summary || {};
        session.summary.linkedTicketId = latestTicket._id;
        await session.save();
      }
    }

    await logEvent({
      companyId: company._id,
      eventType: EVENT_TYPES.CHANNEL_INBOUND,
      entityType: 'chat_session',
      entityId: session._id,
      metadata: { channel: 'telegram', message: text.substring(0, 200) },
    });

    let mediaInfo = null;
    if (photo) {
      const fileId = photo[photo.length - 1].file_id;
      const download = await telegramService.downloadFile(botToken, fileId, 'uploads/images/');
      mediaInfo = { type: 'image', ...download };
    } else if (voice) {
      const fileId = voice.file_id;
      const download = await telegramService.downloadFile(botToken, fileId, 'uploads/audio/');
      mediaInfo = { type: 'audio', ...download };
    } else if (document) {
      const fileId = document.file_id;
      const download = await telegramService.downloadFile(botToken, fileId, 'uploads/files/');
      mediaInfo = { type: 'file', ...download };
    }

    const userMsg = {
      role: 'user',
      content: text,
      timestamp: new Date(),
      meta: { channel: 'telegram', telegramMessageId: message.message_id },
    };

    if (mediaInfo) {
      userMsg.mediaUrl = mediaInfo.relativeUrl;
      userMsg.mediaType = mediaInfo.type;
      userMsg.fileName = mediaInfo.fileName;
      userMsg.fileSize = mediaInfo.fileSize;
      userMsg.mimeType = mediaInfo.mimeType;
    }

    session.messages.push(userMsg);
    session.messageCount += 1;
    session.lastActivity = new Date();
    await session.save();

    const lastAgentMessage = [...session.messages].reverse().find((m) => m.role === 'agent');
    const idleThreshold = 10 * 60 * 1000; 
    const lastAgentTime = lastAgentMessage?.timestamp ? new Date(lastAgentMessage.timestamp).getTime() : 0;
    const sessionStartTime = new Date(session.lastActivity).getTime();
    const referenceTime = lastAgentTime || sessionStartTime;
    const isAgentIdle = (Date.now() - referenceTime) > idleThreshold;

    if (session.isAgentHandling && !isAgentIdle) {
      try {
        const io = getIO();
        const msgPayload = {
          sessionId: session.sessionId,
          userId: user._id,
          userName: user.name,
          content: text || (userMsg.mediaUrl ? 'Media Attachment' : ''),
          role: 'user',
          channel: 'telegram',
          timestamp: new Date(),
          mediaUrl: userMsg.mediaUrl,
          mediaType: userMsg.mediaType,
          fileName: userMsg.fileName,
          mimeType: userMsg.mimeType,
        };

                io.of('/admin').to(`company:${company._id}`).emit('chat:customerMessage', msgPayload);

        const linkedTicket = await ticketRepo.findOne({
          companyId: company._id,
          'context.sessionId': session.sessionId,
        });
        if (linkedTicket) {
          io.of('/admin')
            .to(`company:${company._id}:ticket:${linkedTicket._id}`)
            .emit('ticket:message:new', {
              ...msgPayload,
              ticketId: linkedTicket._id,
              ticketNumber: linkedTicket.ticketNumber,
            });
        }
      } catch (socketErr) {}
      return { ok: true };
    }

    const userAsksForAgent = /\b(human|agent|person|representative|speak to|talk to|real person)\b|موظف|بشري|كلم حد|اتكلم مع|تواصل مع|عايز حد|حولني|حولنى|دعم فني/i.test(text);

    if (userAsksForAgent) {
      let isNewTicket = false;
      let ticketToEmit = null;

      if (session.summary?.linkedTicketId) {
        const ticket = await ticketRepo.model.findById(session.summary.linkedTicketId);
        if (ticket && ![TICKET_STATUS.CLOSED, TICKET_STATUS.CLOSED].includes(ticket.status)) {
          if (ticket.priority !== TICKET_PRIORITY.HIGH) {
             ticket.priority = TICKET_PRIORITY.HIGH;
             await ticket.save();
          }
          ticketToEmit = ticket;
        }
      }

      if (!ticketToEmit) {
        const ticketNumber = await messageProcessor.generateTicketNumber(company._id);
        const ticket = await ticketRepo.create({
          companyId: company._id,
          ticketNumber,
          userId: user._id,
          channel: CHANNELS.TELEGRAM,
          category: 'other',
          priority: TICKET_PRIORITY.HIGH,
          status: TICKET_STATUS.PENDING,
          context: {
            sessionId: session.sessionId,
            lastUserMessage: text,
            aiSummary: 'User requested human agent escalation via Telegram.',
          },
        });
        session.summary = session.summary || {};
        session.summary.linkedTicketId = ticket._id;
        ticketToEmit = ticket;
        isNewTicket = true;
      }

      await this.sendTelegramMessage(
        botToken,
        chatId,
        "سيتم تحويلك إلى خدمة العملاء. يرجى الانتظار، سيتم الرد عليك فور توفر أحد الموظفين."
      );

      session.messages.push({
        role: 'assistant',
        content: "سيتم تحويلك إلى خدمة العملاء. يرجى الانتظار، سيتم الرد عليك فور توفر أحد الموظفين.",
        timestamp: new Date(),
        meta: { channel: 'telegram', type: 'system_escalation' },
      });
      await session.save();

      try {
        const io = getIO();
        if (isNewTicket) {
          io.of('/admin').to(`company:${company._id}`).emit('ticket:new', {
            ticket: ticketToEmit,
            sessionId: session.sessionId,
            channel: 'telegram',
          });
        } else {
          const msgPayload = {
            sessionId: session.sessionId,
            userId: user._id,
            userName: user.name,
            content: text || '',
            role: 'user',
            channel: 'telegram',
            timestamp: new Date(),
          };
          io.of('/admin').to(`company:${company._id}`).emit('chat:customerMessage', msgPayload);
          io.of('/admin')
            .to(`company:${company._id}:ticket:${ticketToEmit._id}`)
            .emit('ticket:message:new', {
              ...msgPayload,
              ticketId: ticketToEmit._id,
              ticketNumber: ticketToEmit.ticketNumber,
            });
        }
      } catch (e) {}

      return { ok: true };
    }

    let aiAnswer;
    let result;

        if (text || !mediaInfo) {
      result = await messageProcessor.processMessage(
        company._id,
        session.sessionId,
        text || (mediaInfo ? `Sent a ${mediaInfo.type}` : ''),
        CHANNELS.TELEGRAM,
        null,
        true
      );
      aiAnswer = result.aiResponse.answer;
    } else {
      aiAnswer = `أنا استلمت الـ ${mediaInfo.type === 'audio' ? 'رسالة الصوتية' : mediaInfo.type === 'image' ? 'صورة' : 'ملف'} بتاعتك. خليني أشوفها وأساعدك.`;

            session.messages.push({
        role: 'assistant',
        content: aiAnswer,
        timestamp: new Date(),
        meta: { channel: 'telegram', type: 'media_ack' },
      });
      await session.save();
    }

    if (botToken) {
      const options = result?.shouldClose ? { remove_keyboard: true } : undefined;
      await telegramService.sendMessage(botToken, chatId, aiAnswer, options);
    }

    if (result?.shouldClose) {
      session.status = 'closed';
      session.isAgentHandling = false;
      session.endedAt = new Date();
      await session.save();

      if (session.summary?.linkedTicketId) {
        const ticket = await ticketRepo.model.findById(session.summary.linkedTicketId);
        if (ticket && ticket.status !== TICKET_STATUS.CLOSED) {
          ticket.status = TICKET_STATUS.CLOSED;
          ticket.resolvedAt = new Date();
          ticket.context.analysisStatus = 'pending';
          if (session.messages?.length > 0) {
            ticket.context.conversationSnapshot = session.messages;
          }
          await ticket.save();

          // Trigger automated QA analysis
          qaService.analyzeAndSaveByTicketId(company._id, ticket._id).catch((err) => {
            console.error(`[QA Auto] Failed for ticket ${ticket.ticketNumber}:`, err.message);
          });

          // Trigger feedback request
          this.sendFeedbackRequest(company._id, ticket._id).catch((err) => {
            console.error(`[Feedback] Failed for ticket ${ticket.ticketNumber}:`, err.message);
          });
        }
      }

      user.onboardingStep = 0;
      await user.save();
    }

    try {
      const io = getIO();
      if (result?.ticket) {
        io.of('/admin').to(`company:${company._id}`).emit('ticket:new', {
          ticket: result.ticket,
          sessionId: session.sessionId,
          channel: 'telegram',
        });

        // Trigger feedback request if the bot automatically closes the ticket
        if (result.shouldClose) {
          this.sendFeedbackRequest(company._id, result.ticket._id).catch((err) => {
            console.error('[Feedback] sendFeedbackRequest failed:', err.message);
          });
        }
      }
    } catch (socketErr) {}

    return { ok: true };
  }

  async sendFeedbackRequest(companyId, ticketId) {
    try {
      const ticket = await ticketRepo.model.findOne({ _id: ticketId, companyId }).populate('userId');
      if (!ticket || !ticket.userId || !ticket.userId.telegramChatId) return;

      const company = await companyRepo.model.findById(companyId);
      const botToken = company.channelsConfig?.telegram?.botToken || config.telegram.botToken;
      if (!botToken) return;

      const text = "نتمنى أن تكون خدمتنا قد نالت إعجابك. كيف تقيم تجربتك معنا؟";
      
      const replyMarkup = {
        inline_keyboard: [
          [
            { text: '1 ⭐', callback_data: `feedback:${ticketId}:1` },
            { text: '2 ⭐', callback_data: `feedback:${ticketId}:2` },
            { text: '3 ⭐', callback_data: `feedback:${ticketId}:3` },
            { text: '4 ⭐', callback_data: `feedback:${ticketId}:4` },
            { text: '5 ⭐', callback_data: `feedback:${ticketId}:5` }
          ]
        ]
      };

      await this.sendTelegramMessage(botToken, ticket.userId.telegramChatId, text, replyMarkup);
    } catch (err) {
      console.error('[Feedback] Failed to send request:', err.message);
    }
  }
}

export default new TelegramWebhookService();
