# Team Leader Dashboard API

> `GET /api/v1/team-leader/dashboard`

Returns a comprehensive 14-section dashboard for team leaders with per-agent breakdowns, SLA monitoring, insights, and actionable suggestions.

---

## Headers

| Key | Value |
|-----|-------|
| `Authorization` | `Bearer <token>` |
| `x-company-id` | `{{companyId}}` |

---

## Response Structure

```json
{
  "success": true,
  "message": "Dashboard overview retrieved successfully",
  "data": {
    "dashboard": {
      "teamStats":       { },
      "kpis":            { },
      "goals":           { },
      "callPerformance": { },
      "channelDistribution": [ ],
      "agentsPerformance":   [ ],
      "topAgents":           [ ],
      "lowPerformers":       [ ],
      "workload":        { },
      "sla":             { },
      "insights":        [ ],
      "suggestions":     [ ],
      "trendData":       [ ],
      "heatmap":         [ ],
      "teamScore":       { }
    }
  }
}
```

---

## 1. Team Stats

```json
{
  "totalAgents": 24,
  "onlineAgents": 15,
  "idleAgents": 3,
  "overloadedAgents": 4
}
```

| Field | Type | Description |
|-------|------|-------------|
| `totalAgents` | number | Total agents on the team |
| `onlineAgents` | number | Agents with active tickets or recent activity |
| `idleAgents` | number | Online agents with 0 active tickets |
| `overloadedAgents` | number | Agents with >15 active tickets |

**Widget:** Stat cards row. Overloaded in red, idle in grey.

---

## 2. KPIs

```json
{
  "activeTickets": 187,
  "unassignedTickets": 23,
  "resolvedToday": 42,
  "avgFirstResponseTime": 4.8,
  "avgResolutionTime": 112.3,
  "csatScore": 84
}
```

| Field | Type | Description |
|-------|------|-------------|
| `activeTickets` | number | Tickets with status `pending` or `opened` |
| `unassignedTickets` | number | Tickets with no assigned agent |
| `resolvedToday` | number | Tickets resolved since midnight UTC |
| `avgFirstResponseTime` | number | Average across team (minutes) |
| `avgResolutionTime` | number | Average across team (minutes) |
| `csatScore` | number | % of ratings ≥ 4 (0-100) |

**Widget:** Stat cards row with icons. CSAT as ring/badge.

---

## 3. Goals

```json
{
  "tickets": {
    "total": 500,
    "current": 5,
    "percentageCompleted": 1
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `total` | number | Monthly/quarterly ticket resolution target |
| `current` | number | Actual resolved tickets so far |
| `percentageCompleted` | number | `current / total * 100`, capped at 100 |

**Widget:** Progress bar + "X / 500" label.

---

## 4. Call Performance

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

**Widget:** Stat cards + answer rate ring.

---

## 5. Channel Distribution

```json
[
  { "name": "Telegram",  "count": 85,  "percentage": 38 },
  { "name": "Web",       "count": 62,  "percentage": 28 },
  { "name": "Whatsapp",  "count": 45,  "percentage": 20 },
  { "name": "Voice",     "count": 31,  "percentage": 14 }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Channel name (capitalized) |
| `count` | number | Ticket count |
| `percentage` | number | % share (0-100, sums to ~100) |

**Widget:** Pie/donut chart.

---

## 6. Agents Performance

Core per-agent breakdown. Each agent's ticket stats + feedback merged.

```json
[
  {
    "agentId": "664a1b2c...",
    "name": "Ahmed Hassan",
    "status": "online",
    "activeTickets": 12,
    "resolvedTickets": 34,
    "avgResponseTime": 3.2,
    "avgResolutionTime": 89.5,
    "csat": 92,
    "workload": "high",
    "performance": "good"
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `agentId` | string | Agent ObjectId |
| `name` | string | Agent display name |
| `status` | string | `online` / `offline` (based on activity) |
| `activeTickets` | number | Tickets in `pending` or `opened` status |
| `resolvedTickets` | number | Tickets with status `closed` |
| `avgResponseTime` | number | Average minutes to first response |
| `avgResolutionTime` | number | Average minutes to resolution |
| `csat` | number | CSAT score 0-100 |
| `workload` | string | `low` (<5 active), `normal` (5-11), `high` (≥12) |
| `performance` | string | `good` (csat≥80 & response≤5 & resolution≤90), `average`, `bad` |

**Widget:** Table/sortable list. Color-code workload and performance columns.

---

## 7. Top & Low Performers

```json
{
  "topAgents": [
    {
      "agentId": "664a...",
      "name": "Ahmed Hassan",
      "score": 92,
      "resolvedTickets": 34,
      "csat": 92
    }
  ],
  "lowPerformers": [
    {
      "agentId": "664a...",
      "name": "Khaled Omar",
      "score": 48,
      "resolvedTickets": 8,
      "csat": 52,
      "issues": ["high response time", "low CSAT"]
    }
  ]
}
```

**Score formula:** `(csat + max(0, 100 - responseTime*5) + max(0, 100 - resolutionTime)) / 3`

| Field | Type | Description |
|-------|------|-------------|
| `score` | number | Composite 0-100 |
| `issues` | string[] | List of reasons why agent is a low performer |

**Widget:** Leaderboard cards for top 3, alert cards for low performers.

---

## 8. Workload Distribution

```json
{
  "totalCapacity": 480,
  "used": 356,
  "percentage": 74,
  "level": "normal"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `totalCapacity` | number | `totalAgents × 20` (max tickets per agent) |
| `used` | number | Sum of all agents' active tickets |
| `percentage` | number | `used / totalCapacity * 100`, capped at 100 |
| `level` | string | `low` (≤30%), `normal` (31-79%), `high` (≥80%) |

**Widget:** Utilization bar. Green ≤30%, amber 31-79%, red ≥80%.

---

## 9. SLA Metrics

```json
{
  "overdueTickets": 8,
  "breachedTickets": 5,
  "withinSla": 174,
  "slaCompliancePercentage": 93
}
```

| Field | Type | Description |
|-------|------|-------------|
| `overdueTickets` | number | Not closed AND `createdAt > 4h ago` |
| `breachedTickets` | number | Closed but resolution time exceeded 4h |
| `withinSla` | number | Closed tickets that met SLA |
| `slaCompliancePercentage` | number | `withinSla / (resolved + active) * 100` |

**SLA target:** 240 minutes (4 hours).

**Widget:** Alert banners — overdue in red, breached in grey, compliance ring.

---

## 10. Insights

Auto-generated observations based on current data:

```json
[
  {
    "type": "warning",
    "metric": "unassignedTickets",
    "message": "23 tickets unassigned — exceeding recommended threshold",
    "severity": "high"
  },
  {
    "type": "critical",
    "metric": "overdueTickets",
    "message": "8 tickets have breached SLA deadline and need immediate action",
    "severity": "high"
  },
  {
    "type": "info",
    "metric": "agentActivity",
    "message": "All agents are currently idle with no active tickets",
    "severity": "low"
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `warning` / `critical` / `info` / `positive` |
| `metric` | string | Which data point triggered this insight |
| `message` | string | Human-readable observation |
| `severity` | string | `high` / `medium` / `low` |

**Trigger rules:**
- `unassignedTickets` > 10 → warning
- `avgFirstResponseTime` > 5 min → warning
- `csatScore` < 60 → critical
- `overloadedAgents` > 0 → warning
- `overdueTickets` > 0 → critical
- `idleAgents` > 0 while `activeTickets` > 0 → info
- All agents idle → info
- No resolved today → info

**Widget:** Insight feed list, color-coded by severity.

---

## 11. Suggestions

Actionable recommendations for the team leader:

```json
[
  {
    "type": "optimization",
    "action": "reassign",
    "message": "Reassign tickets from 4 overloaded agents to 3 idle agents",
    "priority": "high"
  },
  {
    "type": "quality",
    "action": "train",
    "message": "CSAT score is below target; schedule quality training for low-performing agents",
    "priority": "medium"
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `optimization` / `assignment` / `performance` / `quality` / `staffing` |
| `action` | string | `reassign` / `assign` / `coach` / `train` / `hire` / `redistribute` |
| `message` | string | Actionable recommendation |
| `priority` | string | `high` / `medium` / `low` |

**Trigger rules:**
- Overloaded + idle agents → reassign
- Unassigned > 5 → assign
- Response time > 5 → coach
- CSAT < 70 → train
- Utilization < 30% → redistribute
- Utilization > 85% → hire

**Widget:** Action card list with priority badges.

---

## 12. Performance Trend

Full daily time series, last 30 days. Always sorted ascending. No gaps.

```json
[
  { "date": "2026-05-01", "assigned": 28, "resolved": 22 },
  { "date": "2026-05-02", "assigned": 35, "resolved": 30 },
  { "date": "2026-05-26", "assigned": 0,  "resolved": 0 }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | `YYYY-MM-DD` UTC, every day in range |
| `assigned` | number | Tickets created that day |
| `resolved` | number | Tickets resolved that day |

**Widget:** Line chart — assigned vs resolved overlay.

---

## 13. Heatmap

Hour-by-hour ticket creation volume over the last 30 days.

```json
[
  { "hour": 0,  "load": 2 },
  { "hour": 8,  "load": 15 },
  { "hour": 10, "load": 42 },
  { "hour": 12, "load": 35 },
  { "hour": 14, "load": 40 },
  { "hour": 16, "load": 36 },
  { "hour": 23, "load": 2 }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `hour` | number | Hour of day (0-23) |
| `load` | number | Total ticket count for that hour across 30 days |

**Always returns all 24 hours** — hours with no tickets show `load: 0`.

**Widget:** Bar chart or heatmap grid. Higher loads in darker colors.

---

## 14. Team Score

Composite metric weighted by CSAT, response time, and resolution time.

```json
{
  "overall": 78,
  "breakdown": {
    "csatScore":      { "value": 84, "weight": 0.40, "contribution": 34 },
    "responseTime":   { "value": 76, "weight": 0.30, "contribution": 23 },
    "resolutionTime": { "value": 72, "weight": 0.30, "contribution": 22 }
  },
  "grade": "B+"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `overall` | number | Composite score 0-100 |
| `csatScore.value` | number | Raw CSAT % |
| `responseTime.value` | number | `max(0, 100 - avgResponseTime * 5)` |
| `resolutionTime.value` | number | `max(0, 100 - avgResolutionTime * 0.5)` |
| `grade` | string | `A` (≥90), `B+` (≥80), `B` (≥70), `C+` (≥60), `C` (<60) |

**Formula:** `overall = csatScore×0.40 + responseScore×0.30 + resolutionScore×0.30`

**Widget:** Score card with gauge/circular progress + grade badge.

---

## Frontend Integration Quick Reference

| Section | Widget Type | Notes |
|---------|-------------|-------|
| `teamStats` | Stat cards (4 values) | Overloaded in red, idle in grey |
| `kpis` | Stat cards (6 values) | CSAT as ring/badge |
| `goals` | Progress bar | X / 500 label |
| `callPerformance` | Stat cards + ring | answerRate for circular progress |
| `channelDistribution` | Pie/donut | Percentages in tooltip |
| `agentsPerformance` | Sortable table | Color-code workload & performance columns |
| `topAgents` | Leaderboard cards | Top 3 agents |
| `lowPerformers` | Alert cards | Show issues list |
| `workload` | Utilization bar | Green / amber / red |
| `sla` | Alert banners + ring | Overdue in red, compliance ring |
| `insights` | Feed list | Color by severity |
| `suggestions` | Action cards | Priority badges |
| `trendData` | Line chart | assigned vs resolved overlay |
| `heatmap` | Bar chart grid | 24 bars, color by load |
| `teamScore` | Gauge + grade badge | Circular progress |

### Polling Strategy

- **Page load**: call once
- **Real-time refresh**: poll every 60 seconds
- All sections update together — no partial refresh needed
