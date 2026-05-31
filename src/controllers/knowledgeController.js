import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import { KnowledgeItem } from '../models/index.js';
import slugify from 'slugify';
import ApiError from '../utils/apiError.js';
import BaseController from './baseController.js';
import { recordAudit } from '../services/auditLogService.js';

class KnowledgeController extends BaseController {

  createKnowledgeItem = this.catchAsync(async (req, res) => {
    const { type, title, subtitle, content, features, slug, isActive } = req.body;

    const itemSlug = slug || slugify(title, { lower: true, strict: true });

    const existing = await KnowledgeItem.findOne({ companyId: req.companyId, slug: itemSlug });
    if (existing) {
      throw ApiError.conflict('Knowledge item with this slug already exists');
    }

    const item = await KnowledgeItem.create({
      companyId: req.companyId,
      type,
      title,
      subtitle: subtitle || null,
      content,
      features: features || [],
      slug: itemSlug,
      isActive: isActive !== undefined ? isActive : true,
    });

    await recordAudit({
      companyId: req.companyId,
      actor: req.user,
      action: 'knowledge.created',
      resourceType: 'knowledge_item',
      targetId: item._id,
      details: { title: item.title, slug: item.slug, type: item.type },
    });

    this.sendSuccess(res, { item }, 'Knowledge item created', 201);
  });

  listKnowledgeItems = this.catchAsync(async (req, res) => {
    const { page = 1, limit = 20, type, isActive, search } = req.query;

    const filter = { companyId: req.companyId };
    if (type) filter.type = type;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await KnowledgeItem.countDocuments(filter);
    const items = await KnowledgeItem.find(filter)
      .sort({ updatedAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .select('-embeddingVector');

    this.sendPaginated(res, items, {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / parseInt(limit)),
    });
  });

  getKnowledgeItem = this.catchAsync(async (req, res) => {
    const item = await KnowledgeItem.findOne({
      _id: req.params.id,
      companyId: req.companyId,
    }).select('-embeddingVector');

    if (!item) throw ApiError.notFound('Knowledge item not found');
    this.sendSuccess(res, { item });
  });

  updateKnowledgeItem = this.catchAsync(async (req, res) => {
    const item = await KnowledgeItem.findOne({
      _id: req.params.id,
      companyId: req.companyId,
    });
    if (!item) throw ApiError.notFound('Knowledge item not found');

    const allowed = ['type', 'title', 'subtitle', 'content', 'features', 'isActive'];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) {
        item[field] = req.body[field];
      }
    });

    await item.save();

    await recordAudit({
      companyId: req.companyId,
      actor: req.user,
      action: 'knowledge.updated',
      resourceType: 'knowledge_item',
      targetId: item._id,
      details: { title: item.title, slug: item.slug },
    });

    this.sendSuccess(res, { item: item.toJSON() }, 'Knowledge item updated');
  });

  deleteKnowledgeItem = this.catchAsync(async (req, res) => {
    const item = await KnowledgeItem.findOneAndDelete({
      _id: req.params.id,
      companyId: req.companyId,
    });
    if (!item) throw ApiError.notFound('Knowledge item not found');

    await recordAudit({
      companyId: req.companyId,
      actor: req.user,
      action: 'knowledge.deleted',
      resourceType: 'knowledge_item',
      targetId: item._id,
      details: { title: item.title, slug: item.slug },
    });

    this.sendSuccess(res, null, 'Knowledge item deleted');
  });

}

export default new KnowledgeController();
