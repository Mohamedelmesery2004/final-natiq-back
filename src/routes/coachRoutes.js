import { Router } from 'express';
import coachController from '../controllers/coachController.js';
import { protect, tenantIsolation, allowRoles } from '../middlewares/authMiddleware.js';
import validate from '../middlewares/validateMiddleware.js';
import * as coachValidator from '../validators/coachValidator.js';
import { ROLES } from '../constants/index.js';

const router = Router();

router.use(protect, tenantIsolation);

const coachAccess = allowRoles(
  ROLES.PLATFORM_SUPER_ADMIN,
  ROLES.COMPANY_MANAGER,
  ROLES.TEAM_LEADER,
  ROLES.AGENT,
);

router.post(
  '/:ticketId',
  coachAccess,
  validate(coachValidator.startCoaching),
  coachController.startCoaching,
);

router.get(
  '/jobs/:jobId',
  coachAccess,
  validate(coachValidator.getJob),
  coachController.getJob,
);

export default router;
