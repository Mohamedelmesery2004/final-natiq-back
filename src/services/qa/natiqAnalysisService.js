import axios from 'axios';
import config from '../../config/index.js';
import buildConversationForNatiq from './natiqConversationFormatter.js';
import translatorService from '../translation/translatorService.js';
import { ChatSession } from '../../models/index.js';
import ticketService from '../ticketService.js';
import ApiError from '../../utils/apiError.js';

const translateConversationToEnglish = async (conversation) => {
  if (!conversation) return conversation;

  const lines = conversation.split('\n').filter(Boolean);
  const translatedLines = [];

  for (const line of lines) {
    const match = line.match(/^(AGENT|CUSTOMER):\s*(.*)$/);
    if (!match) {
      translatedLines.push(line);
      continue;
    }

    const [, label, content] = match;
    let translatedContent = content;
    try {
      translatedContent = await translatorService.translateToEnglish(content);
    } catch {
      translatedContent = content;
    }
    translatedLines.push(`${label}: ${translatedContent}`);
  }

  return translatedLines.join('\n');
};

export const buildConversationFromTicketId = async (companyId, ticketId) => {
  const ticket = await ticketService.getTicketById(companyId, ticketId);

  let messages = [];
  if (ticket.context?.conversationSnapshot?.length > 0) {
    messages = ticket.context.conversationSnapshot;
  } else if (ticket.context?.sessionId) {
    const session = await ChatSession.findOne({
      companyId,
      sessionId: ticket.context.sessionId,
    }).select('messages');
    if (session?.messages?.length) messages = session.messages;
  }

  if (!messages.length) {
    throw ApiError.badRequest('No ticket messages found for analysis.');
  }

  const { conversation } = buildConversationForNatiq({ conversation: messages });
  if (!conversation) {
    throw ApiError.badRequest('No valid ticket messages found for analysis.');
  }

  const translatedConversation = await translateConversationToEnglish(conversation);
  return { conversation: translatedConversation };
};

export const analyzeWithNatiq = async (ticket) => {
  const { conversation } = buildConversationForNatiq(ticket);
  if (!conversation) {
    throw new Error('No visible conversation messages found for Natiq analysis.');
  }

  const translatedConversation = await translateConversationToEnglish(conversation);

  const response = await axios.post(
    config.natiq.analyzeUrl,
    { conversation: translatedConversation },
    {
      headers: { 'Content-Type': 'application/json' }
    }
  );

  if (!response?.data || typeof response.data !== 'object') {
    throw new Error('Natiq API returned malformed response.');
  }

  return {
    analysis: response.data,
    analyzedAt: new Date().toISOString(),
  };
};

export const analyzeWithNatiqByTicketId = async (companyId, ticketId) => {
  const payload = await buildConversationFromTicketId(companyId, ticketId);

  const response = await axios.post(
    config.natiq.analyzeUrl,
    payload,
    {
      headers: { 'Content-Type': 'application/json' }
    }
  );

  if (!response?.data || typeof response.data !== 'object') {
    throw ApiError.internal('Natiq API returned malformed response.');
  }

  return {
    analysis: response.data,
    analyzedAt: new Date().toISOString(),
  };
};

export const analyzeWithNatiqSafe = async (ticket, logger = console) => {
  try {
    return await analyzeWithNatiq(ticket);
  } catch (error) {
    logger.error('[QA Natiq] Additional analysis failed.', {
      ticketNumber: ticket?.ticketNumber,
      message: error?.message,
      code: error?.code,
      status: error?.response?.status,
    });
    return null;
  }
};

export default {
  buildConversationFromTicketId,
  analyzeWithNatiq,
  analyzeWithNatiqByTicketId,
  analyzeWithNatiqSafe,
};
