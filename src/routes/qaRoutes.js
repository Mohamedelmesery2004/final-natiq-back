import { Router } from 'express';
import qaController from '../controllers/qaController.js';
import { protect, tenantIsolation, allowRoles } from '../middlewares/authMiddleware.js';
import validate from '../middlewares/validateMiddleware.js';
import * as qaValidator from '../validators/qaValidator.js';
import { ROLES } from '../constants/index.js';

const router = Router();

router.use(protect, tenantIsolation);

const qaAccess = allowRoles(
  ROLES.PLATFORM_SUPER_ADMIN,
  ROLES.COMPANY_MANAGER,
  ROLES.TEAM_LEADER,
  ROLES.AGENT
);

router.post(
  '/analyze',
  qaAccess,
  validate(qaValidator.analyzeRaw),
  qaController.analyzeRaw
);

router.post(
  '/analyze/:ticketId',
  qaAccess,
  validate(qaValidator.analyzeNatiqById),
  qaController.analyzeNatiqById
);

router.post(
  '/tickets/:ticketId/analyze',
  qaAccess,
  validate(qaValidator.analyzeById),
  qaController.analyzeById
);

router.get(
  '/results',
  qaAccess,
  validate(qaValidator.getResults),
  qaController.getAutomatedResults
);

router.get(
  '/results/:id',
  qaAccess,
  validate(qaValidator.getResultById),
  qaController.getAutomatedDetails
);

export default router;
