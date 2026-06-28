# Subscription & Billing Management System

## Role Restructuring

| Old | New |
|---|---|
| `COMPANY_OWNER` — company-level top admin | **Natiq platform team** — manages all companies, subscriptions, billing, tiers |
| `COMPANY_MANAGER` — limited management | **Gets full company-level control** — dashboard, settings, telegram, staff listing |

### Middleware Change
`tenantIsolation` in `src/middlewares/authMiddleware.js:40` now treats `COMPANY_OWNER` the same as `PLATFORM_SUPER_ADMIN` — they can see all companies across the platform.

---

## New Model: SubscriptionPlan

**File:** `src/models/subscriptionPlan.js`

Defines the tiers/plans available for companies to subscribe to:

| Field | Type | Description |
|---|---|---|
| `name` | String | Plan display name (e.g. "Growth") |
| `code` | String (unique) | Slug identifier (e.g. "growth") |
| `description` | String | Short description |
| `price` | Number | Price amount |
| `currency` | String | USD, EUR, etc. |
| `interval` | enum: monthly/yearly | Billing cycle |
| `features[]` | [{text, included}] | Feature list for UI display |
| `limits` | {maxAgents, maxChatsPerDay, maxTicketsPerDay, maxKnowledgeItems, aiEnabled, channels[], storageGb} | Usage limits |
| `isActive` | Boolean | Soft delete / toggle |
| `sortOrder` | Number | Display ordering |

---

## Extended Company Model

**File:** `src/models/company.js`

Three new embedded sections:

### `subscription`
```json
{
  "planId": "ObjectId → SubscriptionPlan",
  "status": "active | trialing | past_due | canceled | expired",
  "startDate": "Date",
  "endDate": "Date",
  "trialEndDate": "Date",
  "autoRenew": true
}
```

### `billingInfo`
```json
{
  "email": "",
  "phone": "",
  "address": { "line1", "line2", "city", "state", "country", "postalCode" }
}
```

### `invoices[]`
```json
[{
  "invoiceNumber": "INV-001",
  "amount": 79,
  "currency": "USD",
  "status": "paid | pending | overdue | refunded | canceled",
  "planId": "ObjectId",
  "planName": "Growth",
  "periodStart/periodEnd": "Date",
  "paidAt/dueDate": "Date",
  "paymentMethod": "",
  "notes": ""
}]
```

---

## Owner (Natiq Team) API

Base: `/api/v1/owner` — requires `COMPANY_OWNER` or `PLATFORM_SUPER_ADMIN`

### Dashboard
| Method | Endpoint | Description |
|---|---|---|
| GET | `/dashboard` | Platform overview — total companies, active subs, revenue, recent companies |

### Subscription Plans (Tiers)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/plans` | List all plans (filter: `?isActive=true`) |
| GET | `/plans/:planId` | Get single plan |
| POST | `/plans` | Create plan |
| PUT | `/plans/:planId` | Update plan |
| DELETE | `/plans/:planId` | Delete plan (blocked if companies use it) |
| PATCH | `/plans/:planId/toggle` | Toggle active/inactive |

### Companies
| Method | Endpoint | Description |
|---|---|---|
| GET | `/companies` | List all companies (`?search=&isActive=&page=&limit=`) |
| GET | `/companies/:companyId` | Full company detail with plan info |

### Subscriptions
| Method | Endpoint | Description |
|---|---|---|
| GET | `/subscriptions` | List all company subscriptions (`?status=&planId=&search=`) |
| GET | `/subscriptions/:companyId` | Get company subscription with plan details |
| POST | `/subscriptions/:companyId/assign` | Assign a plan to a company |
| PUT | `/subscriptions/:companyId` | Update subscription fields |
| POST | `/subscriptions/:companyId/cancel` | Cancel company subscription |

### Billing
| Method | Endpoint | Description |
|---|---|---|
| PUT | `/billing/:companyId` | Update company billing info |
| GET | `/invoices/:companyId` | List company invoices |
| POST | `/invoices/:companyId` | Add invoice to company |
| PUT | `/invoices/:companyId/:invoiceId` | Update invoice |

---

## Manager API (Old Owner Logic Moved Here)

Base: `/api/v1/admin/management` — requires `COMPANY_MANAGER`

| Method | Endpoint | Old Owner Equivalent |
|---|---|---|
| GET | `/dashboard` | `GET /api/v1/owner/dashboard` |
| GET | `/settings` | `GET /api/v1/owner/settings` |
| PUT | `/settings` | `PUT /api/v1/owner/settings` |
| POST | `/telegram/webhook` | `POST /api/v1/owner/telegram/webhook` |
| GET | `/team-leaders` | `GET /api/v1/owner/managers` (now lists team leaders) |
| GET | `/agents` | New — list agents with team leader info |

Existing manager endpoints (audit logs, RBAC matrix, exports) remain unchanged.

---

## Seed Data

**File:** `src/seeds/seed.js`

Four subscription plans are seeded:

| Plan | Price | Interval | Agents | Channels |
|---|---|---|---|---|
| Starter | $29 | monthly | 2 | web |
| Growth | $79 | monthly | 10 | web, telegram, whatsapp |
| Enterprise | $199 | monthly | unlimited | all |
| Enterprise Yearly | $166 | monthly (yearly billing) | unlimited | all |

The `Prime Store` company is assigned the **Growth** plan on seed.

---

## Service Layer

### `src/services/owner/ownerBillingService.js`
Core business logic:
- `listPlans`, `getPlan`, `createPlan`, `updatePlan`, `deletePlan`, `togglePlanActive`
- `listCompanySubscriptions`, `getCompanySubscription`
- `assignPlanToCompany`, `updateCompanySubscription`, `cancelCompanySubscription`
- `addInvoice`, `listInvoices`, `updateInvoice`
- `updateBillingInfo`
- `getOwnerDashboard` — aggregate stats across all companies

### `src/services/manager/managerDashboardService.js`
Identical to the former `ownerDashboardService.js` — now serving company managers.

---

## RBAC Updates

**File:** `src/constants/index.js`

`COMPANY_OWNER` now has full `MANAGE` access to `COMPANIES` resource (previously they had no company resource permissions).
