import { Router } from 'express';
import teamLeaderController from '../controllers/teamLeaderController.js';
import qaController from '../controllers/qaController.js';
import { protect, tenantIsolation, allowRoles } from '../middlewares/authMiddleware.js';
import { ROLES } from '../constants/index.js';

const router = Router();

// Ensure all routes are protected, tenant-isolated, and restricted to Team Leaders or above
router.use(protect, tenantIsolation, allowRoles(ROLES.TEAM_LEADER, ROLES.COMPANY_MANAGER, ROLES.PLATFORM_SUPER_ADMIN));

router.get('/dashboard', teamLeaderController.getDashboard);
router.get('/agents', teamLeaderController.getAgents);
router.get('/agents/:agentId/performance', teamLeaderController.getAgentPerformance);
router.get('/agents/:agentId/profile', teamLeaderController.getAgentProfile);
router.post('/agents/:agentId/notify', teamLeaderController.notifyAgent);

router.post('/tickets/assign', teamLeaderController.assignTickets);
router.get('/tickets/queue/unassigned', teamLeaderController.getUnassignedQueue);
router.get('/tickets', teamLeaderController.getCompanyTickets);
router.get('/tickets/:ticketId/messages', teamLeaderController.getTicketMessages);
router.patch('/tickets/:ticketId/qa-notes', teamLeaderController.appendTicketQANote);
router.patch('/agents/:agentId/supervisor-notes', teamLeaderController.appendAgentSupervisorNote);

router.get('/calls', teamLeaderController.getCalls);

// QA Analysis (reuse existing QA controller)
router.get('/qa/results', qaController.getAutomatedResults);
router.get('/qa/results/:id', qaController.getAutomatedDetails);
router.post('/qa/tickets/:ticketId/analyze', qaController.analyzeById);

export default router;
