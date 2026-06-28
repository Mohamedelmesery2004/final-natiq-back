import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { User, Company } from '../models/index.js';
import ApiError from '../utils/apiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { RBAC_MATRIX, ROLES } from '../constants/index.js';

const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    throw ApiError.unauthorized('Access denied. No token provided.');
  }

  const decoded = jwt.verify(token, config.jwt.secret);

  const user = await User.findById(decoded.id).select('-passwordHash');
  if (!user) {
    throw ApiError.unauthorized('User belonging to this token no longer exists.');
  }

  if (!user.isActive) {
    throw ApiError.unauthorized('User account is deactivated.');
  }

  req.user = user;
  req.userId = user._id;
  req.companyId = user.companyId;
  req.userRole = user.role;

  next();
});

const tenantIsolation = asyncHandler(async (req, res, next) => {

    if (req.userRole === ROLES.PLATFORM_SUPER_ADMIN || req.userRole === ROLES.COMPANY_OWNER) {
    const explicitCompanyId = req.query?.companyId || req.body?.companyId;
    if (explicitCompanyId) {
      const company = await Company.findById(explicitCompanyId);
      if (!company) {
        throw ApiError.notFound('Company not found');
      }
      req.companyId = company._id;
    }

        return next();
  }

  if (!req.companyId) {
    throw ApiError.forbidden('Tenant context is missing.');
  }

  const company = await Company.findById(req.companyId);
  if (!company || !company.isActive) {
    throw ApiError.forbidden('Company is inactive or does not exist.');
  }

  next();
});

const requirePermission = (resource, action) => {
  return (req, res, next) => {
    const role = req.userRole;
    if (!role) {
      throw ApiError.unauthorized('No role found for user.');
    }

    const permissions = RBAC_MATRIX[role];
    if (!permissions) {
      throw ApiError.forbidden('No permissions defined for this role.');
    }

    const resourcePermissions = permissions[resource];
    if (!resourcePermissions || !resourcePermissions.includes(action)) {
      throw ApiError.forbidden(
        `Access denied. Role '${role}' does not have '${action}' permission on '${resource}'.`
      );
    }

    next();
  };
};

const allowRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      throw ApiError.forbidden(
        `Access denied. Required roles: ${roles.join(', ')}`
      );
    }
    next();
  };
};

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      companyId: user.companyId,
      role: user.role,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
};

export {
  protect,
  tenantIsolation,
  requirePermission,
  allowRoles,
  generateToken,
};
