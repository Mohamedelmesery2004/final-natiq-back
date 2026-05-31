import { Router } from 'express';
import chatController from '../controllers/chatController.js';
import { protect, tenantIsolation, requirePermission } from '../middlewares/authMiddleware.js';
import chatUpload from '../middlewares/chatUploadMiddleware.js';
import validate from '../middlewares/validateMiddleware.js';
import * as chatValidator from '../validators/chatValidator.js';
import { RESOURCES, ACTIONS } from '../constants/index.js';

const router = Router();

router.use(protect, tenantIsolation);

router.post(
  '/sessions',
  requirePermission(RESOURCES.CHAT, ACTIONS.CREATE),
  validate(chatValidator.createSession),
  chatController.createSession
);

router.post(
  '/sessions/:sessionId/messages',
  requirePermission(RESOURCES.CHAT, ACTIONS.CREATE),
  validate(chatValidator.sendMessage),
  chatController.sendMessage
);

 router.post(
  '/sessions/:sessionId/media',
  requirePermission(RESOURCES.CHAT, ACTIONS.CREATE),
  chatUpload.single('media'),
  chatController.sendMediaMessage
);

router.get(
  '/sessions/my',
  requirePermission(RESOURCES.CHAT, ACTIONS.READ),
  validate(chatValidator.listSessions),
  chatController.getMySessions
);

router.post(
  '/sessions/:sessionId/close',
  requirePermission(RESOURCES.CHAT, ACTIONS.CREATE),
  chatController.closeSession
);

router.post(
  '/sessions/:sessionId/upload-recording',
  requirePermission(RESOURCES.CHAT, ACTIONS.CREATE),
  chatUpload.single('audio'),
  chatController.uploadSessionRecording
);

router.post(
  '/tts',
  requirePermission(RESOURCES.CHAT, ACTIONS.CREATE),
  chatController.generateTTS
);

export default router;
