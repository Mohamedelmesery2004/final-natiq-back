import axios from 'axios';
import config from '../../config/index.js';

const ARABIC_REGEX = /[\u0600-\u06FF]/;

export const hasArabic = (text = '') =>
  typeof text === 'string' && ARABIC_REGEX.test(text);

class BaseTranslationProvider {
  async translateToEnglish(text) {
    return text;
  }
}

class GroqTranslationProvider extends BaseTranslationProvider {
  async translateToEnglish(text) {
    if (!text || !hasArabic(text) || !config.groq.apiKey) {
      return text;
    }

    const response = await axios.post(
      `${config.groq.baseUrl}/chat/completions`,
      {
        model: config.groq.model,
        messages: [
          {
            role: 'system',
            content:
              'Translate Arabic text to natural English. Keep meaning exactly, do not summarize, do not add details, and return only translated text.',
          },
          { role: 'user', content: text },
        ],
        temperature: 0,
        max_tokens: 1024,
      },
      {
        headers: {
          Authorization: `Bearer ${config.groq.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const translated = response.data?.choices?.[0]?.message?.content?.trim();
    return translated || text;
  }
}

class TranslatorService {
  constructor(provider = new GroqTranslationProvider()) {
    this.provider = provider;
  }

  async translateToEnglish(text) {
    if (!text || typeof text !== 'string') return text;
    return this.provider.translateToEnglish(text);
  }
}

export { BaseTranslationProvider, GroqTranslationProvider, TranslatorService };
export default new TranslatorService();
