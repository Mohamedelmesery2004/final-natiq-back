export function formatConversationForCoach(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { conversation: [] };
  }

  const conversation = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    const content = typeof msg.content === 'string' ? msg.content.trim() : '';
    if (!content) continue;

    if (msg.role === 'user') {
      conversation.push({ customer: content });
    } else if (msg.role === 'assistant' || msg.role === 'agent') {
      conversation.push({ agent: content });
    }
  }

  return { conversation };
}
