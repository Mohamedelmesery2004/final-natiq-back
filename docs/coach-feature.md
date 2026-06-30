# Coach Feature

## Endpoints

### Start coaching analysis (async)

```
POST /api/v1/coach/:ticketId
```

Kicks off background processing. Returns immediately with a `jobId`.

| Param | Type | Description |
|---|---|---|
| `ticketId` | `string` (24-char hex) | MongoDB ObjectId of the ticket |

**Response (202 Accepted)**

```json
{
  "success": true,
  "message": "Coaching analysis started",
  "data": {
    "jobId": "665abc..."
  }
}
```

---

### Poll for results

```
GET /api/v1/coach/jobs/:jobId
```

| Param | Type | Description |
|---|---|---|
| `jobId` | `string` (24-char hex) | Job ID from the start endpoint |

**While processing (200)**

```json
{
  "success": true,
  "message": "Coaching analysis is processing",
  "data": {
    "status": "processing",
    "result": null
  }
}
```

**On completion (200)**

```json
{
  "success": true,
  "message": "Coaching analysis retrieved successfully",
  "data": {
    "status": "completed",
    "result": {
      "ai_recommendations": "string",
      "weakness_analysis": "string",
      "suggested_learning": "string",
      "encouragement_quote": "string"
    }
  }
}
```

**On failure (500)**

```json
{
  "success": false,
  "message": "Coaching AI request timed out"
}
```

---

## Auth

Required for all endpoints. Valid JWT with one of:
- `platform_super_admin`
- `company_manager`
- `team_leader`
- `agent`

Tenant isolation enforced — only tickets/jobs belonging to the user's company.

---

## Flow

```
client → POST /api/v1/coach/:ticketId
         → validate + auth
         → create CoachJob (status: pending)
         → return 202 { jobId }
         → background:
             1. fetch ticket + messages
             2. format conversation
             3. POST external AI (45 min timeout)
             4. save result to CoachJob (status: completed / failed)

client → GET /api/v1/coach/jobs/:jobId  (poll every 5-10s)
         → return status + result when done
```

---

## Architecture

```
src/
├── models/coachJob.js              # Mongoose schema (pending/processing/completed/failed)
├── utils/conversationFormatter.js   # Pure transform function
├── services/coachService.js         # Business logic + background processing
├── controllers/coachController.js   # Two handlers (start, poll)
├── validators/coachValidator.js     # Joi schemas
└── routes/coachRoutes.js            # POST /:ticketId, GET /jobs/:jobId
```

---

## Transformation Logic

`src/utils/conversationFormatter.js` — pure, testable function.

| Input `role` | Output key |
|---|---|
| `user` | `customer` |
| `assistant` | `agent` |
| `agent` | `agent` |
| `system` | ignored |

Empty/whitespace messages skipped. Content trimmed. Order preserved. Capped at **100 turns**.

---

## Error Handling

| Scenario | HTTP | Message |
|---|---|---|
| Ticket not found | 404 | Ticket not found |
| No messages | 400 | No messages found for this ticket |
| Job not found | 404 | Coaching job not found |
| External API timeout | 500 | Coaching AI request timed out |
| External API failure | 500 | Coaching AI service unavailable |
| Invalid ID format | 400 | Invalid ID format |

---

## Client polling example

```js
async function getCoaching(ticketId) {
  const { data: { data: { jobId } } } = await axios.post(`/api/v1/coach/${ticketId}`);

  while (true) {
    const { data } = await axios.get(`/api/v1/coach/jobs/${jobId}`);
    if (data.data.status === 'completed') return data.data.result;
    if (data.data.status === 'failed') throw new Error(data.message);
    await new Promise(r => setTimeout(r, 5000));
  }
}
```

---

## Testing

```js
import { formatConversationForCoach } from '../utils/conversationFormatter.js';

const messages = [
  { role: 'system', content: 'irrelevant' },
  { role: 'user', content: '  hello  ' },
];

const result = formatConversationForCoach(messages);
// → { conversation: [{ customer: 'hello' }] }
```
