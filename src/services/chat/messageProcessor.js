import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../../repositories/index.js';
import { ChatSession, KnowledgeItem, Ticket, Company, User } from '../../models/index.js';
import { generateEmbedding, cosineSimilarity } from '../../utils/embeddings.js';
import { getAIResponse } from '../../utils/ai.js';
import { logEvent } from '../eventLogService.js';
import { CHAT_STATUS, EVENT_TYPES, TICKET_STATUS, TICKET_PRIORITY } from '../../constants/index.js';

class MessageProcessor {
  async generateTicketNumber(companyId) {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = 'NQ'; 

    const lastTicket = await ticketRepo.model.findOne({
      companyId,
      ticketNumber: new RegExp(`^${prefix}-${dateStr}`),
    }).sort({ ticketNumber: -1 });

    let sequence = 1;
    if (lastTicket) {
      const lastSeq = parseInt(lastTicket.ticketNumber.split('-').pop(), 10);
      sequence = lastSeq + 1;
    }

    return `${prefix}-${dateStr}-${String(sequence).padStart(4, '0')}`;
  }

  async findRelevantKnowledge(companyId, queryText, topK = 3) {
    try {
      const queryEmbedding = await generateEmbedding(queryText);

      const items = await KnowledgeItem.find({
        companyId,
        isActive: true,
        embeddingVector: { $exists: true, $ne: [] },
      });

      if (items.length === 0) return [];

      const scored = items.map((item) => ({
        item,
        score: cosineSimilarity(queryEmbedding, item.embeddingVector),
      }));

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, topK).filter((s) => s.score > 0.3);
    } catch (error) {
      console.error('Knowledge retrieval error:', error.message);
      return [];
    }
  }

  async processMessage(companyId, sessionId, userMessage, channel = 'web', media = null, skipUserMessageSave = false) {
    const session = await chatSessionRepo.findOne({ companyId, sessionId, status: CHAT_STATUS.ACTIVE });
    if (!session) {
      throw new Error('Active chat session not found');
    }

    const [company, user, userTickets] = await Promise.all([
      companyRepo.model.findById(companyId),
      userRepo.model.findById(session.userId).select('name email phone role telegramChatId createdAt'),
      ticketRepo.model.find({ companyId, userId: session.userId })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('ticketNumber category priority status createdAt'),
    ]);
    const escalationThreshold = company?.settings?.escalationThreshold || 0.5;

    const msg = {
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
      meta: { channel },
    };

    if (media) {
      msg.mediaUrl = media.url;
      msg.mediaType = media.type;
      msg.fileName = media.fileName;
      msg.fileSize = media.fileSize;
      msg.mimeType = media.mimeType;
    }

    if (!skipUserMessageSave) {
      session.messages.push(msg);
      session.messageCount += 1;
      session.lastActivity = new Date();
    }

    await logEvent({
      companyId,
      eventType: EVENT_TYPES.CHAT_MESSAGE,
      entityType: 'chat_session',
      entityId: session._id,
      metadata: { channel, message: userMessage.substring(0, 200) },
    });

    const relevantKnowledge = await this.findRelevantKnowledge(companyId, userMessage);
    const knowledgeContext = relevantKnowledge.map(
      (k) => `[${k.item.type}] ${k.item.title}: ${k.item.content}`
    );
    const relatedKnowledgeIds = relevantKnowledge.map((k) => k.item._id);

    const userProfile = user
      ? `\n\nCustomer profile:
- Name: ${user.name}
- Email: ${user.email}
- Phone: ${user.phone || 'Not provided'}
- Account since: ${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown'}`
      : '';

    const ticketHistory = userTickets.length > 0
      ? `\n\nCustomer's recent tickets:\n${userTickets.map(
          (t) => `- ${t.ticketNumber} | ${t.category} | ${t.priority} priority | Status: ${t.status} | ${new Date(t.createdAt).toLocaleDateString()}`
        ).join('\n')}`
      : '\n\nCustomer has no previous tickets.';

    const isFirstMessage = session.messages.filter((m) => m.role === 'assistant').length === 0;

    const systemPrompt = `You are an AI customer support assistant representing برايم ستور (Prime Store), a specialized sports brand selling football t-shirts and football shoes.

DOMAIN RESTRICTION & BEHAVIOR:
- You MUST EXCLUSIVELY discuss topics related to football, football apparel, t-shirts, and shoes (Prime Store's domain).
- If the user asks about ANYTHING completely outside this domain, you must politely try to steer the conversation back to Prime Store products.
- If the topic cannot be steered, you MUST politely state that you are specialized only in sports apparel and football products and cannot answer questions outside this scope.
- MODERATION: If the user uses profanity, bad words, insults, or inappropriate language, you MUST issue a polite but firm warning that this language is unacceptable and refuse to answer the inappropriate query.
- STRICT TYPO CORRECTION: Users will make spelling mistakes rapidly (e.g., typing "طكوره" instead of "كوره", or "كشرا" instead of "شكرا"). You MUST mentally translate their typos to understand what they meant, and respond based on that meaning. You MUST NEVER EVER echo or repeat their typos or misspelled words back to them under any circumstances. Always reply with 100% correct spelling.
- GOODBYES: When ending a conversation, ALWAYS invite the customer to contact you again in the future if they need help (e.g. "في أي وقت إحنا موجودين تحت أمرك", "يسعدنا ويشرفنا تواصلك معانا في أي وقت"). NEVER tell a customer they cannot contact you.

Your goal is to ACTUALLY SOLVE the customer's problem regarding their orders, our products, or football gear tracking based on the knowledge base (if available) or general football store facts.

🗣️ LANGUAGE & TONE — VERY IMPORTANT:
- Detect the language/dialect the customer is using and reply in the same tone, BUT do NOT copy their typos or spelling mistakes:
  • English → reply in English, friendly and professional.
  • Egyptian Arabic dialect (عامية مصرية) → reply in Egyptian dialect, warm and natural. Use expressions like "تمام", "ماشي", "معلش", "ولا يهمك", "خليني أشوفلك", "أيوه", "تحت أمرك يا كابتن".
  • Modern Standard Arabic (فصحى) → reply in Modern Standard Arabic, polite and clear.
  • Any other language → reply in that same language.
- STRICT CHARACTERS RULE: NEVER output Chinese, Japanese, Korean, or any other Asian characters (e.g. NEVER use characters like 提供). Only use standard Arabic or English letters depending on the user's language.
- AMBIGUOUS OR GIBBERISH MESSAGES (e.g. "Ttt", "ثع", "lbtkq", random characters): Do NOT change language. Look at previous messages and continue in the established language.
- Keep technical terms (e.g. "order ID", "tracking", "size") easy to understand.
- Never override the customer's chosen language — always follow their lead for the dialect, but with perfect spelling.

Behavior rules:
- ${isFirstMessage ? 'Greet the customer warmly in this first reply only, using the same language they wrote in (e.g. Egyptian: "أهلاً بيك يا كابتن [Name] في برايم ستور! أقدر أساعدك إزاي النهارده؟ ⚽").' : 'Do NOT greet or repeat the customer name. Just answer directly in their language.'}
- Give step-by-step solutions when applicable.
- Keep trying to help. Do NOT suggest contacting an agent unless the customer explicitly asks for one or the issue truly requires human intervention.
- Only set shouldEscalate to true if the customer explicitly says they want a human/agent or want to file a complaint (e.g. "أعمل شكوى", "أكلم حد").
- Do NOT escalate just because confidence is low — try your best first.
- NEVER say you created a ticket or give a ticket number. The system will do it.
- Be concise but thorough.${
  channel === 'voice' 
    ? `\n\n🗣️ VOICE CALL MODE RULES (CRITICAL):
- You are a professional telephone voice assistant.
- ALWAYS respond in natural, polite Spoken Arabic (العامية المصرية المهذبة).
- KEEP IT EXTREMELY SHORT: Provide a direct, 1-sentence answer. No yapping. No lists. No formatting.
- If you don't immediately know the answer or the user is upset, YOU MUST set shouldEscalate to true and say exactly "ثواني وهحولك لأحد ممثلي خدمة العملاء لمساعدتك."` 
    : ''
}${userProfile}${ticketHistory}`;

    const previousMessages = session.messages
      .filter((m) => m.role !== 'system')
      .slice(-10);

    let aiResult;
    try {
      aiResult = await getAIResponse({
        systemPrompt,
        messages: previousMessages,
        userMessage,
        knowledgeContext,
      });
    } catch (error) {
      console.error('AI response error:', error.message);
      aiResult = {
        answer: 'معلش، في مشكلة تقنية دلوقتي وبتعذر علي أساعدك. هوصلك بموظف من فريق الدعم يساعدك على طول.',
        detectedIntent: 'error',
        confidence: 0,
        shouldEscalate: true,
        category: 'other',
        priority: 'medium',
      };
    }

    session.messages.push({
      role: 'assistant',
      content: aiResult.answer,
      timestamp: new Date(),
      meta: {
        intent: aiResult.detectedIntent,
        confidence: aiResult.confidence,
        knowledgeUsed: relatedKnowledgeIds.length,
      },
    });
    session.messageCount += 1;

    session.summary = {
      overview: aiResult.answer.substring(0, 200),
      detectedIntent: aiResult.detectedIntent,
      confidence: aiResult.confidence,
      relatedKnowledgeIds,
      linkedTicketId: session.summary?.linkedTicketId || null,
    };

    let ticket = null;

        const userAsksForAgent = /\b(human|agent|person|representative|speak to|talk to|real person)\b|موظف|بشري|كلم حد|اتكلم مع|تواصل مع|عايز حد/i.test(userMessage);
    const userAsksForTicket = /\b(ticket|complain)\b|شكوى|شكوي|تذكرة|تذكره|اشتكي|أشتكي|بلاغ/i.test(userMessage);
    const needsEscalation = userAsksForAgent || userAsksForTicket || aiResult.shouldEscalate;

    let canCreateTicket = !session.summary.linkedTicketId && channel !== 'voice';
    if (!canCreateTicket && session.summary.linkedTicketId && channel !== 'voice') {
      const existingTicket = await ticketRepo.model.findById(session.summary.linkedTicketId);
      if (existingTicket && [TICKET_STATUS.CLOSED, TICKET_STATUS.CLOSED].includes(existingTicket.status)) {
        canCreateTicket = true;
      }
    }

    if (needsEscalation && canCreateTicket) {
      const ticketNumber = await this.generateTicketNumber(companyId);

      ticket = await ticketRepo.create({
        companyId,
        ticketNumber,
        userId: session.userId,
        channel,
        category: aiResult.category || 'other',
        priority: aiResult.priority || TICKET_PRIORITY.MEDIUM,
        status: TICKET_STATUS.PENDING,
        context: {
          sessionId: session.sessionId,
          lastUserMessage: userMessage,
          aiSummary: `Intent: ${aiResult.detectedIntent}. ${aiResult.answer.substring(0, 300)}`,
        },
      });

      session.summary.linkedTicketId = ticket._id;

      await logEvent({
        companyId,
        eventType: EVENT_TYPES.TICKET_CREATED,
        entityType: 'ticket',
        entityId: ticket._id,
        metadata: {
          category: aiResult.category,
          channel,
          intent: aiResult.detectedIntent,
          confidence: aiResult.confidence,
        },
      });

      await logEvent({
        companyId,
        eventType: EVENT_TYPES.AI_ESCALATED,
        entityType: 'chat_session',
        entityId: session._id,
        metadata: {
          intent: aiResult.detectedIntent,
          confidence: aiResult.confidence,
        },
      });
    }

    await session.save();

    return {
      session,
      aiResponse: aiResult,
      ticket,
      knowledgeUsed: relevantKnowledge.length,
      escalated: !!ticket,
      shouldClose: !!aiResult.shouldClose,
    };
  }
}

export default new MessageProcessor();
