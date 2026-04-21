# Aegis Go-Live Readiness Report — April 22, 2026

**Generated:** 2026-04-21  
**Author:** Claude (Nate Barrett review required)  
**Target:** app.abellumber.com production deployment  
**Deployment:** Vercel (region `iad1`, Washington DC)

---

## 1. DATA READINESS

### 1.1 Schema

| Metric | Value |
|---|---|
| Prisma models | 80 |
| Enums | BuilderType, PaymentTerm, AccountStatus, OrderStatus, QuoteStatus, JobStatus, DeliveryStatus, InstallationStatus, InvoiceStatus, StaffRole, etc. |
| Manual migration files | 10 (v2 through v11) |
| Prisma managed migrations | 7 (in `prisma/migrations/`) |
| Latest migration | `add_multi_role_support` + pending SQL patches (`pending_ai_invocation.sql`, `pending_staff_preferences.sql`) |

**⚠️ ACTION REQUIRED:** Verify the two `pending_*.sql` files have been applied to the Neon production database. If not, run them before go-live.

### 1.2 Seed Data State

Three seed scripts exist — each serves a different purpose:

| Script | Purpose | Key data |
|---|---|---|
| `seed.ts` | Demo/dev — 1 builder, 21 products, 1 project | Not for production |
| `seed-real-data.ts` | Real catalog import from Excel | 2,852 products, 7,416 BOMs, 95 builders, 945 builder-specific prices |
| `seed-from-xlsx.ts` | Full production seed from `Abel_OS_Seed_Data.xlsx` | Staff, builders, products, projects — FK-safe, idempotent, has `--dry-run` |

**⚠️ ACTION REQUIRED:** Confirm `seed-real-data.ts` (or `seed-from-xlsx.ts`) has been run against the production Neon database with the current `Abel_Catalog_CLEAN.xlsx` and `Abel_Product_Catalog_LIVE.xlsx` files. The Neon snapshot `pre-seed-april-13-2026` was the baseline — verify the latest product data is loaded.

### 1.3 Integrity Checks

29 automated checks exist in `prisma/integrity-checks.ts`:

| Check | Severity |
|---|---|
| orphan_deals | High |
| duplicate_skus | High |
| negative_margin_products | High |
| pricing_below_cost | High |
| builders_missing_contact_email | High |
| duplicate_builder_emails | High |
| duplicate_staff_emails | High |
| staff_missing_role_or_dept | Medium |
| staff_without_password | Medium |
| products_missing_base_price | High |
| zero_price_products | High |
| unlinked_contracts | Medium |
| builders_no_activity | Low |
| active_orders_no_builder | High |
| deals_closed_won_no_builder | Medium |
| order_items_orphan_product | High |
| quote_items_orphan_product | High |
| invoices_without_order | Medium |
| jobs_without_project | Medium |
| orders_negative_total | High |
| invoices_zero_total | Medium |
| jobs_overdue_no_assignment | Medium |
| quotes_expired_not_rejected | Low |
| overdue_invoices_not_flagged | Medium |
| orders_unlinked_quote | Low |
| builders_no_email_verified | Low |
| quote_items_zero_quantity | High |
| order_items_zero_quantity | High |
| deliveries_completed_no_timestamp | Medium |
| installations_completed_no_qc | Medium |

**⚠️ ACTION REQUIRED:** Run `npx tsx prisma/integrity-checks.ts` against the production database before go-live. Fix any HIGH severity violations. The script connects via `DATABASE_URL`.

---

## 2. SYSTEM & TOOLS READINESS

### 2.1 Environment Variables

**51 unique env vars** referenced across `src/`. Categorized by criticality:

#### REQUIRED (app won't function without these)

| Variable | In .env.example? | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon pooled connection. Use `-pooler` URL. |
| `DIRECT_URL` | ✅ | Non-pooled Neon URL for migrations only |
| `JWT_SECRET` | ✅ | Must be 48+ chars, unique per env |
| `NODE_ENV` | ✅ | Must be `production` |
| `NEXT_PUBLIC_APP_URL` | ✅ | `https://app.abellumber.com` |
| `CRON_SECRET` | ✅ | Authenticates all 19+ cron jobs |

#### REQUIRED FOR PRODUCTION FEATURES

| Variable | In .env.example? | Notes |
|---|---|---|
| `RESEND_API_KEY` | ✅ | Email: order confirmations, password resets, quotes |
| `RESEND_FROM_EMAIL` | ✅ | `Abel Lumber <noreply@abellumber.com>` |
| `STRIPE_SECRET_KEY` | ✅ | Payments |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Verify Stripe webhooks |
| `ANTHROPIC_API_KEY` | ✅ | AI takeoffs, blueprint analysis, agent hub |
| `EMAIL_WEBHOOK_SECRET` | ✅ | Verify email webhooks |
| `HYPHEN_WEBHOOK_SECRET` | ✅ | Brookfield Hyphen integration |
| `INFLOW_WEBHOOK_SECRET` | ✅ | InFlow inventory sync |
| `INTERNAL_LOG_SECRET` | ✅ | Internal logging auth |

#### RECOMMENDED (degraded experience if missing)

| Variable | In .env.example? | Notes |
|---|---|---|
| `SENTRY_DSN` | ✅ | Server error tracking |
| `NEXT_PUBLIC_SENTRY_DSN` | ✅ | Client error tracking |
| `UPSTASH_REDIS_REST_URL` | ✅ | Rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | Rate limiting |
| `ALERT_NOTIFY_EMAILS` | ✅ | System alert recipients |
| `CURRI_API_KEY` | ✅ | Third-party delivery |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | ✅ | Gmail sync |

#### NOT IN .env.example BUT REFERENCED IN CODE

| Variable | Where used | Risk |
|---|---|---|
| `ENGINE_BRIDGE_TOKEN` | `src/lib/` | NUC bridge auth — safe to skip if NUC not deployed |
| `NUC_AGENT_TOKEN` | `src/lib/` | NUC agent auth — same |
| `NUC_BRAIN_API_KEY` | API routes | NUC brain — same |
| `NUC_BRAIN_URL` | API routes | NUC brain URL — same |
| `NUC_TAILSCALE_URL` | `src/lib/` | NUC Tailscale — same |
| `NUC_URL` | `src/lib/` | NUC coordinator URL — same |
| `CF_ACCESS_CLIENT_ID` | `src/lib/` | Cloudflare Access — check if needed |
| `CF_ACCESS_CLIENT_SECRET` | `src/lib/` | Cloudflare Access — check if needed |
| `NEXT_PUBLIC_CRON_SECRET` | code ref | ✅ FIXED — was leaking cron secret to browser; patched to use server-side proxy |
| `NEXT_PUBLIC_DEPLOY_TAG` | code ref | Build metadata — optional |
| `TWILIO_WEBHOOK_SECRET` | API routes | Twilio SMS — optional if not using |

**⚠️ FLAG:** `NEXT_PUBLIC_CRON_SECRET` appears in code. `NEXT_PUBLIC_` vars are inlined into the browser bundle at build time. If this is the same value as `CRON_SECRET`, it leaks the secret to every visitor. Investigate and remove if so.

### 2.2 Cron Jobs

**23 cron route files** exist. **19 are scheduled** in `vercel.json`. **4 are NOT scheduled:**

| Route | Intended schedule (from comments) | Risk | Recommendation |
|---|---|---|---|
| `collections-cycle` | Daily 8am CT (1pm UTC) weekdays | **HIGH** — collections won't auto-process | Add: `"0 13 * * 1-5"` |
| `data-quality` | Nightly 2am UTC | **MEDIUM** — data violations go undetected | Add: `"0 2 * * *"` |
| `financial-snapshot` | Daily 6am UTC | **MEDIUM** — no financial KPI tracking | Add: `"0 6 * * *"` |
| `inbox-feed` | Every 15 minutes | **HIGH** — ops inbox won't populate | Add: `"*/15 * * * *"` |

**⚠️ ACTION REQUIRED:** Add these 4 entries to `vercel.json` before go-live. The `collections-cycle` and `inbox-feed` gaps are operationally significant.

### 2.3 Vercel Configuration

| Setting | Value | Status |
|---|---|---|
| Region | `iad1` (Washington DC) | ✅ Good — closest to DFW via US-East backbone |
| Build command | `npx prisma generate && next build` | ✅ |
| Install command | `npm install` | ✅ |
| Framework | Next.js | ✅ |
| Security headers | X-Frame-Options DENY, HSTS (2yr + preload), nosniff, strict referrer, permissions-policy (no camera/mic/geo) | ✅ Solid |
| Rewrites | `/uploads/:path*` → `/api/files/:path*` | ✅ |

**⚠️ NOTE:** `UPLOAD_DIR="./uploads"` is ephemeral on Vercel. File uploads stored to local disk will be lost on function cold starts. If file persistence is needed on day 1, either use Vercel Blob or ensure uploaded files route to an external store. The `.env.production.template` mentions this.

### 2.4 External Services Checklist

| Service | Purpose | Env var(s) | Verify |
|---|---|---|---|
| **Neon Postgres** | Primary database | `DATABASE_URL`, `DIRECT_URL` | Connection pooler active, snapshot `pre-seed-april-13-2026` as baseline |
| **Vercel** | Hosting + crons | (automatic) | Deployment successful, domain DNS pointed |
| **Stytch** | Auth (referenced in deps) | Check Stytch config | Verify project ID + secret in Vercel env |
| **Resend** | Transactional email | `RESEND_API_KEY` | Domain `abellumber.com` verified, SPF/DKIM/DMARC |
| **Stripe** | Payments | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Webhook endpoint registered at `app.abellumber.com/api/webhooks/stripe` |
| **Upstash Redis** | Rate limiting | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | REST endpoint reachable |
| **Sentry** | Error monitoring | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Project created, source maps uploading |
| **Anthropic** | AI features | `ANTHROPIC_API_KEY` | API key active with sufficient credits |
| **Google** | Gmail sync | `GOOGLE_SERVICE_ACCOUNT_KEY` | Service account has domain-wide delegation |
| **Curri** | Delivery | `CURRI_API_KEY` | API key active (if using day 1) |
| **Hyphen** | Brookfield portal | `HYPHEN_WEBHOOK_SECRET` | Webhook URL registered with Brookfield |
| **InFlow** | Inventory sync | `INFLOW_WEBHOOK_SECRET` | Webhook configured |

### 2.5 DNS / Domain

**Verify before go-live:**
- `app.abellumber.com` → Vercel CNAME or A record
- SSL certificate auto-provisioned by Vercel
- `NEXT_PUBLIC_APP_URL` set to `https://app.abellumber.com`

---

## 3. GO-LIVE PUNCH LIST

### 🔴 BLOCKERS (must fix before April 22)

1. ~~**Add 4 missing cron schedules to `vercel.json`**~~ ✅ DONE — `collections-cycle`, `data-quality`, `financial-snapshot`, `inbox-feed` added
2. **Run integrity checks** — `npx tsx prisma/integrity-checks.ts` against production DB, fix HIGH violations
3. **Verify pending SQL patches applied** — `pending_ai_invocation.sql`, `pending_staff_preferences.sql`
4. ~~**Investigate `NEXT_PUBLIC_CRON_SECRET`**~~ ✅ FIXED — patched admin data-quality page to use server-side proxy (`/api/ops/admin/data-quality/run`)

### 🟡 SHOULD FIX (day 1 quality)

5. **Verify all REQUIRED env vars** are set in Vercel project settings (see §2.1)
6. **Confirm real seed data loaded** — product catalog (2,852 SKUs), builder accounts (95), pricing
7. **Verify Stripe webhook endpoint** is registered and receiving test events
8. **Verify Resend domain** — SPF, DKIM, DMARC all passing for `abellumber.com`
9. **File upload strategy** — confirm whether Vercel Blob or external storage is wired, or if ephemeral local disk is acceptable for MVP
10. **Sentry source map upload** — confirm `SENTRY_AUTH_TOKEN` is set for release tracking

### 🟢 POST-LAUNCH (first week)

11. **NUC env vars** (`ENGINE_BRIDGE_TOKEN`, `NUC_*`) — not needed until cluster deploys
12. **Cloudflare Access** (`CF_ACCESS_*`) — verify if actively used or legacy
13. **QuickBooks sync** — decision pending on build vs. kill
14. **Twilio SMS** — optional, wire when ready
15. **Page-level color migration** — ~215 pages still have hardcoded `#C6A24E`/`#0f2a3e` (inheriting from tokens, cosmetic only — future cleanup wave)
