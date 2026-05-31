import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import BaseController from './baseController.js';
import { RBAC_MATRIX, ROLES } from '../constants/index.js';
import { listAuditLogs } from '../services/auditLogService.js';
import {
  exportCallsCsv,
  exportTicketsCsv,
  exportAnalyticsSummaryCsv,
} from '../services/exportService.js';

const ROLE_LABELS = {
  [ROLES.PLATFORM_SUPER_ADMIN]: 'Super Admin',
  [ROLES.COMPANY_MANAGER]: 'Company Manager',
  [ROLES.TEAM_LEADER]: 'Supervisor',
  [ROLES.AGENT]: 'Agent',
  [ROLES.CUSTOMER]: 'Customer',
};

class ManagerController extends BaseController {
  listAuditLogs = this.catchAsync(async (req, res) => {
    const result = await listAuditLogs(req.companyId, req.query);
    this.sendSuccess(res, result, 'Audit logs retrieved');
  });

  getRbacMatrix = this.catchAsync(async (req, res) => {
    this.sendSuccess(
      res,
      {
        matrix: RBAC_MATRIX,
        roleLabels: ROLE_LABELS,
      },
      'RBAC matrix'
    );
  });

  exportCalls = this.catchAsync(async (req, res) => {
    const csv = await exportCallsCsv(req.companyId, req.query);
    const filename = `calls-export-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
  });

  exportTickets = this.catchAsync(async (req, res) => {
    const csv = await exportTicketsCsv(req.companyId, req.query);
    const filename = `tickets-export-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
  });

  exportAnalyticsSummary = this.catchAsync(async (req, res) => {
    const csv = await exportAnalyticsSummaryCsv(req.companyId, req.query);
    const filename = `analytics-summary-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
  });
}

export default new ManagerController();
