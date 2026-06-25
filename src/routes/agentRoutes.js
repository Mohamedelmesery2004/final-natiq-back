import { Router } from 'express';
import agentController from '../controllers/agentController.js';
import taskController from '../controllers/taskController.js';
import notificationController from '../controllers/notificationController.js';
import { protect, tenantIsolation, allowRoles } from '../middlewares/authMiddleware.js';
import validate from '../middlewares/validateMiddleware.js';
import * as agentValidator from '../validators/agentValidator.js';
import upload from '../middlewares/uploadMiddleware.js';
import chatUpload from '../middlewares/chatUploadMiddleware.js';
import { ROLES } from '../constants/index.js';

const router = Router();

router.post('/auth/login', validate(agentValidator.agentLogin), agentController.login);

router.use(protect, tenantIsolation, allowRoles(ROLES.AGENT));

router.get('/profile', agentController.getProfile);
router.patch('/profile', upload.single('profileImage'), validate(agentValidator.updateProfile), agentController.updateProfile);

router.get('/dashboard/overview', validate(agentValidator.dashboardOverview), agentController.getDashboard);

router.get('/tickets', validate(agentValidator.listAgentTickets), agentController.listTickets);
router.get('/tickets/:ticketId', validate(agentValidator.ticketIdParam), agentController.getTicket);
router.get('/tickets/:ticketId/messages', validate(agentValidator.ticketIdParam), agentController.getTicketMessages);
router.post('/tickets/:ticketId/claim', validate(agentValidator.ticketIdParam), agentController.claimTicket);
router.post('/tickets/:ticketId/reply', validate(agentValidator.agentReply), agentController.replyToTicket);
router.post('/tickets/:ticketId/media-reply', chatUpload.single('media'), agentController.replyMediaToTicket);
router.post('/tickets/:ticketId/resolve', validate(agentValidator.ticketIdParam), agentController.resolveTicket);
router.post('/tickets/:ticketId/close', validate(agentValidator.ticketIdParam), agentController.closeTicket);

router.get('/chat-history/:sessionId', validate(agentValidator.sessionIdParam), agentController.getChatHistory);

// Analytics
router.get('/analytics/overview', validate(agentValidator.analyticsQuery), agentController.getAnalyticsOverview);
router.get('/analytics/tickets', validate(agentValidator.analyticsQuery), agentController.getTicketAnalytics);
router.get('/analytics/time-series', validate(agentValidator.analyticsQuery), agentController.getTimeSeries);
router.get('/analytics/quality', agentController.getQualityMetrics);
router.get('/analytics/insights', agentController.getInsights);

// Tasks
router.get('/tasks', taskController.getTasks);
router.post('/tasks', taskController.createTask);
router.patch('/tasks/:taskId', taskController.updateTask);
router.delete('/tasks/:taskId', taskController.deleteTask);

// Notifications
router.get('/notifications', notificationController.getNotifications);
router.patch('/notifications/read-all', notificationController.markAllAsRead);
router.patch('/notifications/:notificationId/read', notificationController.markAsRead);

export default router;
