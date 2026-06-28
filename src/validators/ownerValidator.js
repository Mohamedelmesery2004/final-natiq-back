import Joi from 'joi';

const createPlan = {
  body: Joi.object({
    name: Joi.string().trim().max(100).required(),
    code: Joi.string().trim().lowercase().required()
      .pattern(/^[a-z0-9_-]+$/, 'alphanumeric, underscore, hyphen only'),
    description: Joi.string().max(500).allow(''),
    price: Joi.number().min(0).required(),
    currency: Joi.string().uppercase().default('USD'),
    interval: Joi.string().valid('monthly', 'yearly').default('monthly'),
    features: Joi.array().items(
      Joi.object({
        text: Joi.string().required(),
        included: Joi.boolean().default(true),
      })
    ).default([]),
    limits: Joi.object({
      maxAgents: Joi.number().integer().min(0).default(5),
      maxChatsPerDay: Joi.number().integer().min(0).default(100),
      maxTicketsPerDay: Joi.number().integer().min(0).default(50),
      maxKnowledgeItems: Joi.number().integer().min(0).default(100),
      aiEnabled: Joi.boolean().default(true),
      channels: Joi.array().items(Joi.string().valid('web', 'telegram', 'whatsapp', 'voice')),
      storageGb: Joi.number().min(0).default(5),
    }).default(),
    isActive: Joi.boolean().default(true),
    sortOrder: Joi.number().integer().default(0),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const updatePlan = {
  body: Joi.object({
    name: Joi.string().trim().max(100),
    code: Joi.string().trim().lowercase().pattern(/^[a-z0-9_-]+$/, 'alphanumeric, underscore, hyphen only'),
    description: Joi.string().max(500).allow(''),
    price: Joi.number().min(0),
    currency: Joi.string().uppercase(),
    interval: Joi.string().valid('monthly', 'yearly'),
    features: Joi.array().items(
      Joi.object({
        text: Joi.string().required(),
        included: Joi.boolean().default(true),
      })
    ),
    limits: Joi.object({
      maxAgents: Joi.number().integer().min(0),
      maxChatsPerDay: Joi.number().integer().min(0),
      maxTicketsPerDay: Joi.number().integer().min(0),
      maxKnowledgeItems: Joi.number().integer().min(0),
      aiEnabled: Joi.boolean(),
      channels: Joi.array().items(Joi.string().valid('web', 'telegram', 'whatsapp', 'voice')),
      storageGb: Joi.number().min(0),
    }),
    isActive: Joi.boolean(),
    sortOrder: Joi.number().integer(),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const assignPlan = {
  body: Joi.object({
    planId: Joi.string().required(),
    startDate: Joi.date().iso(),
    endDate: Joi.date().iso(),
    trialEndDate: Joi.date().iso(),
    autoRenew: Joi.boolean(),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const updateSubscription = {
  body: Joi.object({
    planId: Joi.string(),
    status: Joi.string().valid('active', 'trialing', 'past_due', 'canceled', 'expired'),
    startDate: Joi.date().iso(),
    endDate: Joi.date().iso(),
    trialEndDate: Joi.date().iso(),
    autoRenew: Joi.boolean(),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const updateBillingInfo = {
  body: Joi.object({
    email: Joi.string().email().allow(''),
    phone: Joi.string().allow(''),
    address: Joi.object({
      line1: Joi.string().allow(''),
      line2: Joi.string().allow(''),
      city: Joi.string().allow(''),
      state: Joi.string().allow(''),
      country: Joi.string().allow(''),
      postalCode: Joi.string().allow(''),
    }),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const addInvoice = {
  body: Joi.object({
    invoiceNumber: Joi.string().required(),
    amount: Joi.number().min(0).required(),
    currency: Joi.string().uppercase().default('USD'),
    status: Joi.string().valid('paid', 'pending', 'overdue', 'refunded', 'canceled').default('pending'),
    planId: Joi.string().allow('', null),
    planName: Joi.string().allow(''),
    periodStart: Joi.date().iso(),
    periodEnd: Joi.date().iso(),
    paidAt: Joi.date().iso(),
    dueDate: Joi.date().iso(),
    paymentMethod: Joi.string().allow(''),
    notes: Joi.string().allow(''),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const updateInvoice = {
  body: Joi.object({
    amount: Joi.number().min(0),
    currency: Joi.string().uppercase(),
    status: Joi.string().valid('paid', 'pending', 'overdue', 'refunded', 'canceled'),
    paidAt: Joi.date().iso().allow(null),
    dueDate: Joi.date().iso(),
    paymentMethod: Joi.string().allow(''),
    notes: Joi.string().allow(''),
  }).options({ stripUnknown: true, abortEarly: false }),
};

export {
  createPlan,
  updatePlan,
  assignPlan,
  updateSubscription,
  updateBillingInfo,
  addInvoice,
  updateInvoice,
};
