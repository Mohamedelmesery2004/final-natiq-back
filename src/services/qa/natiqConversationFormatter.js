const CUSTOMER_ROLES = new Set(['user', 'customer', 'client']);
const AGENT_ROLES = new Set(['agent', 'assistant', 'admin', 'staff', 'support']);
const SYSTEM_ROLES = new Set(['system']);
const MEANINGLESS_MESSAGES = new Set(['.', '..', '...']);

const toTimestamp = (value) => {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? 0 : ts;
};

const isVisibleConversationMessage = (message) => {
  if (!message || typeof message.content !== 'string' || !message.content.trim()) {
    return false;
  }
  const normalizedContent = message.content.trim();

  if (MEANINGLESS_MESSAGES.has(normalizedContent)) {
    return false;
  }

  if (message.meta?.type === 'system_escalation' || message.isSystem) {
    return false;
  }

  if (SYSTEM_ROLES.has(String(message.role || '').toLowerCase())) {
    return false;
  }

  return true;
};

const mapRoleToLabel = (role) => {
  const normalized = String(role || '').toLowerCase();
  if (CUSTOMER_ROLES.has(normalized)) return 'CUSTOMER';
  if (AGENT_ROLES.has(normalized)) return 'AGENT';
  return 'AGENT';
};

const getSourceMessages = (ticket = {}) => {
  if (Array.isArray(ticket.conversation)) return ticket.conversation;
  if (Array.isArray(ticket.context?.conversationSnapshot)) {
    return ticket.context.conversationSnapshot;
  }
  return [];
};

export const buildConversationForNatiq = (ticket = {}) => {
  const sourceMessages = getSourceMessages(ticket);

  const lines = sourceMessages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => isVisibleConversationMessage(message))
    .sort((a, b) => {
      const timeDiff = toTimestamp(a.message.timestamp) - toTimestamp(b.message.timestamp);
      if (timeDiff !== 0) return timeDiff;
      return a.index - b.index;
    })
    .map(({ message }) => `${mapRoleToLabel(message.role)}: ${message.content.trim()}`);

  return {
    conversation: lines.join('\n'),
  };
};

export default buildConversationForNatiq;
