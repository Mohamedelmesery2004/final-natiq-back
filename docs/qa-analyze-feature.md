# QA Analysis Feature

## Endpoints

### Analyze ticket (Natiq) — saves result to DB

```
POST /api/v1/qa/analyze/:ticketId
```

| Param | Type | Description |
|---|---|---|
| `ticketId` | `string` (24-char hex) | MongoDB ObjectId of the ticket |

**Response (200)**

```json
{
  "success": true,
  "message": "Natiq analysis completed successfully",
  "data": {
    "analysis": {
      "agent_behavior": "string",
      "churn_prob": 0.75,
      "communication_clarity_score": 3,
      "conversation_summary": "string",
      "customer_satisfaction": "low",
      "dominant_customer_emotion": "frustrated",
      "emotion_trend": {
        "average": "neutral",
        "end": "frustrated",
        "start": "neutral"
      },
      "resolution_status": "unresolved",
      "summary_for_dashboard": "string"
    },
    "analyzedAt": "ISO date string",
    "ticketId": "objectId",
    "provider": "natiq"
  }
}
```

**Behavior:** Fetches the ticket's conversation, translates it to English, sends to the Natiq AI API, saves the full response to the `QAAnalysis` document (upserted by `ticketId`), and returns the result.

---

### Retrieve saved analysis by ticketId

```
GET /api/v1/qa/results/by-ticket/:ticketId
```

| Param | Type | Description |
|---|---|---|
| `ticketId` | `string` (24-char hex) | MongoDB ObjectId of the ticket |

**Response (200)**

```json
{
  "success": true,
  "message": "QA analysis retrieved successfully",
  "data": {
    "_id": "objectId",
    "companyId": "objectId",
    "ticketId": "objectId",
    "agentId": "objectId | null",
    "customerId": "objectId | null",
    "ticketNumber": "NQ-...",
    "channel": "web",
    "category": "billing",
    "customerSentiment": "unclear",
    "resolutionStatus": "unclear",
    "scores": {
      "professionalism": 0,
      "empathy": 0,
      "quality": 0
    },
    "fullAnalysis": null,
    "natiqAnalysis": {
      "agent_behavior": "string",
      "churn_prob": 0.75,
      "communication_clarity_score": 3,
      "conversation_summary": "string",
      "customer_satisfaction": "low",
      "dominant_customer_emotion": "frustrated",
      "emotion_trend": { ... },
      "resolution_status": "unresolved",
      "summary_for_dashboard": "string"
    },
    "metadata": {
      "analyzedAt": "ISO date"
    },
    "createdAt": "ISO date",
    "updatedAt": "ISO date"
  }
}
```

**Error (404)**

```json
{
  "success": false,
  "message": "Analysis not found for this ticket"
}
```

---

## Auth

All endpoints require a valid JWT with one of:
- `platform_super_admin`
- `company_manager`
- `team_leader`
- `agent`

Tenant isolation enforced — only data belonging to the user's company.

---

## Flow

```
POST /api/v1/qa/analyze/:ticketId
  → validate + auth
  → fetch ticket + messages
  → format conversation (user/agent → CUSTOMER/AGENT)
  → translate conversation to English
  → POST Natiq AI API
  → upsert QAAnalysis document (sets natiqAnalysis field)
  → return result

GET /api/v1/qa/results/by-ticket/:ticketId
  → validate + auth
  → QAAnalysis.findOne({ companyId, ticketId })
  → return full document
```

---

## Files

| File | Responsibility |
|---|---|
| `src/services/qaService.js` | Orchestrates analyze + save, lookup by ticketId |
| `src/services/qa/natiqAnalysisService.js` | Natiq API call, conversation translation |
| `src/services/qa/natiqConversationFormatter.js` | Formats raw messages into CUSTOMER/AGENT text |
| `src/services/translation/translatorService.js` | Arabic → English translation (Groq) |
| `src/controllers/qaController.js` | Request handlers |
| `src/validators/qaValidator.js` | Joi schemas |
| `src/routes/qaRoutes.js` | Route definitions |
| `src/models/qaAnalysis.js` | Mongoose schema (natiqAnalysis: Mixed) |
