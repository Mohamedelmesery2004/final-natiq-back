import Joi from 'joi';

const objectId = Joi.string()
  .pattern(/^[a-fA-F0-9]{24}$/)
  .required()
  .messages({
    'string.pattern.base': 'Invalid ID format',
    'any.required': 'ID is required',
  });

export const startCoaching = {
  params: Joi.object({
    ticketId: objectId,
  }),
};

export const getJob = {
  params: Joi.object({
    jobId: objectId,
  }),
};
