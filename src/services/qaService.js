import axios from 'axios';
import config from '../config/index.js';
import ApiError from '../utils/apiError.js';
import { ChatSession, QAAnalysis, Ticket } from '../models/index.js';
import ticketService from './ticketService.js';
import { analyzeWithNatiqSafe, analyzeWithNatiqByTicketId } from './qa/natiqAnalysisService.js';

const SYSTEM_PROMPT = `You are a strict, senior Customer Support QA and Conversation Intelligence analyst.

You analyze full customer support conversations including Egyptian Arabic, slang, typos, and informal writing.
You are critical, evidence-based, and NOT lenient. A happy ending does NOT erase a bad start.

═══════════════════════════════════════════════════════
CRITICAL: FULL JOURNEY ANALYSIS — NOT JUST THE ENDING
═══════════════════════════════════════════════════════

You MUST read every message in chronological order.
You MUST track the customer's emotional state at EACH stage:
  • initial_tone   → what was the customer's tone at the start?
  • journey_shifts → did it escalate? calm down? when and why?
  • final_tone     → how did the conversation end?

A customer who opened with "ايه يعم الخرا ده" (What the f*** is this) or "شغل زباله" (Garbage work)
is an ANGRY customer — even if they thanked the agent at the end.
You MUST reflect that anger in initial_tone and in risk_flags.

Do NOT report the customer as "neutral" or "calm" if they started with profanity or aggressive language.
Do NOT let a positive ending override a clearly negative start.
Do NOT ignore messages just because the conversation eventually resolved.

═══════════════════════════════════════════════════
AGENT EVALUATION — BE STRICT
═══════════════════════════════════════════════════

Evaluate ONLY the human agent messages (role: "agent").
Ignore bot/assistant/system messages entirely.

A reply of just "hello" to an incoming angry or frustrated customer is a LOW-VALUE reply.
It shows lack of awareness of the customer's situation.

Flag these explicitly:
  • low_value_replies: vague greetings, one-word replies, non-answers
  • missed_empathy: customer expressed frustration and agent ignored it
  • weak_handling: agent moved on without acknowledging the complaint

Strengths must be EARNED. Only add them if the agent genuinely did something well.

═══════════════════════════════════════════════════
SYSTEM / BOT MESSAGE FILTERING
═══════════════════════════════════════════════════

Messages where role = "assistant" OR meta.type = "system_escalation"
are SYSTEM MESSAGES. Exclude them from agent analysis entirely.
They are infrastructure, not agent behavior.

═══════════════════════════════════════════════════
RESOLUTION — VERIFY FROM CONTENT, NOT FROM STATUS
═══════════════════════════════════════════════════

The ticket status field may be wrong. Verify resolution from actual conversation.
A ticket marked "closed" with an unresolved issue MUST be flagged as inconsistent.

Distinguish clearly between:
  • resolved         → issue confirmed solved, customer confirmed satisfied
  • contained_only   → customer calmed down but core issue was not addressed
  • escalated        → transferred to another team or person
  • unresolved       → issue remains open
  • unclear          → insufficient evidence

═══════════════════════════════════════════════════
ALLOWED LABEL VALUES
═══════════════════════════════════════════════════

customer_tone (initial / final):
  "angry" | "frustrated" | "urgent" | "confused" | "neutral" | "calm" | "satisfied" | "unclear"

customer_sentiment:
  "very_negative" | "negative" | "neutral" | "positive" | "very_positive"

agent_tone (per message):
  "polite" | "professional" | "empathetic" | "robotic" | "confused" | "weak" | "annoying" | "inappropriate"

resolution_status:
  "resolved" | "contained_only" | "escalated" | "unresolved" | "unclear"

═══════════════════════════════════════════════════
OUTPUT FORMAT — RETURN ONLY VALID JSON
═══════════════════════════════════════════════════

{
  "ticket_summary": {
    "ticket_number": "",
    "channel": "",
    "category": "",
    "priority": "",
    "status": "",
    "customer_intent": "",
    "short_summary": ""
  },

  "customer_analysis": {
    "initial_tone": "",
    "final_tone": "",
    "overall_sentiment": "",
    "tone_journey": "",
    "tone_reasoning": "",
    "customer_sentiment_score": 0,
    "customer_satisfaction_score": 0,
    "final_customer_state": ""
  },

  "agent_analysis": {
    "overall_tone": "",
    "tone_reasoning": "",
    "agent_professionalism_score": 0,
    "agent_empathy_score": 0,
    "agent_tone_per_message": [
      {
        "message": "",
        "tone": "",
        "reason": ""
      }
    ],
    "issues": [],
    "strengths": [],
    "low_value_replies": [],
    "missed_empathy_moments": [],
    "language_issues": [],
    "understood_customer": false,
    "clear_next_step_provided": false,
    "proper_routing_or_escalation": false
  },

  "resolution_analysis": {
    "resolution_status": "",
    "resolution_confidence": 0,
    "resolution_reasoning": "",
    "ticket_closed_correctly": false,
    "closure_reasoning": ""
  },

  "quality_assessment": {
    "conversation_quality_score": 0,
    "main_failures": [],
    "main_successes": [],
    "risk_flags": [],
    "qa_verdict": ""
  },

  "recommendations": {
    "for_agent": [],
    "for_workflow": [],
    "for_automation": []
  }
}

IMPORTANT:
- Return ONLY valid JSON. No markdown, no explanation, no wrapper text.
- Be strict and realistic.
- A good ending does not erase a bad start.
- If you would give a score of 9+ to an agent who opened with "hello" to an angry customer, you are wrong.`;

const callGroqQA = async (ticketPayload) => {
  if (!config.groq.apiKey) {
    throw ApiError.internal('GROQ API key is not configured');
  }

  const userMessage = [
    '[TICKET DATA START]',
    JSON.stringify(ticketPayload, null, 2),
    '[TICKET DATA END]',
    '',
    'Analyze the full conversation chronologically. Return valid JSON only.',
  ].join('\n');

  const response = await axios.post(
    `${config.groq.baseUrl}/chat/completions`,
    {
      model: config.groq.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    },
    {
      headers: {
        Authorization: `Bearer ${config.groq.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    }
  );

  const raw = response.data.choices?.[0]?.message?.content;
  if (!raw) throw ApiError.internal('Empty response from AI provider');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); }
      catch { throw ApiError.internal('AI returned malformed JSON.'); }
    } else {
      throw ApiError.internal('AI returned non-JSON content.');
    }
  }

  return {
    analysis: parsed,
    model: config.groq.model,
    tokensUsed: response.data.usage?.total_tokens ?? null,
    analyzedAt: new Date().toISOString(),
  };
};

class QAService {

  async analyzeRaw(ticketData) {
    this._validateHasConversationContent(ticketData);
    const oldResult = await callGroqQA(ticketData);
    const natiqResult = await analyzeWithNatiqSafe(ticketData);

    return {
      ...oldResult,
      oldAnalysis: oldResult.analysis,
      natiqAnalysis: natiqResult?.analysis ?? null,
      natiqMetadata: natiqResult
        ? { analyzedAt: natiqResult.analyzedAt, provider: 'natiq' }
        : null,
    };
  }

  async analyzeById(companyId, ticketId) {
    const ticket = await ticketService.getTicketById(companyId, ticketId);

    let sessionMessages = [];

    // 1. Check for conversation snapshot from resolution time (most reliable)
    if (ticket.context?.conversationSnapshot?.length > 0) {
      sessionMessages = ticket.context.conversationSnapshot;
    }
    // 2. Fall back to active ChatSession if snapshot is missing
    else if (ticket.context?.sessionId) {
      const session = await ChatSession.findOne({
        companyId,
        sessionId: ticket.context.sessionId,
      }).select('messages');
      if (session) sessionMessages = session.messages;
    }

    const payload = this._buildTicketPayload(ticket, sessionMessages);
    this._validateHasConversationContent(payload);

    const oldResult = await callGroqQA(payload);
    const natiqResult = await analyzeWithNatiqSafe(payload);

    return {
      ...oldResult,
      oldAnalysis: oldResult.analysis,
      natiqAnalysis: natiqResult?.analysis ?? null,
      natiqMetadata: natiqResult
        ? { analyzedAt: natiqResult.analyzedAt, provider: 'natiq' }
        : null,
      ticket: {
        _id: ticket._id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        channel: ticket.channel,
        category: ticket.category,
        priority: ticket.priority,
      },
    };
  }

  async analyzeAndSaveByTicketId(companyId, ticketId) {
    try {
      const result = await this.analyzeById(companyId, ticketId);
      const { analysis, natiqAnalysis, ticket } = result;

      // Extract high-level metrics safely
      const professionalismScore = analysis.agent_analysis?.agent_professionalism_score || 0;
      const empathyScore = analysis.agent_analysis?.agent_empathy_score || 0;
      const qualityScore = analysis.quality_assessment?.conversation_quality_score || 0;
      const customerSentiment = analysis.customer_analysis?.overall_sentiment || 'unclear';
      const resolutionStatus = analysis.resolution_analysis?.resolution_status || 'unclear';

      // Pull ticket to get agent/customer IDs if not in result
      const fullTicket = await ticketService.getTicketById(companyId, ticketId);

      const savedAnalysis = await QAAnalysis.findOneAndUpdate(
        { ticketId },
        {
          companyId,
          ticketId,
          agentId: fullTicket.assignedTo?._id || null,
          customerId: fullTicket.userId?._id || null,
          ticketNumber: fullTicket.ticketNumber,
          channel: fullTicket.channel,
          category: fullTicket.category,
          customerSentiment,
          resolutionStatus,
          scores: {
            professionalism: professionalismScore,
            empathy: empathyScore,
            quality: qualityScore,
          },
          fullAnalysis: analysis,
          natiqAnalysis: natiqAnalysis ?? null,
          metadata: {
            model: result.model,
            tokensUsed: result.tokensUsed,
            analyzedAt: new Date(result.analyzedAt),
            natiq: result.natiqMetadata ?? null,
          },
        },
        { new: true, upsert: true }
      );

      // Update ticket status
      try {
        await Ticket.updateOne(
          { _id: ticketId, companyId },
          { $set: { 'context.analysisStatus': 'completed' } }
        );
      } catch (err) { }

      console.log(`[QA Automation] Successfully saved analysis for ticket ${fullTicket.ticketNumber}`);
      return savedAnalysis;
    } catch (error) {
      console.error(`[QA Automation] Detailed Error for ticket ${ticketId}:`, error);

      // Mark as failed
      try {
        await Ticket.updateOne(
          { _id: ticketId, companyId },
          { $set: { 'context.analysisStatus': 'failed' } }
        );
      } catch (err) { }

      throw error;
    }
  }

  async analyzeNatiqByTicketId(companyId, ticketId) {
    try {
      const result = await analyzeWithNatiqByTicketId(companyId, ticketId);
      return {
        ...result,
        ticketId,
        provider: 'natiq',
      };
    } catch (error) {
      console.error('[QA Natiq] analyze by ticket failed', {
        ticketId,
        message: error?.message,
        code: error?.code,
        status: error?.response?.status,
      });
      throw error;
    }
  }

  async getAutomatedResults(companyId, filters = {}) {
    const {
      page = 1,
      limit = 20,
      ticketId,
      agentId,
      sentiment,
      status,
      category,
    } = filters;

    const query = { companyId };
    if (ticketId) query.ticketId = ticketId;
    if (agentId) query.agentId = agentId;
    if (sentiment) query.customerSentiment = sentiment;
    if (status) query.resolutionStatus = status;
    if (category) query.category = category;

    const total = await QAAnalysis.countDocuments(query);
    const results = await QAAnalysis.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('agentId', 'name email')
      .populate('customerId', 'name email')
      .select('-fullAnalysis'); // Don't return huge JSON in list

    return {
      results,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getAutomatedAnalysisDetails(companyId, analysisId) {
    const analysis = await QAAnalysis.findOne({ companyId, _id: analysisId })
      .populate('agentId', 'name email')
      .populate('customerId', 'name email')
      .populate('ticketId', 'ticketNumber status channel context');

    if (!analysis) throw ApiError.notFound('Analysis record not found');
    return analysis;
  }

  _buildTicketPayload(ticket, sessionMessages = []) {
    const conversation = sessionMessages
      .filter((m) => typeof m.content === 'string' && m.content.trim())
      .slice(-60)
      .map((m) => ({
        role: m.role,
        content: m.content.trim(),
        timestamp: m.timestamp,
        isSystem: m.meta?.type === 'system_escalation' || m.role === 'assistant',
      }));

    return {
      ticketNumber: ticket.ticketNumber,
      channel: ticket.channel,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      createdAt: ticket.createdAt,
      resolvedAt: ticket.resolvedAt ?? null,
      firstResponseAt: ticket.firstResponseAt ?? null,

      customer: {
        name: ticket.userId?.name ?? 'Unknown',
        email: ticket.userId?.email ?? null,
      },

      assignedAgent: ticket.assignedTo
        ? { name: ticket.assignedTo.name, email: ticket.assignedTo.email }
        : null,

      lastUserMessage: ticket.context?.lastUserMessage ?? null,

      agentNotes: (ticket.agentNotes ?? []).map((n) => ({
        agentName: n.agentId?.name ?? 'Agent',
        content: n.content,
        createdAt: n.createdAt,
      })),
      conversation,
      conversationStats: {
        total: conversation.length,
        user: conversation.filter((m) => m.role === 'user').length,
        agent: conversation.filter((m) => m.role === 'agent').length,
        system: conversation.filter((m) => m.isSystem).length,
      },
    };
  }
  _validateHasConversationContent(ticketData) {
    const hasAgentNotes =
      Array.isArray(ticketData.agentNotes) && ticketData.agentNotes.length > 0;

    const hasLastMessage =
      typeof ticketData.lastUserMessage === 'string' &&
      ticketData.lastUserMessage.trim().length > 0;

    const hasConversation =
      Array.isArray(ticketData.conversation) &&
      ticketData.conversation.some(
        (m) => typeof m.content === 'string' && m.content.trim().length > 0
      );

    if (!hasAgentNotes && !hasLastMessage && !hasConversation) {
      throw ApiError.badRequest(
        'Ticket must contain at least one of: agentNotes, lastUserMessage, or conversation to be analyzed.'
      );
    }
  }
}

export default new QAService();