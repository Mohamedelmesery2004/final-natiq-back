import Joi from 'joi';
import { KNOWLEDGE_TYPE } from '../constants/index.js';

const createKnowledge = {
  body: Joi.object({
    type: Joi.string()
      .valid(...Object.values(KNOWLEDGE_TYPE))
      .required(),
    title: Joi.string().required().trim().min(2).max(200),
    subtitle: Joi.string().trim().max(300).allow(null, ''),
    content: Joi.string().required().min(10),
    features: Joi.array().items(Joi.string().trim()),
    slug: Joi.string().trim().lowercase().pattern(/^[a-z0-9-]+$/),
    isActive: Joi.boolean(),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const updateKnowledge = {
  params: Joi.object({
    id: Joi.string().required(),
  }).options({ stripUnknown: true, abortEarly: false }),
  body: Joi.object({
    type: Joi.string().valid(...Object.values(KNOWLEDGE_TYPE)),
    title: Joi.string().trim().min(2).max(200),
    subtitle: Joi.string().trim().max(300).allow(null, ''),
    content: Joi.string().min(10),
    features: Joi.array().items(Joi.string().trim()),
    isActive: Joi.boolean(),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const listKnowledge = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    type: Joi.string().valid(...Object.values(KNOWLEDGE_TYPE)),
    isActive: Joi.boolean(),
    search: Joi.string().trim(),
  }).options({ stripUnknown: true, abortEarly: false }),
};

export { createKnowledge, updateKnowledge, listKnowledge };
