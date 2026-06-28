# Manager & Owner API — All GET Endpoints

## Manager (`/api/v1/admin/management`)

Role: `COMPANY_MANAGER` — company-scoped

### Dashboard & Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/management/dashboard` | Full dashboard: KPIs, SLA, productivity, trends, call performance, channel distribution, CSAT, insights, suggestions |
| GET | `/api/v1/admin/management/audit-logs` | Paginated audit logs (`?page=&limit=&action=&resourceType=&from=&to=`) |
| GET | `/api/v1/admin/management/rbac-matrix` | RBAC permission matrix |

### Company Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/management/settings` | Full company document (channels, integrations, settings, subscription) |

### Staff

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/management/team-leaders` | All team leaders for the company |
| GET | `/api/v1/admin/management/agents` | All agents with populated team leader |

### Exports (CSV)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/management/exports/calls?from=&to=` | Call logs CSV |
| GET | `/api/v1/admin/management/exports/tickets?from=&to=` | Tickets CSV |
| GET | `/api/v1/admin/management/exports/analytics-summary?from=&to=` | Analytics summary CSV |

---

## Owner / Natiq Team (`/api/v1/owner`)

Role: `COMPANY_OWNER` or `PLATFORM_SUPER_ADMIN` — platform-wide (sees all companies)

### Dashboard & Overview

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/owner/dashboard` | Platform dashboard: aggregated KPIs across all companies (workforce, tickets, chats, resolution rate, response times, performance trend 31d, channel distribution, CSAT, system health, insights) |
| GET | `/api/v1/owner/dashboard/overview` | Alias for `/dashboard` |

### Subscription Plans (Tiers)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/owner/plans` | All subscription plans (`?isActive=true`) |
| GET | `/api/v1/owner/plans/:planId` | Single plan details |

### Companies

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/owner/companies` | All companies paginated (`?page=&limit=&isActive=&search=`) |
| GET | `/api/v1/owner/companies/:companyId` | Full company detail page — includes: company info + plan, users (by role), tickets (stats + list), chat sessions (stats + list), knowledge items, calls (stats + list), billing (invoices, totals), recent events |

### Subscriptions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/owner/subscriptions` | All company subscriptions (`?status=&planId=&search=&page=&limit=`) |
| GET | `/api/v1/owner/subscriptions/:companyId` | Single company subscription with populated plan |

### Invoices & Billing

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/owner/invoices/:companyId` | Paginated invoices for a company (`?page=&limit=`) |

### Managers (all companies)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/owner/managers` | All company managers across platform (`?companyId=` to filter by specific company) |

---

## Shared Endpoints (Public / Auth)

| Method | Endpoint | Role |
|--------|----------|------|
| POST | `/api/v1/auth/login` | Any |
| GET | `/api/v1/auth/me` | Any (authenticated) |
| GET | `/api/v1/auth/companies` | Any |

### Test Accounts

| Role | Email | Password |
|------|-------|----------|
| Super Admin | admin@primestore.com | admin123 |
| Owner (Natiq) | owner@primestore.com | owner123 |
| Manager (Prime) | manager@primestore.com | manager123 |
| Manager (TechMart) | manager@techmart-eg.com | manager123 |
| Manager (Gulf Bank) | manager@gulfbank.com | manager123 |
| Team Leader | teamlead@primestore.com | teamlead123 |
| Agent (Omar) | omar@primestore.com | agent123 |
| Agent (Fatima) | fatima@primestore.com | agent123 |
| Agent (Khaled) | khaled.agent@primestore.com | agent123 |
