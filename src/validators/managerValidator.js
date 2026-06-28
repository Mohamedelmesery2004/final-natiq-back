import Joi from 'joi';

const listAuditLogs = {
  query: Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    action: Joi.string().trim().max(120),
    resourceType: Joi.string().trim().max(80),
    from: Joi.date().iso(),
    to: Joi.date().iso(),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const exportQuery = {
  query: Joi.object({
    from: Joi.date().iso(),
    to: Joi.date().iso(),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const updateCompanySettings = {
  body: Joi.object({
    name: Joi.string().trim().max(100),
    industry: Joi.string().valid('telecom', 'banking', 'ecommerce', 'healthcare', 'sports_retail', 'other'),
    channelsConfig: Joi.object({
      telegram: Joi.object({
        botToken: Joi.string().allow('', null),
        webhookUrl: Joi.string().allow('', null),
        webhookSecret: Joi.string().allow('', null),
        isActive: Joi.boolean(),
      }).options({ stripUnknown: true, abortEarly: false }),
      whatsapp: Joi.object({
        isActive: Joi.boolean(),
        phoneNumberId: Joi.string().allow('', null),
        accessToken: Joi.string().allow('', null),
      }),
      webChat: Joi.object({
        isActive: Joi.boolean(),
        color: Joi.string().allow('', null),
        welcomeMessage: Joi.string().max(200).allow('', null),
      }),
    }),
    settings: Joi.object({
      aiEnabled: Joi.boolean(),
      escalationThreshold: Joi.number().min(0).max(1),
      maxSessionMessages: Joi.number().integer().min(1),
      workingHours: Joi.object({
        start: Joi.string().pattern(/^([01]\d|2[0-3]):?([0-5]\d)$/),
        end: Joi.string().pattern(/^([01]\d|2[0-3]):?([0-5]\d)$/),
        timezone: Joi.string(),
      }),
    }),
  }),
};

export { listAuditLogs, exportQuery, updateCompanySettings };
