import Joi from 'joi';

const analyzeRaw = {
  body: Joi.object({
    ticketNumber: Joi.string().trim().max(100).optional(),
    channel: Joi.string().trim().max(100).optional(),
    category: Joi.string().trim().max(100).optional(),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent', 'critical').optional(),
    status: Joi.string().valid('open', 'pending', 'in_progress', 'resolved', 'closed', 'escalated').optional(),

    lastUserMessage: Joi.string().trim().max(5000).optional(),

    agentNotes: Joi.array()
      .items(
        Joi.object({
          agentName: Joi.string().trim().max(200).optional(),
          agentId: Joi.string().optional(),
          content: Joi.string().trim().max(5000).required(),
          createdAt: Joi.alternatives().try(Joi.date(), Joi.string()).optional(),
        }).unknown(true)
      )
      .optional(),

    conversation: Joi.string().trim().max(20000).optional(),

    customer: Joi.object({
      name: Joi.string().trim().max(200).optional(),
      email: Joi.string().email().optional(),
      phone: Joi.string().optional(),
    }).optional(),

    assignedAgent: Joi.object({
      name: Joi.string().trim().max(200).optional(),
      email: Joi.string().email().optional(),
    }).optional(),

    createdAt: Joi.alternatives().try(Joi.date(), Joi.string()).optional(),
    resolvedAt: Joi.alternatives().try(Joi.date(), Joi.string()).optional(),
    firstResponseAt: Joi.alternatives().try(Joi.date(), Joi.string()).optional(),

    metadata: Joi.object().unknown(true).optional(),
  }).unknown(true),
};

const analyzeById = {
  params: Joi.object({
    ticketId: Joi.string().required(),
  }),
};

const analyzeNatiqById = {
  params: Joi.object({
    ticketId: Joi.string().required(),
  }),
};

const getResults = {
  query: Joi.object({
    page: Joi.number().integer().min(1).optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    ticketId: Joi.string().optional(),
    agentId: Joi.string().optional(),
    sentiment: Joi.string().optional(),
    status: Joi.string().optional(),
    category: Joi.string().optional(),
  }),
};

const getResultById = {
  params: Joi.object({
    id: Joi.string().required(),
  }),
};

export { analyzeRaw, analyzeById, analyzeNatiqById, getResults, getResultById };
