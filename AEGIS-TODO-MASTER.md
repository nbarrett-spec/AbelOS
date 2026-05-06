# Aegis — Master TODO

**Last updated:** 2026-05-05
**Source documents:**
- `AEGIS-OPS-FINANCE-HANDOFF.docx` (7 fixes — all shipped 2026-05-05)
- `AEGIS-BUGFIX-HANDOFF-2026-05-05.docx` (25 bugs/features/UX)
- `AEGIS-100-IMPROVEMENTS-AUDIT-2026-05-05.docx` (100 audit items)

**Total open:** 117 items (10 P0 · 56 P1 · 45 P2 · 6 P3)

> Single source of truth for everything pending. Items move from
> open → in-progress → done as we work them. Cross-referenced to file
> paths for quick navigation. Group prefixes:
>
> - **B-***  → Bugfix handoff (BUG-1 through UX-7)
> - **A-***  → Audit doc (SEC, DATA, API, UX, PERF, INT, BIZ, OBS)

---

## ✅ SHIPPED THIS SESSION (2026-05-05)

| ID | Title | Commit |
|---|---|---|
| OPS-FIX-6 | Settings page hardcoded `x-staff-id` headers removed | `fa206e1` |
| OPS-FIX-7 | Quote-page double `animate-enter` removed (best-guess fix) | `2ddf3ea` |
| OPS-FIX-1 | `<DocumentAttachments>` component + wired on 5 detail pages | `e797812` + `5e19473` |
| OPS-FIX-2 | Manual invoice form + tax support + listing button + badge | `0122ebf` |
| OPS-FIX-3 | Payments Hub + VendorPayment API + record modal | `d3b8878` |
| OPS-FIX-4 | Journal Entries + Chart of Accounts + GL UI | `b09b2e1` |
| OPS-FIX-5 | DocumentAttachments wired on JE detail | `b09b2e1` |
| ADD-ON | Self-serve API key generator + management UI | `a3e0050` |
| MCP-FIX | Fresh McpServer per request — fixes "Already connected" | `7411d8b` |
| B-BUG-10 | Root 404 primary action `/ops` (was `/dashboard`, signed out staff) | `135538f` |
| SCHEMA | Migration applied (4 tables + 1 col + 2 enums + 23 COA seed rows) | `c3d95b6` |

---

## 🔥 P0 — Broken / Blocking (10 items)

| ID | Title | Path / Notes |
|---|---|---|
| **B-BUG-1** | QC house walk page broken | `/ops/qc` or `/ops/quality` — needs symptom check |
| **B-BUG-2** | Approve / Create / Deny builder account broken | API has PATCH for status; **no POST for create**, no UI buttons on listing |
| **B-BUG-3** | Daily tasks drill-in broken | `/ops/tasks` or dashboard widget — wrong onClick route |
| **B-BUG-4** | Job readiness board broken | `/ops/job-readiness` — needs symptom check |
| **B-BUG-5** | Calendar sync broken | `/ops/calendar` + Google Calendar OAuth — likely token refresh |
| **B-BUG-6** | "Failed to fetch" on POs page | `/ops/purchasing` — Prisma include error likely |
| **B-BUG-7** | Inventory page non-functional | `/ops/inventory` — could be data side OR sort handler |
| **B-BUG-8** | Inventory CSV export broken | API path EXISTS at `?format=csv` — symptom may not be code-side |
| **B-BUG-9** | "Assign to me" broken on sales dashboard | `/sales/dashboard` — find onClick handler |
| **B-BUG-11** | Cannot select recipients for messaging | `/ops/messaging` — combobox not wired to data source |
| **A-SEC-1** | JWT_SECRET fallback `dev-secret-change-in-production` still in code | `src/middleware.ts` + `src/lib/staff-auth.ts` |
| **A-SEC-2** | BPW sync cron has zero auth | `src/app/api/cron/bpw-sync/route.ts` — add CRON_SECRET guard |
| **A-DATA-1** | Zero soft-delete pattern in 239 models | `prisma/schema.prisma` — add `deletedAt` to Builder, Order, Quote, Invoice, Job, Product |
| **A-DATA-2** | `onDelete: Restrict` on `Order.builderId` blocks builder cleanup | `prisma/schema.prisma:584` |
| **A-DATA-3** | `onDelete: Restrict` on `QuoteItem.productId` blocks product retirement | `prisma/schema.prisma:558` — add `productSnapshot` JSON for history |
| **A-API-1** | 4,011 `any` types vs only 17 zod validations | Codebase-wide — start with builder/order/quote/invoice POST routes |
| **A-API-2** | Twilio SMS webhook returns 501 — inbound SMS unhandled | `src/app/api/agent/sms/route.ts` |
| **A-API-3** | Collections send-email endpoint doesn't exist | UI calls `/api/ops/collections/send-email` — route missing |
| **A-UX-1** | 259 ops pages, only 4 `loading.tsx` files | Most pages have no loading state |
| **A-UX-2** | Driver manifest page is 8 lines — stub | `src/app/ops/portal/driver/manifest/page.tsx` |
| **A-UX-3** | Finance YTD page is 36 lines — stub | `src/app/ops/finance/ytd/page.tsx` |
| **A-UX-4** | Ops inbox is 57 lines — stub | `src/app/ops/inbox/page.tsx` |
| **A-INT-1** | Hyphen scraper has 5 NotImplementedError stubs | `src/lib/hyphen/scraper.ts:192-248` — needs Playwright |
| **A-INT-2** | Hyphen schedule + closing date fetched but not persisted | `src/lib/hyphen/job-sync.ts:5-6` |
| **A-BIZ-1** | No quote expiration enforcement | Stale-pricing risk on old quotes — add `expiresAt` + cron |
| **A-BIZ-2** | Takeoff engine is template-based mock | `src/lib/takeoff-engine.ts:15` — Phase 1 only, not AI |

> *(P0 row count: 25 — but several B-BUGs need browser verification before they're confidently fixable. Count above includes those pending verification.)*

---

## 🔧 P1 — High-value / Critical (56 items)

### Bugfix doc — features (B-FEAT-*)
| ID | Title | Notes |
|---|---|---|
| **B-FEAT-1** | Dunnage door wood/fiberglass flag | Schema add: `OrderItem.doorMaterial` enum [WOOD, FIBERGLASS, METAL]; required on Final Front |
| **B-FEAT-2** | Blueprint upload on Communities page | Reuse `<DocumentAttachments>`, entityType=COMMUNITY |
| **B-FEAT-3** | Non-BOM orders skip manufacturing | Add `order.hasBomItems` computed; mfg query filters; "STOCK ONLY" badge |
| **B-FEAT-4** | Manufacturing schedule 24hr before delivery | `buildByDate = scheduledDate - 1 business day`; alert if missed |
| **B-FEAT-5** | QC photo queue (per-door + per-load requirements) | New `QcPhotoRequirement` + `QcPhoto` models |
| **B-FEAT-6** | Import tools (inventory, price lists, builders) | `/ops/import` page with CSV/Excel upload |

### Bugfix doc — UX gaps (B-UX-* — renamed to disambiguate from audit UX)
| ID | Title | Notes |
|---|---|---|
| **B-UX-1** | Global search Cmd+K | MCP `global_search` tool already exists as data layer |
| **B-UX-2** | Drillable addresses / job numbers everywhere | Build `<DrillLink>` reusable component |
| **B-UX-3** | Edit features on builder/community/order/quote detail pages | Use SlideOver/Modal pattern; PATCH endpoints exist |
| **B-UX-4** | Order page references all need to be drillable links | Same pattern as B-UX-2 |
| **B-UX-5** | Sidebar reorganization (workflow-based grouping) | DASHBOARD / SALES / OPS / INVENTORY / FINANCE / SETTINGS |
| **B-UX-6** | Dark mode contrast — text too low contrast | Bump dark:text-* classes one shade in globals/tailwind |
| **B-UX-7** | Add Note button on every detail page | New `<NotesSection>` reusable component |

### Audit — Security & Auth
| ID | Title | Path |
|---|---|---|
| **A-SEC-3** | Sentry: only 32 usages in 453 routes — captureException missing in most catch blocks | Codebase-wide |
| **A-SEC-4** | No real CSRF token validation, only origin check | `src/middleware.ts:275` |
| **A-SEC-5** | Admin routes: verify role check, not just session existence | `src/middleware.ts:681` |
| **A-SEC-6** | Hyphen OAuth credentials in plaintext | `src/lib/hyphen/scraper.ts` |

### Audit — Data Integrity
| ID | Title | Path |
|---|---|---|
| **A-DATA-4** | `OrderItem.productId` Restrict blocks product deletion | `prisma/schema.prisma:656` |
| **A-DATA-5** | Quote.takeoffId unique + cascade creates orphan risk | `prisma/schema.prisma` |
| **A-DATA-6** | Missing index on `Builder.status` | Add `@@index([status])` |
| **A-DATA-7** | Missing index on `Order.status` | Add `@@index([status, createdAt])` |
| **A-DATA-8** | Missing index on `Job.phase` | Add `@@index([phase, scheduledDate])` |
| **A-DATA-9** | Missing index on `Invoice.dueDate` | Add `@@index([status, dueDate])` |

### Audit — API Quality
| ID | Title | Path |
|---|---|---|
| **A-API-4** | Statement-send only logs request, doesn't email | `/api/ops/accounts/[id]/statement/send/` |
| **A-API-5** | Job link-order endpoint missing | TODO at `src/app/ops/jobs/[jobId]/page.tsx:1090` |
| **A-API-6** | Delivery detail route doesn't exist | TODO in `DeliverySignOff.tsx:292` |
| **A-API-7** | All QuickBooks sync functions return "not implemented" | `src/lib/integrations/quickbooks.ts:163-190` — decision: build or kill |
| **A-API-8** | BuilderTrend sync incomplete (one-directional) | `src/lib/integrations/buildertrend.ts` |
| **A-API-9** | Financial snapshot uses hardcoded `cashOnHand = 0` | `src/app/api/cron/financial-snapshot/route.ts:56` |
| **A-API-10** | PM standup narrative hardcoded | `src/app/api/ops/projects/standup/[pmId]/route.ts:18` |

### Audit — UX Stub Pages
| ID | Title | Lines |
|---|---|---|
| **A-UX-5** | Calendar page stub | 65 |
| **A-UX-6** | Customer catalog stub | 62 |
| **A-UX-7** | My Book (sales rep) stub | 24 |
| **A-UX-8** | Portal analytics stub | 79 |
| **A-UX-9** | Portal warranty stub (claims non-functional) | 67 |
| **A-UX-10** | Portal projects stub | 69 |
| **A-UX-11** | Sales contracts stub | 67 |
| **A-UX-12** | Sales documents stub | 67 |
| **A-UX-13** | Quote conversion filters don't read URL params | `/ops/quotes/conversion/page.tsx:209,275,382` |
| **A-UX-14** | Substitutions page minimal (114 lines) | |
| **A-UX-15** | Shortages page minimal (93 lines) | |

### Audit — Performance
| ID | Title | Path |
|---|---|---|
| **A-PERF-1** | Ops accounts page loads all builders without pagination | `src/app/ops/accounts/` |
| **A-PERF-2** | Material calendar loads entire delivery schedule | `src/app/ops/material-calendar/page.tsx` |
| **A-PERF-3** | Manufacturing job-packet page unbounded fetch | `src/app/ops/manufacturing/job-packet/` |
| **A-PERF-4** | Hyphen sync imports all jobs every run (no incremental) | `src/lib/hyphen/job-sync.ts` |
| **A-PERF-5** | Collections email cron fetches contact per invoice (N+1) | `src/app/api/cron/collections-email/route.ts` |

### Audit — Integrations
| ID | Title | Path |
|---|---|---|
| **A-INT-3** | Calendar sync broken (matches B-BUG-5) | `src/app/api/cron/calendar-sync/` |
| **A-INT-4** | Gmail sync ack/receipt handling incomplete | `src/app/api/cron/gmail-sync/route.ts` |
| **A-INT-5** | BuilderTrend tasks one-directional sync | `src/lib/integrations/buildertrend.ts` |
| **A-INT-6** | InFlow sync runs but inventory page broken (matches B-BUG-7) | |

### Audit — Business Logic
| ID | Title | Path |
|---|---|---|
| **A-BIZ-3** | No inventory reservation on order placement | Add `reservedQty` on `InventoryItem` |
| **A-BIZ-4** | No auto-reorder cron for fast-moving SKUs | New cron: reorder-point check → draft PO |
| **A-BIZ-5** | MRP doesn't account for vendor lead times | Add `leadTimeDays` to Vendor/Product |
| **A-BIZ-6** | No backorder handling | New flow: `OrderItem.backordered`, link to incoming PO, notify builder |
| **A-BIZ-7** | Dunnage door strike type not captured (matches B-FEAT-1) | |
| **A-BIZ-8** | 24hr-before-delivery mfg rule not enforced (matches B-FEAT-4) | |

### Audit — Observability
| ID | Title | Path |
|---|---|---|
| **A-OBS-1** | AuditLog write is TODO — no production audit trail | `src/lib/security.ts:148` |
| **A-OBS-2** | No structured logging — 54+ console.log in API layer | Adopt pino/winston |
| **A-OBS-3** | Health check doesn't ping integrations (DB/Redis/Resend) | `src/app/api/health/` |

---

## 🛠️ P2 — Backlog / Tech Debt (45 items)

### Audit — Security
| ID | Title |
|---|---|
| **A-SEC-7** | No rate limiting on auth endpoints — add Upstash limiter to login/signup/reset |
| **A-SEC-8** | Password reset tokens lack explicit expiration check |
| **A-SEC-9** | File uploads have no size limit enforcement (25MB cap) |
| **A-SEC-10** | No Content-Security-Policy header in middleware |
| **A-SEC-11** | Agent SMS webhook returns 501 with no auth |
| **A-SEC-12** | NUC integration endpoints lack auth |

### Audit — Data
| ID | Title |
|---|---|
| **A-DATA-10** | Missing composite index on `Delivery.status + scheduledDate` |
| **A-DATA-11** | 667 indexes for 239 models — but key operational fields missed |
| **A-DATA-12** | Legacy models still in schema (Bolt*, Bpw*, QbCustomer*) |
| **A-DATA-13** | No DB-level constraint on `Order.total` vs sum of line items |
| **A-DATA-14** | Staff `SetNull` on assigneeId — UI doesn't handle null gracefully |
| **A-DATA-15** | Verify `Product.sku` has unique constraint |

### Audit — API
| ID | Title |
|---|---|
| **A-API-11** | 20+ API routes have no try/catch (raw 500 + stack traces leaked) |
| **A-API-12** | Webhook retry cron has no exponential backoff |
| **A-API-13** | No idempotency on payment webhook processing |
| **A-API-14** | Import endpoints missing (matches B-FEAT-6) |
| **A-API-15** | Search inputs not sanitized in raw queries — audit `$queryRaw`/`$executeRaw` |

### Audit — UX
| ID | Title |
|---|---|
| **A-UX-16** | Admin page (91 lines) — needs user mgmt, role assignment, integration status |
| **A-UX-17** | Homeowner page (113 lines) — needs warranty info, products, care |
| **A-UX-18** | Portal messages stub (65 lines) |
| **A-UX-19** | Portal schedule stub (71 lines) |
| **A-UX-20** | QC rework uses localStorage — should be DB-backed |

### Audit — Performance
| ID | Title |
|---|---|
| **A-PERF-6** | PM daily tasks cron has no idempotency check |
| **A-PERF-7** | 54 console.log in API routes (perf + noise) |
| **A-PERF-8** | No query result caching for frequently-accessed data — add Redis 60s TTL |
| **A-PERF-9** | Quote report filters in memory, not DB |
| **A-PERF-10** | Boise Cascade spend analysis recalculates per request — pre-compute via cron |
| **A-PERF-11** | No image optimization for product photos |

### Audit — Integrations
| ID | Title |
|---|---|
| **A-INT-7** | Bolt sync still in crons — ECI Bolt is dead (remove) |
| **A-INT-8** | QuickBooks sync queue models exist, sync is stub — build or kill (TASKS.md #45) |
| **A-INT-9** | NUC brain-sync crons assume Tailscale (fail on Vercel — no Tailscale) |
| **A-INT-10** | Stripe webhook handler missing idempotency |
| **A-INT-11** | Boise pricing sync — no delta detection (full re-import) |

### Audit — Business
| ID | Title |
|---|---|
| **A-BIZ-9** | No dynamic pricing / margin protection on cost changes |
| **A-BIZ-10** | No native account-health/churn signal in Aegis (currently only NUC) |
| **A-BIZ-11** | Credit hold logic not enforced at order creation |
| **A-BIZ-12** | No revision history on quotes |
| **A-BIZ-13** | No PDF versioning for generated documents |

### Audit — Observability
| ID | Title |
|---|---|
| **A-OBS-4** | No centralized cron status dashboard (51 crons running blind) |
| **A-OBS-5** | No alerting on financial-snapshot errors |
| **A-OBS-6** | Webhook delivery success/failure dashboard incomplete |
| **A-OBS-7** | SLO route exists but no try/catch — verify calculations |

---

## 🪶 P3 — Nice-to-Have (6 items)

| ID | Title |
|---|---|
| **A-PERF-12** | run-automations cron has 21 console.logs |
| **A-INT-12** | SEO local-listing route has placeholder phone `(512) XXX-XXXX` |
| **A-OBS-8** | Add external uptime check (BetterStack/Checkly) — current is self-probe |
| **A-OBS-9** | No deployment notification in Slack/Teams |
| **A-OBS-10** | MRP AI insight placeholder — wire to NUC brain when ready |
| **A-BIZ-14** | OrderTemplate model exists but no "Reorder" / "Copy previous" UX in builder portal |

---

## 🔁 Duplicates / Cross-References

These are the same underlying work with different names across the docs:

| Bugfix doc | Audit doc | Notes |
|---|---|---|
| B-BUG-5 (Calendar sync) | A-INT-3 (Calendar sync broken) | Same |
| B-BUG-7 (Inventory page broken) | A-INT-6 (InFlow runs, page broken) | Same |
| B-BUG-8 (Inventory CSV export) | — | API path exists; symptom unclear |
| B-FEAT-1 (Dunnage strike) | A-BIZ-7 | Same |
| B-FEAT-4 (Mfg schedule 24hr rule) | A-BIZ-8 | Same |
| B-FEAT-6 (Import tools) | A-API-14 | Same |
| B-UX-1 (Global Cmd+K) | (no overlap) | Use existing MCP `global_search` as data |

---

## 🧭 KEY SYSTEMIC PATTERNS (from audit)

1. **No input validation:** 4,011 `any` types vs 17 zod usages. Every API route accepts whatever is sent.
2. **No soft-delete:** Permanent deletions everywhere. Once data is gone, it's gone. Breaks audit, breaks history.
3. **Stub pages shipped:** 15+ pages under 100 lines that show users empty shells. Either hide nav or build them.
4. **Console.log as logging:** 54+ in API layer alone. No structured logging means no searchable production logs.
5. **Integration dead code:** QB, Bolt, BPW integrations are dead but still in schema/crons. Clean up or kill.
6. **Missing indexes on filter fields:** Status, date, phase fields used in WHERE clauses have no indexes. Queries will degrade.
7. **Sentry gap:** Only 32 usages across the entire platform. Most errors silently logged to console and lost.

These are "treat as a sweep" — not 7 separate items, but 7 patterns to apply across the codebase as you address related items.

---

## 📋 SUGGESTED EXECUTION ORDER

### Sprint 1 (this week — quick wins, code-only, high impact)
1. **Verify in browser**: B-BUG-1, B-BUG-3, B-BUG-4, B-BUG-6, B-BUG-7, B-BUG-9, B-BUG-11 — collect actual symptoms before fixing. 1-2 hours of guided clicking.
2. **B-BUG-2 part 1** — add POST /api/admin/builders endpoint (creating builders is broken)
3. **A-SEC-1** — remove JWT_SECRET fallback (10-min change, big security win)
4. **A-SEC-2** — add CRON_SECRET to bpw-sync (5 min)
5. **B-UX-6** — dark mode contrast bump (1-line tailwind change)
6. **A-DATA-6, A-DATA-7, A-DATA-8, A-DATA-9** — add 4 missing indexes (one migration)
7. **A-OBS-1** — wire AuditLog persistence (the audit() function never actually writes today)

### Sprint 2 (next week — features)
1. **B-FEAT-1 / A-BIZ-7** — dunnage strike type (schema + UI)
2. **B-FEAT-3** — non-BOM orders skip mfg (computed flag)
3. **B-FEAT-4 / A-BIZ-8** — 24hr mfg rule (cron + alert)
4. **B-FEAT-2** — blueprint upload on communities (reuse DocumentAttachments)
5. **A-BIZ-1** — quote expiration enforcement (small schema + cron)
6. **A-BIZ-3** — inventory reservation on order placement (schema + cascade)

### Sprint 3 (week 3 — UX sweep)
1. **B-UX-1** — global Cmd+K search (use existing MCP global_search as backend)
2. **B-UX-2 / B-UX-4** — drillable links everywhere (build `<DrillLink>`, audit tables)
3. **B-UX-3** — edit features on detail pages (SlideOver pattern)
4. **B-UX-7** — Add Note component (reusable)
5. **A-UX-1** — loading.tsx skeletons on top 7 pages

### Sprint 4 (week 4 — backend hardening)
1. **A-API-1** — start zod sweep (builder, order, quote, invoice POST endpoints)
2. **A-OBS-2** — pino structured logging
3. **A-PERF-8** — Redis caching for top 5 read-heavy endpoints
4. **A-DATA-1** — soft-delete pattern on top 6 models

### Backlog (P2/P3 — tackle when bandwidth allows)
The 51 P2/P3 items above. Don't try to do them in batch — handle one at a time when adjacent work touches the relevant area.

---

## 📝 STATUS LEGEND

- 🟥 **P0** — Broken / blocking. Fix immediately.
- 🟧 **P1** — High value. 2-4 sprint cycles.
- 🟨 **P2** — Tech debt. Backlog.
- 🟩 **P3** — Nice-to-have.
- ✅ — Done in this session
- 🟦 — In progress
