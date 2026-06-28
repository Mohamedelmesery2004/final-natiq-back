# Agent Dashboard Overview

> `GET /api/v1/agent/dashboard/overview`

A lightweight, real-time dashboard payload for a single agent. Optimized for the agent's main screen — KPIs, today's activity, SLA urgency, charts, and recent events.

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

---

## Response Structure

```json
{
  "success": true,
  "data": {
    "dashboard": {
      "kpis": { },
      "todayStats": { },
      "slaStats": { },
      "productivity": { },
      "performanceTrend": [ ],
      "callPerformance": { },
      "channelDistribution": [ ],
      "feedbackStats": { },
      "csatUI": { },
      "recentActivity": [ ],
      "topCategories": [ ],
      "goalProgress": { },
      "workload": { }
    }
  }
}
```

---

## 1. KPIs

```json
{
  "assignedTickets": 42,
  "resolvedTickets": 34,
  "pendingTickets": 5,
  "inProgressTickets": 3,
  "avgFirstResponseTime": 4.2,
  "avgResolutionTime": 118.5,
  "csatScore": 87
}
```

| Field | Type | Description |
|-------|------|-------------|
| `assignedTickets` | number | Total tickets assigned in period |
| `resolvedTickets` | number | Tickets with status `closed` |
| `pendingTickets` | number | Tickets with status `pending` |
| `inProgressTickets` | number | Tickets with status `opened` |
| `avgFirstResponseTime` | number | Average first response time in **minutes** |
| `avgResolutionTime` | number | Average resolution time in **minutes** |
| `csatScore` | number | Customer satisfaction score (0-100) based on ratings ≥ 4 |

---

## 2. Today Stats

Real-time "what happened today" — no date filter, always computed for the current UTC day.

```json
{
  "ticketsToday": 5,
  "resolvedToday": 3,
  "avgResponseToday": 2.1,
  "avgResolutionToday": 45.0
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ticketsToday` | number | Tickets assigned since midnight UTC |
| `resolvedToday` | number | Tickets resolved since midnight UTC |
| `avgResponseToday` | number | Average first response time in minutes for today's tickets |
| `avgResolutionToday` | number | Average resolution time in minutes for today's resolved tickets |

**Note:** Uses UTC date boundaries to match MongoDB storage. If the value is 0, the agent has had no activity today yet.

---

## 3. SLA / Urgency

```json
{
  "overdueTickets": 2,
  "dueSoon": 1,
  "breachedTickets": 3
}
```

| Field | Type | Description |
|-------|------|-------------|
| `overdueTickets` | number | Not closed AND `createdAt > 4h ago` — past SLA deadline |
| `dueSoon` | number | Not closed AND `createdAt` between 3-4h ago — will breach within 60 min |
| `breachedTickets` | number | Already closed but resolution time exceeded 4h SLA |

**SLA target:** 240 minutes (4 hours) from ticket creation to resolution.  
**UI hint:** Display `overdueTickets` in red, `dueSoon` in amber, `breachedTickets` with a warning icon.

---

## 4. Productivity

```json
{
  "ticketsPerHour": 1.25,
  "avgHandlingTime": 118.5,
  "activeTimeSec": 97800
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ticketsPerHour` | number | Resolved tickets / active hours since last login |
| `avgHandlingTime` | number | Average resolution time in minutes |
| `activeTimeSec` | number | Seconds since agent's last login (proxy for active session time) |

**Note:** `ticketsPerHour` = 0 when `activeTimeSec` is 0 (no session tracked or just logged in).

---

## 5. Performance Trend

Full daily time series with zero-filled gaps. Default range = last 30 days. Never empty.

```json
[
  { "date": "2026-05-01", "assigned": 3, "resolved": 0 },
  { "date": "2026-05-02", "assigned": 0, "resolved": 1 },
  { "date": "2026-05-03", "assigned": 2, "resolved": 2 }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | `YYYY-MM-DD` in UTC, every day in range |
| `assigned` | number | Tickets assigned (grouped by `createdAt`) |
| `resolved` | number | Tickets resolved (grouped by `resolvedAt`) |

**Charting rules:**
- Full time series — every day present, missing days = 0
- Always sorted ascending
- Render as line chart: assigned vs resolved overlay
- Pass directly to chart library, no client-side gap filling needed

---

## 6. Channel Distribution

```json
[
  { "channel": "telegram", "count": 30, "percentage": 71 },
  { "channel": "web", "count": 12, "percentage": 29 }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `channel` | string | Channel name |
| `count` | number | Ticket count |
| `percentage` | number | % share (0-100, sums to ~100) |

**UI:** Pie chart or horizontal bar chart.

---

## 7. Feedback Stats

```json
{
  "totalRatings": 28,
  "avgRating": 4.2,
  "csat": 82,
  "ratingBreakdown": {
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 10,
    "5": 12
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `totalRatings` | number | Total feedback submissions |
| `avgRating` | number | Average rating (1-5 scale) |
| `csat` | number | % of ratings ≥ 4 |
| `ratingBreakdown` | object | Count of each star rating |

**UI:** Star distribution bar chart + CSAT percentage widget.

---

## 8. Recent Activity

Last 10 events **within the past 72 hours**. Fresh data only — no stale entries.

```json
[
  {
    "type": "ticket_resolved",
    "ticketId": "abc123...",
    "label": "Resolved ticket #a1b2c3",
    "timeAgo": "2min ago"
  },
  {
    "type": "agent_replied",
    "ticketId": "def456...",
    "label": "Replied to ticket #d4e5f6",
    "timeAgo": "15min ago"
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Event type: `ticket_claimed`, `ticket_resolved`, `ticket_closed`, `agent_replied`, `ticket_created` |
| `ticketId` | string (ObjectId) | Ticket identifier |
| `label` | string | Human-readable summary |
| `timeAgo` | string | Relative time: `2min ago`, `1h ago`, `3d ago` |

**Behavior:** Returns empty `[]` if the agent has been idle >72 hours. Events sorted newest-first.

---

## 9. Top Categories

```json
[
  { "name": "payment", "count": 12 },
  { "name": "network", "count": 8 },
  { "name": "packages", "count": 6 }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Category key from `TICKET_CATEGORY` enum |
| `count` | number | Ticket count |

**Enum values:** `billing`, `network`, `packages`, `complaint`, `payment`, `refund`, `other`

---

## 10. Goal Progress

Dynamic goals based on agent's own historical performance.

```json
{
  "total": 42,
  "current": 34,
  "percentage": 81,
  "dailyTarget": 6
}
```

| Field | Type | Description |
|-------|------|-------------|
| `total` | number | Target = `dailyTarget × daysInPeriod` |
| `current` | number | Actual resolved tickets in period |
| `percentage` | number | % complete (capped at 100) |
| `dailyTarget` | number | 120% of avg daily resolved tickets |

**UI:** Progress bar. Color: green ≥80%, amber ≥50%, red <50%.

---

## 11. Call Performance

Aggregated call metrics from the Call model. Returns zero-safe defaults when no calls exist.

```json
{
  "totalCalls": 15,
  "answered": 12,
  "missed": 3,
  "avgDuration": 245,
  "answerRate": 80
}
```

| Field | Type | Description |
|-------|------|-------------|
| `totalCalls` | number | Total calls in period |
| `answered` | number | Calls with status `active` or `ended` (connected) |
| `missed` | number | Calls with status `missed` |
| `avgDuration` | number | Average call duration in **seconds** |
| `answerRate` | number | Percentage answered (0-100) |

**UI:** Stat cards: total calls, answer rate ring, avg duration badge.

---

## 12. CSAT UI

Derived from `feedbackStats` for direct frontend rendering. No separate DB query.

```json
{
  "percentage": 82,
  "label": "Good",
  "color": "green",
  "trend": 0
}
```

| Field | Type | Description |
|-------|------|-------------|
| `percentage` | number | Same as `feedbackStats.csat` (0-100) |
| `label` | string | `Good` (≥75), `Average` (50-74), `Bad` (<50) |
| `color` | string | `green`, `orange`, or `red` matching label |
| `trend` | number | Reserved for future trend arrow (0 for now) |

**UI:** Circular progress ring with color coding. Label displayed below percentage.

---

## 13. Workload

Utilization-style metric based on assigned tickets vs goal target.

```json
{
  "used": 34,
  "total": 42,
  "percentage": 81,
  "level": "high"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `used` | number | `kpis.assignedTickets` |
| `total` | number | `goalProgress.total` (dailyTarget × days) |
| `percentage` | number | Used / total × 100, capped at 100 |
| `level` | string | `high` (≥70%), `medium` (40-69%), `low` (<40%) |

**UI:** Progress bar with color by level — red for high, amber for medium, green for low.

---

## Frontend Integration Quick Reference

| Section | Widget Type | Notes |
|---------|-------------|-------|
| `kpis` | Stat cards (7 values) | Show avgFirstResponseTime + avgResolutionTime in minutes |
| `todayStats` | "Today" badge/card | Real-time feel — refreshes on page load |
| `slaStats` | Alert banners | Red (overdue), Amber (dueSoon), Grey (breached) |
| `productivity` | Small stat row | ticketsPerHour with 2 decimal precision |
| `performanceTrend` | Line chart | Full time series — ready for chart library |
| `callPerformance` | Stat cards + ring | answerRate for circular progress, avgDuration badge |
| `channelDistribution` | Pie/donut | Percentages in tooltip |
| `feedbackStats` | Star chart + CSAT % | ratingBreakdown for distribution bars |
| `csatUI` | Circular progress ring | percentage + color + label — render directly |
| `recentActivity` | Activity feed list | Auto-scroll, newest at top |
| `topCategories` | Horizontal bar | Sorted by count descending |
| `goalProgress` | Progress bar | Percentage + X/Y label |
| `workload` | Utilization bar | Color by level: high=red, medium=amber, low=green |

### Refreshing Strategy

- Page load: call both endpoints
- Poll `dashboard/overview` every 60s for real-time feel
- Poll `analytics/full` every 5min (heavier computation)
- `todayStats` updates every 60s → reflects same-day activity
- `recentActivity` updates every 60s → new entries appear as agent works
