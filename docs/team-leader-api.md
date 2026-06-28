# Team Leader API

Base path: `/api/v1/team-leader`

All routes require authentication and are restricted to `TEAM_LEADER`, `COMPANY_MANAGER`, or higher roles.

---

## Dashboard

### `GET /dashboard`

Full team overview with stats, KPIs, agent performance, SLA, insights, suggestions, trends.

---

## Agent Monitoring

### `GET /agents`

List all agents in the team with active ticket count and online status.

### `GET /agents/:agentId/profile` — Agent Monitoring Dashboard

Returns comprehensive monitoring data for a single agent.

#### Response

```json
{
  "success": true,
  "data": {
    "agent": {
      "_id": "6a417ed70ccdf6e1b0c4444e",
      "companyId": "6a417ed30ccdf6e1b0c44434",
      "name": "Omar Hassan",
      "email": "omar@primestore.com",
      "phone": "+201166778899",
      "profileImage": null,
      "isActive": true,
      "lastLogin": "2026-06-28T20:14:02.060Z",
      "teamLeaderId": "6a417ed70ccdf6e1b0c4444d",
      "onboardingStep": 0,
      "supervisorNotes": []
    },
    "performance": {
      "assignedTickets": 8,
      "pendingTickets": 3,
      "inProgressTickets": 1,
      "resolvedTickets": 4,
      "avgFirstResponseTime": 12,
      "avgResolutionTime": 48,
      "csatScore": 75,
      "todayTickets": 2,
      "todayResolved": 1,
      "todayAvgResponse": 5,
      "todayAvgResolution": 30
    },
    "sla": {
      "overdueTickets": 1,
      "dueSoon": 2,
      "breachedTickets": 0
    },
    "calls": {
      "total": 5,
      "answered": 4,
      "missed": 1,
      "avgDuration": 180,
      "answerRate": 80,
      "recent": [
        {
          "_id": "...",
          "customer": { "_id": "...", "name": "Khaled", "phone": "+201001234567" },
          "customerPhone": "+201001234567",
          "status": "ended",
          "duration": 240,
          "notes": "",
          "startedAt": "2026-06-28T15:30:00.000Z"
        }
      ]
    },
    "activeTickets": [
      {
        "_id": "...",
        "subject": "Order #12345 not delivered",
        "status": "opened",
        "priority": "high",
        "channel": "whatsapp",
        "category": "shipping",
        "customer": { "_id": "...", "name": "Khaled", "email": "khaled@example.com" },
        "createdAt": "2026-06-28T10:00:00.000Z",
        "hoursSinceCreation": 8,
        "hasSlaBreach": true
      }
    ],
    "recentResolved": [
      {
        "_id": "...",
        "subject": "Refund request",
        "channel": "whatsapp",
        "priority": "medium",
        "customer": { "_id": "...", "name": "Noura", "email": "noura@example.com" },
        "createdAt": "2026-06-27T14:00:00.000Z",
        "resolvedAt": "2026-06-27T16:30:00.000Z",
        "resolutionHours": 2.5,
        "responseTimeMin": 5
      }
    ],
    "feedback": {
      "totalRatings": 6,
      "avgRating": 4.2,
      "csat": 67,
      "ratingBreakdown": { "1": 0, "2": 1, "3": 1, "4": 2, "5": 2 }
    },
    "recentActivity": [
      { "type": "ticket_resolved", "ticketId": "...", "label": "Resolved ticket #abcdef", "timeAgo": "2h ago" },
      { "type": "agent_replied", "ticketId": "...", "label": "Replied to ticket #123456", "timeAgo": "3h ago" }
    ]
  }
}
```

#### Section Guide

| Section | Description |
|---|---|
| `agent` | Basic profile info, status, supervisor notes |
| `performance` | KPIs from AgentDashboardService (assigned, pending, in-progress, resolved, avg response/resolution times, CSAT, today's stats) |
| `sla` | Overdue, due-soon, and breached SLA counts |
| `calls` | Aggregated call performance + last 10 calls with customer info |
| `activeTickets` | Up to 20 open/pending tickets with customer, priority, channel, SLA breach indicator |
| `recentResolved` | Last 10 resolved tickets with resolution hours and response time |
| `feedback` | Rating breakdown with CSAT percentage |
| `recentActivity` | Last 15 events from the past 72 hours (claimed, resolved, closed, replied) |

### `GET /agents/:agentId/performance`

Performance analytics for a specific agent over a period.

**Query:** `?period=week|month|year`

Returns resolved tickets, avg response/resolution times, channel distribution, trend data, weekly heatmap.

### `POST /agents/:agentId/notify`

Send a notification to an agent.

**Body:** `{ "message": "..." }`

### `PATCH /agents/:agentId/supervisor-notes`

Add a supervisor note to an agent profile.

**Body:** `{ "content": "..." }`

---

## Tickets

### `GET /tickets`

List company tickets with optional `?status=` and `?agentId=` filters (paginated).

### `GET /tickets/queue/unassigned`

Unassigned ticket queue (paginated).

### `POST /tickets/assign`

Bulk assign tickets to an agent.

**Body:** `{ "ticketIds": ["..."], "agentId": "..." }`

### `GET /tickets/:ticketId/messages`

Get ticket details + chat messages from the linked session.

### `PATCH /tickets/:ticketId/qa-notes`

Append a team leader note to a QA analysis.

**Body:** `{ "content": "..." }`

---

## Calls

### `GET /calls`

List calls with optional `?status=` and `?agentId=` filters (paginated). Team leaders only see their own agents' calls.

---

## QA

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/qa/results` | List automated QA results |
| `GET` | `/qa/results/:id` | Get QA result details |
| `POST` | `/qa/tickets/:ticketId/analyze` | Run QA analysis on a ticket |
