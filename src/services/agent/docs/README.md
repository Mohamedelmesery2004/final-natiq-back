# Agent Services — API Documentation

This directory contains API documentation for the agent-facing analytics and dashboard endpoints.

| Doc | Endpoint | Purpose |
|-----|----------|---------|
| [agent-dashboard-overview.md](./agent-dashboard-overview.md) | `GET /agent/dashboard/overview` | Lightweight agent dashboard — KPIs, today stats, SLA, charts, activity feed |
| [agent-analytics-full.md](./agent-analytics-full.md) | `GET /agent/analytics/full` | Full analytics payload — all KPIs, charts, intelligence, recommendations, call insights |

---

## Route Prefix

All endpoints are mounted under:

```
/api/v1/agent
```

Auth: `Bearer <token>` + tenant isolation via `x-company-id`.

---

## Available Analytics Endpoints (all under `/api/v1/agent/analytics`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/analytics/overview` | Legacy — summary KPIs + channel breakdown |
| GET | `/analytics/tickets` | Category, priority, top customer breakdown |
| GET | `/analytics/time-series` | Legacy — assigned/resolved/response time per day (zero-filled) |
| GET | `/analytics/quality` | QA evaluation scores + customer satisfaction stats |
| GET | `/analytics/insights` | Strengths, weaknesses, recommendations |
| GET | `/analytics/full` | **<ins>New</ins>** — consolidated: all KPIs + charts + intelligence + goals + recommendations + activity + calls |

---

## Key Differences: `full` vs `overview` vs `dashboard`

| Endpoint | Scope | Chart Data | Best For |
|----------|-------|------------|----------|
| `dashboard/overview` | Agent's main screen | Sparse (activity-only days) | Home tab, today stats, SLA alerts |
| `analytics/full` | Deep analytics | Sparse (activity-only days) | Analytics tab, charts, agent IQ |
| `analytics/time-series` | Legacy compat | Zero-filled (all days) | Old frontend versions |
| `analytics/overview` | Legacy compat | No time series | Old frontend versions |
{
    "success": true,
    "message": "Success",
    "data": {
        "dashboard": {
            "kpis": {
                "assignedTickets": 5,
                "resolvedTickets": 5,
                "pendingTickets": 0,
                "inProgressTickets": 0,
                "avgFirstResponseTime": 12.7,
                "avgResolutionTime": 33.6,
                "csatScore": 50
            },
            "todayStats": {
                "ticketsToday": 0,
                "resolvedToday": 0,
                "avgResponseToday": 0,
                "avgResolutionToday": 0
            },
            "slaStats": {
                "overdueTickets": 0,
                "dueSoon": 0,
                "breachedTickets": 0
            },
            "productivity": {
                "ticketsPerHour": 51.14,
                "avgHandlingTime": 33.6,
                "activeTimeSec": 352
            },
            "performanceTrend": [
                {
                    "date": "2026-05-27",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-05-28",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-05-29",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-05-30",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-05-31",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-01",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-02",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-03",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-04",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-05",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-06",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-07",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-08",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-09",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-10",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-11",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-12",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-13",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-14",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-15",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-16",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-17",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-18",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-19",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-20",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-21",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-22",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-23",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-24",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-25",
                    "assigned": 0,
                    "resolved": 0
                },
                {
                    "date": "2026-06-26",
                    "assigned": 0,
                    "resolved": 0
                }
            ],
            "callPerformance": {
                "totalCalls": 4,
                "answered": 4,
                "missed": 0,
                "avgDuration": 13,
                "answerRate": 100
            },
            "channelDistribution": [
                {
                    "channel": "telegram",
                    "count": 5,
                    "percentage": 100
                }
            ],
            "feedbackStats": {
                "totalRatings": 2,
                "avgRating": 3,
                "csat": 50,
                "ratingBreakdown": {
                    "1": 1,
                    "2": 0,
                    "3": 0,
                    "4": 0,
                    "5": 1
                }
            },
            "csatUI": {
                "percentage": 50,
                "label": "Average",
                "color": "orange",
                "trend": 0
            },
            "recentActivity": [],
            "topCategories": [
                {
                    "name": "other",
                    "count": 5
                }
            ],
            "goalProgress": {
                "total": 6,
                "current": 5,
                "percentage": 83,
                "dailyTarget": 2
            },
            "workload": {
                "used": 5,
                "total": 6,
                "percentage": 83,
                "level": "high"
            }
        }
    }
}