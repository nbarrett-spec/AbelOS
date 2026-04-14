# Abel OS — Architecture & System Design

**Effective:** April 13, 2026 (Go-Live)  
**Audience:** Engineers, architects, new team members  
**Scope:** Data models, API architecture, external services, constraints

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Vercel Edge Network (Global CDN)                │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Next.js 14 Frontend (React 18, Tailwind CSS)                │  │
│  │  ✓ Builder Portal (/dashboard, /projects, /orders)          │  │
│  │  ✓ Ops Portal (/ops, /admin)                                │  │
│  │  ✓ Crew App (/crew)                                         │  │
│  │  ✓ Homeowner View (/homeowner)                              │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Edge Middleware (src/middleware.ts)                         │  │
│  │  ✓ JWT validation                                            │  │
│  │  ✓ Role-based routing (builder vs ops vs crew)             │  │
│  │  ✓ Rate limiting (Upstash Redis distributed)               │  │
│  │  ✓ Security headers (CSP, HSTS, etc.)                      │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Next.js API Routes (445+ endpoints)                         │  │
│  │  ✓ /api/auth/* — Auth flows (login, signup, password)     │  │
│  │  ✓ /api/orders/* — Order CRUD + status                    │  │
│  │  ✓ /api/quotes/* — Quote request + responses              │  │
│  │  ✓ /api/builder/* — Pricing intelligence, forecasting    │  │
│  │  ✓ /api/admin/* — Builder mgmt, product sync              │  │
│  │  ✓ /api/ops/* — Staff operations (churn, inventory)      │  │
│  │  ✓ /api/webhooks/* — Stripe, QB, cron auth              │  │
│  │  See README for full endpoint list                         │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                               │
                ┌──────────────┼──────────────┐
                │              │              │
            ┌───▼──────┐   ┌───▼────────┐   ┌─▼────────────┐
            │  Neon    │   │  Upstash   │   │   Stripe     │
            │ Database │   │  Redis     │   │  (Payments)  │
            │          │   │            │   │              │
            │Postgres  │   │  Rate      │   │  ✓ Checkout │
            │ Pooled   │   │  Limiting  │   │  ✓ Webhooks │
            │Conn <50  │   │            │   │  ✓ Invoices │
            └──────────┘   └────────────┘   └──────────────┘

        ┌────────────────┐     ┌──────────────┐
        │    Resend      │     │  Anthropic   │
        │   (Email)      │     │  Claude 3    │
        │                │     │              │
        │ ✓ Transactional│     │ ✓ Pricing    │
        │ ✓ Reset links  │     │   Intelligence
        │ ✓ Confirmations│     │ ✓ Demand     │
        │ ✓ Invites      │     │   Forecasting
        └────────────────┘     │ ✓ Churn Risk │
                               └──────────────┘

        ┌────────────────┐     ┌──────────────┐
        │    Sentry      │     │   Vercel     │
        │  (Error Track) │     │  (Logs/CDN)  │
        │                │     │              │
        │ ✓ Runtime errs │     │ ✓ Deployment │
        │ ✓ Performance  │     │ ✓ Analytics  │
        │ ✓ Sourcemaps   │     │ ✓ Monitoring│
        └────────────────┘     └──────────────┘

        ┌────────────────┐     ┌──────────────┐
        │   InFlow       │     │  QuickBooks  │
        │  (Order Data)  │     │ (Accounting) │
        │                │     │              │
        │ ✓ Catalog      │     │ ✓ Sync queue │
        │ ✓ Pricing      │     │ ✓ Jobs run   │
        │ ✓ Inventory    │     │   periodically
        │ ✓ Product info │     └──────────────┘
        └────────────────┘
```

---

## Data Flow: Request → Response

### Typical Builder Order Flow

1. Builder types order in browser
2. Browser POST /api/orders (with JWT cookie)
3. Edge Middleware validates JWT; redirects if invalid
4. Route handler processes: validate input → check permissions → query DB → call AI → create Stripe intent → send email → return 200
5. Browser receives response & redirects to /orders/{id}
6. Background cron jobs sync to QB, forecast demand, calculate churn

---

## Core Data Models

**Builder** — Customer account with contact, billing, QB integration  
**Project** — Job site with blueprints, takeoffs, quotes  
**Order** — Transaction with line items, payment status, delivery info  
**OrderLineItem** — Individual line in order (product + qty + price)  
**Product** — Catalog item with cost, base price, category  
**Quote** — Price estimate (7-day validity)  
**Staff** — Ops team member (admin, manager, ops role)  
**Deal** — Internal sales tracking  

Full schema: `/sessions/jolly-happy-carson/mnt/Abel Lumber/abel-builder-platform/prisma/schema.prisma`

---

## API Route Structure (445 Total)

**Auth:**
- POST /api/auth/login, signup, logout, forgot-password, reset-password

**Orders & Quotes:**
- GET/POST /api/orders, GET/PATCH /api/orders/[id]
- GET/POST /api/quotes, PATCH /api/quotes/[id]

**Projects & Blueprints:**
- GET/POST /api/projects, POST /api/blueprints/[projectId]

**Catalog:**
- GET /api/catalog/products, /api/catalog/categories, /api/search

**Intelligence (AI):**
- POST /api/builder/pricing-intelligence
- POST /api/builder/reorder-forecast
- POST /api/ops/ai/predictive (churn risk)
- POST /api/ops/ai/alerts (intervention opportunities)

**Operations:**
- GET /api/admin/builders, PATCH /api/admin/builders/[id]
- GET /api/admin/stats, POST /api/admin/sync-catalog
- GET /api/ops/health

**Webhooks:**
- POST /api/webhooks/stripe, /api/webhooks/qb
- POST /api/cron/* (Vercel cron jobs)

---

## External Service Integrations

| Service | Purpose | Fallback |
|---------|---------|----------|
| **Stripe** | Online payments | Manual payment (NET_30) |
| **Resend** | Transactional email | Retry queue; non-blocking |
| **Anthropic Claude** | Pricing intelligence, demand forecasting | Base pricing + historical averages |
| **QuickBooks** | Accounting sync | Queue jobs; sync when available |
| **InFlow** | Product catalog, inventory | Cached product data (24h stale acceptable) |
| **Sentry** | Error monitoring & performance | Log to console; non-blocking |
| **Upstash Redis** | Rate limiting | In-memory fallback (single instance) |

---

## Authentication & Authorization

**Auth Flow:**
- Builder: email + password → JWT (7d expiry, httpOnly cookie) → can access own data
- Staff: email + password → JWT (7d expiry) → role-based access (admin > manager > ops)
- Public: No auth → /login, /signup, /api/health only

**Authorization:**
- Builder: Can view only own orders, projects, quotes
- Crew: Can view assigned jobs
- Ops/Admin: Can view all builders, orders, system admin
- Admin: Full system access

---

## Data Consistency & Integrity

Run post-seed or after migrations:
```bash
npx tsx prisma/integrity-checks.ts
```

Checks 19 data quality rules (orphaned records, duplicates, negative margins, quote validity, etc.). Exit 0 = all pass.

---

## Performance Characteristics

- **Builders list:** ~1000 rows; paginated → <100ms
- **Orders for builder:** ~500 rows; indexed → <50ms
- **Product search:** Full-text on 5000 items → <500ms
- **Pricing intelligence:** Claude API → 1-3s (cached when possible)

**Connection pool:** Neon (max 50), Upstash (global), Stripe (100 req/s with retry)

---

## Known Limitations & Planned Improvements

**Current:**
- CSP too permissive (unsafe-inline for Tailwind)
- No query caching layer
- No API versioning
- Rate limiting IP-based only
- No feature flags framework

**Phase 2:**
- Query caching (Redis/Vercel KV)
- API versioning
- Web Authentication (passwordless)
- MFA for staff
- Full-text search engine
- Event sourcing for audit trail

---

## Disaster Recovery

**Backup:** Neon snapshots (hourly); code in GitHub  
**Restore:** RTO <2 hours (DB restore + code rollback + env sync)  
**RPO:** 1 hour (latest Neon snapshot)

---

**Last Updated:** April 13, 2026  
**Next Review:** May 13, 2026
