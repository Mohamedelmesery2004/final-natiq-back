import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import { AuditLog } from '../models/index.js';

/**
 * Compliance audit trail (separate from business EventLog).
 */
export async function recordAudit({
  companyId,
  actor,
  action,
  resourceType,
  targetId = null,
  details = {},
}) {
  try {
    await AuditLog.create({
      companyId,
      actorId: actor?._id || actor,
      actorEmail: actor?.email || null,
      actorName: actor?.name || null,
      action,
      resourceType,
      targetId,
      details,
    });
  } catch (err) {
    console.error('AuditLog record failed:', err.message);
  }
}

export async function listAuditLogs(companyId, { page = 1, limit = 30, action, resourceType, from, to } = {}) {
  const filter = { companyId };
  if (action) filter.action = action;
  if (resourceType) filter.resourceType = resourceType;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));

  const [total, items] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((p - 1) * l)
      .limit(l)
      .lean(),
  ]);

  return {
    items,
    page: p,
    limit: l,
    total,
    pages: Math.ceil(total / l) || 1,
  };
}
