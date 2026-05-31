import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '../repositories/index.js';
import { EventLog } from '../models/index.js';

const logEvent = async ({ companyId, eventType, entityType, entityId, metadata = {} }) => {
  try {
    await EventLog.create({
      companyId,
      eventType,
      entityType,
      entityId,
      timestamp: new Date(),
      metadata,
    });
  } catch (error) {

        console.error('EventLog error:', error.message);
  }
};

export { logEvent };
