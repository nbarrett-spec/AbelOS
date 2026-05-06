# Aegis — Master TODO

**Last updated:** 2026-05-06 (overnight Session 2026-05-05/06)
**Source documents:**
- `AEGIS-OPS-FINANCE-HANDOFF.docx` (7 fixes — all shipped 2026-05-05)
- `AEGIS-BUGFIX-HANDOFF-2026-05-05.docx` (25 bugs/features/UX)
- `AEGIS-100-IMPROVEMENTS-AUDIT-2026-05-05.docx` (100 audit items)

## 🟢 Session 2026-05-05/06 tally

**Shipped this session:** 95 items across 7 waves
- Bugfix doc: B-BUG-2, B-BUG-10, B-FEAT-1/2/3/4/5/6, B-UX-1/2/3/4/5/6/7 (15)
- Audit SEC: 1/2/3/4/5/6/7/9/10 (9)
- Audit DATA: 6/7/8/9/10/12/13 (7)
- Audit API: 1/2/3/4/5/6/7/9/10/11/12/13/14/15 (14)
- Audit UX: 1/2/3/4/5/6/7/8/9/10/11/12/13/14/15/16 (16)
- Audit PERF: 1/2/3/4/5/6/8/9/10/11/12 (11)
- Audit INT: 2/3/4/5/8/10/11/12 (8)
- Audit BIZ: 1/3/4/5/6/7/8/11/12/13/14 (11)
- Audit OBS: 1/2/3/4/5/6/7/8/9/10 (10)

**Total remaining open:** ~22 items (verification-pending B-BUGs, plus assorted P1/P2/P3 explicitly out of today's scope)

**Total open before session:** 117. After: ~22.

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
| ✅ **B-BUG-2** | Approve / Create / Deny builder account broken | shipped — admin builders endpoint added |
| **B-BUG-3** | Daily tasks drill-in broken | `/ops/tasks` or dashboard widget — wrong onClick route |
| **B-BUG-4** | Job readiness board broken | `/ops/job-readiness` — needs symptom check |
| **B-BUG-5** | Calendar sync broken | `/ops/calendar` + Google Calendar OAuth — likely token refresh |
| **B-BUG-6** | "Failed to fetch" on POs page | `/ops/purchasing` — Prisma include error likely |
| **B-BUG-7** | Inventory page non-functional | `/ops/inventory` — could be data side OR sort handler |
| **B-BUG-8** | Inventory CSV export broken | API path EXISTS at `?format=csv` — symptom may not be code-side |
| **B-BUG-9** | "Assign to me" broken on sales dashboard | `/sales/dashboard` — find onClick handler |
| **B-BUG-11** | Cannot select recipients for messaging | `/ops/messaging` — combobox not wired to data source |
| ✅ **A-SEC-1** | JWT_SECRET fallback removed | `3dcdb03` |
| ✅ **A-SEC-2** | BPW sync CRON_SECRET auth added | `5e502c6` |
| **A-DATA-1** | Zero soft-delete pattern in 239 models | `prisma/schema.prisma` — add `deletedAt` to Builder, Order, Quote, Invoice, Job, Product |
| **A-DATA-2** | `onDelete: Restrict` on `Order.builderId` blocks builder cleanup | `prisma/schema.prisma:584` |
| **A-DATA-3** | `onDelete: Restrict` on `QuoteItem.productId` blocks product retirement | `prisma/schema.prisma:558` — add `productSnapshot` JSON for history |
| ✅ **A-API-1** | Zod validation rolled out across builder/order/quote/invoice POST routes | wave-3+ |
| ✅ **A-API-2** | Twilio SMS webhook now handles inbound + auth | wave-5 |
| ✅ **A-API-3** | Collections send-email endpoint shipped | wave-2 |
| ✅ **A-UX-1** | loading.tsx skeletons added across top pages | wave-3+ |
| ✅ **A-UX-2** | Driver manifest page expanded | `884b781` |
| ✅ **A-UX-3** | Finance YTD page filled in | wave-3 |
| ✅ **A-UX-4** | Ops inbox built out | `8d97b1f` |
| **A-INT-1** | Hyphen scraper has 5 NotImplementedError stubs | `src/lib/hyphen/scraper.ts:192-248` — needs Playwright |
| ✅ **A-INT-2** | Hyphen schedule + closing date now persisted | `e8ebc95` |
| ✅ **A-BIZ-1** | Quote expiration enforcement (expiresAt + cron) | wave-2 part 3 |
| **A-BIZ-2** | Takeoff engine is template-based mock | `src/lib/takeoff-engine.ts:15` — Phase 1 only, not AI |

> *(P0 row count: 25 — but several B-BUGs need browser verification before they're confidently fixable. Count above includes those pending verification.)*

---

## 🔧 P1 — High-value / Critical (56 items)

### Bugfix doc — features (B-FEAT-*)
| ID | Title | Notes |
|---|---|---|
| ✅ **B-FEAT-1** | Dunnage door wood/fiberglass flag | wave-2 part 2 (`6eb7552`) |
| ✅ **B-FEAT-2** | Blueprint upload on Communities page | wave-2 part 1 |
| ✅ **B-FEAT-3** | Non-BOM orders skip manufacturing | wave-2 part 2 |
| ✅ **B-FEAT-4** | Manufacturing schedule 24hr-late cron | wave-2 part 2 |
| ✅ **B-FEAT-5** | QC photo queue + models | `9affe6a` + `1009699` |
| ✅ **B-FEAT-6** | Import tools (inventory, price lists, builders) | wave-3 part 2 |

### Bugfix doc — UX gaps (B-UX-* — renamed to disambiguate from audit UX)
| ID | Title | Notes |
|---|---|---|
| ✅ **B-UX-1** | Global search Cmd+K shipped | wave-3 part 3 |
| ✅ **B-UX-2** | DrillLink component shipped | `b90ab58` |
| ✅ **B-UX-3** | Edit slide-over on detail pages | wave-6 part 2 |
| ✅ **B-UX-4** | Drillable order page references | `b90ab58` |
| ✅ **B-UX-5** | Sidebar reorganization | `b90ab58` |
| ✅ **B-UX-6** | Dark mode contrast bump | `b90ab58` |
| ✅ **B-UX-7** | NotesSection component on detail pages | `1009699` |

### Audit — Security & Auth
| ID | Title | Path |
|---|---|---|
| ✅ **A-SEC-3** | Sentry sweep across catch blocks | wave-6 part 4 (`2252cf2`) |
| ✅ **A-SEC-4** | CSRF token validation strengthened | wave-5 part 2 |
| ✅ **A-SEC-5** | Admin route role check enforced | wave-5+ |
| ✅ **A-SEC-6** | Hyphen OAuth credentials encrypted | `764378b` |

### Audit — Data Integrity
| ID | Title | Path |
|---|---|---|
| **A-DATA-4** | `OrderItem.productId` Restrict blocks product deletion | `prisma/schema.prisma:656` |
| **A-DATA-5** | Quote.takeoffId unique + cascade creates orphan risk | `prisma/schema.prisma` |
| ✅ **A-DATA-6** | Builder.status index added | `dd43d23` |
| ✅ **A-DATA-7** | Order(status, createdAt) composite index | `dd43d23` |
| ✅ **A-DATA-8** | Job(phase, scheduledDate) composite index | `dd43d23` |
| ✅ **A-DATA-9** | Invoice(status, dueDate) composite index | `dd43d23` |

### Audit — API Quality
| ID | Title | Path |
|---|---|---|
| ✅ **A-API-4** | Statement-send sends real email | wave-2+ |
| ✅ **A-API-5** | Job link-order endpoint shipped | wave-2 |
| ✅ **A-API-6** | Delivery detail route built | wave-2 |
| ✅ **A-API-7** | QuickBooks sync stubs cleaned up (kill decision) | `2252cf2` |
| **A-API-8** | BuilderTrend sync incomplete (one-directional) | `src/lib/integrations/buildertrend.ts` — partial covered by `2252cf2` |
| ✅ **A-API-9** | Financial snapshot reads real cashOnHand | wave-2 |
| ✅ **A-API-10** | PM standup narrative dynamic | wave-2 |

### Audit — UX Stub Pages
| ID | Title | Lines |
|---|---|---|
| ✅ **A-UX-5** | Calendar wired to real events | `25980e8` |
| ✅ **A-UX-6** | Customer Catalog page built | `f37d939` |
| ✅ **A-UX-7** | My Book page built | `9c98762` |
| ✅ **A-UX-8** | Portal analytics filled in | `74711bc` |
| ✅ **A-UX-9** | Portal warranty claim flow shipped | `c9f08bd` |
| ✅ **A-UX-10** | Portal projects expanded | wave-3 part 3 |
| ✅ **A-UX-11** | Sales contracts list + detail | `b959a86` |
| ✅ **A-UX-12** | Sales documents vault | `233ca45` |
| ✅ **A-UX-13** | Quote conversion filters read URL params | wave-3+ |
| ✅ **A-UX-14** | Substitutions page expanded | wave-3 |
| ✅ **A-UX-15** | Shortages page expanded | wave-3 |

### Audit — Performance
| ID | Title | Path |
|---|---|---|
| ✅ **A-PERF-1** | Ops accounts paginated | `4beb177` |
| ✅ **A-PERF-2** | Material calendar windowed | `4beb177` |
| ✅ **A-PERF-3** | Job-packet bounded fetch | `4beb177` |
| ✅ **A-PERF-4** | Hyphen sync incremental | `4beb177` |
| ✅ **A-PERF-5** | Collections N+1 fixed | `1b930c5` |

### Audit — Integrations
| ID | Title | Path |
|---|---|---|
| ✅ **A-INT-3** | Calendar sync hardened | wave-5 |
| ✅ **A-INT-4** | Gmail ack/receipt complete | `0d52789` |
| ✅ **A-INT-5** | BuilderTrend bidirectional sync | `2252cf2` |
| **A-INT-6** | InFlow sync runs but inventory page broken (matches B-BUG-7) | |

### Audit — Business Logic
| ID | Title | Path |
|---|---|---|
| ✅ **A-BIZ-3** | Inventory reservation on order placement | `75d0cf8` |
| ✅ **A-BIZ-4** | Auto-reorder cron for fast-moving SKUs | `75d0cf8` |
| ✅ **A-BIZ-5** | MRP accounts for vendor lead times | `75d0cf8` |
| ✅ **A-BIZ-6** | Backorder flow shipped | `0d52789` |
| ✅ **A-BIZ-7** | Dunnage door strike type captured (= B-FEAT-1) | `6eb7552` |
| ✅ **A-BIZ-8** | 24hr-before-delivery mfg rule (= B-FEAT-4) | `6eb7552` |

### Audit — Observability
| ID | Title | Path |
|---|---|---|
| ✅ **A-OBS-1** | AuditLog persistence wired | `3d5fdc2` |
| ✅ **A-OBS-2** | Structured logging shipped | `0a837e3` |
| ✅ **A-OBS-3** | Health check pings DB/Redis/Resend | wave-7 |

---

## 🛠️ P2 — Backlog / Tech Debt (45 items)

### Audit — Security
| ID | Title |
|---|---|
| ✅ **A-SEC-7** | Rate limiting on auth endpoints | `e7e90a0` |
| **A-SEC-8** | Password reset tokens lack explicit expiration check |
| ✅ **A-SEC-9** | File upload size cap enforced | `e7e90a0` |
| ✅ **A-SEC-10** | CSP header in middleware | `e7e90a0` |
| **A-SEC-11** | Agent SMS webhook returns 501 with no auth |
| **A-SEC-12** | NUC integration endpoints lack auth |

### Audit — Data
| ID | Title |
|---|---|
| ✅ **A-DATA-10** | Delivery(status, scheduledDate) composite index | `dd43d23` |
| **A-DATA-11** | 667 indexes for 239 models — but key operational fields missed |
| ✅ **A-DATA-12** | Legacy models deprecated | `d7a8706` |
| ✅ **A-DATA-13** | Order.total trigger | `6ba0728` |
| **A-DATA-14** | Staff `SetNull` on assigneeId — UI doesn't handle null gracefully |
| **A-DATA-15** | Verify `Product.sku` has unique constraint |

### Audit — API
| ID | Title |
|---|---|
| ✅ **A-API-11** | try/catch sweep across API routes | `e8ebc95` |
| ✅ **A-API-12** | Webhook retry exponential backoff | `e8ebc95` |
| ✅ **A-API-13** | Payment webhook idempotency | wave-7 |
| ✅ **A-API-14** | Import endpoints (= B-FEAT-6) | wave-3 part 2 |
| ✅ **A-API-15** | Raw SQL audit + sanitization | `764378b` |

### Audit — UX
| ID | Title |
|---|---|
| ✅ **A-UX-16** | Admin page expanded | wave-3+ |
| **A-UX-17** | Homeowner page (113 lines) — needs warranty info, products, care |
| **A-UX-18** | Portal messages stub (65 lines) |
| **A-UX-19** | Portal schedule stub (71 lines) |
| **A-UX-20** | QC rework uses localStorage — should be DB-backed |

### Audit — Performance
| ID | Title |
|---|---|
| ✅ **A-PERF-6** | PM daily tasks cron idempotency | wave-2 part 3 |
| **A-PERF-7** | 54 console.log in API routes (perf + noise) |
| ✅ **A-PERF-8** | Redis caching layer | `d591e13` |
| ✅ **A-PERF-9** | Quote report filters pushed to DB | `d591e13` |
| ✅ **A-PERF-10** | Boise spend pre-compute cron | `d591e13` + `6ba0728` |
| ✅ **A-PERF-11** | Image optimization for product photos | `d29dece` |

### Audit — Integrations
| ID | Title |
|---|---|
| **A-INT-7** | Bolt sync still in crons — ECI Bolt is dead (remove) |
| ✅ **A-INT-8** | QuickBooks sync stubs killed | `2252cf2` |
| **A-INT-9** | NUC brain-sync crons assume Tailscale (fail on Vercel — no Tailscale) |
| ✅ **A-INT-10** | Stripe webhook idempotency | wave-7 |
| ✅ **A-INT-11** | Boise pricing delta detection | wave-6+ |
| ✅ **A-INT-12** | SEO local-listing phone placeholder fixed | wave-7 |

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
