# Owner Dashboard API

> `GET /api/v1/owner/dashboard`

Executive-level dashboard with system health, KPIs, insights, and actionable suggestions.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | ISO date | No | Start of date filter range |
| `to` | ISO date | No | End of date filter range |

---

## Headers

| Key | Value |
|-----|-------|
| `Authorization` | `Bearer <token>` |

---

## Response Structure

```json
{
  "success": true,
  "data": {
    "dashboard": {
      "overview":           { },
      "kpis":               { },
      "todayStats":         { },
      "slaStats":           { },
      "productivity":       { },
      "performanceTrend":   [ ],
      "callPerformance":    { },
      "channelDistribution":[ ],
      "feedbackStats":      { },
      "csatUI":             { },
      "recentActivity":     [ ],
      "topCategories":      [ ],
      "goalProgress":       { },
      "workload":           { },
      "insights":           [ ],
      "suggestions":        [ ]
    }
  }
}
```

---

## 1. Overview

Executive summary of system health. Composite healthScore derived from 5 weighted metrics.

```json
{
  "healthScore": 78,
  "status": "good",
  "workloadLevel": "medium",
  "riskLevel": "moderate"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `healthScore` | number | Composite 0–100 (resolutionRate×30 + capacity×25 + activeMgrs×15 + answerRate×15 + CSAT×15) |
| `status` | string | `excellent` (>75), `good` (>45), `critical` (≤45) |
| `workloadLevel` | string | `low` (<35%), `medium` (35-69%), `high` (≥70%) |
| `riskLevel` | string | `none` / `moderate` / `high` |

**Health Score Weighting:**

| Component | Weight | Threshold |
|-----------|--------|-----------|
| Resolution rate | 30 pts | ≥80% = full score |
| Capacity utilization | 25 pts | <70% = full score |
| Active managers | 15 pts | ≥1 = full score |
| Call answer rate | 15 pts | ≥70% = full score |
| CSAT | 15 pts | ≥75 = full score |

**Widget:** Gauge/circular progress for healthScore + 3 indicator badges.

---

## 2. KPIs

Comprehensive metrics with derived intelligence including workforce counts and utilization.

```json
{
  "totalAgents": 24,
  "totalManagers": 3,
  "totalTeamLeaders": 2,
  "totalWorkforce": 29,
  "totalTickets": 520,
  "openTickets": 87,
  "resolvedTickets": 433,
  "ticketsToday": 12,
  "ticketsLast7Days": 85,
  "ticketsDelta": 12,
  "resolutionRate": 83,
  "workloadPerAgent": 4,
  "activeManagers": 2,
  "managerActivationRate": 67,
  "activeChats": 34,
  "totalChats": 412,
  "chatLoadPerAgent": 1,
  "agentUtilization": 18,
  "avgFirstResponseTime": 4.2,
  "avgResolutionTime": 112.3
}
```

| Field | Type | Description |
|-------|------|-------------|
| `totalAgents` | number | Total agents (role = AGENT) |
| `totalManagers` | number | Total managers (role = COMPANY_MANAGER) |
| `totalTeamLeaders` | number | Total team leaders (role = TEAM_LEADER) |
| `totalWorkforce` | number | Sum of agents + managers + team leaders |
| `totalTickets` | number | All tickets |
| `openTickets` | number | Tickets with status `pending` or `opened` |
| `resolvedTickets` | number | Tickets with status `closed` |
| `ticketsToday` | number | Created since midnight UTC |
| `ticketsLast7Days` | number | Created in last 7 days |
| `ticketsDelta` | number | % change vs previous 7 days |
| `resolutionRate` | number | `resolved / total * 100` |
| `workloadPerAgent` | number | `openTickets / agents` |
| `activeManagers` | number | Managers with `isActive: true` |
| `managerActivationRate` | number | `activeManagers / totalManagers * 100` |
| `activeChats` | number | Chat sessions with status `active` |
| `totalChats` | number | All chat sessions |
| `chatLoadPerAgent` | number | `activeChats / agents` |
| `agentUtilization` | number | `openTickets / (agents × 20) * 100`, capped at 100 |
| `avgFirstResponseTime` | number | Average minutes to first response |
| `avgResolutionTime` | number | Average minutes to resolution |

**Widget:** Stat cards grid. Color-code resolutionRate (green≥80, amber≥50, red<50).

---

## 3. Today Stats

Real-time snapshot of today's activity.

```json
{
  "ticketsToday": 12,
  "resolvedToday": 8,
  "avgResponseToday": 3.5,
  "avgResolutionToday": 95.2
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ticketsToday` | number | Tickets created since midnight UTC |
| `resolvedToday` | number | Tickets resolved since midnight UTC |
| `avgResponseToday` | number | Average first response time for today (minutes) |
| `avgResolutionToday` | number | Average resolution time for today (minutes) |

**Widget:** "Today" badge with counts.

---

## 4. SLA Stats

SLA compliance tracking against 240-minute (4-hour) target.

```json
{
  "overdueTickets": 3,
  "dueSoon": 2,
  "breachedTickets": 5,
  "withinSla": 120,
  "slaCompliancePercentage": 93
}
```

| Field | Type | Description |
|-------|------|-------------|
| `overdueTickets` | number | Open tickets past 4h SLA window |
| `dueSoon` | number | Open tickets in 2-4h window (warning) |
| `breachedTickets` | number | Closed tickets that exceeded 4h |
| `withinSla` | number | Closed tickets meeting SLA |
| `slaCompliancePercentage` | number | `withinSla / (resolved + active) * 100` |

**SLA target:** 240 minutes (4 hours). Due-soon warning at 60 minutes.

**Widget:** Alert banners — red for overdue, amber for dueSoon, compliance ring.

---

## 5. Productivity

Team-wide productivity metrics.

```json
{
  "ticketsPerHour": 1.25,
  "avgHandlingTime": 112.3,
  "activeTimeSec": 97800
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ticketsPerHour` | number | Average tickets resolved per agent per hour |
| `avgHandlingTime` | number | Average resolution time in minutes |
| `activeTimeSec` | number | Total active time in seconds |

**Widget:** Small stat row.

---

## 6. Performance Trend

Full 30-day time series. Always sorted ascending. No gaps — missing days return 0.

```json
[
  { "date": "2026-05-01", "assigned": 28, "resolved": 22 },
  { "date": "2026-05-02", "assigned": 35, "resolved": 30 },
  { "date": "2026-05-26", "assigned": 0,  "resolved": 0 }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | `YYYY-MM-DD` UTC |
| `assigned` | number | Tickets created that day |
| `resolved` | number | Tickets resolved that day |

**Widget:** Line chart — assigned vs resolved overlay.

---

## 7. Call Performance

Voice channel metrics with answer rate.

```json
{
  "totalCalls": 187,
  "answered": 152,
  "missed": 35,
  "avgDuration": 312,
  "answerRate": 81
}
```

| Field | Type | Description |
|-------|------|-------------|
| `totalCalls` | number | Total calls in period |
| `answered` | number | Calls with status `active` or `ended` (connected) |
| `missed` | number | Calls with status `missed` |
| `avgDuration` | number | Average call duration in **seconds** |
| `answerRate` | number | `answered / totalCalls * 100` |

**Call Status Mapping:**

| API Field | Call Model Statuses |
|-----------|-------------------|
| `answered` | `active`, `ended` |
| `missed` | `missed` (includes `rejected`, `ringing` with no answer) |

**Widget:** Stat cards + answer rate circular ring.

---

## 8. Channel Distribution

Ticket volume broken down by channel. Sorted descending by count.

```json
[
  { "name": "Telegram", "count": 85, "percentage": 38 },
  { "name": "Web",      "count": 62, "percentage": 28 },
  { "name": "Whatsapp", "count": 45, "percentage": 20 },
  { "name": "Voice",    "count": 31, "percentage": 14 }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Channel name (first letter capitalized) |
| `count` | number | Ticket count for this channel |
| `percentage` | number | % share (0-100, sums to ~100) |

**Widget:** Pie/donut chart.

---

## 9. Feedback Stats

Customer satisfaction ratings across all agents.

```json
{
  "totalRatings": 28,
  "avgRating": 4.2,
  "csat": 82,
  "ratingBreakdown": { "1": 1, "2": 2, "3": 3, "4": 10, "5": 12 }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `totalRatings` | number | Total number of feedback submissions |
| `avgRating` | number | Average rating (1.0–5.0) |
| `csat` | number | % of ratings ≥ 4 (0-100) |
| `ratingBreakdown` | object | Count per star: `{ "1": N, "2": N, "3": N, "4": N, "5": N }` |

**Widget:** Star distribution bar chart + CSAT circular ring.

---

## 10. CSAT UI

Derived from feedbackStats for direct rendering — no client-side calculation needed.

```json
{
  "percentage": 82,
  "label": "Good",
  "color": "green",
  "trend": 0
}
```

| Threshold | Label | Color |
|-----------|-------|-------|
| ≥75 | Good | green |
| 50–74 | Average | orange |
| <50 | Bad | red |

| Field | Type | Description |
|-------|------|-------------|
| `percentage` | number | CSAT % (same as feedbackStats.csat) |
| `label` | string | `Good` / `Average` / `Bad` |
| `color` | string | `green` / `orange` / `red` |
| `trend` | number | % change vs previous period (0 = first measurement) |

**Widget:** Circular progress ring with color + label.

---

## 11. Recent Activity

Last 10 events from the past 72 hours. Newest first.

```json
[
  { "type": "ticket_resolved", "ticketId": "...", "label": "Resolved ticket #a1b2c3", "timeAgo": "2min ago" },
  { "type": "ticket_created",  "ticketId": "...", "label": "Created ticket #d4e5f6",  "timeAgo": "15min ago" }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Event type constant |
| `ticketId` | string | MongoDB ObjectId of the ticket |
| `label` | string | Human-readable event description |
| `timeAgo` | string | Relative time like `"2min ago"`, `"1h ago"` |

**Event Types Tracked:**
- `ticket_claimed`
- `ticket_resolved`
- `ticket_closed`
- `agent_replied`
- `ticket_created`

**Widget:** Activity feed list, newest first.

---

## 12. Top Categories

Ticket volume by category. Sorted descending by count.

```json
[
  { "name": "payment",    "count": 12 },
  { "name": "technical",  "count": 8 },
  { "name": "general",    "count": 5 }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Category name (lowercase, from ticket data) |
| `count` | number | Number of tickets in this category |

**Widget:** Horizontal bar chart, sorted by count descending.

---

## 13. Goal Progress

Monthly/quarterly ticket resolution target tracking.

```json
{
  "total": 500,
  "current": 433,
  "percentage": 87,
  "dailyTarget": 15
}
```

| Field | Type | Description |
|-------|------|-------------|
| `total` | number | Target ticket resolution goal (default 500) |
| `current` | number | Total resolved tickets so far |
| `percentage` | number | `current / total * 100`, capped at 100 |
| `dailyTarget` | number | Recommended tickets to resolve per day to meet goal |

**Widget:** Progress bar — green ≥80%, amber ≥50%, red <50%.

---

## 14. Workload

Overall system workload vs capacity.

```json
{
  "used": 87,
  "total": 480,
  "percentage": 18,
  "level": "low"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `used` | number | Current open tickets |
| `total` | number | Maximum capacity (`agents × 20`) |
| `percentage` | number | `used / total * 100`, capped at 100 |
| `level` | string | `low` (≤30%), `medium` (31-69%), `high` (≥70%) |

**Widget:** Utilization bar — green (low), amber (medium), red (high).

---

## 15. Insights

Dynamic observations based on 11 data conditions. Updated on every request.

```json
[
  { "type": "warning",  "metric": "workloadPerAgent", "message": "High workload per agent (4 tickets each)", "severity": "high" },
  { "type": "critical", "metric": "activeManagers",   "message": "No active managers — operational risk detected", "severity": "high" },
  { "type": "info",     "metric": "activeTickets",    "message": "No active tickets — team is idle", "severity": "low" }
]
```

| Field | Values |
|-------|--------|
| `type` | `info` / `warning` / `critical` / `positive` |
| `metric` | Which data point triggered the insight |
| `message` | Human-readable observation |
| `severity` | `low` / `medium` / `high` |

**Trigger Rules:**

| Condition | Type | Severity |
|-----------|------|----------|
| `workloadPerAgent > 5` | warning | high |
| `resolutionRate === 100 && totalTickets > 0` | positive | low |
| `openTickets === 0` | info | low |
| `activeManagers === 0 && totalManagers > 0` | critical | high |
| `activeChannels < 2` | info | medium |
| `overdueTickets > 0` | critical | high |
| `breachedTickets > 0` | warning | medium |
| `answerRate < 60 && totalCalls > 0` | warning | high |
| `csat > 0 && csat < 50` | critical | high |
| `resolutionRate < 50 && totalTickets > 0` | warning | high |
| `resolvedToday === 0` | info | low |

**Widget:** Feed list, color-coded by severity.

---

## 16. Suggestions

Actionable recommendations derived from current system state.

```json
[
  { "type": "staffing",     "action": "hire",     "message": "Hire more agents or redistribute tickets to reduce workload", "priority": "high" },
  { "type": "staffing",     "action": "activate",  "message": "Assign or activate managers to mitigate operational risk", "priority": "high" },
  { "type": "optimization", "action": "reschedule", "message": "Agents are idle — consider reducing shifts or scheduling training", "priority": "medium" }
]
```

| Field | Values |
|-------|--------|
| `type` | `staffing` / `optimization` / `quality` |
| `action` | `hire` / `reschedule` / `train` / `activate` / `coach` |
| `message` | Human-readable recommendation |
| `priority` | `low` / `medium` / `high` |

**Trigger Rules:**

| Condition | Type | Action | Priority |
|-----------|------|--------|----------|
| `workloadPerAgent > 5` | staffing | hire | high |
| `openTickets === 0 && agentsCount > 0` | optimization | reschedule | medium |
| `resolutionRate > 0 && resolutionRate < 50` | quality | train | high |
| `activeManagers === 0` | staffing | activate | high |
| `answerRate < 60 && totalCalls > 0` | optimization | coach | medium |
| `csat > 0 && csat < 60` | quality | train | high |

**Widget:** Action cards with priority badges.

---

## Frontend Integration Quick Reference

| Section | Widget Type | Notes |
|---------|-------------|-------|
| `overview` | Gauge + indicator badges | Health score as circular gauge |
| `kpis` | Stat cards grid (16 values) | Color-code resolution rate |
| `todayStats` | Today badge | Small stat row |
| `slaStats` | Alert banners + compliance ring | Red/amber based on overdue |
| `productivity` | Stat row | ticketsPerHour |
| `performanceTrend` | Line chart (30 days) | assigned vs resolved overlay |
| `callPerformance` | Stat cards + answer ring | answerRate circular progress |
| `channelDistribution` | Pie/donut chart | Percentages in tooltip |
| `feedbackStats` | Star chart + CSAT ring | ratingBreakdown bars |
| `csatUI` | Circular ring | percentage + label + color |
| `recentActivity` | Activity feed | Newest first, max 10 items |
| `topCategories` | Horizontal bar chart | Sorted by count descending |
| `goalProgress` | Progress bar | Green/amber/red threshold |
| `workload` | Utilization bar | Color by level |
| `insights` | Feed list | Color by severity |
| `suggestions` | Action cards | Priority badges |

### Polling Strategy

- **Page load**: call once
- **Auto-refresh**: poll every 60 seconds
- All 16 sections update together — no partial refresh needed
- Use `from`/`to` query params for historical date range; omit for live view
