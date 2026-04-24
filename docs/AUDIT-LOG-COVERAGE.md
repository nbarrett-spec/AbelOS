# Audit Log Coverage Report

**Generated:** 2026-04-23 (Agent A5, Wave-1)
**Source of truth:** `scripts/_audit_coverage_scan.mjs` scanning every `route.ts` under `src/app/api/`.
**Audit lib:** `src/lib/audit.ts` — exports `audit(request, action, entity, ...)`, `logAudit({...})`, `auditBuilder(...)`.

A route is classified **COVERED** when it imports from `@/lib/audit` AND calls `audit()`, `logAudit()`, or `auditBuilder()` somewhere in the file. **NOT COVERED** = has a mutation handler (POST/PATCH/PUT/DELETE) but no audit call. **READ-ONLY / SKIP** = no mutation handler (GET-only, probe, or empty). Methodology note: the scanner is static — it can't catch audit calls hidden behind dynamic helpers or wrapped libraries, so a handful of "NOT COVERED" entries may already be logging via a sidecar (examples called out inline below).

---

## Summary

| Bucket | Count |
|---|---:|
| Total `route.ts` files scanned | **733** |
| Mutation routes (POST / PATCH / PUT / DELETE) | **450** |
| COVERED (audit import + call) | **340** |
| NOT COVERED | **110** |
| READ-ONLY / SKIP | **283** |

**Coverage of mutation routes: 340 / 450 = 75.6%.**

The 110 gap is concentrated in six buckets:

| Domain | Not covered | Priority bias |
|---|---:|---|
| `ops/*` (non-finance) | 16 | high (Hyphen, substitutions, reports, gold-stock, voice briefings — all mutate tenant data) |
| `cron/*` | 17 | low (runs are tracked via `startCronRun` / `finishCronRun` — audit is duplicative unless the cron mutates user data. Flagged anyway) |
| `auth/*` | 9 | **CRITICAL** (login, signup, profile, forgot/reset/change password — pure identity surface) |
| `agent-hub/*` | 20 | medium (agent-authored side effects like auto-PO, pricing rules, permits, outreach) |
| `webhooks/*` | 4 | **CRITICAL** (Stripe, Gmail, Hyphen, InFlow — all external → state mutations) |
| `agent/*` + `builders/*` + `homeowner/*` + `hyphen/*` + misc | ~44 | mixed |

---

## Recommended Wiring Order (highest impact first)

Order reflects "what breaks investigations when we can't see who did it, and when." Each tier should be wired and merged before moving down.

### Tier 0 — Pre-launch blockers (wire Monday)
These are the ones that leave a literal gap in a court/forensic trail. Money, identity, and external state.

1. **`POST /api/webhooks/stripe`** — payment events; entity: `Payment` / `Invoice`. CRITICAL severity.
2. **`POST /api/webhooks/inflow`** — inventory state sync from external system; entity: `Inventory` / `InflowEvent`.
3. **`POST /api/webhooks/hyphen`** — Brookfield order/CO state; entity: `HyphenEvent` / `Job`.
4. **`POST /api/webhooks/gmail`** — inbound email processing; entity: `CommunicationLog`.
5. **`POST /api/auth/login`** + **`POST /api/ops/auth/login`** already covered. Still missing: builder-side login.
6. **`POST /api/auth/signup`** — builder registration, creates `Builder`. CRITICAL.
7. **`POST /api/auth/change-password`** — credential mutation. CRITICAL.
8. **`POST /api/auth/reset-password`** — credential mutation. CRITICAL.
9. **`POST /api/auth/forgot-password`** — initiates credential reset (at minimum log the attempt + IP for security forensics). WARN.
10. **`POST /api/auth/dev-login`** — back-door login for local dev; must be audited if shipped. CRITICAL.

### Tier 1 — Money / Allocations / POs (wire this week)
11. **`POST /api/ops/substitutions/requests/[id]/approve`** — triggers `runAllocationSwap` (real inventory swap). CRITICAL.
12. **`POST /api/ops/substitutions/requests/[id]/reject`** — denies a swap. WARN.
13. **`POST /api/ops/products/[productId]/substitutes/apply`** — direct-apply sub path (IDENTICAL/COMPATIBLE). WARN.
14. **`POST /api/ops/gold-stock/[kitId]/build`** + **`PATCH /api/ops/gold-stock/[kitId]`** — kit consumption / state change.
15. **`POST /api/dashboard/reorder`** — creates reorder from dashboard; entity: `PurchaseOrder` draft.
16. **`POST /api/hyphen/orders`**, **`POST /api/hyphen/changeOrders`**, **`POST /api/hyphen/oauth/token`** — OAuth + inbound order mutations from Brookfield portal.
17. **`POST /api/ops/hyphen/ingest`** + **`PATCH /api/ops/hyphen/documents/[id]`** — ingest queue mutations (see 4/22 HyphenDocument work).

### Tier 2 — Builder & Homeowner externally-visible writes
18. **`POST /api/builders/register`** — new builder account.
19. **`POST /api/builders/warranty`** — builder-filed warranty claim.
20. **`POST /api/builders/quote-request`** — public quote request intake.
21. **`POST /api/builders/messages`** — builder→Abel message.
22. **`POST /api/homeowner/[token]/confirm`** — homeowner selection commit. Use `auditBuilder`-style (scope to `homeowner:<token>` staff id).
23. **`POST /api/homeowner/[token]/selections`** + **`POST /api/homeowner/[token]/upgrades`** — selection mutations.
24. **`POST /api/homeowner/seed`** — seed path; likely needs ADMIN severity if kept.
25. **`POST /api/quote-request/instant`** + **`PATCH`** — instant quote flow.
26. **`POST /api/orders`** (the `/api/orders` root) — already partially covered via `ops/orders`, but this builder-side path is not.
27. **`POST /api/deliveries/feedback`** — homeowner/builder delivery feedback.
28. **`POST /api/door/[id]`** — hardware scan endpoint; entity: door state.
29. **`PATCH /api/crew/delivery/[id]`**, **`PATCH /api/crew/install/[id]`** — field crew state mutation.
30. **`POST /api/bulk-order/parse`** — bulk order intake.
31. **`POST /api/catalog/cart`** + **`DELETE`** — builder cart mutations.
32. **`POST /api/takeoff`** — takeoff creation.
33. **`POST /api/upload`** — file upload; log what was uploaded + actor.

### Tier 3 — Admin / ops utility surfaces
34. **`PATCH /api/admin/builders/[id]`** — admin-edits-builder. CRITICAL.
35. **`DELETE /api/admin/errors`** — error log deletion. WARN.
36. **`POST /api/admin/sync-catalog`** — catalog-wide mutation. WARN.
37. **`POST /api/admin/products/enrich`** — bulk product mutation.
38. **`POST /api/admin/webhooks/[id]`** — webhook replay/resurrect from DLQ.
39. **`POST /api/admin/hyphen/events/[id]`** — Hyphen event mutation.
40. **`POST /api/admin/hyphen/aliases`** + **`DELETE`** — alias mapping mutation.
41. **`POST /api/admin/alert-mute`** + **`DELETE`** — alert suppression (abuse vector).
42. **`POST /api/admin/test-alert-notify`**, **`POST /api/admin/test-cron-alert`** — admin-triggered diagnostics; low severity but log who fired.
43. **`POST /api/ops/reports/generate`**, **`POST /api/ops/reports/schedule`** — report artifact creation.
44. **`POST /api/ops/admin/digest-preview`** — admin digest preview.
45. **`PATCH /api/ops/video-rooms`** + **`POST`** — video room state.

### Tier 4 — Agent-Hub side effects
These are autonomous agent writes. Because the agent can generate a lot of volume, severity should default to INFO but group logging by session.

46. **`POST /api/agent-hub/pricing/rules`** — mutates pricing rules. WARN.
47. **`POST /api/agent-hub/permits`** + **`PATCH /api/agent-hub/permits/[id]`** — permit records.
48. **`POST /api/agent-hub/inventory/auto-po`** — auto-generates PO. WARN (money).
49. **`POST /api/agent-hub/churn/intervene`** — customer-facing action.
50. **`POST /api/agent-hub/outreach/sequence`**, **`POST /api/agent-hub/outreach/generate`** — outbound messaging.
51. **`POST /api/agent-hub/schedule/auto-assign`** — schedule mutation.
52. **`POST /api/agent-hub/pricing/calculate`**, **`/competitors`** — calc writes.
53. **`POST /api/agent-hub/seo/*`** (content, keywords, local-listing, review-request) — external artifacts.
54. **`POST /api/agent-hub/expansion/recommend`**, **`POST /api/agent-hub/quality/predict`**, **`POST /api/agent-hub/inventory/forecast`**, **`POST /api/agent-hub/notifications/proactive`** — prediction/action writes.
55. **`POST /api/agent-hub/actions/log`** — **already writes directly to `AuditLog`** via raw SQL (see file head). Consider refactoring to use `logAudit()` for consistency but NOT a gap.
56. **`PATCH /api/agent-hub/heartbeat`** — heartbeat only; SKIP unless we want session trail.
57. **`POST /api/agent/chat`**, **`POST /api/agent/email`**, **`POST /api/agent/sms`**, **`POST /api/agent/schedule-change`** — agent-authored messaging/scheduling surfaces.

### Tier 5 — Cron / background / informational (lowest)
Crons track runs via `startCronRun/finishCronRun` in `src/lib/cron.ts`. Audit adds value only when the cron MUTATES user-visible entities. Recommend adding `audit()` calls **inside the inner mutation loops** rather than on the cron handler itself. Treat the handler-level "not covered" as acceptable for:

- `cron/uptime-probe`, `cron/observability-gc`, `cron/allocation-health` — diagnostic / GC.
- `cron/aegis-brain-sync`, `cron/brain-sync`, `cron/brain-sync-staff` — brain replication.
- `cron/demand-forecast-weekly`, `cron/shortage-forecast`, `cron/gold-stock-monitor`, `cron/material-confirm-checkpoint` — read-heavy forecasters.
- `cron/webhook-retry` — retry worker (downstream writes already go through `webhooks/stripe`-etc. processors, which need tier-0 wiring anyway).
- `cron/hyphen-sync`, `cron/mrp-nightly`, `cron/process-outreach`, `cron/quote-followups`, `cron/cross-dock-scan`, `cron/cycle-count-schedule` — mutate; audit the inner mutation calls they invoke (jobs lib, outreach lib), NOT the handler.

### Tier 6 — Lightweight / ephemeral (probably SKIP)
These write to ephemeral or low-stakes tables. Consider leaving them out of audit to keep log volume sane.

- `POST /api/presence`, `POST /api/ops/presence`, `POST /api/ops/presence/activity` — 90s-TTL viewer tracking.
- `POST /api/client-errors` — error-beacon sink.
- `POST /api/internal/security-event` — already writes `SecurityEvent` via `logSecurityEvent` (separate audit stream).
- `POST /api/notifications`, `PATCH /api/notifications` — user-notification CRUD.
- `POST /api/messages` — builder-scope messaging (audit might be over-logging if `ops/messages` is already covered; verify).
- `POST /api/ops/staff/preferences/digest`, `POST /api/ops/portal/driver/voice-briefing`, `POST /api/ops/portal/sales/voice-briefing` — preference/briefing writes; low security value.
- `POST /api/v1/engine/data/calendar/events`, `/drive/search`, `/gmail/threads` — engine proxy endpoints (read-through to Google; audit at the engine command level instead).
- `POST /api/v1/engine/inbox/[inboxItemId]/ack` — ack action; consider auditing for engine trail.

---

## NOT COVERED — full list (110)

Grouped by domain, with HTTP method and a one-line entity guess. Path is relative to `src/app/api/`.

### auth (9) — **CRITICAL**
| Path | Method | Mutates |
|---|---|---|
| `auth/change-password/route.ts` | POST | Builder credential |
| `auth/dev-login/route.ts` | POST | Builder session (dev) |
| `auth/forgot-password/route.ts` | POST | PasswordResetToken + outbound email |
| `auth/login/route.ts` | POST | Builder session (cookie) |
| `auth/logout/route.ts` | POST | Builder session revoke |
| `auth/preferences/route.ts` | PATCH | BuilderPreferences |
| `auth/profile/route.ts` | PATCH | Builder row |
| `auth/reset-password/route.ts` | POST | Builder credential |
| `auth/signup/route.ts` | POST | New Builder |

### webhooks (4) — **CRITICAL** (external writes)
| Path | Method | Mutates |
|---|---|---|
| `webhooks/gmail/route.ts` | POST | CommunicationLog / GmailMessage |
| `webhooks/hyphen/route.ts` | POST | HyphenEvent / Job |
| `webhooks/inflow/route.ts` | POST | InflowEvent / Inventory |
| `webhooks/stripe/route.ts` | POST | Payment / Invoice / WebhookEvent |

### admin (10)
| Path | Method | Mutates |
|---|---|---|
| `admin/alert-mute/route.ts` | POST, DELETE | AlertMute row |
| `admin/builders/[id]/route.ts` | PATCH | Builder (admin edit) |
| `admin/errors/route.ts` | DELETE | ErrorLog row purge |
| `admin/hyphen/aliases/route.ts` | POST, DELETE | HyphenAlias |
| `admin/hyphen/events/[id]/route.ts` | POST | HyphenEvent status |
| `admin/products/enrich/route.ts` | POST | Product (bulk enrich) |
| `admin/sync-catalog/route.ts` | POST | Product catalog sync |
| `admin/test-alert-notify/route.ts` | POST | Alert fire-test |
| `admin/test-cron-alert/route.ts` | POST | Cron-alert fire-test |
| `admin/webhooks/[id]/route.ts` | POST | WebhookEvent replay/resurrect |

### ops (16 — excluding auth/finance already covered)
| Path | Method | Mutates |
|---|---|---|
| `ops/admin/digest-preview/route.ts` | POST | DigestPreview |
| `ops/gold-stock/[kitId]/route.ts` | PATCH | GoldStockKit |
| `ops/gold-stock/[kitId]/build/route.ts` | POST | GoldStockKit build |
| `ops/hyphen/documents/[id]/route.ts` | PATCH | HyphenDocument status |
| `ops/hyphen/ingest/route.ts` | POST | HyphenDocument ingest |
| `ops/portal/driver/voice-briefing/route.ts` | POST | DriverBriefing |
| `ops/portal/sales/voice-briefing/route.ts` | POST | SalesBriefing |
| `ops/presence/route.ts` | POST | Presence heartbeat (ephemeral) |
| `ops/presence/activity/route.ts` | POST | Presence activity (ephemeral) |
| `ops/products/[productId]/substitutes/apply/route.ts` | POST | Allocation swap |
| `ops/reports/generate/route.ts` | POST | Report artifact |
| `ops/reports/schedule/route.ts` | POST | ReportSchedule |
| `ops/staff/preferences/digest/route.ts` | POST | StaffPreference.digest |
| `ops/substitutions/requests/[id]/approve/route.ts` | POST | SubstitutionRequest → APPLIED |
| `ops/substitutions/requests/[id]/reject/route.ts` | POST | SubstitutionRequest → REJECTED |
| `ops/video-rooms/route.ts` | POST, PATCH | VideoRoom |

### agent-hub (20)
| Path | Method | Mutates |
|---|---|---|
| `agent-hub/actions/log/route.ts` | POST | AuditLog (direct raw SQL — see note) |
| `agent-hub/churn/intervene/route.ts` | POST | ChurnIntervention |
| `agent-hub/expansion/recommend/route.ts` | POST | ExpansionRecommendation |
| `agent-hub/heartbeat/route.ts` | PATCH | AgentSession (ephemeral) |
| `agent-hub/inventory/auto-po/route.ts` | POST | AutoPO draft |
| `agent-hub/inventory/forecast/route.ts` | POST | ForecastRun |
| `agent-hub/notifications/proactive/route.ts` | POST | ProactiveNotification |
| `agent-hub/outreach/generate/route.ts` | POST | OutreachDraft |
| `agent-hub/outreach/sequence/route.ts` | POST | OutreachSequence |
| `agent-hub/permits/route.ts` | POST | Permit |
| `agent-hub/permits/[id]/route.ts` | PATCH | Permit |
| `agent-hub/pricing/calculate/route.ts` | POST | PricingRun |
| `agent-hub/pricing/competitors/route.ts` | POST | CompetitorPrice |
| `agent-hub/pricing/rules/route.ts` | POST | PricingRule |
| `agent-hub/quality/predict/route.ts` | POST | QualityPrediction |
| `agent-hub/schedule/auto-assign/route.ts` | POST | ScheduleAssignment |
| `agent-hub/seo/content/route.ts` | POST | SEOContent |
| `agent-hub/seo/keywords/route.ts` | POST | SEOKeyword |
| `agent-hub/seo/local-listing/route.ts` | POST | LocalListing |
| `agent-hub/seo/review-request/route.ts` | POST | ReviewRequest |

> **Note on `agent-hub/actions/log`:** this route already writes directly to `AuditLog` via raw SQL. Flagged here because it bypasses the canonical `logAudit()` helper. Refactor recommended, not gap.

### agent (4)
| Path | Method | Mutates |
|---|---|---|
| `agent/chat/route.ts` | POST | ChatMessage |
| `agent/email/route.ts` | POST | OutboundEmail |
| `agent/schedule-change/route.ts` | POST | ScheduleChange |
| `agent/sms/route.ts` | POST | OutboundSMS |

### cron (17)
| Path | Method | Mutates |
|---|---|---|
| `cron/aegis-brain-sync/route.ts` | POST | Brain-sync run |
| `cron/allocation-health/route.ts` | POST | AllocationHealthReport |
| `cron/brain-sync/route.ts` | POST | Brain-sync run |
| `cron/brain-sync-staff/route.ts` | POST | Brain-sync run (staff) |
| `cron/cross-dock-scan/route.ts` | POST | CrossDockScan |
| `cron/cycle-count-schedule/route.ts` | POST | CycleCountSchedule |
| `cron/demand-forecast-weekly/route.ts` | POST | DemandForecast |
| `cron/gold-stock-monitor/route.ts` | POST | GoldStockAlert |
| `cron/hyphen-sync/route.ts` | POST | HyphenEvent ingest |
| `cron/material-confirm-checkpoint/route.ts` | POST | MaterialConfirm sweep |
| `cron/mrp-nightly/route.ts` | POST | MRP batch |
| `cron/observability-gc/route.ts` | POST | Observability GC |
| `cron/process-outreach/route.ts` | POST | Outreach batch |
| `cron/quote-followups/route.ts` | POST | Quote followup batch |
| `cron/shortage-forecast/route.ts` | POST | ShortageForecast |
| `cron/uptime-probe/route.ts` | POST | UptimeCheck |
| `cron/webhook-retry/route.ts` | POST | WebhookEvent retry |

### homeowner (4)
| Path | Method | Mutates |
|---|---|---|
| `homeowner/[token]/confirm/route.ts` | POST | HomeownerAccess + selections locked |
| `homeowner/[token]/selections/route.ts` | POST | HomeownerSelection |
| `homeowner/[token]/upgrades/route.ts` | POST | HomeownerUpgrade |
| `homeowner/seed/route.ts` | POST | Seed homeowner data |

### hyphen (3)
| Path | Method | Mutates |
|---|---|---|
| `hyphen/changeOrders/route.ts` | POST | HyphenChangeOrder |
| `hyphen/oauth/token/route.ts` | POST | HyphenCredential |
| `hyphen/orders/route.ts` | POST | HyphenOrder |

### builders (4)
| Path | Method | Mutates |
|---|---|---|
| `builders/messages/route.ts` | POST | BuilderMessage |
| `builders/quote-request/route.ts` | POST | QuoteRequest |
| `builders/register/route.ts` | POST | Builder (registration) |
| `builders/warranty/route.ts` | POST | WarrantyClaim |

### crew (2)
| Path | Method | Mutates |
|---|---|---|
| `crew/delivery/[id]/route.ts` | PATCH | Delivery state |
| `crew/install/[id]/route.ts` | PATCH | InstallJob state |

### v1/engine (4)
| Path | Method | Mutates |
|---|---|---|
| `v1/engine/data/calendar/events/route.ts` | POST | Proxy to Google Calendar |
| `v1/engine/data/drive/search/route.ts` | POST | Proxy to Google Drive |
| `v1/engine/data/gmail/threads/route.ts` | POST | Proxy to Gmail |
| `v1/engine/inbox/[inboxItemId]/ack/route.ts` | POST | EngineInboxItem ack |

### other (misc, 13)
| Path | Method | Mutates |
|---|---|---|
| `bulk-order/parse/route.ts` | POST | BulkOrderIntake |
| `catalog/cart/route.ts` | POST, DELETE | CartItem |
| `client-errors/route.ts` | POST | ClientError |
| `dashboard/reorder/route.ts` | POST | PurchaseOrder (dashboard) |
| `deliveries/feedback/route.ts` | POST | DeliveryFeedback |
| `door/[id]/route.ts` | POST | Door state (hardware scan) |
| `internal/security-event/route.ts` | POST | SecurityEvent (separate stream) |
| `messages/route.ts` | POST | Message |
| `notifications/route.ts` | PATCH | Notification |
| `presence/route.ts` | POST | Presence (ephemeral) |
| `quote-request/instant/route.ts` | POST, PATCH | InstantQuote |
| `takeoff/route.ts` | POST | Takeoff |
| `upload/route.ts` | POST | UploadedFile |

---

## COVERED — full list (340)

These routes import from `@/lib/audit` and call one of `audit()`, `logAudit()`, `auditBuilder()`. Grouped alphabetically.

<details>
<summary>Expand covered list (340 routes)</summary>

| Path | Methods |
|---|---|
| `admin/hyphen/credentials` | DELETE, POST |
| `agent-hub/intelligence/refresh` | POST |
| `agent-hub/messages` | PATCH, POST |
| `agent-hub/tasks` | POST |
| `agent-hub/tasks/[id]` | PATCH |
| `blueprints/[id]` | DELETE |
| `blueprints/[id]/analyze` | POST |
| `blueprints/[id]/convert` | POST |
| `blueprints/[id]/takeoff` | POST |
| `builder-portal/jobs/[jobId]/co-preview` | POST |
| `builder/branding` | PATCH |
| `builder/chat` | POST |
| `builder/chat/[conversationId]` | POST |
| `builder/deliveries/[id]/reschedule` | POST |
| `builder/onboarding` | PATCH |
| `builder/orders/[id]/reorder` | POST |
| `builder/phase-config` | PUT |
| `builder/referrals` | PATCH, POST |
| `builder/templates` | POST |
| `builder/templates/[id]` | DELETE |
| `builder/templates/[id]/add-to-cart` | POST |
| `invoices/batch-pay` | POST |
| `orders` | POST |
| `orders/[id]/reorder` | POST |
| `payments` | POST |
| `projects` | POST |
| `projects/[id]/blueprints` | POST |
| `projects/[id]/homeowner-access` | POST |
| `quotes` | POST |
| `quotes/[id]` | PATCH |
| `quotes/[id]/convert` | POST |
| `v1/engine/agent/approve/[commandId]` | POST |
| `v1/engine/agent/reject/[commandId]` | POST |
| `v1/engine/chat` | POST |
| `v1/engine/command` | POST |
| `ops/accounting-ai` | POST |
| `ops/accounts/[id]/activities` | POST |
| `ops/accounts/[id]/margins` | POST |
| `ops/accounts/[id]/pricing` | PATCH, POST |
| `ops/accounts/proactive` | POST |
| `ops/activity-log` | POST |
| `ops/admin/data-quality` | PATCH, POST |
| `ops/admin/data-quality/run` | POST |
| `ops/admin/data-repair/accept-fix` | POST |
| `ops/admin/data-repair/flag-for-review` | POST |
| `ops/admin/data-repair/reject-fix` | POST |
| `ops/admin/qr-tags/log-print` | POST |
| `ops/agent` | POST |
| `ops/agent/workflows` | POST |
| `ops/agent/workflows/[id]` | PATCH |
| `ops/ai` | POST |
| `ops/ai-orders` | POST |
| `ops/ai/alerts` | PATCH |
| `ops/ai/builder-snapshot` | POST |
| `ops/ai/chat` | POST |
| `ops/ai/exec-briefing` | POST |
| `ops/ai/insights` | POST |
| `ops/ai/order-summary` | POST |
| `ops/ai/scans` | POST |
| `ops/auth/diagnose` | POST |
| `ops/auth/forgot-password` | POST |
| `ops/auth/login` | POST |
| `ops/auth/logout` | POST |
| `ops/auth/profile` | PATCH, POST |
| `ops/auth/reset-password` | POST |
| `ops/auth/run-migrations` | POST |
| `ops/auth/seed-admin` | POST |
| `ops/auth/seed-staff` | POST |
| `ops/auth/setup-account` | POST |
| `ops/auto-po` | POST |
| `ops/automations` | PATCH, POST |
| `ops/automations/dunnage-to-final-front` | POST |
| `ops/blueprints/analyze` | POST |
| `ops/blueprints/generate-takeoff` | POST |
| `ops/brain-seed` | POST |
| `ops/brain/proxy` | POST |
| `ops/brain/scores` | POST |
| `ops/brain/trigger-sync` | POST |
| `ops/brain/webhook` | POST |
| `ops/builder-chat` | POST |
| `ops/builder-messages` | PATCH |
| `ops/builders/[id]` | DELETE, PATCH |
| `ops/builders/[id]/phase-config` | POST |
| `ops/builders/[id]/settings` | PATCH |
| `ops/builders/applications` | PATCH |
| `ops/cash-flow-optimizer/collections` | POST |
| `ops/cash-flow-optimizer/payment-terms` | POST |
| `ops/cash-flow-optimizer/setup` | POST |
| `ops/cash-flow-optimizer/working-capital` | POST |
| `ops/change-orders` | PATCH, POST |
| `ops/cleanup` | POST |
| `ops/collections` | POST |
| `ops/collections/[invoiceId]/action` | POST |
| `ops/collections/rules` | POST |
| `ops/collections/run-cycle` | POST |
| `ops/communication-logs` | POST |
| `ops/communication-logs/gmail-fetch` | POST |
| `ops/communication-logs/gmail-sync` | POST |
| `ops/communities` | POST |
| `ops/communities/[id]` | PATCH |
| `ops/contacts` | POST |
| `ops/contracts` | POST |
| `ops/crews` | PATCH, POST |
| `ops/crews/subcontractor-pricing` | DELETE, PATCH, POST |
| `ops/data-fix` | POST |
| `ops/delegations` | POST |
| `ops/delegations/[id]` | DELETE, PATCH |
| `ops/deliveries/[id]/send-confirmation` | POST |
| `ops/delivery-notify` | POST |
| `ops/delivery/[deliveryId]/assign-driver` | POST |
| `ops/delivery/[deliveryId]/complete` | POST |
| `ops/delivery/[deliveryId]/depart` | POST |
| `ops/delivery/[deliveryId]/load` | POST |
| `ops/delivery/curri` | POST |
| `ops/delivery/dispatch` | POST |
| `ops/delivery/optimize-hint` | POST |
| `ops/delivery/partial-shipment` | PATCH, POST |
| `ops/delivery/route-optimizer` | POST |
| `ops/delivery/tracking` | POST |
| `ops/divisions` | PATCH, POST |
| `ops/documents/vault` | POST |
| `ops/documents/vault/[id]` | DELETE |
| `ops/email` | PATCH, POST |
| `ops/finance/ap-schedule` | POST |
| `ops/finance/ap-waterfall` | POST |
| `ops/finance/bank` | PATCH, POST |
| `ops/finance/monthly-close` | POST |
| `ops/fleet/location` | POST |
| `ops/floor-plans/[id]` | DELETE, PATCH |
| `ops/floor-plans/upload` | POST |
| `ops/gchat` | POST |
| `ops/growth` | POST |
| `ops/homeowner-access` | PATCH, POST |
| `ops/import-bolt` | POST |
| `ops/import-box` | POST |
| `ops/import-bpw` | POST |
| `ops/import-bpw/intake` | POST |
| `ops/import-bpw/process` | POST |
| `ops/import-hyphen` | POST |
| `ops/import-inflow` | PATCH, POST |
| `ops/inbox` | PATCH, POST |
| `ops/inbox/[id]/escalate` | POST |
| `ops/inbox/[id]/resolve` | POST |
| `ops/inbox/[id]/snooze` | POST |
| `ops/inbox/[id]/take-action` | POST |
| `ops/inspections` | POST |
| `ops/inspections/[id]` | PATCH |
| `ops/inspections/[id]/photos` | POST |
| `ops/inspections/templates` | POST |
| `ops/integrations` | POST |
| `ops/integrations/buildertrend` | POST |
| `ops/integrations/buildertrend/projects` | DELETE, POST, PUT |
| `ops/integrations/buildertrend/webhook` | POST |
| `ops/integrations/inflow` | DELETE, PATCH, POST |
| `ops/integrations/inflow/sync` | POST |
| `ops/integrations/setup` | POST |
| `ops/integrations/supplier-pricing` | POST |
| `ops/integrations/supplier-pricing/apply` | POST |
| `ops/inventory/[id]` | PATCH |
| `ops/inventory/allocations` | POST |
| `ops/inventory/allocations/[id]` | DELETE |
| `ops/inventory/allocations/bulk` | POST |
| `ops/inventory/auto-reorder` | POST |
| `ops/inventory/transfers` | POST |
| `ops/inventory/transfers/[id]/complete` | POST |
| `ops/invoice-reminder` | POST |
| `ops/invoices` | POST |
| `ops/invoices/[id]` | PATCH |
| `ops/invoices/[id]/payments` | POST |
| `ops/invoices/[id]/remind` | POST |
| `ops/invoices/from-order` | POST |
| `ops/jobs` | POST |
| `ops/jobs/[id]` | DELETE, PATCH |
| `ops/jobs/[id]/co-preview` | POST |
| `ops/jobs/[id]/confirm-scheduled-date` | POST |
| `ops/jobs/[id]/material-confirm` | POST |
| `ops/jobs/[id]/material-escalate` | POST |
| `ops/jobs/[id]/notes` | POST |
| `ops/jobs/[id]/phases` | POST |
| `ops/jobs/[id]/phases/[phaseId]` | DELETE, PATCH |
| `ops/jobs/backfill-addresses` | POST |
| `ops/jobs/geocode` | POST |
| `ops/lien-releases` | POST |
| `ops/lien-releases/[id]` | PATCH |
| `ops/locations` | POST |
| `ops/manufacturing-ai` | POST |
| `ops/manufacturing-command/receiving` | PATCH |
| `ops/manufacturing/advance-job` | POST |
| `ops/manufacturing/bom` | DELETE, POST |
| `ops/manufacturing/bom-cleanup` | POST |
| `ops/manufacturing/cost-rollup` | POST |
| `ops/manufacturing/generate-picks` | POST |
| `ops/manufacturing/labor-rates` | POST |
| `ops/manufacturing/picks` | POST |
| `ops/manufacturing/picks/[id]` | PATCH |
| `ops/manufacturing/qc` | POST |
| `ops/manufacturing/tag-program` | POST |
| `ops/margin-rules` | POST |
| `ops/marketing/campaigns` | POST |
| `ops/material-watch` | PATCH, POST |
| `ops/messages` | POST |
| `ops/messages/[conversationId]` | POST |
| `ops/migrate` | POST |
| `ops/migrate-agent-hub` | POST |
| `ops/migrate-all` | POST |
| `ops/migrate-cascades` | POST |
| `ops/migrate-change-orders` | POST |
| `ops/migrate-documents` | POST |
| `ops/migrate-features` | POST |
| `ops/migrate-indexes` | POST |
| `ops/migrate-manufacturing` | POST |
| `ops/migrate-nfc` | POST |
| `ops/migrate-outreach` | POST |
| `ops/migrate-phase2` | POST |
| `ops/migrate-phase3` | POST |
| `ops/migrate-phase4` | POST |
| `ops/migrate-phase5` | POST |
| `ops/migrate-punch-items` | POST |
| `ops/migrate-temporal` | POST |
| `ops/migrate/add-indexes` | POST |
| `ops/migrate/ai-agent` | POST |
| `ops/migrate/builder-pricing-tiers` | POST |
| `ops/migrate/data-scrub` | POST |
| `ops/migrate/employee-onboarding` | POST |
| `ops/migrate/fix-order-totals` | POST |
| `ops/migrate/manufacturing-tables` | POST |
| `ops/migrate/multi-role-support` | POST |
| `ops/migrate/platform-upgrade` | POST |
| `ops/migrate/portal-overrides` | POST |
| `ops/migrate/product-expansion` | POST |
| `ops/migrate/vendor-credit` | POST |
| `ops/mrp/draft-pos` | POST |
| `ops/mrp/production-queue` | PATCH |
| `ops/mrp/setup` | POST |
| `ops/mrp/suggest-po` | POST |
| `ops/notifications` | PATCH, POST |
| `ops/notifications/builder/send` | POST |
| `ops/orders` | POST |
| `ops/orders/[id]` | PATCH |
| `ops/orders/bulk` | PATCH |
| `ops/organizations` | POST |
| `ops/outreach/tracker` | POST |
| `ops/payments` | POST |
| `ops/phase-templates` | POST |
| `ops/phase-templates/[id]` | DELETE, PUT |
| `ops/portal/installer/jobs/[jobId]/complete` | POST |
| `ops/portal/installer/jobs/[jobId]/escalate` | POST |
| `ops/portal/installer/jobs/[jobId]/photos` | POST |
| `ops/portal/installer/jobs/[jobId]/start` | POST |
| `ops/preferences` | PATCH |
| `ops/pricing/tiers` | POST |
| `ops/procurement-intelligence/cash-flow` | POST |
| `ops/procurement-intelligence/cost-trends` | POST |
| `ops/procurement-intelligence/setup` | POST |
| `ops/procurement-intelligence/smart-po` | POST |
| `ops/procurement-intelligence/vendor-scoring` | POST |
| `ops/procurement/ai-assistant` | POST |
| `ops/procurement/inventory` | PATCH, POST |
| `ops/procurement/inventory/calculate-usage` | POST |
| `ops/procurement/purchase-orders` | POST |
| `ops/procurement/purchase-orders/[id]` | PATCH |
| `ops/procurement/setup` | POST |
| `ops/procurement/suppliers` | POST |
| `ops/procurement/suppliers/[id]` | PATCH |
| `ops/procurement/suppliers/[id]/products` | POST |
| `ops/product-categories` | POST |
| `ops/products/categories` | POST |
| `ops/products/cleanup` | POST |
| `ops/products/enrich` | POST |
| `ops/products/images` | PATCH, POST |
| `ops/products/pricing` | POST |
| `ops/punch-items` | PATCH, POST |
| `ops/purchasing` | PATCH, POST |
| `ops/purchasing/[id]` | PATCH |
| `ops/purchasing/[id]/send` | POST |
| `ops/purchasing/recommendations` | POST |
| `ops/purchasing/smart-po` | POST |
| `ops/quote-requests` | PATCH |
| `ops/quotes` | DELETE, PATCH, POST |
| `ops/readiness-check` | POST |
| `ops/receiving` | POST |
| `ops/receiving/[id]/receive` | POST |
| `ops/returns` | POST |
| `ops/returns/[id]` | PATCH |
| `ops/revenue-intelligence/builder-value` | POST |
| `ops/revenue-intelligence/pricing-engine` | POST |
| `ops/revenue-intelligence/setup` | POST |
| `ops/sales/contracts` | POST |
| `ops/sales/contracts/[id]` | DELETE, PUT |
| `ops/sales/deals` | POST |
| `ops/sales/deals/[id]` | DELETE, PUT |
| `ops/sales/deals/[id]/activities` | POST |
| `ops/sales/documents` | POST |
| `ops/sales/documents/[id]` | DELETE, PUT |
| `ops/sales/migrate` | POST |
| `ops/sales/outreach-engine` | POST |
| `ops/sales/pipeline` | PATCH |
| `ops/sales/seed-reps` | POST |
| `ops/schedule` | POST |
| `ops/schedule/[id]` | DELETE, PATCH |
| `ops/schedule/milestones` | POST |
| `ops/seed` | PATCH, POST |
| `ops/seed-demo-data` | POST |
| `ops/seed-employees` | POST |
| `ops/seed-workflow` | POST |
| `ops/settings` | POST |
| `ops/staff` | POST |
| `ops/staff/[id]` | PATCH, POST |
| `ops/staff/[id]/reset-password` | POST |
| `ops/staff/bulk-invite` | POST |
| `ops/staff/fix-passwords` | POST |
| `ops/staff/preferences` | POST |
| `ops/staff/seed` | POST |
| `ops/suppliers` | POST |
| `ops/sync-health` | POST |
| `ops/takeoff-inquiries` | PATCH, POST |
| `ops/takeoffs/[id]` | PATCH |
| `ops/takeoffs/[id]/extract` | POST |
| `ops/takeoffs/[id]/generate-quote` | POST |
| `ops/takeoffs/[id]/match-products` | POST |
| `ops/takeoffs/upload` | POST |
| `ops/trades` | POST |
| `ops/trades/[id]/reviews` | POST |
| `ops/tts` | POST |
| `ops/vendors` | POST |
| `ops/vendors/[id]` | DELETE, PATCH |
| `ops/vendors/performance` | POST |
| `ops/warehouse/bays` | POST |
| `ops/warehouse/cycle-count/complete` | POST |
| `ops/warehouse/cycle-count/line/[id]/count` | POST |
| `ops/warehouse/pick-verify` | POST |
| `ops/warehouse/picks/[jobId]/mark-picked` | POST |
| `ops/warehouse/picks/[jobId]/scan` | POST |
| `ops/warehouse/picks/[jobId]/short` | POST |
| `ops/warranty/automation` | POST |
| `ops/warranty/claims` | POST |
| `ops/warranty/claims/[id]` | PATCH |
| `ops/warranty/inspections` | PATCH, POST |
| `ops/warranty/policies` | PATCH, POST |
| `ops/workflows` | POST |

</details>

---

## READ-ONLY / SKIP — full list (283)

These files have no mutation handler. Most are GET-only listings, health probes, or internal meta endpoints. Not auditable by definition. Summary count by domain only — full enumeration would bloat this doc without adding signal.

| Domain | Count |
|---|---:|
| `ops/*` | 167 |
| `cron/*` | 22 |
| `v1/*` | 20 |
| `admin/*` | 14 |
| `agent-hub/*` | 12 |
| `builder/*` | 12 |
| `crew/*` | 5 |
| `catalog/*` | 4 |
| `account/*` | 2 |
| `builder-portal/*` | 2 |
| `dashboard/*` | 2 |
| `health/*` | 2 |
| `invoices/*` | 2 |
| `orders/*` | 2 |
| `projects/*` | 2 |
| `_meta, activity, auth, blueprints, deliveries, docs, executive, homeowner, quick-order, quotes, readiness, recommendations, search` | 1 each |

Full file-level list lives in `scripts/_readonly.txt` (generated by `scripts/_audit_coverage_scan.mjs`; not committed).

---

## Notes for the wiring agent

1. **Use `audit(request, action, entity, entityId, details, severity?)`** — it auto-extracts staff from headers, picks sensible severity, and fans out a live event. Only use `logAudit(...)` when you don't have a `NextRequest` (crons, cross-lib callers).
2. **Call `await audit(...)` AFTER the mutation succeeds**, not before. On failure the user didn't actually change anything.
3. **Pass entityId** whenever the mutation has a natural id (order id, job id, invoice id). The audit reader UI uses it for entity drill-down.
4. **Stash useful payload in `details`** — new/old values, counts, list of affected ids. Don't dump entire request bodies; redact `passwordHash`, `token`, `cookie`.
5. **Webhooks:** use entity `'Webhook'`, action like `'STRIPE_PAYMENT_INTENT_SUCCEEDED'`, entityId = Stripe event id. This keeps the main event log clean without coupling to the canonical entity that got mutated downstream (`Invoice`, `Payment`, etc.) — those downstream calls should audit separately.
6. **Auth flows:** severity should be WARN for login/logout, CRITICAL for credential change (change-password, reset-password, signup). Include `email` (not password) in `details`.
7. **Crons:** audit only the inner mutation (e.g. an invoice reminder created), NOT the cron handler entry — the cron run itself is already tracked in `CronRun` via `startCronRun`/`finishCronRun`.
8. **Agent-hub `actions/log`:** refactor to call `logAudit()` instead of raw SQL so the `publishEvent` fan-out fires. Today it silently skips the live-event topic.
