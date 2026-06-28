# Agent Analytics — Full Response

> `GET /api/v1/agent/analytics/full`

A consolidated analytics payload for a single agent, designed to power dashboards, charts, and insight widgets. All sections are computed in parallel for optimal performance.

---

## Headers

| Key | Value |
|-----|-------|
| `Authorization` | `Bearer <token>` |
| `x-company-id` | `{{companyId}}` |

---

## Query Parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | ISO date | optional | Period start (e.g. `2026-01-01`). Defaults to 30 days ago. |
| `to` | ISO date | optional | Period end. Defaults to now. |
| `channel` | enum | optional | Filter to one channel: `web`, `telegram`, `whatsapp_mock`, `messenger_mock`, `voice` |

---

## Response Structure

```json
{
  "success": true,
  "data": {
    "analytics": {
      "kpis": { },
      "charts": { },
      "channelBreakdown": [ ],
      "performanceInsights": { },
      "agentAnalysis": { },
      "goals": { },
      "recommendations": [ ],
      "activityFeed": [ ],
      "callInsights": { }
    }
  }
}
```

---

## 1. KPIs

```json
{
  "totalTickets": 42,
  "assignedTickets": 42,
  "pendingTickets": 5,
  "inProgressTickets": 3,
  "resolvedTickets": 34,
  "reopenedTickets": 2,
  "reopenedRate": 5.9,
  "avgFirstResponseTime": 4.2,
  "avgResolutionTime": 118.5,
  "slaCompliance": {
    "response": 92.3,
    "resolution": 85.7,
    "overall": 89.0
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `totalTickets` | number | Total tickets assigned to agent in period |
| `assignedTickets` | number | Same as totalTickets |
| `pendingTickets` | number | Tickets with status `pending` |
| `inProgressTickets` | number | Tickets with status `opened` |
| `resolvedTickets` | number | Tickets with status `closed` |
| `reopenedTickets` | number | Tickets closed then re-opened |
| `reopenedRate` | number | Percentage of resolved tickets that were reopened |
| `avgFirstResponseTime` | number | Average first response time in **minutes** |
| `avgResolutionTime` | number | Average resolution time in **minutes** |
| `slaCompliance.response` | number | % of tickets responded within 30 min SLA |
| `slaCompliance.resolution` | number | % of tickets resolved within 4h SLA |
| `slaCompliance.overall` | number | Average of response + resolution compliance |

---

## 2. Charts

### ticketsOverTime

Only dates with activity. No gap-filling. No duplicate dates.

```json
[
  { "date": "2026-04-23", "assigned": 3, "resolved": 3 },
  { "date": "2026-04-25", "assigned": 2, "resolved": 2 }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | `YYYY-MM-DD` in UTC |
| `assigned` | number | Tickets assigned (grouped by `createdAt`) |
| `resolved` | number | Tickets resolved (grouped by `resolvedAt`) |

**Rules:**
- Grouped strictly by UTC calendar day — no duplicates
- Assigned uses `$createdAt`, resolved uses `$resolvedAt`
- Empty days (both 0) are omitted
- The frontend should render each entry as a bar/point — gaps between bars means no activity on that day

### responseTimeTrend

Only days with at least one first response. No zero-value days.

```json
[
  { "date": "2026-04-23", "avgResponseTimeMin": 4.2 },
  { "date": "2026-04-25", "avgResponseTimeMin": 6.1 }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | `YYYY-MM-DD` in UTC |
| `avgResponseTimeMin` | number | Average minutes to first response for tickets created on that day |

### resolutionTimeTrend

Only days with at least one resolved ticket. No zero-value days.

```json
[
  { "date": "2026-04-23", "avgResolutionTimeMin": 120.5 }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | `YYYY-MM-DD` in UTC |
| `avgResolutionTimeMin` | number | Average minutes to resolution for tickets resolved on that day |

### peakDay

The day of week with the most ticket assignments.

```json
{ "day": "Wednesday", "count": 15 }
```

### busiestHour

The hour (0-23) with the most ticket assignments.

```json
{ "hour": 14, "count": 8 }
```

---

## 3. Channel Breakdown

```json
[
  { "channel": "telegram", "count": 30, "resolvedCount": 25, "percentage": 71, "avgResponseTimeMin": 3.1 },
  { "channel": "web", "count": 12, "resolvedCount": 9, "percentage": 29, "avgResponseTimeMin": 6.8 }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `channel` | string | Channel name |
| `count` | number | Total tickets |
| `resolvedCount` | number | Closed tickets |
| `percentage` | number | % share of total (0-100) |
| `avgResponseTimeMin` | number | Avg first response minutes for this channel |

---

## 4. Performance Insights

```json
{
  "responseTimeStatus": "fast",
  "resolutionEfficiency": "medium",
  "workloadStatus": "balanced",
  "performanceTrend": "improving",
  "details": {
    "avgFirstResponseTime": 4.2,
    "avgResolutionTime": 118.5,
    "reopenedRate": 5.9,
    "openTicketCount": 8,
    "currentPeriodResolved": 18,
    "previousPeriodResolved": 12,
    "currentPeriodAvgFrt": 4.2,
    "previousPeriodAvgFrt": 6.8
  }
}
```

| Field | Values | Threshold Logic |
|-------|--------|----------------|
| `responseTimeStatus` | `fast` / `average` / `slow` | fast ≤5min, slow ≥30min |
| `resolutionEfficiency` | `high` / `medium` / `low` | high ≤60min, low ≥180min |
| `workloadStatus` | `overloaded` / `balanced` / `idle` | overloaded ≥15 open, idle ≤3 open |
| `performanceTrend` | `improving` / `stable` / `declining` | Based on 14-day period-over-period deltas |

---

## 5. Agent Intelligence

### QA-based (when QA data exists):

```json
{
  "strengths": [
    { "area": "speed", "label": "Fast responder", "score": 92 }
  ],
  "weaknesses": [
    { "area": "communication", "label": "Needs communication improvement", "score": 55 }
  ],
  "skillsScore": {
    "communication": 62,
    "problemSolving": 78,
    "speed": 92,
    "professionalism": 85
  },
  "qualityScore": 79.0,
  "source": "qa"
}
```

### Behavior-based (fallback when no QA data):

```json
{
  "strengths": [
    { "area": "speed", "label": "Fast responder", "score": 90 }
  ],
  "weaknesses": [],
  "skillsScore": {
    "communication": 72,
    "problemSolving": 85,
    "speed": 90,
    "professionalism": 80
  },
  "qualityScore": 81.8,
  "source": "behavior"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `skillsScore.communication` | 0-100 | From empathy + quality (QA) or speed + professionalism (behavior) |
| `skillsScore.problemSolving` | 0-100 | From quality (QA) or resolution rate (behavior) |
| `skillsScore.speed` | 0-100 | From professionalism/empathy (QA) or inverse of FRT (behavior) |
| `skillsScore.professionalism` | 0-100 | From professionalism score (QA) or inverse of reopen rate (behavior) |
| `qualityScore` | 0-100 | Average of all skills |
| `source` | `qa` / `behavior` | Indicates which scoring method was used |

**Strengths** = skill ≥ 80, **Weaknesses** = skill ≤ 60.

---

## 6. Goals & Gamification

```json
{
  "dailyTarget": 6,
  "weeklyTarget": 30,
  "achievementRate": 83.3,
  "streakDays": 3,
  "rank": {
    "position": 2,
    "totalAgents": 12,
    "percentile": 83.3
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `dailyTarget` | number | 120% of avg daily resolved — stretch goal |
| `weeklyTarget` | number | `dailyTarget × 5` |
| `achievementRate` | number | % of daily target achieved (capped at 100) |
| `streakDays` | number | Consecutive days meeting or exceeding daily target |
| `rank.position` | number | Position among all agents (1 = top) |
| `rank.totalAgents` | number | Total agents in company |
| `rank.percentile` | number | Percentile rank (higher = better) |

---

## 7. Recommendations

```json
[
  {
    "type": "critical",
    "area": "response_time",
    "message": "Your response time (45 min) is significantly slower than the 5 min benchmark.",
    "impact": "Customer satisfaction drops by 16% for every 10-minute delay.",
    "priority": 1
  },
  {
    "type": "positive",
    "area": "response_time",
    "message": "Excellent response time at 2 min.",
    "impact": "Quick responses are your strongest CSAT driver.",
    "priority": 5
  }
]
```

| Field | Type | Values |
|-------|------|--------|
| `type` | string | `critical` / `warning` / `improvement` / `opportunity` / `positive` |
| `area` | string | `response_time` / `resolution_time` / `reopen_rate` / `workload` / `trend` / `channel` / `calls` / skill area |
| `priority` | number | 1 = highest, 5 = lowest. Sorted ascending. |

Recommendations are generated from 10+ data-driven rules comparing agent metrics against thresholds, trend deltas, and channel performance.

---

## 8. Activity Feed

Last 20 activities (real-time, no time filter).

```json
[
  {
    "type": "ticket_resolved",
    "label": "You resolved ticket #a1b2c3",
    "entityId": "abc123...",
    "timestamp": "2026-06-25T14:30:00.000Z"
  },
  {
    "type": "agent_replied",
    "label": "You replied to ticket #d4e5f6",
    "entityId": "def456...",
    "timestamp": "2026-06-25T13:15:00.000Z"
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Event type: `ticket_claimed`, `ticket_resolved`, `ticket_closed`, `agent_replied` |
| `label` | string | Human-readable description |
| `entityId` | string | MongoDB ObjectId of the ticket |
| `timestamp` | string (ISO) | When the event occurred |

---

## 9. Call Insights

```json
{
  "totalCalls": 15,
  "answeredCalls": 12,
  "missedCalls": 3,
  "rejectedCalls": 0,
  "avgDuration": 185,
  "totalDuration": 2775,
  "answerRate": 80.0,
  "peakCallHours": [
    { "hour": 10, "count": 5 },
    { "hour": 14, "count": 4 },
    { "hour": 16, "count": 3 }
  ],
  "missTrend": "decreasing"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `answerRate` | number | % of calls answered |
| `avgDuration` | number | Average call duration in seconds |
| `missTrend` | string | `increasing` / `decreasing` / `stable` — period-over-period |
| `peakCallHours` | array | Top 3 busiest hours |

---

## Chart Integration Notes

| Chart | Use | Notes |
|-------|-----|-------|
| `ticketsOverTime` | Bar/line chart | Sparse — only activity days. Gaps = no activity. |
| `responseTimeTrend` | Line chart | Sparse — only days with response data. |
| `resolutionTimeTrend` | Line chart | Sparse — only days with resolutions. |
| `channelBreakdown` | Pie/donut chart | Percentages sum to ~100. |
| `peakDay` / `busiestHour` | Single stat widgets | Best day/hour for agent activity. |

All three chart arrays are **sparse** — they contain only dates with real data. Charting libraries (Chart.js, Recharts, ECharts) handle sparse data natively with `null` gaps. No zero-padding is applied server-side.
