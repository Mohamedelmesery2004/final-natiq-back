import Joi from 'joi';
import { ROLES } from '../constants/index.js';

const createUser = {
  body: Joi.object({
    name: Joi.string().required().trim().min(2).max(100),
    email: Joi.string().required().email().trim().lowercase(),
    password: Joi.string().required().min(6).max(128),
    phone: Joi.string().trim().allow(null, ''),
    role: Joi.string()
      .valid(ROLES.COMPANY_MANAGER, ROLES.TEAM_LEADER, ROLES.AGENT)
      .required(),
    profileImage: Joi.string().uri().allow(null, ''),
    teamLeaderId: Joi.string().optional().allow(null),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const updateUser = {
  params: Joi.object({
    id: Joi.string().required(),
  }).options({ stripUnknown: true, abortEarly: false }),
  body: Joi.object({
    name: Joi.string().trim().min(2).max(100),
    phone: Joi.string().trim().allow(null, ''),
    role: Joi.string().valid(ROLES.COMPANY_MANAGER, ROLES.TEAM_LEADER, ROLES.AGENT),
    isActive: Joi.boolean(),
    profileImage: Joi.string().uri().allow(null, ''),
    teamLeaderId: Joi.string().optional().allow(null),
  }).options({ stripUnknown: true, abortEarly: false }),
};

const listUsers = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(200).default(20),
    role: Joi.string().valid(...Object.values(ROLES)),
    isActive: Joi.boolean(),
    search: Joi.string().trim(),
  }).options({ stripUnknown: true, abortEarly: false }),
};

export { createUser, updateUser, listUsers };
