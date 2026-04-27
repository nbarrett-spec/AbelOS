# Routes + Flags Health — 2026-04-23

**HEAD:** `74f6bbd` (fix(build): drop THOMAS_BUILDER_PATTERNS page export)
**Agent:** H4 — Monday-readiness routes + flags health check
**Scope:** `src/app/**/page.tsx` (326 files), `src/app/**/route.ts` (758 files), `src/middleware.ts`, feature-flag grep across `src/`.

---

## TL;DR verdict

**YELLOW** — cleared to deploy, but one real security exposure needs a decision before Monday.

- Page-export validator: 326 files, **0 violations**.
- Route-export validator: 758 files, **0 violations**.
- Sibling dynamic-segment audit: **0 conflicts**.
- Feature-flag inventory: **30 distinct flags** catalogued; one default-off by design (`FEATURE_PM_DIGEST_EMAIL`), all others default ON.
- PM bookmarkable URLs: **all 9 verified PASS** (pages + APIs exist, feature-flagged, default ON).
- Middleware gate sanity: carve-outs correct for `/ops/reset-password` + `/ops/setup-account`; `/ops/my-book` correctly requires auth.
- **`/chad`, `/ben`, `/thomas`, `/brittney` are PUBLIC** — middleware matcher does not cover app-root paths. Server components query Prisma directly and return rendered HTML containing PM job counts, builder names, communities, addresses, job numbers. This is a real security issue if Nate cares about confidentiality of PM assignments.
- `.claude/worktrees/*` are proper git worktrees (safe) but not listed in `.gitignore`. No production shadow risk because they're untracked, but worth adding for cleanliness.

---

## Section 1: Page export validator (326 files scanned, 0 violations)

Scanned every `src/app/**/page.tsx` for exports outside the Next.js 14 page whitelist:
- `default` (component) — required
- Permitted named: `metadata`, `dynamic`, `revalidate`, `runtime`, `preferredRegion`, `fetchCache`, `maxDuration`, `generateStaticParams`, `generateMetadata`, `viewport`

**Result: 0 violations.** Confirms the fix in commit `74f6bbd` (dropping `THOMAS_BUILDER_PATTERNS` as a page-level `export const`) cleared the last offender. No page file exports arbitrary runtime symbols.

---

## Section 2: Route export validator (758 files, 0 violations)

Scanned every `src/app/**/route.ts` for exports outside:
- HTTP methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`
- Config: `dynamic`, `revalidate`, `runtime`, `preferredRegion`, `fetchCache`, `maxDuration`, `generateStaticParams`

Type-only exports (`export type`, `export interface`) skipped — those are erased at build time and allowed.

**Result: 0 violations.** Confirms commits `03c8f35` (removed `_clearYtdCache`) and `8c9d286` (dedup + scopeType alias) cleaned up route handlers.

---

## Section 3: Sibling dynamic-segment audit

Walked every directory under `src/app` checking for multiple `[slug]`-style children with different parameter names inside the same parent.

**Result: 0 conflicts.** Confirms the fix in commit `ceae670`. Every dynamic-segment sibling uses a consistent slug name.

---

## Section 4: Feature-flag inventory (30 flags total)

| Flag | Read at | Default when unset | Recommended prod value |
|---|---|---|---|
| `NEXT_PUBLIC_FEATURE_BUILDER_OVERVIEW` | `src/app/admin/builders/[id]/page.tsx:163` | ON (`!== 'off'`) | unset (ON) |
| `NEXT_PUBLIC_FEATURE_BRITTNEY_PAGE` | `src/app/brittney/page.tsx:118` | ON (`=== 'off'` disables) | unset (ON) |
| `NEXT_PUBLIC_FEATURE_BEN_PAGE` | `src/app/ben/page.tsx:111` | ON | unset (ON) |
| `NEXT_PUBLIC_FEATURE_THOMAS_PAGE` | `src/app/thomas/page.tsx:128` | ON | unset (ON) |
| `NEXT_PUBLIC_FEATURE_CHAD_PAGE` | `src/app/chad/page.tsx:109` | ON | unset (ON) |
| `FEATURE_HYPHEN_SYNC` | `src/app/api/integrations/hyphen/sync/route.ts:30` | (checks trimmed value; see note) | set explicit `on` for cron |
| `NEXT_PUBLIC_FEATURE_CALENDAR` | `src/app/ops/calendar/page.tsx:17` | ON | unset (ON) |
| `NEXT_PUBLIC_FEATURE_PM_TODAY` | `src/app/ops/today/page.tsx:21` | ON | unset (ON) |
| **`FEATURE_PM_DIGEST_EMAIL`** | `src/app/api/cron/pm-daily-digest/route.ts:153` | **OFF** (`=== 'true'` required) | Decision: set `true` only when you're ready for emails to hit PMs |
| `NEXT_PUBLIC_FEATURE_FINANCE_YTD` | `src/app/ops/finance/ytd/page.tsx:23` | ON | unset (ON) |
| `NEXT_PUBLIC_FEATURE_SUB_QUEUE` | `src/app/ops/substitutions/page.tsx:98` | ON | unset (ON) |
| `NEXT_PUBLIC_FEATURE_SMARTPO` | `src/app/ops/smartpo/page.tsx:56` | ON | unset (ON) |
| `FEATURE_BUILDERTREND_INGEST` | `src/lib/builder-trend/client.ts:134` | ON | unset (ON) |
| `NEXT_PUBLIC_FEATURE_SHORTAGES` | `src/app/ops/shortages/page.tsx:82` | ON | unset (ON) |
| `NEXT_PUBLIC_FEATURE_HYPHEN_PANEL` | `src/app/ops/jobs/[jobId]/HyphenPanel.tsx:97`; `page.tsx:19` | ON | unset (ON) |
| `NEXT_PUBLIC_FEATURE_CO_INBOX` | `src/app/ops/jobs/[jobId]/ChangeOrderInbox.tsx:21`; `page.tsx:23` | ON | unset (ON) |
| `NEXT_PUBLIC_FEATURE_DELIVERY_SIGNOFF` | `src/app/ops/jobs/[jobId]/DeliverySignOff.tsx:20`; `page.tsx:25` | ON | unset (ON) |
| `NEXT_PUBLIC_FEATURE_MATERIAL_DRAWER` | `src/app/ops/jobs/[jobId]/page.tsx:21`; `MaterialDrawer.tsx:66` | ON | unset (ON) |
| `NEXT_PUBLIC_FEATURE_EXEC_DASH` | `src/app/ops/executive/page.tsx:149` | ON | unset (ON) |
| `NEXT_PUBLIC_FEATURE_PM_ROSTER` | `src/app/ops/pm/page.tsx:98` | ON | unset (ON) |
| `NEXT_PUBLIC_FEATURE_PM_COMPARE` | `src/app/ops/pm/compare/page.tsx:119` | ON | unset (ON) |
| `NEXT_PUBLIC_FEATURE_INTEGRATIONS_DASH` | `src/app/ops/integrations/FreshnessPanel.tsx:345` | ON | unset (ON) |
| `NEXT_PUBLIC_FEATURE_PM_BOOK` | `src/app/ops/pm/book/[staffId]/page.tsx:148` | ON | unset (ON) |
| `NEXT_PUBLIC_FEATURE_PM_ACTIVITY_FEED` | `src/app/ops/pm/activity/page.tsx:26` | ON | unset (ON) |
| `NEXT_PUBLIC_FEATURE_CYCLECOUNT_HISTORY` | `src/app/ops/portal/warehouse/cycle-count/page.tsx:8` | ON | unset (ON) |
| `FEATURE_COLLECTIONS_SEND_REMINDER` | `src/app/api/ops/collections/send-reminder/route.ts:64` | ON | unset (ON) |
| `FEATURE_SMARTPO_SHIP` | `src/app/api/ops/smartpo/ship/route.ts:77` | ON | unset (ON) |
| `NEXT_PUBLIC_BRITTNEY_DELEGATE_TO_PM_BOOK` | `src/app/brittney/page.tsx:171` | OFF (opt-in delegate) | unset (keeps inline render) |

Notes:
- All PM-launch-critical flags default ON, so the default envrionment (no extra env vars) ships Monday with every PM feature live.
- `FEATURE_PM_DIGEST_EMAIL` is a **safety kill-switch**, not a disabled feature. Nate must flip it to `true` when he wants PMs to start getting emails; until then the cron runs but short-circuits.
- No flag requires a specific prod env value other than the digest switch.

---

## Section 5: PM URL verification

| URL | Page file | API file(s) | Status |
|---|---|---|---|
| `/ops/my-book` | `src/app/ops/my-book/page.tsx` | n/a (redirects only) | PASS — reads `x-staff-id`, redirects to `/ops/pm/book/{staffId}` or login |
| `/ops/today` | `src/app/ops/today/page.tsx` | `src/app/api/ops/pm/today/route.ts` | PASS — default export + FF `FEATURE_PM_TODAY` |
| `/ops/pm` | `src/app/ops/pm/page.tsx` | `src/app/api/ops/pm/roster/route.ts` | PASS — FF `FEATURE_PM_ROSTER` |
| `/ops/pm/compare` | `src/app/ops/pm/compare/page.tsx` | `src/app/api/ops/pm/compare/route.ts` | PASS — FF `FEATURE_PM_COMPARE` |
| `/ops/pm/activity` | `src/app/ops/pm/activity/page.tsx` | `src/app/api/ops/pm/activity/route.ts` | PASS — FF `FEATURE_PM_ACTIVITY_FEED`, component `src/components/pm/PmActivityFeed.tsx` |
| `/ops/pm/book/[staffId]` | `src/app/ops/pm/book/[staffId]/page.tsx` | `src/app/api/ops/pm/book/[staffId]/route.ts` | PASS — FF `FEATURE_PM_BOOK` |
| `/ops/substitutions` | `src/app/ops/substitutions/page.tsx` | `src/app/api/ops/substitutions/route.ts` | PASS — FF `FEATURE_SUB_QUEUE` |
| `/chad` | `src/app/chad/page.tsx` | (queries Prisma directly) | PASS (file level) — see Section 6 for auth concern |
| `/ben` | `src/app/ben/page.tsx` | (queries Prisma directly) | PASS (file level) — see Section 6 |
| `/thomas` | `src/app/thomas/page.tsx` | (queries Prisma directly) | PASS (file level) — see Section 6 |
| `/brittney` | `src/app/brittney/page.tsx` | (queries Prisma directly) | PASS (file level) — see Section 6 |

All page files are server components. Each uses only the allowed page exports (default + `dynamic` + `revalidate` + occasional `metadata`). None over-export.

---

## Section 6: Middleware gate sanity + PUBLIC EXPOSURE SECURITY FINDING

### Middleware gates — verified correct

Read `src/middleware.ts` end-to-end.

- **Line 40:** `opsPublicRoutes = ['/ops/login', '/ops/forgot-password', '/ops/reset-password', '/ops/setup-account']` — matches the physical directories that exist in `src/app/ops/`.
- **Lines 146–149:** explicit bypass for `/ops/setup-account` and `/ops/reset-password` so users with stale staff cookies still reach these pages. Confirmed present (from commit `638b267`).
- `/ops/my-book` is NOT in the public allowlist — middleware requires a valid `abel_staff_session` JWT before the page runs. Correct behaviour.
- `/admin/*`, `/api/admin/*` gated with `ADMIN` role.
- `/api/ops/*` gated with staff JWT (exceptions: `/api/ops/auth/*` and `/api/ops/hyphen/ingest` with bearer token).
- `/api/agent-hub/*` supports either `AGENT_HUB_API_KEY` bearer or staff cookie.
- `/sales/*` gated with staff JWT.

### PUBLIC EXPOSURE SECURITY FINDING — real, needs a decision before Monday

**Finding.** Middleware `config.matcher` (lines 594–610) covers:
```
/dashboard/:path*, /projects/:path*, /login, /signup, /forgot-password,
/reset-password, /ops/:path*, /admin/:path*, /sales/:path*, /api/:path*
```

It does **NOT** cover `/chad`, `/ben`, `/thomas`, `/brittney`. These are app-root shortcut paths — Next.js will serve them to any anonymous visitor. Each page is a server component that:

1. Runs `prisma.$queryRawUnsafe` to look up the Staff row by firstName/lastName, then
2. Runs `prisma.$queryRawUnsafe` to pull the PM's active jobs (Chad: 140+ jobs possibly; Brittney: Toll + Texas R&R; Thomas: 4 builders; Ben: may be empty), then
3. Renders HTML containing: job numbers, full builder names, community names, lot/block, job addresses, scope, status, scheduled dates, overdue counts, materials-ready percentage, and direct `/ops/jobs/{id}` links.

Anyone who knows the URL sees the data. Not obfuscated — plain HTML in the page source. The only gate is the feature flag (`NEXT_PUBLIC_FEATURE_*_PAGE === 'off'`), which is intentionally OFF → ON (so the kill-switch is "hide this", not "require auth").

**Why this probably exists.** The comment in `brittney/page.tsx` says "Bookmark-friendly shortcut" — the design is trivial-to-remember URLs PMs paste into their browser. Nate likely traded auth friction for bookmark simplicity. That's a reasonable ops call for a small internal team on a private-ish domain — IF Nate has accepted that a typo, a shared screenshot, or a crawler finding the URL exposes PM assignments.

**Options:**

1. **Accept.** Say "internal shortcut, not sensitive" and leave as-is. Monday-ready, no changes.
2. **Cheapest fix.** Add these four paths to the middleware matcher (`/chad`, `/ben`, `/thomas`, `/brittney`). That alone makes middleware run, but middleware currently has no handler branch for them — so you'd also need a small branch at the top of `middleware()` requiring any staff cookie (no role check) before allowing the request. Probably 15 lines.
3. **Redirect-shim fix.** Replace each `page.tsx` with a 4-line server component that reads `headers().get('x-staff-id')` — BUT that only works if middleware runs, which requires (2) anyway. Pure shim without (2) achieves nothing.
4. **Kill the shortcuts.** Point them at `/ops/pm/book/<staffId>` redirects (which IS middleware-gated). Simplest. But PMs lose the memorable URL.

I'd recommend (2) — add middleware coverage + require staff cookie. Keeps the bookmarks, adds a one-time login. 30-minute change.

---

## Section 7: Orphaned files

- **`src/app/aegis-home/page.tsx`** (+ `layout.tsx`) — found. Only inbound reference is `src/components/ui-v2/TenantSwitcher.tsx`, which is itself in the ui-v2 experimental tree. No nav menu or link from the active `/ops` or `/admin` shell. This matches your description of "pre-existing demo page from scrapped visual overhaul." Not reachable through normal user flow, but also not harmful — safe to leave for Monday, worth deleting in a follow-up cleanup.
- **`src/app/jobs/[id]/`** — does NOT exist. Confirms C7's cleanup already moved the D2 artifacts out. The canonical job page is now `src/app/ops/jobs/[jobId]/page.tsx`.
- Broad sweep for any `page.tsx` not reachable from a parent layout: every active page file has a parent `layout.tsx` somewhere in the chain (`src/app/layout.tsx` is root). No unreachable files found.

---

## Section 8: `.claude/worktrees` orphan detection

`.claude/worktrees/` contains 4 active git worktrees:

| Worktree | Branch | HEAD |
|---|---|---|
| `awesome-poitras-3aca18` | `claude/awesome-poitras-3aca18` | `6b92e9a` |
| `competent-driscoll-b6fc54` | `claude/competent-driscoll-b6fc54` | `50757cd` |
| `jolly-visvesvaraya-fa35e2` | `claude/jolly-visvesvaraya-fa35e2` | `d44b1cd` |
| `upbeat-hertz-fd6c76` | `claude/upbeat-hertz-fd6c76` | `144776b` |

Each has its own `src/app` — roughly 3,382 `.ts`/`.tsx` files total across the four.

**Vercel / production risk: NONE.**
- They are real git worktrees registered in `.git/worktrees/<name>/` (verified). The parent repo treats them as separate checkouts and `git status` reports them as untracked (`??`).
- Vercel builds only the tracked source tree — untracked files aren't pushed to Vercel.
- No shadow risk for the Next.js compile.

**Gitignore gap worth fixing.** `.gitignore` does NOT include `.claude/worktrees/`. The closest line is `.claude/skills/`. In theory a `git add -A` from anyone unfamiliar could stage worktree contents. Safe fix: append `.claude/worktrees/` to `.gitignore`. Non-blocking for Monday.

---

## Top recommendations

**Pre-Monday (blocking?):**

1. **Decide on `/chad` `/ben` `/thomas` `/brittney` auth** (Section 6). Either accept the public exposure or add middleware matcher coverage + a minimal cookie check. ~30 min fix if you want the gate.

**Pre-Monday (non-blocking):**

2. Confirm `FEATURE_PM_DIGEST_EMAIL` should stay `false` / unset at Monday launch — i.e., PMs will NOT get daily digest emails until you flip it. (Current default is off; code path safe.)

**Post-Monday cleanup (low priority):**

3. Add `.claude/worktrees/` to `.gitignore`. One-line fix.
4. Decide fate of `src/app/aegis-home/*` — either wire it into nav or delete. Currently dead code.
5. Collapse the three duplicate PM page patterns (`/chad`, `/ben`, `/thomas`, `/brittney`) into a single parametric route like `/ops/pm/shortcut/[slug]` with a config map. Each is ~350 lines of near-identical code; refactor would save ~1000 lines and eliminate the per-PM flag proliferation.

**Not blocking anything.** Build is green on all export validators. Middleware gates are correct for their covered paths. PM URLs all exist with working APIs. The only unresolved item is the PM-shortcut public-exposure design choice.
