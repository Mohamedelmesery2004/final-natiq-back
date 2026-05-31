import Joi from 'joi';
import { CHANNELS } from '../constants/index.js';

const createSession = {
  body: Joi.object({
    channel: Joi.string()
      .valid(...Object.values(CHANNELS))
      .default('web'),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const sendMessage = {
  params: Joi.object({
    sessionId: Joi.string().required(),
  }).options({ stripUnknown: true, abortEarly: false }),
  body: Joi.object({
    content: Joi.string().required().trim().min(1).max(2000),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const listSessions = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20),
    status: Joi.string().valid('active', 'closed'),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const adminListSessions = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    status: Joi.string().valid('active', 'closed'),
    channel: Joi.string().valid(...Object.values(CHANNELS)),
    userId: Joi.string(),
    search: Joi.string().trim(),
  }).options({ stripUnknown: true, abortEarly: false }),
};

export { createSession, sendMessage, listSessions, adminListSessions };
