import { Router } from 'express';
import internalMessageController from '../controllers/internalMessageController.js';
import { protect, tenantIsolation, requirePermission } from '../middlewares/authMiddleware.js';
import { RESOURCES, ACTIONS } from '../constants/index.js';

const router = Router();

router.use(protect, tenantIsolation);

router.get(
  '/users',
  requirePermission(RESOURCES.TICKET, ACTIONS.READ), // Agents can read
  internalMessageController.getUsers
);

router.get(
  '/:contactId',
  requirePermission(RESOURCES.TICKET, ACTIONS.READ),
  internalMessageController.getMessages
);

router.post(
  '/',
  requirePermission(RESOURCES.TICKET, ACTIONS.READ),
  internalMessageController.sendMessage
);

export default router;
