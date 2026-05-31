import Joi from 'joi';
import { TICKET_STATUS, TICKET_PRIORITY, TICKET_CATEGORY } from '../constants/index.js';

const listTickets = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    status: Joi.string().valid(...Object.values(TICKET_STATUS)),
    priority: Joi.string().valid(...Object.values(TICKET_PRIORITY)),
    category: Joi.string().valid(...Object.values(TICKET_CATEGORY)),
    assignedTo: Joi.string(),
    userId: Joi.string(),
    search: Joi.string().trim(),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const updateTicket = {
  params: Joi.object({
    ticketId: Joi.string().required(),
  }).options({ stripUnknown: true, abortEarly: false }),
  body: Joi.object({
    status: Joi.string().valid(...Object.values(TICKET_STATUS)),
    priority: Joi.string().valid(...Object.values(TICKET_PRIORITY)),
    category: Joi.string().valid(...Object.values(TICKET_CATEGORY)),
    assignedTo: Joi.string().allow(null),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const addNote = {
  params: Joi.object({
    ticketId: Joi.string().required(),
  }).options({ stripUnknown: true, abortEarly: false }),
  body: Joi.object({
    content: Joi.string().required().trim().min(1).max(2000),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const customerReply = {
  params: Joi.object({
    ticketId: Joi.string().required(),
  }).options({ stripUnknown: true, abortEarly: false }),
  body: Joi.object({
    content: Joi.string().required().trim().min(1).max(2000),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const submitFeedback = {
  params: Joi.object({
    ticketId: Joi.string().required(),
  }).options({ stripUnknown: true, abortEarly: false }),
  body: Joi.object({
    rating: Joi.number().integer().min(1).max(5).required(),
    comment: Joi.string().allow('', null).trim().max(1000),
  }).options({ stripUnknown: true, abortEarly: false }),
};

export { listTickets, updateTicket, addNote, customerReply, submitFeedback };
