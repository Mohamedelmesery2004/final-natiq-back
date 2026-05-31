import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import { Call, Ticket } from '../models/index.js';
import analyticsService from './analyticsService.js';

function escapeCsvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(headers, rows) {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  return lines.join('\r\n');
}

function parseDateRange(from, to) {
  const out = {};
  if (from) out.from = from;
  if (to) out.to = to;
  return Object.keys(out).length ? out : {};
}

export async function exportCallsCsv(companyId, { from, to } = {}) {
  const filter = { companyId };
  const dr = parseDateRange(from, to);
  if (dr.from || dr.to) {
    filter.createdAt = {};
    if (dr.from) filter.createdAt.$gte = new Date(dr.from);
    if (dr.to) filter.createdAt.$lte = new Date(dr.to);
  }

  const calls = await callRepo.model.find(filter)
    .sort({ createdAt: -1 })
    .populate('agentId', 'name email')
    .populate('customerId', 'name email')
    .lean();

  const headers = [
    'callId',
    'status',
    'customerName',
    'customerEmail',
    'agentName',
    'agentEmail',
    'durationSec',
    'startedAt',
    'endedAt',
    'createdAt',
  ];

  const rows = calls.map((c) => [
    c.callId,
    c.status,
    c.customerName || c.customerId?.name || '',
    c.customerId?.email || '',
    c.agentName || c.agentId?.name || '',
    c.agentId?.email || '',
    c.duration ?? '',
    c.startedAt ? new Date(c.startedAt).toISOString() : '',
    c.endedAt ? new Date(c.endedAt).toISOString() : '',
    c.createdAt ? new Date(c.createdAt).toISOString() : '',
  ]);

  return rowsToCsv(headers, rows);
}

export async function exportTicketsCsv(companyId, { from, to } = {}) {
  const filter = { companyId };
  const dr = parseDateRange(from, to);
  if (dr.from || dr.to) {
    filter.createdAt = {};
    if (dr.from) filter.createdAt.$gte = new Date(dr.from);
    if (dr.to) filter.createdAt.$lte = new Date(dr.to);
  }

  const tickets = await ticketRepo.model.find(filter)
    .sort({ createdAt: -1 })
    .populate('assignedTo', 'name email')
    .lean();

  const headers = [
    'ticketNumber',
    'status',
    'priority',
    'category',
    'subject',
    'assignedToName',
    'assignedToEmail',
    'createdAt',
    'resolvedAt',
  ];

  const rows = tickets.map((t) => [
    t.ticketNumber,
    t.status,
    t.priority,
    t.category,
    (t.subject || '').slice(0, 500),
    t.assignedTo?.name || '',
    t.assignedTo?.email || '',
    t.createdAt ? new Date(t.createdAt).toISOString() : '',
    t.resolvedAt ? new Date(t.resolvedAt).toISOString() : '',
  ]);

  return rowsToCsv(headers, rows);
}

export async function exportAnalyticsSummaryCsv(companyId, { from, to } = {}) {
  const overview = await analyticsService.getOverview(companyId, parseDateRange(from, to));
  const headers = ['section', 'metric', 'value'];
  const rows = [];
  if (overview.kpis) {
    for (const [k, v] of Object.entries(overview.kpis)) {
      rows.push(['kpis', k, v]);
    }
  }
  rows.push(['summary', 'topCategories', JSON.stringify(overview.topCategories || [])]);
  rows.push(['summary', 'topChannels', JSON.stringify(overview.topChannels || [])]);
  rows.push(['summary', 'topIntents', JSON.stringify(overview.topIntents || [])]);
  rows.push(['summary', 'topAgents', JSON.stringify(overview.topAgents || [])]);
  return rowsToCsv(headers, rows);
}
