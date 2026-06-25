# Chapter 5: Backend Implementation

## 5.3 Backend Implementation

The backend implementation forms the computational foundation of the Natiq platform, a multi-channel AI-powered customer service system. The system is engineered to meet three principal design goals: scalability to handle concurrent interactions across heterogeneous channels, maintainability through strict separation of concerns and adherence to established design patterns, and modularity to enable independent evolution of channel integrations, AI providers, and business logic.

The technology stack is derived entirely from the project's dependencies. Node.js provides the asynchronous, event-driven runtime. Express 5 serves as the web framework with its middleware pipeline architecture. MongoDB accessed via Mongoose 9 ODM is the persistence layer, chosen for its schema flexibility and native support for embedded document arrays -- a critical requirement for storing conversational message histories within session documents. Three AI providers are integrated: Google Gemini for conversational AI, Groq (LLaMA 3.3-70B) for quality assurance analysis, and HuggingFace Inference API (`BAAI/bge-small-en-v1.5`) for semantic embedding generation. Real-time bidirectional communication is implemented through Socket.IO with three namespace-partitioned channels. JWT-based authentication governs a six-role RBAC authorization model with resource-level permissions across eight resource categories.

---

### 5.3.1 Architecture Overview and Flow

The system adopts a **Layered Architecture** with five distinct strata: API, Application, Domain, Infrastructure, and Cross-Cutting. This architectural style was selected for the following reasons:

1. **Channel Agnosticism**: The multi-channel requirement (web, Telegram, WhatsApp, voice) demands that core business logic remain independent of channel-specific protocols. The layered approach isolates channel handling in the API layer and channel service modules, allowing the conversational AI engine to operate identically regardless of ingress channel.

2. **Provider Abstraction**: Integration with three AI providers (Gemini, Groq, HuggingFace) requires clean boundaries. Each provider is encapsulated behind its own utility module, enabling substitution without affecting consuming services.

3. **Separation of Concerns**: The six-role RBAC system with granular resource-level permissions benefits from clear layer boundaries. Authentication middleware handles identity verification, authorization middleware checks permissions, and service methods implement business rules -- each layer with a singular responsibility.

The system diverges from a pure Clean Architecture in favor of a pragmatic hybrid. The Repository pattern abstracts data access, the Service layer encapsulates business rules, and the Domain layer defines entities and invariants. However, the absence of explicit Use Case or CQRS interfaces reflects a deliberate simplification appropriate for the domain complexity, reducing boilerplate while maintaining testability.

#### Full Request Lifecycle

The complete path of an HTTP request through the system follows a well-defined pipeline:

```
HTTP Request
  → Express Application (src/app.js)
    → Global Middleware: Helmet → CORS → Rate Limiter → JSON Parser
      → Cookie Parser → Compression → Morgan Logger
    → Route Resolution (/api/v1/...)
      → Route-Level Middleware Stack:
        → protect (JWT verification, user hydration)
        → tenantIsolation (company scope enforcement)
        → requirePermission / allowRoles (RBAC authorization)
        → validate (Joi schema validation)
      → Controller Method (catchAsync-wrapped)
        → Parameter extraction from request
        → Delegation to Service Layer
          → Business logic execution with error validation
          → Data access via Repository Layer
            → Mongoose Model operations
          → External AI service calls
          → Event/Audit logging (fire-and-forget)
        → Response via sendSuccess/sendPaginated
    → Not Found Handler (404, unmatched routes)
    → Global Error Handler (operational and programmer errors)
```

---

#### 5.3.1.1 Controllers and Entry Points

The controller layer comprises twenty-one controller modules. Each extends the shared `BaseController`, which provides standardized response formatting and asynchronous error propagation.

**BaseController**

```javascript
class BaseController {
    sendSuccess(res, data = null, message = 'Success', statusCode = 200) {
    return sendSuccess(res, data, message, statusCode);
  }

  sendPaginated(res, data, pagination, message = 'Success') {
    return sendPaginated(res, data, pagination, message);
  }

  catchAsync(fn) {
    return asyncHandler(fn.bind(this));
  }
}
```

The `catchAsync` method wraps every controller handler with the `asyncHandler` utility, which captures rejected promises and forwards them to Express's error middleware. This eliminates the need for try-catch blocks in every controller method. `sendSuccess` and `sendPaginated` enforce a consistent response envelope (`{ success, message, data, pagination }`) across all endpoints.

**AuthController**

Responsible for public-facing identity operations: customer registration, login, profile retrieval, and company discovery. Delegates to `AuthService` for password hashing, credential validation, and JWT generation.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `register` | POST /api/v1/auth/register | Customer registration |
| `login` | POST /api/v1/auth/login | Customer authentication |
| `getMe` | GET /api/v1/auth/me | Authenticated user profile |
| `getPublicCompanies` | GET /api/v1/auth/companies | Active company listing |

**AgentController**

The largest controller, encompassing the complete agent workflow: authentication, profile management, ticket operations, dashboard retrieval, and chat history access.

```javascript
class AgentController extends BaseController {
  login = this.catchAsync(async (req, res) => {
    const { email, password, companySlug } = req.body;
    const company = await companyRepo.findOne({ slug: companySlug, isActive: true });
    if (!company) throw ApiError.unauthorized('Invalid company or credentials');
    const user = await userRepo.findOne({ companyId: company._id, email });
    if (!user) throw ApiError.unauthorized('Invalid email or password');
    if (!user.isActive) throw ApiError.unauthorized('Account is deactivated');
    if (user.role !== ROLES.AGENT && user.role !== ROLES.TEAM_LEADER &&
        user.role !== ROLES.COMPANY_MANAGER && user.role !== ROLES.COMPANY_OWNER) {
      throw ApiError.forbidden('This login is for agents, team leaders, managers, and company owners');
    }
    const isMatch = await user.comparePassword(password);
    if (!isMatch) throw ApiError.unauthorized('Invalid email or password');
    user.lastLogin = new Date();
    await user.save();
    const token = generateToken(user);
    this.sendSuccess(res, { user: user.toJSON(), token }, 'Agent login successful');
  });
```

This snippet demonstrates the controller pattern: extraction of request parameters, repository interaction for data access, business rule validation (active account, role check), authentication via bcrypt comparison, JWT generation, and standardized response formatting. Each failure path throws an `ApiError` with an appropriate HTTP status code, which is caught by the global error handler.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `login` | POST /api/v1/agent/auth/login | Agent authentication |
| `claimTicket` | POST /api/v1/agent/tickets/:ticketId/claim | Claim unassigned ticket |
| `replyToTicket` | POST /api/v1/agent/tickets/:ticketId/reply | Agent reply |
| `resolveTicket` | POST /api/v1/agent/tickets/:ticketId/resolve | Resolve ticket |
| `closeTicket` | POST /api/v1/agent/tickets/:ticketId/close | Close ticket and session |
| `getDashboard` | GET /api/v1/agent/dashboard/overview | Agent performance KPIs |
| `listTickets` | GET /api/v1/agent/tickets | Scoped ticket listing |

**ChatController**

Core conversational interface endpoint for the web chat channel. Handles session management, message processing (which triggers AI inference), media uploads, text-to-speech generation, and session lifecycle.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `createSession` | POST /api/v1/chat/sessions | Create session |
| `sendMessage` | POST /api/v1/chat/sessions/:sessionId/messages | Process message via AI |
| `generateTTS` | POST /api/v1/chat/tts | ElevenLabs TTS |
| `getMySessions` | GET /api/v1/chat/sessions/my | User sessions |

**TeamLeaderController**

Supervisory controller providing team-level dashboards, agent performance evaluation, bulk ticket assignment, and quality assurance workflow management.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `getDashboard` | GET /api/v1/team-leader/dashboard | Team KPIs and trends |
| `getAgentPerformance` | GET /api/v1/team-leader/agents/:agentId/performance | Period-based analytics |
| `assignTickets` | POST /api/v1/team-leader/tickets/assign | Bulk assignment |
| `appendTicketQANote` | PATCH /api/v1/team-leader/tickets/:ticketId/qa-notes | QA coaching feedback |

The complete list of twenty-one controllers covers: auth, platform, admin users, knowledge, embeddings, chat, admin chat, tickets, admin tickets, channels (Telegram/WhatsApp), analytics, agent, QA, calls, team leader, manager, owner, notifications, tasks, and internal messages.

---

#### 5.3.1.2 Layered Architecture Breakdown

##### API Layer

The outermost layer handles HTTP protocol concerns: request parsing, authentication, authorization, validation, and response formatting.

**Components**: 21 controllers, 5 middleware modules, 18 route definitions.

The route definitions declare the middleware chain applied before each controller, making the security posture of every endpoint immediately visible:

```javascript
// src/routes/agentRoutes.js
import { Router } from 'express';
import agentController from '../controllers/agentController.js';
import { protect, tenantIsolation, allowRoles } from '../middlewares/authMiddleware.js';
import validate from '../middlewares/validateMiddleware.js';
import * as agentValidator from '../validators/agentValidator.js';
import { ROLES } from '../constants/index.js';

const router = Router();

// Public route (no authentication)
router.post('/auth/login', validate(agentValidator.agentLogin), agentController.login);

// Protected routes (all require authentication, tenant isolation, AGENT role)
router.use(protect, tenantIsolation, allowRoles(ROLES.AGENT));

router.get('/profile', agentController.getProfile);
router.get('/dashboard/overview', validate(agentValidator.dashboardOverview), agentController.getDashboard);
router.get('/tickets', validate(agentValidator.listAgentTickets), agentController.listTickets);
router.post('/tickets/:ticketId/claim', validate(agentValidator.ticketIdParam), agentController.claimTicket);
router.post('/tickets/:ticketId/reply', validate(agentValidator.agentReply), agentController.replyToTicket);
router.post('/tickets/:ticketId/close', validate(agentValidator.ticketIdParam), agentController.closeTicket);
```

This routing structure demonstrates the chain of responsibility: `protect` verifies the JWT and hydrates the user, `tenantIsolation` enforces company-scoped data access, `allowRoles` gates by role, `validate` applies Joi schema validation, and the controller executes the business logic. The middleware is declared once at the router level for all protected routes, ensuring consistent application.

The global middleware pipeline in `src/app.js` configures security (Helmet, CORS, rate limiting), request parsing (JSON up to 10MB, URL-encoded, cookies), compression, and logging (Morgan with dev/combined formats dependent on environment).

##### Application Layer

The thickest layer, containing all business logic, use case orchestration, and cross-service coordination.

**Components**: AuthService, TicketService, QAService (484 lines), EmbeddingService, TeamLeaderService (672 lines), AgentTicketService (483 lines), MessageProcessor (276 lines), ChatSessionManager, AnalyticsService, EventLogService, AuditLogService, ExportService, TelegramService, plus subdirectory services for agent dashboards, channel integrations, QA analysis, and translation.

The `AuthService` demonstrates service-layer encapsulation of business rules:

```javascript
// src/services/authService.js
class AuthService {
  async register({ companySlug, name, email, password, phone }) {
    const company = await companyRepo.findOne({ slug: companySlug, isActive: true });
    if (!company) throw ApiError.notFound('Company not found or inactive');
    const existingUser = await userRepo.findOne({ companyId: company._id, email });
    if (existingUser) throw ApiError.conflict('User with this email already exists in this company');
    const user = await userRepo.create({
      companyId: company._id, name, email,
      passwordHash: password, phone: phone || null,
      role: ROLES.CUSTOMER,
    });
    const token = generateToken(user);
    return { user: user.toJSON(), token };
  }

  async login({ email, password, companySlug }) {
    const company = await companyRepo.findOne({ slug: companySlug });
    if (!company) throw ApiError.notFound('Company not found');
    const user = await userRepo.findOne({ companyId: company._id, email });
    if (!user) throw ApiError.unauthorized('Invalid email or password');
    if (!user.isActive) throw ApiError.unauthorized('Account is deactivated');
    const isMatch = await user.comparePassword(password);
    if (!isMatch) throw ApiError.unauthorized('Invalid email or password');
    user.lastLogin = new Date();
    await user.save();
    const token = generateToken(user);
    return { user: user.toJSON(), token };
  }
}
```

The service methods are pure business logic: they validate domain rules (company existence, email uniqueness, credential matching), interact with the repository layer for persistence, and return structured results. They are independent of HTTP concerns, making them testable without HTTP infrastructure and reusable across different channels (HTTP, Socket.IO events).

##### Domain Layer

Defines business entities, their relationships, constraints, and behaviors through Mongoose schemas.

**Components**: 13 Mongoose models (User, Company, KnowledgeItem, ChatSession, Ticket, TicketFeedback, QAAnalysis, Call, EventLog, AuditLog, InternalMessage, Task, Notification).

The User model demonstrates the domain layer's responsibilities:

```javascript
// src/models/user.js
const userSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, lowercase: true, trim: true },
  role: { type: String, enum: Object.values(ROLES), required: true, default: ROLES.CUSTOMER },
  passwordHash: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  teamLeaderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  supervisorNotes: [{
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true, maxlength: 8000 },
    createdAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

userSchema.index({ companyId: 1, email: 1 }, { unique: true });  // Tenant-scoped unique email
userSchema.index({ telegramChatId: 1 }, { sparse: true });        // Sparse index for optional field

userSchema.pre('save', async function () {
  if (!this.isModified('passwordHash')) return;
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  return obj;
};
```

This model enforces several domain invariants: the compound unique index on `(companyId, email)` ensures email uniqueness within each tenant; the `pre-save` hook automatically hashes passwords before persistence; the `comparePassword` instance method encapsulates bcrypt comparison logic; the custom `toJSON` method prevents password hash leakage in serialization output. The `supervisorNotes` embedded subdocument array captures coaching feedback from team leaders, demonstrating the document-model approach to hierarchical data relationships.

##### Infrastructure Layer

Provides data access abstractions and external service integrations.

**Components**: BaseRepository + 13 repository instances, AI provider utilities (Gemini, Groq, HuggingFace), channel-specific services (Telegram, WhatsApp), Socket.IO initialization.

The `BaseRepository` abstracts all common database operations behind a consistent interface:

```javascript
// src/repositories/baseRepository.js
class BaseRepository {
  constructor(model) { this.model = model; }

  async create(data) { return await this.model.create(data); }
  async findById(id, select = '') {
    let query = this.model.findById(id);
    if (select) query = query.select(select);
    return await query.exec();
  }
  async find(filter = {}, options = {}) {
    let query = this.model.find(filter);
    if (options.select) query = query.select(options.select);
    if (options.sort) query = query.sort(options.sort);
    if (options.limit) query = query.limit(options.limit);
    if (options.skip) query = query.skip(options.skip);
    if (options.populate) query = query.populate(options.populate);
    return await query.exec();
  }
  async findWithPagination(filter = {}, page = 1, limit = 10, options = {}) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.find(filter, { ...options, skip, limit }),
      this.count(filter),
    ]);
    return { data, total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) };
  }
  async update(id, data, options = { new: true }) {
    return await this.model.findByIdAndUpdate(id, data, options).exec();
  }
  async delete(id) { return await this.model.findByIdAndDelete(id).exec(); }
  async count(filter = {}) { return await this.model.countDocuments(filter).exec(); }
  async aggregate(pipeline) { return await this.model.aggregate(pipeline).exec(); }
}
```

Thirteen repository instances are created from this base, each bound to a specific model:

```javascript
export const companyRepo = new CompanyRepository(Company);
export const userRepo = new UserRepository(User);
export const ticketRepo = new TicketRepository(Ticket);
export const chatSessionRepo = new ChatSessionRepository(ChatSession);
// ... 9 more repositories
```

The `UserRepository` extends the base with a domain-specific query method (`findByEmail`), demonstrating how the Repository pattern accommodates specialization while maintaining a consistent interface. Services depend on repositories rather than models directly, achieving persistence ignorance -- service code does not import or reference Mongoose APIs.

---

### 5.3.2 Architectural Patterns Detected

**Repository Pattern**

Implemented in full form through the `BaseRepository` class hierarchy. Each repository encapsulates a Mongoose model and exposes generic CRUD operations. Services interact with repositories rather than models directly, decoupling business logic from persistence technology. The pattern is demonstrated at the infrastructure layer: `AuthService.register` calls `userRepo.create(...)` and `companyRepo.findOne(...)`, with no direct Mongoose usage in the service code. If the data store were migrated from MongoDB to another database, only the repository implementations would require modification.

**Service Layer Pattern**

All business logic resides in service modules, with controllers acting as thin HTTP adapters. This separation enables logic reuse across HTTP endpoints, Socket.IO event handlers (e.g., `agentTicketService.agentReplyToTicket` is called from both the REST controller `agentController.replyToTicket` and the Socket.IO event `ticket:sendMessage`), and potential future channel integrations.

**Middleware Pipeline Pattern**

Express middleware is used extensively for cross-cutting concerns. The system implements a three-tier middleware stack: global middleware (security headers, parsing, compression, logging), route-level middleware (authentication, authorization, validation), and controller handlers. Errors propagate back through the pipeline to the global error handler, which transforms exceptions into standardized error responses.

**Singleton Pattern**

All controllers and services are exported as singleton instances. This ensures a single instance handles all requests, avoiding redundant object instantiation and enabling shared state for database connection pools and AI client configurations.

```javascript
export default new AuthService();   // Singleton pattern
export default new TicketService(); // Singleton pattern
```

**Observer Pattern (Event-Driven Logging)**

The `EventLogService` and `AuditLogService` implement a lightweight event-driven pattern. Service methods call these as fire-and-forget operations, creating immutable event records in separate collections. This decouples core business operations from compliance and analytics logging, ensuring that logging failures do not affect primary business flows:

```javascript
// Used extensively: fire-and-forget domain event logging
await logEvent({
  companyId,
  eventType: EVENT_TYPES.TICKET_CLAIMED,
  entityType: 'ticket',
  entityId: ticket._id,
  metadata: { agentId, ticketNumber: ticket.ticketNumber },
});
```

**Strategy Pattern (AI Provider Isolation)**

Three AI providers are each encapsulated behind their own utility module: Google Gemini in `utils/ai.js`, Groq in `services/qaService.js`, and HuggingFace in `utils/embeddings.js`. While the codebase does not implement a formal strategy interface, the structural separation achieves the same goal -- provider-specific implementation details are isolated, and substitution requires changes only within the provider's module.

---

### 5.3.3 Feature-Based Implementation

#### 5.3.3.1 Multi-Channel Conversational AI

**Functional Description**

AI-powered customer support across web chat, Telegram, WhatsApp, and voice channels. The system maintains session state, performs semantic knowledge retrieval, generates contextually aware responses via Google Gemini, detects intent with confidence scoring, and automatically creates support tickets when escalation thresholds are exceeded.

**Endpoints**

- `POST /api/v1/chat/sessions` -- Create session
- `POST /api/v1/chat/sessions/:sessionId/messages` -- Process message via AI
- `POST /api/v1/chat/tts` -- ElevenLabs TTS generation
- `POST /api/v1/channels/telegram/webhook` -- Telegram inbound webhook
- `POST /api/v1/channels/whatsapp/mock-webhook` -- WhatsApp inbound webhook

**Core Engine: MessageProcessor**

The `MessageProcessor.processMessage` method is the system's central AI orchestration engine. It receives messages from any channel and performs knowledge retrieval, prompt construction, Gemini invocation, and ticket escalation:

```javascript
async processMessage(companyId, sessionId, userMessage, channel = 'web', media = null, skipUserMessageSave = false) {
    const session = await chatSessionRepo.findOne({ companyId, sessionId, status: CHAT_STATUS.ACTIVE });
    if (!session) throw new Error('Active chat session not found');

    const [company, user, userTickets] = await Promise.all([
      companyRepo.model.findById(companyId),
      userRepo.model.findById(session.userId).select('name email phone role telegramChatId createdAt'),
      ticketRepo.model.find({ companyId, userId: session.userId })
        .sort({ createdAt: -1 }).limit(5).select('ticketNumber category priority status createdAt'),
    ]);

    // Save user message to session
    session.messages.push({ role: 'user', content: userMessage, timestamp: new Date(), meta: { channel } });
    session.messageCount += 1;
    session.lastActivity = new Date();

    // Semantic knowledge retrieval
    const relevantKnowledge = await this.findRelevantKnowledge(companyId, userMessage);
    const knowledgeContext = relevantKnowledge.map(k => `[${k.item.type}] ${k.item.title}: ${k.item.content}`);

    // Build context-rich system prompt with user profile + ticket history + domain rules
    const systemPrompt = `You are an AI customer support assistant...`;  // comprehensive prompt

    // Invoke Gemini AI
    const aiResult = await getAIResponse({
      systemPrompt,
      messages: session.messages.filter(m => m.role !== 'system').slice(-10),
      userMessage,
      knowledgeContext,
    });

    // Save AI response
    session.messages.push({ role: 'assistant', content: aiResult.answer, timestamp: new Date(), meta: { ... } });

    // Auto-escalation: create ticket if needed
    if (needsEscalation && canCreateTicket) {
      const ticketNumber = await this.generateTicketNumber(companyId);
      ticket = await ticketRepo.create({
        companyId, ticketNumber, userId: session.userId, channel,
        category: aiResult.category, priority: aiResult.priority,
        status: TICKET_STATUS.PENDING,
        context: { sessionId: session.sessionId, lastUserMessage: userMessage, aiSummary: '...' },
      });
    }
    return { session, aiResponse: aiResult, ticket, escalated: !!ticket };
}
```

##### 5.3.3.1.1 Flow Explanation

1. **Request Received**: A message arrives via one of three paths. For web chat, `chatController.sendMessage` receives the authenticated request. For Telegram, `channelController.telegramWebhook` processes the incoming update, resolves the company from the bot token, and identifies or creates the user. For WhatsApp, the `WhatsappWebhookService` handles the inbound payload.

2. **Controller Delegation**: The controller calls `MessageProcessor.processMessage` with the company context, session ID, message content, and channel identifier.

3. **Knowledge Retrieval**: The method calls `findRelevantKnowledge`, which generates an embedding vector for the user's query using HuggingFace, computes cosine similarity against all stored knowledge item embeddings, and returns items scoring above a 0.3 threshold.

4. **Prompt Construction**: A comprehensive system prompt is built incorporating the user profile (name, email, account age), recent ticket history (last 5 tickets), retrieved knowledge content, domain restrictions (Prime Store sports retail), language detection instructions (Arabic dialect support, typo correction), and channel-specific behavior (voice mode requires shorter responses).

5. **AI Invocation**: The Gemini API is called via `getAIResponse` with the system prompt and last 10 conversation messages. The response is structured JSON containing `answer`, `detectedIntent`, `confidence`, `shouldEscalate`, `category`, and `priority`.

6. **Ticket Escalation**: If the customer explicitly requests a human agent, mentions a complaint, or the AI's `shouldEscalate` flag is true, a ticket is automatically created with ticket number format `NQ-YYYYMMDD-XXXX`. The session is linked to the new ticket via `session.summary.linkedTicketId`.

7. **Response Delivery**: For web chat, the AI response is returned in the API response. For Telegram, the response is sent directly via the Telegram Bot API. Real-time events are emitted via Socket.IO to the admin namespace to notify available agents.

8. **Event Logging**: Both the chat message event and any ticket creation escalation event are recorded via `EventLogService.logEvent` as fire-and-forget operations.

#### 5.3.3.2 Agent Ticket Management

**Functional Description**

Complete agent workflow for handling customer support tickets: atomic claiming from a shared queue, context-rich replies with optional media, ticket resolution triggering automated QA analysis, and closure of both ticket and linked chat session.

**Endpoints**

- `POST /api/v1/agent/auth/login` -- Agent authentication
- `POST /api/v1/agent/tickets/:ticketId/claim` -- Claim unassigned ticket
- `POST /api/v1/agent/tickets/:ticketId/reply` -- Text reply
- `POST /api/v1/agent/tickets/:ticketId/media-reply` -- Reply with media
- `POST /api/v1/agent/tickets/:ticketId/resolve` -- Resolve ticket
- `POST /api/v1/agent/tickets/:ticketId/close` -- Close ticket + session
- `GET /api/v1/agent/tickets` -- List with filters
- `GET /api/v1/agent/dashboard/overview` -- Agent KPIs

**Real Code Flow: Ticket Claiming**

The controller delegates to `AgentTicketService.claimTicket`, which implements an atomic claim operation:

```javascript
// Controller (thin HTTP adapter)
claimTicket = this.catchAsync(async (req, res) => {
    const ticket = await agentTicketService.claimTicket(req.companyId, req.params.ticketId, req.userId);
    // ... Telegram notification, Socket.IO event emission
    this.sendSuccess(res, { ticket }, 'Ticket claimed successfully');
});
```

```javascript
// Service (business logic + orchestration)
async claimTicket(companyId, ticketId, agentId) {
    // Atomic claim: findOneAndUpdate with filter requiring assignedTo: null
    const ticket = await Ticket.findOneAndUpdate(
      { _id: ticketId, companyId, assignedTo: null, status: TICKET_STATUS.PENDING },
      { $set: { assignedTo: agentId, status: TICKET_STATUS.OPENED } },
      { new: true }
    ).populate('userId', 'name email phone')
     .populate('assignedTo', 'name email');

    if (!ticket) {
      const existing = await ticketRepo.findOne({ _id: ticketId, companyId });
      if (!existing) throw ApiError.notFound('Ticket not found');
      if (existing.assignedTo) throw ApiError.conflict('Ticket is already assigned to another agent');
      throw ApiError.conflict('Ticket cannot be claimed');
    }

    // Channel-specific notification
    if (ticket.channel === CHANNELS.TELEGRAM && ticket.userId) {
      const company = await companyRepo.model.findById(companyId);
      const botToken = company.channelsConfig?.telegram?.botToken;
      const user = await userRepo.model.findById(ticket.userId._id);
      if (user?.telegramChatId && botToken) {
        await telegramService.sendMessage(botToken, user.telegramChatId, `...`);
      }
    }

    await logEvent({
      companyId, eventType: EVENT_TYPES.TICKET_CLAIMED,
      entityType: 'ticket', entityId: ticket._id,
      metadata: { agentId, ticketNumber: ticket.ticketNumber },
    });

    // Update linked chat session
    if (ticket.context?.sessionId) {
      await ChatSession.findOneAndUpdate(
        { companyId, sessionId: ticket.context.sessionId },
        { $set: { isAgentHandling: true, assignedAgent: agentId },
          $push: { messages: claimMsg }, $inc: { messageCount: 1 } }
      );
      if (ticket.channel === CHANNELS.WEB) {
        getIO().of('/webchat').to(`session:${ticket.context.sessionId}`).emit('chat:message', { ... });
      }
    }
    return ticket;
}
```

##### 5.3.3.2.1 Flow Explanation

1. **Agent Authentication**: `POST /api/v1/agent/auth/login` validates credentials via bcrypt, checks role membership (AGENT, TEAM_LEADER, MANAGER, or OWNER), and returns a JWT.

2. **Ticket Claiming**: The agent calls `POST /api/v1/agent/tickets/:ticketId/claim`. The controller delegates to `AgentTicketService.claimTicket`, which performs an atomic MongoDB `findOneAndUpdate` with a filter requiring `assignedTo: null`. This prevents race conditions where two agents simultaneously claim the same ticket -- only one `findOneAndUpdate` will match and update the document.

3. **Multi-Channel Notification**: After successful claim, the service sends a channel-specific notification. For Telegram customers, it uses the Telegram Bot API to send an Arabic message. For web chat customers, it emits a Socket.IO event to the session room with a system message indicating agent assignment.

4. **Agent Reply**: `POST /api/v1/agent/tickets/:ticketId/reply` appends an agent note to the ticket's `agentNotes` array, pushes the message to the linked chat session, sets `firstResponseAt` if first reply, and dispatches the message to the customer via their original channel.

5. **Resolution and QA Trigger**: `POST /api/v1/agent/tickets/:ticketId/resolve` sets ticket status to CLOSED, records `resolvedAt`, and triggers `QAService.analyzeAndSaveByTicketId` asynchronously (fire-and-forget with `.catch()`). This non-blocking approach ensures the API response is not delayed by AI analysis.

#### 5.3.3.3 Quality Assurance and Team Leader Supervision

**Functional Description**

Automated AI-powered quality analysis of agent-customer interactions, combined with team leader tools for agent performance monitoring, coaching feedback, and workload management.

**Endpoints**

- `POST /api/v1/qa/tickets/:ticketId/analyze` -- Trigger QA analysis
- `GET /api/v1/qa/results` -- List QA analysis results
- `GET /api/v1/qa/results/:id` -- Single analysis detail
- `GET /api/v1/team-leader/dashboard` -- Team performance KPIs
- `GET /api/v1/team-leader/agents/:agentId/performance` -- Period-based analytics
- `POST /api/v1/team-leader/tickets/assign` -- Bulk ticket assignment
- `PATCH /api/v1/team-leader/tickets/:ticketId/qa-notes` -- QA coaching note

The QA analysis is triggered automatically when a ticket is resolved. The `TicketService.updateTicket` method calls the QA service asynchronously:

```javascript
// src/services/ticketService.js (async trigger in updateTicket)
if (updateData.status === TICKET_STATUS.CLOSED) {
    qaService.analyzeAndSaveByTicketId(companyId, ticketId).catch((err) => {
      console.error(`[QA Automation] Trigger failed for ticket ${ticket.ticketNumber}:`, err.message);
    });
}
```

The `QAService.analyzeAndSaveByTicketId` method fetches the complete ticket with conversation context, constructs a structured payload, and submits it to Groq's LLaMA 3.3-70B model with a comprehensive Arabic-language QA system prompt. The AI evaluates the agent across three dimensions (professionalism, empathy, quality), assigns numeric scores, performs customer sentiment analysis, and categorizes the resolution outcome. Results are upserted into the `QAAnalysis` collection.

---

### 5.3.4 Cross-Cutting Concerns

**Authentication and Authorization**

Authentication is implemented via JWT using the `jsonwebtoken` library. The `generateToken` function creates tokens containing `{ id, companyId, role }` with configurable expiry (default 7 days):

```javascript
const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, companyId: user.companyId, role: user.role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
};
```

The `protect` middleware extracts the token from the `Authorization: Bearer <token>` header, verifies it, loads the user from the database, and attaches identity context to the request:

```javascript
const protect = asyncHandler(async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) throw ApiError.unauthorized('Access denied. No token provided.');
  const decoded = jwt.verify(token, config.jwt.secret);
  const user = await User.findById(decoded.id).select('-passwordHash');
  if (!user) throw ApiError.unauthorized('User belonging to this token no longer exists.');
  if (!user.isActive) throw ApiError.unauthorized('User account is deactivated.');
  req.user = user;
  req.userId = user._id;
  req.companyId = user.companyId;
  req.userRole = user.role;
  next();
});
```

Authorization uses a two-tier system. The `requirePermission` middleware checks the `RBAC_MATRIX` constant for resource-level access, while `allowRoles` provides coarse-grained role whitelisting:

```javascript
const requirePermission = (resource, action) => {
  return (req, res, next) => {
    const role = req.userRole;
    const permissions = RBAC_MATRIX[role];
    if (!permissions || !permissions[resource] || !permissions[resource].includes(action)) {
      throw ApiError.forbidden(`Access denied. Role '${role}' does not have '${action}' permission on '${resource}'.`);
    }
    next();
  };
};
```

The `RBAC_MATRIX` defines precise permissions for six roles across eight resources. For example, `COMPANY_MANAGER` has CRUD on users and knowledge, RUM on tickets, CR on embeddings, R on analytics and audit logs, and RUD on chat. `CUSTOMER` has only CR on chat and R on tickets.

**Validation Strategy**

Request validation is declarative using Joi schemas defined in thirteen validator modules. The `validate` middleware applies schemas to request body, query, and parameters simultaneously:

```javascript
const validate = (schema) => {
  return (req, res, next) => {
    const errors = [];
    ['body', 'query', 'params'].forEach((key) => {
      if (schema[key]) {
        const { error, value } = schema[key].validate(req[key], {
          abortEarly: false, stripUnknown: true,
        });
        if (error) {
          error.details.forEach((detail) => {
            errors.push({ field: detail.path.join('.'), message: detail.message });
          });
        } else if (key === 'body') {
          req.body = value;  // Replace with validated (stripped) body
        }
      }
    });
    if (errors.length > 0) throw ApiError.badRequest('Validation failed', errors);
    next();
  };
};
```

Example schema definition for login validation:

```javascript
const login = {
  body: Joi.object({
    email: Joi.string().required().email().trim().lowercase(),
    password: Joi.string().required(),
    companySlug: Joi.string().required().trim().lowercase(),
  }).options({ stripUnknown: true, abortEarly: false }),
};
```

**Exception Handling**

A custom `ApiError` class provides semantic error creation with static factory methods:

```javascript
class ApiError extends Error {
  constructor(statusCode, message, errors = []) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.isOperational = true;
  }
  static badRequest(message, errors) { return new ApiError(400, message, errors); }
  static unauthorized(message = 'Unauthorized') { return new ApiError(401, message); }
  static forbidden(message = 'Forbidden') { return new ApiError(403, message); }
  static notFound(message = 'Resource not found') { return new ApiError(404, message); }
  static conflict(message) { return new ApiError(409, message); }
  static internal(message = 'Internal server error') { return new ApiError(500, message); }
}
```

The global error handler transforms both operational errors (`ApiError` instances) and unexpected errors into standardized JSON responses. It handles Mongoose-specific errors (ValidationError returning 400 with field-level errors, duplicate key 11000 returning 409, CastError returning 400) and JWT errors (JsonWebTokenError and TokenExpiredError returning 401):

```javascript
const errorHandler = (err, req, res, _next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let errors = err.errors || [];

  if (err.name === 'ValidationError') { statusCode = 400; message = 'Validation failed'; errors = ... }
  if (err.code === 11000) { statusCode = 409; message = `Duplicate value for field: ${Object.keys(err.keyValue)[0]}`; }
  if (err.name === 'CastError') { statusCode = 400; message = `Invalid ${err.path}: ${err.value}`; }
  if (err.name === 'JsonWebTokenError') { statusCode = 401; message = 'Invalid token'; }
  if (err.name === 'TokenExpiredError') { statusCode = 401; message = 'Token expired'; }

  res.status(statusCode).json({
    success: false, message,
    ...(errors.length > 0 && { errors }),
    ...(config.env === 'development' && { stack: err.stack }),
  });
};
```

**Real-Time Communication**

Socket.IO is initialized with three namespaces. Each namespace authenticates via JWT during the handshake:

```javascript
const adminNamespace = io.of('/admin');
adminNamespace.use(async (socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) return next(new Error('Authentication required'));
  const decoded = jwt.verify(token, config.jwt.secret);
  const user = await User.findById(decoded.id).select('-passwordHash');
  if (!user || !user.isActive) return next(new Error('User not found or inactive'));
  socket.user = user;
  socket.companyId = user.companyId?.toString();
  next();
});
```

The `/admin` namespace supports staff roles across company-scoped rooms. The `/webchat` namespace serves authenticated customers in session-scoped rooms. The `/calls` namespace handles WebRTC signaling with events for call initiation, acceptance, rejection, offer/answer exchange, and ICE candidate relay. All namespaces enforce room-based event routing to ensure messages are delivered only to authorized recipients.

**Tenant Isolation**

The `tenantIsolation` middleware enforces multi-tenant data partitioning. For non-super-admin users, `req.companyId` is extracted from the JWT. Super admins can override this via query/body parameter. The middleware also verifies company existence and active status:

```javascript
const tenantIsolation = asyncHandler(async (req, res, next) => {
  if (req.userRole === ROLES.PLATFORM_SUPER_ADMIN) {
    const explicitCompanyId = req.query?.companyId || req.body?.companyId;
    if (explicitCompanyId) {
      const company = await Company.findById(explicitCompanyId);
      if (!company) throw ApiError.notFound('Company not found');
      req.companyId = company._id;
    }
    return next();
  }
  if (!req.companyId) throw ApiError.forbidden('Tenant context is missing.');
  const company = await Company.findById(req.companyId);
  if (!company || !company.isActive) throw ApiError.forbidden('Company is inactive or does not exist.');
  next();
});
```

---

### 5.3.5 Performance and Scalability Considerations

**Asynchronous Operations**: The entire codebase leverages async/await patterns. The `asyncHandler` utility ensures all asynchronous controller methods properly propagate errors:

```javascript
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
```

**Database Indexing**: Strategic MongoDB indexes are defined on all frequently queried paths. The User model has five indexes: compound unique on `(companyId, email)`, single-field on `role`, `teamLeaderId`, and sparse on `telegramChatId`. The ChatSession model indexes `sessionId`, `(companyId, userId)`, `(companyId, status)`, and `lastActivity` for efficient session management. The KnowledgeItem model indexes `(companyId, slug)` and `(companyId, isActive, embeddingVector)` for knowledge retrieval.

**Pagination**: All list endpoints implement pagination via `BaseRepository.findWithPagination`, which returns `{ data, total, page, limit, pages }`:

```javascript
async findWithPagination(filter = {}, page = 1, limit = 10, options = {}) {
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    this.find(filter, { ...options, skip, limit }),
    this.count(filter),
  ]);
  return { data, total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) };
}
```

**Rate Limiting**: The `express-rate-limit` middleware is configured with a configurable window (default 15 minutes) and maximum request count (default 100 requests per window), disabled in development:

```javascript
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: { success: false, message: 'Too many requests, please try again later.' },
  skip: () => config.env === 'development',
});
app.use('/api/', limiter);
```

**Connection Management**: MongoDB connection is established once during server startup and reused throughout the application lifecycle. The Vercel serverless adapter implements a connection caching pattern to prevent connection proliferation in serverless environments:

```javascript
let isConnected = false;
const connectDBForServerless = async () => {
  if (isConnected) return;
  const conn = await mongoose.connect(config.mongo.uri);
  isConnected = conn.connections[0].readyState === 1;
};
```

**AI Response Optimization**: The `MessageProcessor` limits conversation history to the last 10 messages sent to Gemini, balancing context length against token consumption and response latency. Fire-and-forget patterns are used for QA analysis triggering and notification delivery, preventing these operations from blocking API response time.

---

### 5.3.6 Testing and Quality Assurance

The codebase does not contain automated test files. The `package.json` test script is a placeholder (`"test": "echo \"Error: no test specified\" && exit 1"`). No testing frameworks (Jest, Mocha, Vitest) are listed in dependencies or devDependencies. Quality assurance is addressed exclusively through runtime mechanisms: declarative Joi validation ensures input integrity, the global error handler provides consistent error responses, MongoDB schema definitions enforce data structure at the persistence layer, and the EventLog/AuditLog system provides immutable traceability of all operations.

---

### 5.3.7 Deployment and Environment

**Configuration**: Environment variables are loaded via `dotenv` from `.env`. The configuration module exports a structured object with typed defaults for all settings including MongoDB URI, JWT secret and expiry, AI provider API keys (Groq, HuggingFace, Gemini, ElevenLabs), Telegram bot token, Redis configuration, CORS origin, and rate limit parameters.

**Startup**: The application entry point (`src/server.js`) initializes the Express app, establishes the MongoDB connection, starts the HTTP server, and initializes Socket.IO on the same HTTP instance. The `npm run dev` command uses Nodemon for development auto-reloading.

**Vercel Deployment**: A `vercel.json` configuration rewrites all routes to `api/index.js`, which exports a serverless-compatible handler:

```json
{
  "version": 2,
  "builds": [{ "src": "api/index.js", "use": "@vercel/node" }],
  "rewrites": [{ "source": "/(.*)", "destination": "/api/index.js" }]
}
```

The serverless handler maintains a cached MongoDB connection across invocations, preventing connection proliferation in the serverless execution model.

**Seed Data**: A seed script (`npm run seed`) populates a development tenant with one company, seven users across all roles, and ten Arabic-language knowledge items across all four types.

---

### 5.3.8 Conclusion

The Natiq backend implementation demonstrates a production-grade architecture that balances academic design principles with pragmatic engineering decisions. The layered architecture with repository abstraction provides clear separation of concerns, enabling independent evolution of the API surface, business logic, and data access layers. The service-oriented design encapsulates complex business rules in testable singleton units while keeping controllers as thin HTTP adapters.

The multi-channel AI conversational system represents the architectural centerpiece, integrating semantic knowledge retrieval via HuggingFace embeddings, context-aware response generation via Google Gemini, and automatic escalation workflows that bridge automated and human-assisted support. The quality assurance subsystem extends AI integration beyond customer-facing interactions into operational analytics, providing automated agent performance evaluation at scale.

The RBAC implementation with six roles, eight resources, and five actions across a precise permission matrix addresses the organizational complexity of enterprise customer service operations. The dual logging system (EventLog for operational analytics, AuditLog for compliance) satisfies both business intelligence and regulatory requirements without coupling to core business logic.

Areas for future enhancement include the formalization of AI provider abstraction into a defined strategy interface, implementation of a caching layer (Redis configuration exists but is disabled), introduction of automated test coverage, and adoption of a message queue for asynchronous processing of AI analysis and embedding generation tasks.
