import { Router } from 'express';
import ownerController from '../controllers/ownerController.js';
import { protect, tenantIsolation, allowRoles } from '../middlewares/authMiddleware.js';
import validate from '../middlewares/validateMiddleware.js';
import * as ownerValidator from '../validators/ownerValidator.js';
import { ROLES } from '../constants/index.js';

const router = Router();

// All owner routes: platform-level access (Natiq team)
router.use(protect, tenantIsolation, allowRoles(ROLES.COMPANY_OWNER, ROLES.PLATFORM_SUPER_ADMIN));

// ── Owner Profile / Settings ─────────────────────
router.get('/settings', ownerController.getOwnerSettings);
router.put('/settings', ownerController.updateOwnerSettings);

// ── Dashboard ────────────────────────────────────
router.get('/dashboard', ownerController.getOwnerDashboard);
router.get('/dashboard/overview', ownerController.getOwnerDashboard);

// ── Analytics (Platform-wide) ────────────────────
router.get('/analytics/overview', ownerController.getAnalyticsOverview);

// ── Subscription Plans (Tiers) ───────────────────
router.get('/plans', ownerController.listPlans);
router.get('/plans/:planId', ownerController.getPlan);
router.post('/plans', validate(ownerValidator.createPlan), ownerController.createPlan);
router.put('/plans/:planId', validate(ownerValidator.updatePlan), ownerController.updatePlan);
router.delete('/plans/:planId', ownerController.deletePlan);
router.patch('/plans/:planId/toggle', ownerController.togglePlanActive);

// ── Managers (backward compat) ────────────────────
router.get('/managers', ownerController.listManagers);

// ── Companies (Owner platform view) ──────────────
router.get('/companies', ownerController.listAllCompanies);
router.get('/companies/:companyId', ownerController.getCompanyDetail);

// ── Company Subscriptions ────────────────────────
router.get('/subscriptions', ownerController.listCompanySubscriptions);
router.get('/subscriptions/:companyId', ownerController.getCompanySubscription);
router.post('/subscriptions/:companyId/assign', validate(ownerValidator.assignPlan), ownerController.assignPlanToCompany);
router.put('/subscriptions/:companyId', validate(ownerValidator.updateSubscription), ownerController.updateCompanySubscription);
router.post('/subscriptions/:companyId/cancel', ownerController.cancelCompanySubscription);

// ── Billing Info ─────────────────────────────────
router.put('/billing/:companyId', validate(ownerValidator.updateBillingInfo), ownerController.updateBillingInfo);

// ── Invoices ─────────────────────────────────────
router.get('/invoices/:companyId', ownerController.listInvoices);
router.post('/invoices/:companyId', validate(ownerValidator.addInvoice), ownerController.addInvoice);
router.put('/invoices/:companyId/:invoiceId', validate(ownerValidator.updateInvoice), ownerController.updateInvoice);

export default router;
