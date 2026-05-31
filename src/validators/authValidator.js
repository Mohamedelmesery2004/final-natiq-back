import Joi from 'joi';

const register = {
  body: Joi.object({
    companySlug: Joi.string().required().trim().lowercase(),
    name: Joi.string().required().trim().min(2).max(100),
    email: Joi.string().required().email().trim().lowercase(),
    password: Joi.string().required().min(6).max(128),
    phone: Joi.string().trim().allow(null, ''),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const login = {
  body: Joi.object({
    email: Joi.string().required().email().trim().lowercase(),
    password: Joi.string().required(),
    companySlug: Joi.string().required().trim().lowercase(),
  }).options({ stripUnknown: true, abortEarly: false }),
};

export { register, login };
