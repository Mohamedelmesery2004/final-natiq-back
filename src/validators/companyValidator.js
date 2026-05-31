import Joi from 'joi';

const createCompany = {
  body: Joi.object({
    name: Joi.string().required().trim().min(2).max(100),
    slug: Joi.string().trim().lowercase().pattern(/^[a-z0-9-]+$/),
    industry: Joi.string().valid('telecom', 'banking', 'ecommerce', 'healthcare', 'sports_retail', 'other'),
    channelsConfig: Joi.object({
      telegram: Joi.object({
        botToken: Joi.string().allow(null, ''),
        webhookSecret: Joi.string().allow(null, ''),
        isActive: Joi.boolean(),
      }),
      whatsapp: Joi.object({
        isActive: Joi.boolean(),
        phoneNumberId: Joi.string().allow(null, ''),
        accessToken: Joi.string().allow(null, ''),
      }),
      webChat: Joi.object({
        isActive: Joi.boolean(),
        color: Joi.string().pattern(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/),
        welcomeMessage: Joi.string().allow(null, ''),
      }),
    }),
    integrations: Joi.object({
      webhooks: Joi.array().items(Joi.object({
        name: Joi.string().required(),
        url: Joi.string().uri().required(),
        secret: Joi.string().required(),
        events: Joi.array().items(Joi.string().valid('ticket_created', 'ticket_updated', 'ticket_resolved', 'message_received')),
        isActive: Joi.boolean()
      })),
      apiKeys: Joi.array().items(Joi.object({
        name: Joi.string().required(),
        key: Joi.string().required(),
        permissions: Joi.array().items(Joi.string().valid('read_tickets', 'write_tickets', 'manage_agents', 'all')),
        isActive: Joi.boolean()
      })),
      aiModels: Joi.object({
        provider: Joi.string().valid('openai', 'anthropic', 'custom'),
        modelName: Joi.string(),
        apiKey: Joi.string().allow(null, ''),
        temperature: Joi.number().min(0).max(2),
        maxTokens: Joi.number()
      })
    }),
    settings: Joi.object({
      aiEnabled: Joi.boolean(),
      escalationThreshold: Joi.number().min(0).max(1),
      maxSessionMessages: Joi.number().integer().min(1).max(200),
      workingHours: Joi.object({
        start: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
        end: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
        timezone: Joi.string()
      })
    }),
    isActive: Joi.boolean(),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const updateCompany = {
  params: Joi.object({
    id: Joi.string().required(),
  }),
  body: Joi.object({
    name: Joi.string().trim().min(2).max(100),
    industry: Joi.string().valid('telecom', 'banking', 'ecommerce', 'healthcare', 'sports_retail', 'other'),
    channelsConfig: Joi.object({
      telegram: Joi.object({
        botToken: Joi.string().allow(null, ''),
        webhookSecret: Joi.string().allow(null, ''),
        isActive: Joi.boolean(),
      }),
      whatsapp: Joi.object({
        isActive: Joi.boolean(),
        phoneNumberId: Joi.string().allow(null, ''),
        accessToken: Joi.string().allow(null, ''),
      }),
      webChat: Joi.object({
        isActive: Joi.boolean(),
        color: Joi.string().pattern(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/),
        welcomeMessage: Joi.string().allow(null, ''),
      }),
    }),
    integrations: Joi.object({
      webhooks: Joi.array().items(Joi.object({
        name: Joi.string().required(),
        url: Joi.string().uri().required(),
        secret: Joi.string().required(),
        events: Joi.array().items(Joi.string().valid('ticket_created', 'ticket_updated', 'ticket_resolved', 'message_received')),
        isActive: Joi.boolean()
      })),
      apiKeys: Joi.array().items(Joi.object({
        name: Joi.string().required(),
        key: Joi.string().required(),
        permissions: Joi.array().items(Joi.string().valid('read_tickets', 'write_tickets', 'manage_agents', 'all')),
        isActive: Joi.boolean()
      })),
      aiModels: Joi.object({
        provider: Joi.string().valid('openai', 'anthropic', 'custom'),
        modelName: Joi.string(),
        apiKey: Joi.string().allow(null, ''),
        temperature: Joi.number().min(0).max(2),
        maxTokens: Joi.number()
      })
    }),
    settings: Joi.object({
      aiEnabled: Joi.boolean(),
      escalationThreshold: Joi.number().min(0).max(1),
      maxSessionMessages: Joi.number().integer().min(1).max(200),
      workingHours: Joi.object({
        start: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
        end: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
        timezone: Joi.string()
      })
    }),
    isActive: Joi.boolean(),
  }).options({ stripUnknown: true, abortEarly: false }),
};

export { createCompany, updateCompany };
