import axios from 'axios';
import config from '../config/index.js';
import ApiError from '../utils/apiError.js';
import { Ticket, ChatSession, CoachJob } from '../models/index.js';
import { formatConversationForCoach } from '../utils/conversationFormatter.js';

const MAX_CONVERSATION_TURNS = 100;
const REQUEST_TIMEOUT = 2700000;

class CoachService {
  async startCoaching(companyId, ticketId) {
    const ticket = await Ticket.findOne({ _id: ticketId, companyId })
      .select('companyId context');

    if (!ticket) throw ApiError.notFound('Ticket not found');

    const messages = await this._fetchMessages(companyId, ticket);

    if (!messages || messages.length === 0) {
      throw ApiError.badRequest('No messages found for this ticket');
    }

    const job = await CoachJob.create({
      companyId,
      ticketId,
      status: 'pending',
    });

    this._processInBackground(job._id, messages).catch((err) => {
      console.error('[CoachService] Background processing failed:', err.message);
    });

    return { jobId: job._id };
  }

  async getJob(companyId, jobId) {
    const job = await CoachJob.findOne({ _id: jobId, companyId });

    if (!job) throw ApiError.notFound('Coaching job not found');

    if (job.status === 'failed') {
      throw ApiError.internal(job.error || 'Coaching analysis failed');
    }

    if (job.status !== 'completed') {
      return {
        status: job.status,
        result: null,
      };
    }

    return {
      status: 'completed',
      result: {
        ai_recommendations: job.result.ai_recommendations || '',
        weakness_analysis: job.result.weakness_analysis || '',
        suggested_learning: job.result.suggested_learning || '',
        encouragement_quote: job.result.encouragement_quote || '',
      },
    };
  }

  async _processInBackground(jobId, messages) {
    const formatted = formatConversationForCoach(messages);

    if (formatted.conversation.length > MAX_CONVERSATION_TURNS) {
      formatted.conversation = formatted.conversation.slice(-MAX_CONVERSATION_TURNS);
    }

    await CoachJob.updateOne({ _id: jobId }, {
      $set: { status: 'processing', startedAt: new Date() },
    });

    try {
      const aiResponse = await this._callCoachAPI(formatted);
      const normalized = this._normalizeResponse(aiResponse);

      await CoachJob.updateOne({ _id: jobId }, {
        $set: {
          status: 'completed',
          result: normalized,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      const message = error.isOperational
        ? error.message
        : 'Coaching service internal error';

      await CoachJob.updateOne({ _id: jobId }, {
        $set: { status: 'failed', error: message, completedAt: new Date() },
      });
    }
  }

  async _fetchMessages(companyId, ticket) {
    if (ticket.context?.conversationSnapshot?.length > 0) {
      return ticket.context.conversationSnapshot;
    }

    if (ticket.context?.sessionId) {
      const session = await ChatSession.findOne({
        companyId,
        sessionId: ticket.context.sessionId,
      }).select('messages').lean();

      if (session?.messages?.length > 0) {
        return session.messages;
      }
    }

    return [];
  }

  async _callCoachAPI(payload) {
    try {
      const response = await axios.post(config.coach.apiUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: REQUEST_TIMEOUT,
      });

      return response.data;
    } catch (error) {
      if (error.isOperational) throw error;

      if (error.code === 'ECONNABORTED') {
        throw ApiError.internal('Coaching AI request timed out');
      }

      const status = error.response?.status;
      const body = error.response?.data;
      const message = body?.message || error.message;

      console.error('[CoachService] API call failed', { status, message });

      throw ApiError.internal(
        status >= 500 ? 'Coaching AI service unavailable' : `Coaching AI error: ${message}`
      );
    }
  }

  _normalizeResponse(data) {
    if (!data || typeof data !== 'object') {
      throw ApiError.internal('Invalid response from coaching AI');
    }

    const extract = (obj) => ({
      ai_recommendations: obj.ai_recommendations || '',
      weakness_analysis: obj.weakness_analysis || '',
      suggested_learning: obj.suggested_learning || '',
      encouragement_quote: obj.encouragement_quote || '',
    });

    if (data.data && typeof data.data === 'object') {
      return extract(data.data);
    }

    if (data.response && typeof data.response === 'object') {
      return extract(data.response);
    }

    return extract(data);
  }
}

export default new CoachService();
