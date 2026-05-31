import Joi from 'joi';

const overview = {
  query: Joi.object({
    from: Joi.date().iso(),
    to: Joi.date().iso(),
  }).options({ stripUnknown: true, abortEarly: false }),
};

export { overview };
