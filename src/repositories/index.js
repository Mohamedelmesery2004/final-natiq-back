import BaseRepository from './baseRepository.js';
import {
  Company,
  User,
  KnowledgeItem,
  ChatSession,
  Ticket,
  EventLog,
  TicketFeedback,
  QAAnalysis,
  Call,
  AuditLog,
  InternalMessage,
  Task,
  Notification,
  SubscriptionPlan,
} from '../models/index.js';

class CompanyRepository extends BaseRepository {}
class UserRepository extends BaseRepository {
  async findByEmail(email, companyId) {
    return await this.findOne({ email, companyId });
  }
}
class KnowledgeItemRepository extends BaseRepository {}
class ChatSessionRepository extends BaseRepository {}
class TicketRepository extends BaseRepository {}
class EventLogRepository extends BaseRepository {}
class TicketFeedbackRepository extends BaseRepository {}
class QAAnalysisRepository extends BaseRepository {}
class CallRepository extends BaseRepository {}
class AuditLogRepository extends BaseRepository {}
class InternalMessageRepository extends BaseRepository {}
class TaskRepository extends BaseRepository {}
class NotificationRepository extends BaseRepository {}

export const companyRepo = new CompanyRepository(Company);
export const userRepo = new UserRepository(User);
export const knowledgeItemRepo = new KnowledgeItemRepository(KnowledgeItem);
export const chatSessionRepo = new ChatSessionRepository(ChatSession);
export const ticketRepo = new TicketRepository(Ticket);
export const eventLogRepo = new EventLogRepository(EventLog);
export const ticketFeedbackRepo = new TicketFeedbackRepository(TicketFeedback);
export const qaAnalysisRepo = new QAAnalysisRepository(QAAnalysis);
export const callRepo = new CallRepository(Call);
export const auditLogRepo = new AuditLogRepository(AuditLog);
export const internalMessageRepo = new InternalMessageRepository(InternalMessage);
export const taskRepo = new TaskRepository(Task);
export const notificationRepo = new NotificationRepository(Notification);

class SubscriptionPlanRepository extends BaseRepository {}
export const subscriptionPlanRepo = new SubscriptionPlanRepository(SubscriptionPlan);
