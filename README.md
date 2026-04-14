# Abel OS — Builder Platform

**Live at:** app.abellumber.com (Go-live: April 13, 2026)

Abel OS is the central hub for residential builder ordering and project management at Abel Lumber. It connects:

- **Builders** (customers) — order materials, manage projects, track quotes, access intelligent pricing & forecasting
- **Operations** (Abel staff) — manage inventory, process orders, monitor churn, handle supplier fulfillment
- **Agents** (AI) — provide pricing intelligence, forecast demand, proactively intervene on at-risk accounts
- **Integrations** — QuickBooks (accounting), InFlow (order data), Stripe (payments), Resend (email)

---

## Tech Stack

| Layer | Tech | Notes |
|-------|------|-------|
| Frontend | Next.js 14 App Router, React 18, Tailwind CSS | SSR + Client Components, edge-safe middleware |
| API | Next.js API Routes (App Router) | TypeScript-first, Zod validation, 445 routes |
| Database | PostgreSQL (Neon serverless) | Prisma ORM, full type safety, 30+ tables |
| Auth | JWT (jose library) | bcrypt rounds=12, httpOnly cookies, 7-day expiry |
| Payments | Stripe | Webhook-secured, sandboxed in test mode |
| Email | Resend transactional | Order confirmations, password resets, invite flows |
| Rate Limiting | Upstash Redis | Shared state across Vercel Functions |
| Error Monitoring | Sentry | Real-time runtime error capture + sourcemap upload |
| AI | Claude 3 (Anthropic SDK) | Pricing intelligence, demand forecasting, churn prediction |
| Hosting | Vercel Edge Network | Auto-scaling, global CDN, preview deploys |

---

## Quick Start

### Clone & Setup

```bash
git clone https://github.com/abellumber/abel-builder-platform.git
cd abel-builder-platform
cp .env.example .env
npm install
```

### Database Setup

```bash
# Generate Prisma client
npm run db:generate

# Create tables (dev environment only)
npm run db:migrate

# Seed with initial data
npm run db:seed

# Run integrity checks (post-seed)
npx tsx prisma/integrity-checks.ts
```

### Run Locally

```bash
npm run dev
```

Open http://localhost:3000. Builder login is at `/login`; ops staff login is at `/ops/login`.

### Build & Deploy

```bash
# Typecheck
npx tsc --noEmit

# Build for production
npm run build

# Start production server (local testing)
npm start
```

---

## Scripts

| Script | Purpose | Notes |
|--------|---------|-------|
| `npm run dev` | Local dev server | Fast refresh, sourcemaps, Sentry disabled |
| `npm run build` | Production build | Full typecheck, minify, analyze bundles |
| `npm start` | Run prod build | For local testing only; use Vercel for prod |
| `npm run lint` | ESLint check | Currently disabled during build (TODO: fix lint) |
| `npm run db:generate` | Sync Prisma client | After schema changes |
| `npm run db:push` | Schema push (dev only) | Non-destructive when possible; breaks with migrations |
| `npm run db:migrate` | Run migrations | Interactive; creates migration files in `prisma/migrations/` |
| `npm run db:seed` | Load seed data | Clears & repopulates; safe in dev |
| `npm run db:studio` | Prisma Studio | Web UI to browse + edit DB; port 5555 |
| `npm run db:seed-real` | Load real builder data | For ops testing; uses Excel file |

---

## Project Layout

### `/src/app`
- **`(auth)`** — Login, signup, password reset, verify email (public routes)
- **`dashboard`** — Builder home, project list, order history (protected)
- **`projects`** — Project detail, blueprints, takeoffs, quotes
- **`admin`** — Staff admin panel (builder mgmt, product catalog, stats)
- **`ops`** — Operations hub (order queue, churn, inventory, daily brief)
- **`crew`** — Field crew app (job tracking, material requests)
- **`homeowner`** — Homeowner project view (invite-based access)
- **`api`** — 445+ API routes (see API Surface below)

### `/src/lib`
- **`auth.ts`** — JWT creation, password hashing (bcrypt/12), session validation
- **`rate-limit.ts`** — Upstash Redis rate limiter (fallback to in-memory)
- **`env.ts`** — Environment variable validation & schema
- **`email.ts`** — Resend transactional email templates
- **`permissions.ts`** — Role-based access control (Builder, Crew, Ops, Admin)
- **`validations.ts`** — Zod schemas for payloads (orders, projects, quotes)
- **`api-handler.ts`** — Error handling + logging boilerplate
- **`logger.ts`** — Structured logging (debug/info/warn/error)
- **`stripe.ts`** — Stripe webhook parsing & payment intent handling
- **`integrations/`** — QuickBooks, InFlow, Anthropic API clients

### `/src/components`
- **`intelligence/`** — Pricing widget, forecast chart, churn alert components
- **`forms/`** — Builder form (signup, project creation, quote request)
- **`dashboard/`** — Dashboard widgets, order cards, activity feed
- **`ui/`** — Reusable buttons, modals, inputs, design system

### `/prisma`
- **`schema.prisma`** — 30+ models (Builder, Order, Project, Product, Deal, etc.)
- **`migrations/`** — Timestamped migration files from `db:migrate`
- **`seed.ts`** — Initial data (products, categories, test builders)
- **`seed-real-data.ts`** — Load real builder info from Excel
- **`integrity-checks.ts`** — 19 post-seed data quality checks

---

## API Surface

Core endpoints (445 total; grouped by domain):

**Auth & Account:**
- `POST /api/auth/login` — Builder login (email + password)
- `POST /api/auth/signup` — New builder registration
- `POST /api/auth/logout` — Clear session
- `POST /api/auth/forgot-password` — Email reset link
- `POST /api/auth/reset-password` — Consume reset token
- `GET /api/account/health` — Session check + builder info

**Orders & Quotes:**
- `GET /api/orders` — Builder's orders (paginated, filterable)
- `POST /api/orders` — Create new order
- `GET /api/orders/[id]` — Order detail + line items
- `PATCH /api/orders/[id]` — Update order status
- `GET /api/quotes` — Quotes awaiting response
- `POST /api/quotes` — Request custom quote
- `POST /api/quote-request` — Submit inquiry form

**Projects & Blueprints:**
- `GET /api/projects` — Builder's projects
- `POST /api/projects` — Create project
- `GET /api/projects/[id]` — Project detail
- `POST /api/blueprints/[projectId]` — Upload blueprint
- `POST /api/takeoff` — Generate takeoff from blueprint

**Catalog & Search:**
- `GET /api/catalog/products` — Browse product catalog
- `GET /api/search` — Full-text product search
- `GET /api/catalog/categories` — Product categories + filters

**Intelligence (AI-driven):**
- `POST /api/builder/pricing-intelligence` — Custom pricing recommendation
- `POST /api/builder/reorder-forecast` — Demand forecast for builder
- `POST /api/ops/ai/predictive` — Churn risk score
- `POST /api/ops/ai/alerts` — Proactive intervention opportunities

**Operations (Staff only):**
- `GET /api/admin/builders` — All builders (name, status, balance)
- `PATCH /api/admin/builders/[id]` — Suspend/reactivate builder
- `GET /api/admin/stats` — System-wide metrics
- `POST /api/admin/sync-catalog` — Refresh product data from InFlow
- `GET /api/ops/health` — Health check (uptime, DB, Sentry)

**Webhooks:**
- `POST /api/webhooks/stripe` — Stripe payment events
- `POST /api/webhooks/qb` — QuickBooks sync notifications
- `POST /api/cron/*` — Vercel Cron Jobs (auth via `CRON_SECRET`)

Full API docs: See `docs/ARCHITECTURE.md` for domain models and data flow.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Purpose | Required | Example |
|----------|---------|----------|---------|
| `DATABASE_URL` | Postgres connection (Neon) | Yes | `postgresql://user:pass@host/abel_builder?sslmode=require` |
| `JWT_SECRET` | Session signing key (openssl rand -base64 48) | Yes | 64+ random chars |
| `RESEND_API_KEY` | Email provider (Resend) | Recommended | `re_abc123...` |
| `STRIPE_SECRET_KEY` | Payment processing | Recommended | `sk_test_abc123...` or `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing | Recommended | `whsec_abc123...` |
| `ANTHROPIC_API_KEY` | Claude API (pricing intelligence) | Optional | `sk-ant-abc123...` |
| `SENTRY_DSN` | Error monitoring | Optional | `https://key@sentry.io/project-id` |
| `UPSTASH_REDIS_REST_URL` | Rate limiter (Upstash) | Optional | `https://host.upstash.io` |
| `CRON_SECRET` | Vercel cron auth (openssl rand -hex 32) | Yes (prod) | 64 hex chars |
| `NODE_ENV` | App environment | Yes | `development` or `production` |
| `NEXT_PUBLIC_APP_URL` | Frontend base URL | Yes | `http://localhost:3000` or `https://app.abellumber.com` |
| `NEXT_PUBLIC_SENTRY_DSN` | Client-side error tracking (optional) | No | Same as `SENTRY_DSN` |

Full reference: See `.env.example` at repo root.

---

## Deployment

**Target:** Vercel (Edge Network, auto-scaling, preview deploys)

### Pre-Deploy Checklist
1. `npx tsc --noEmit` — No TypeScript errors
2. `npm run build` — Build succeeds
3. Run integrity checks in staging DB
4. Verify all env vars set in Vercel dashboard
5. Code review merged to `main`

### Deploy Steps
1. Merge to `main` branch
2. Vercel auto-deploys (webhook from GitHub)
3. Preview URL available within 2 minutes
4. Promote to production via Vercel dashboard or `vercel promote <deployment-url>`

### Database Migrations
1. Create migration locally: `npm run db:migrate`
2. Commit migration file to git
3. On Vercel, run: `prisma migrate deploy` (before app starts)
4. Verify data integrity post-migration

See `docs/DEPLOY.md` for rollback, DNS, and verification steps.

---

## Support & Escalation

**On-Call Engineer:** Check `docs/RUNBOOK.md` for incident response procedures.

**Primary Contact:** Nate Barrett (CEO) — n.barrett@abellumber.com

**Escalation Path:**
1. Page on-call engineer (first 15 min)
2. Notify Nate + #abel-os-launch Slack channel (if SEV-1/2)
3. Declare incident, assign Incident Commander

See `docs/INCIDENT_RESPONSE.md` for full playbooks.

---

## Key Docs

- **`docs/README_DEPLOY.md`** — Deployment procedures, rollback, DNS
- **`docs/RUNBOOK.md`** — On-call playbooks, logging in to services, troubleshooting
- **`docs/SECURITY.md`** — Auth model, threat model, dependency policy
- **`docs/INCIDENT_RESPONSE.md`** — Severity levels, postmortem template, known-incident playbooks
- **`docs/ARCHITECTURE.md`** — Data flow diagram, domain models, external services

---

## Development Guidelines

### Code Style
- **TypeScript** — Strict mode, no `any` (unless `@ts-ignore` with reason)
- **Zod validation** — All API inputs validated; errors returned as 400 + JSON
- **Error handling** — Catch & log; return 500 + Sentry digest on unexpected errors
- **Async/await** — Prefer async/await over `.then()`; use `.catch()` on API calls
- **Testing** — Unit tests for utils (lib/), E2E for happy paths (crew, builder, admin portals)

### Security
- **Secrets** — Never commit `.env`; use Vercel dashboard for prod
- **Auth** — JWT in httpOnly cookies, sameSite=strict in prod, 7-day expiry
- **CORS** — Disabled by default (same-origin only); `next.config.js` headers enforce CSP
- **Input validation** — Zod for all payloads; never trust user input
- **Password** — bcrypt rounds=12; reset tokens expire in 24 hours

### Performance
- **Images** — Use `next/image` for optimized AVIF/WebP
- **Data fetching** — Prisma queries + caching layer for hot paths
- **Rate limiting** — Upstash Redis in prod; 30 reqs/min default on login
- **Build** — Next.js static generation where possible; ISR for frequently-updated pages

---

## Links

- **Repository** — https://github.com/abellumber/abel-builder-platform
- **Vercel Project** — https://vercel.com/teams/abel-lumber/abel-builder-platform
- **Neon Console** — https://console.neon.tech (Abel OS production branch)
- **Sentry Dashboard** — https://sentry.io/organizations/abel-lumber/issues/
- **Status Page** — (TBD)

---

**Last Updated:** April 13, 2026  
**Maintainer:** Platform team (n.barrett@abellumber.com)
