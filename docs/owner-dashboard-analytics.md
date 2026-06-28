# Owner Dashboard & Analytics (Natiq Platform)

The **owner** role represents the Natiq platform team. They see aggregate data across **all companies** — focused on revenue, subscriptions, and platform health rather than agent-level details.

---

## Dashboard

### `GET /api/v1/owner/dashboard`

Returns a high-level platform overview for the Natiq team.

#### Response Shape

```json
{
  "overview": {
    "totalCompanies": 5,
    "activeCompanies": 3,
    "totalRevenue": 2846,
    "subscriptionStatusBreakdown": {
      "active": 2,
      "trialing": 1,
      "past_due": 1,
      "canceled": 1
    },
    "planDistribution": [
      {
        "planId": "662...",
        "planName": "Enterprise Yearly",
        "planCode": "enterprise_yearly",
        "price": 1992,
        "interval": "yearly",
        "companyCount": 1,
        "companies": [
          { "name": "Saudi Health Corp", "slug": "saudi-health", "status": "past_due" }
        ]
      }
    ],
    "subscriptionRate": 40,
    "trialConversionRate": 67
  },
  "revenue": {
    "total": 2846,
    "monthly": 854,
    "yearly": 1992,
    "currency": "USD"
  },
  "subscriptionMetrics": {
    "activeSubscriptions": 2,
    "trialing": 1,
    "canceled": 1,
    "subscriptionRate": 40,
    "trialConversionRate": 67,
    "statusBreakdown": {
      "active": 2,
      "trialing": 1,
      "past_due": 1,
      "canceled": 1
    }
  },
  "tickets": {
    "total": 20,
    "resolved": 8,
    "today": 0,
    "resolutionRate": 40
  },
  "plans": {
    "total": 4,
    "active": 4,
    "distribution": [
      {
        "planId": "662...",
        "planName": "Enterprise Yearly",
        "planCode": "enterprise_yearly",
        "price": 1992,
        "interval": "yearly",
        "companyCount": 1,
        "companies": []
      }
    ]
  },
  "recentCompanies": [
    {
      "_id": "662...",
      "name": "Prime Store",
      "slug": "prime-store",
      "subscription": { "status": "active", "planId": { "name": "Enterprise", "code": "enterprise", "price": 199, "interval": "monthly" } },
      "isActive": true,
      "createdAt": "2026-05-01T00:00:00.000Z"
    }
  ],
  "insights": [
    { "type": "warning", "metric": "churn", "message": "1 company canceled", "severity": "high" },
    { "type": "info", "metric": "trials", "message": "1 company on trial — 67% conversion rate", "severity": "medium" }
  ]
}
```

#### Fields

| Field | Type | Description |
|---|---|---|
| `overview.totalCompanies` | number | Total companies registered |
| `overview.activeCompanies` | number | Companies with `isActive: true` |
| `overview.totalRevenue` | number | Sum of all paid USD invoices |
| `overview.subscriptionStatusBreakdown` | object | Count per subscription status (active, trialing, past_due, canceled) |
| `overview.planDistribution` | array | Companies grouped by plan with names, prices, intervals |
| `overview.subscriptionRate` | number | Percentage of companies with active subscriptions |
| `overview.trialConversionRate` | number | Active / (active + trialing) × 100 |
| `revenue.total` | number | Total paid revenue (USD) |
| `revenue.monthly` | number | Revenue from monthly plans (Starter, Growth, Enterprise) |
| `revenue.yearly` | number | Revenue from yearly plans (Enterprise Yearly) |
| `revenue.currency` | string | Always `USD` |
| `subscriptionMetrics.activeSubscriptions` | number | Companies with status `active` |
| `subscriptionMetrics.trialing` | number | Companies with status `trialing` |
| `subscriptionMetrics.canceled` | number | Companies with status `canceled` |
| `subscriptionMetrics.statusBreakdown` | object | Raw counts per status |
| `tickets.total` | number | All tickets across all companies |
| `tickets.resolved` | number | Tickets with status `closed` |
| `tickets.today` | number | Tickets created today |
| `tickets.resolutionRate` | number | resolved / total × 100 |
| `plans.total` | number | All subscription plans |
| `plans.active` | number | Plans with `isActive: true` |
| `plans.distribution` | array | Each plan with count of companies using it |
| `recentCompanies` | array | Last 10 companies created (populated plan info) |
| `insights` | array | Auto-generated warnings/info (churn, low sub rate, zero revenue) |

---

## Analytics

### `GET /api/v1/owner/analytics/overview`

Platform-wide analytics with heatmaps and company-level breakdowns.

**Query Params:** `?from=2026-01-01&to=2026-06-30` (both optional)

#### Response Shape

```json
{
  "overview": {
    "kpis": {
      "totalSessions": 13,
      "activeSessions": 6,
      "totalTickets": 20,
      "openTickets": 6,
      "inProgressTickets": 0,
      "resolvedTickets": 8,
      "resolutionRate": 40
    },
    "heatmap": {
      "chats": [
        { "date": "2026-05-15", "count": 3 }
      ],
      "tickets": [
        { "date": "2026-05-16", "count": 2 }
      ]
    },
    "topCategories": [
      { "category": "billing", "count": 8 },
      { "category": "support", "count": 6 }
    ],
    "topChannels": [
      { "channel": "whatsapp", "count": 7 },
      { "channel": "web", "count": 4 }
    ],
    "topIntents": [
      { "intent": "refund_request", "count": 5 }
    ],
    "topCompanies": [
      {
        "companyId": "662...",
        "name": "Prime Store",
        "slug": "prime-store",
        "industry": "ecommerce",
        "ticketCount": 8,
        "resolvedCount": 4
      }
    ],
    "companyActivity": [
      {
        "companyId": "662...",
        "name": "Prime Store",
        "slug": "prime-store",
        "totalTickets": 8,
        "resolvedTickets": 4,
        "resolutionRate": 50,
        "customerCount": 3
      }
    ]
  }
}
```

#### Fields

| Field | Description |
|---|---|
| `kpi`* | Total/active sessions, tickets by status, resolution rate (filterable by date range) |
| `heatmap` | Daily chat creation & ticket creation counts for the last 365 days |
| `topCategories` | Most common ticket categories across all companies |
| `topChannels` | Chat sessions grouped by channel (whatsapp, web, telegram) |
| `topIntents` | Most frequent chat intents from event logs |
| `topCompanies` | Top 10 companies by ticket volume (with resolved count) |
| `companyActivity` | Per-company ticket stats including resolution rate & unique customer count |

---

## Subscription Plans (CRUD)

All endpoints at `/api/v1/owner/plans`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/plans` | List all plans (optional `?isActive=true`) |
| `GET` | `/plans/:planId` | Get plan by ID |
| `POST` | `/plans` | Create plan (body: `code`, `name`, `price`, `currency`, `interval`, `description`, `features`, `limits`, `isActive`, `sortOrder`) |
| `PUT` | `/plans/:planId` | Update plan |
| `DELETE` | `/plans/:planId` | Delete plan (fails if companies are subscribed) |
| `PATCH` | `/plans/:planId/toggle` | Toggle `isActive` |

---

## Company Subscriptions

All endpoints at `/api/v1/owner/subscriptions`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/subscriptions` | List company subscriptions (query: `status`, `planId`, `search`, `page`, `limit`) |
| `GET` | `/subscriptions/:companyId` | Get single company subscription + invoices |
| `POST` | `/subscriptions/:companyId/assign` | Assign a plan to a company |
| `PUT` | `/subscriptions/:companyId` | Update subscription (planId, status, dates, autoRenew) |
| `POST` | `/subscriptions/:companyId/cancel` | Cancel subscription |

---

## Billing Info

| Method | Endpoint | Description |
|---|---|---|
| `PUT` | `/billing/:companyId` | Update company billing info (email, phone, address) |

---

## Invoices

All endpoints at `/api/v1/owner/invoices`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/invoices/:companyId` | List invoices for a company (paginated) |
| `POST` | `/invoices/:companyId` | Add an invoice to a company |
| `PUT` | `/invoices/:companyId/:invoiceId` | Update an invoice |

---

## Companies

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/companies` | List all companies (paginated, searchable, filterable by `isActive`) |
| `GET` | `/companies/:companyId` | Full company detail page (users, tickets, sessions, KB, calls, billing, events) |

---

## Managers (Backward Compat)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/managers` | List all company managers (optional `?companyId=`) |
