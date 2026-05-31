import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import config from '../config/index.js';

export const getAIResponse = async ({ systemPrompt, messages = [], userMessage, knowledgeContext = [] }) => {
  if (!config.gemini || !config.gemini.apiKey) {
    throw new Error('Gemini API key is not configured in .env');
  }

  const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

  const schema = {
    type: SchemaType.OBJECT,
    properties: {
      answer: { type: SchemaType.STRING, description: "Your helpful response to the customer" },
      detectedIntent: { type: SchemaType.STRING, description: "short intent label like billing_inquiry, package_info, complaint, greeting, goodbye, etc." },
      confidence: { type: SchemaType.NUMBER },
      shouldEscalate: { type: SchemaType.BOOLEAN },
      shouldClose: { type: SchemaType.BOOLEAN },
      category: { type: SchemaType.STRING, description: "billing|network|packages|complaint|payment|refund|other" },
      priority: { type: SchemaType.STRING, description: "low|medium|high|urgent" },
    },
    required: ["answer", "detectedIntent", "confidence", "shouldEscalate", "shouldClose", "category", "priority"]
  };

  const knowledgeStr = knowledgeContext.length > 0
    ? `\n\nRelevant knowledge base information:\n${knowledgeContext.join('\n---\n')}`
    : '';

  const fullSystemPrompt = `${systemPrompt}${knowledgeStr}

Rules:
- Set shouldEscalate to true if: customer explicitly asks for human agent, issue is too complex, or confidence is below 0.5
- Set shouldClose to true ONLY IF the customer confirms they don't need anything else (e.g. "شكرا مش عايز حاجة", "لا شكرا"). Do NOT set to true if they simply say "شكرا", instead you should ask if they need any more help.
- Set confidence based on how well the knowledge base covers the question (0-1)
- Always be helpful, professional, and concise
- If the knowledge base doesn't have relevant info, acknowledge it and offer to connect to a human agent
- Respond in the same language the customer uses`;

  const model = genAI.getGenerativeModel({ 
    model: "gemini-flash-latest",
    systemInstruction: fullSystemPrompt,
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
      responseSchema: schema,
    }
  });

  const chatMessages = messages.slice(-10).map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));

  let content;
  try {
      const chat = model.startChat({
        history: chatMessages
      });

      const result = await chat.sendMessage([{ text: userMessage }]);
      content = result.response.text();
  } catch(e) {
      console.error("Gemini API Error:", e);
      throw new Error("Failed to generate response from Gemini API");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {
      answer: content,
      detectedIntent: 'unknown',
      confidence: 0.5,
      shouldEscalate: false,
      shouldClose: false,
      category: 'other',
      priority: 'medium',
    };
  }

  return {
    answer: parsed.answer || content,
    detectedIntent: parsed.detectedIntent || 'unknown',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    shouldEscalate: !!parsed.shouldEscalate,
    shouldClose: !!parsed.shouldClose,
    category: parsed.category || 'other',
    priority: parsed.priority || 'medium',
  };
};
