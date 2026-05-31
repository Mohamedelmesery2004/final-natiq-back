import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import { KnowledgeItem } from '../models/index.js';
import { generateEmbedding, generateEmbeddings } from '../utils/embeddings.js';

class EmbeddingService {
  async embedKnowledgeItem(itemId) {
    const item = await KnowledgeItem.findById(itemId);
    if (!item) throw new Error('Knowledge item not found');

    const textParts = [item.title];
    if (item.subtitle) textParts.push(item.subtitle);
    textParts.push(item.content);
    if (item.features && item.features.length > 0) {
      textParts.push('Features: ' + item.features.join(', '));
    }
    const text = textParts.join('. ');

    const embedding = await generateEmbedding(text);

    item.embeddingVector = embedding;
    item.embeddingModel = 'BAAI/bge-small-en-v1.5';
    item.lastEmbeddedAt = new Date();
    await item.save();

    return item;
  }

  async syncEmbeddings(companyId, { force = false, batchSize = 50 } = {}) {
    const filter = { companyId, isActive: true };
    if (!force) {
      filter.$or = [
        { lastEmbeddedAt: null },
        { $expr: { $gt: ['$updatedAt', '$lastEmbeddedAt'] } },
      ];
    }

    const items = await KnowledgeItem.find(filter).limit(batchSize);

    if (items.length === 0) {
      return { processed: 0, message: 'All items are up to date' };
    }

    let processed = 0;
    let errors = 0;

    for (const item of items) {
      try {
        await this.embedKnowledgeItem(item._id);
        processed++;
      } catch (error) {
        console.error(`Embedding error for item ${item._id}:`, error.message);
        errors++;
      }

            if (processed % 5 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    return {
      processed,
      errors,
      total: items.length,
      message: `Processed ${processed}/${items.length} items (${errors} errors)`,
    };
  }

  async getEmbeddingStatus(companyId) {
    const totalActive = await KnowledgeItem.countDocuments({ companyId, isActive: true });
    const embedded = await KnowledgeItem.countDocuments({
      companyId,
      isActive: true,
      lastEmbeddedAt: { $ne: null },
      embeddingVector: { $exists: true, $ne: [] },
    });
    const pending = totalActive - embedded;
    const coverage = totalActive === 0 ? 100 : Math.round((embedded / totalActive) * 100);

    return { totalActive, embedded, pending, coverage };
  }
}

export default new EmbeddingService();
