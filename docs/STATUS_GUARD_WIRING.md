# Status Guard Wiring Plan

Goal: make `src/lib/state-machines.ts` the enforced source of truth for every status mutation on Order, Job, Invoice, Delivery, PO, Quote, and Deal. Today ~54 API routes cast a raw string to a Postgres enum (`::"OrderStatus"`, etc.) with no transition check — a client can send `{ "status": "COMPLETE" }` from any state, and it lands.

This plan ships alongside the new `src/lib/status-guard.ts` helper. One route (`src/app/api/ops/orders/[id]/route.ts` PATCH) has been retrofitted as the reference implementation. The rest follow the same pattern.

---

## The helper (what you import)

```ts
import {
  requireValidTransition,       // sync guard — throws InvalidTransitionError
  requireValidTransitionFor,    // async-signature convenience wrapper
  withStatusGuard,              // route middleware wrapper — catches + 409s
  transitionErrorResponse,      // catch-block helper — returns 409 or null
  InvalidTransitionError,       // error class (instanceof checks)
  type GuardEntity,             // 'order' | 'po' | 'invoice' | 'job' | 'delivery' | 'quote' | 'installation' | 'deal'
} from '@/lib/status-guard';
```

`requireValidTransition(entity, from, to)` throws `InvalidTransitionError` with payload:

```ts
{
  error: 'INVALID_TRANSITION',
  entity: 'order',
  from: 'RECEIVED',
  to: 'COMPLETE',
  validNext: ['CONFIRMED', 'CANCELLED'],
  reason: 'DISALLOWED' | 'UNKNOWN_FROM' | 'UNKNOWN_TO',
  message: 'Invalid order transition: RECEIVED -> COMPLETE. Valid next states from RECEIVED: [CONFIRMED, CANCELLED]'
}
```

Idempotent no-ops (`from === to`) are silently allowed.

---

## The codemod

Current shape (unsafe — 40+ routes look like this):

```ts
const { status } = await request.json()
if (status) {
  setClauses.push(`"status" = '${status}'::"OrderStatus"`)
}
await prisma.$executeRawUnsafe(`UPDATE "Order" SET ${setClauses.join(', ')} WHERE "id" = $1`, id)
```

Target shape:

```ts
const { status } = await request.json()
if (status) {
  // 1. Load current status
  const currentRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "status"::text AS "status" FROM "Order" WHERE "id" = $1`,
    id
  )
  if (currentRows.length === 0) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }
  // 2. Guard
  try {
    requireValidTransition('order', currentRows[0].status, status)
  } catch (e) {
    const res = transitionErrorResponse(e)
    if (res) return res
    throw e
  }
  // 3. Write (unchanged)
  setClauses.push(`"status" = '${status}'::"OrderStatus"`)
}
```

### Variations

**Batch writes (IN (...)).** If the route updates N rows in a single UPDATE, you either (a) narrow the UPDATE to rows whose current status allows the transition using a `WHERE status IN (...)` clause derived from the inverse of `getNextStatuses`, or (b) iterate and guard per row. (a) is faster; (b) is simpler. Default to (b) unless N > 50.

**Prisma-client writes (`.update({ data: { status: 'X' } })`).** Same pattern — `findUnique` for current, guard, then `update`.

**Cascade / workflow writes.** Internal cascades (e.g. `src/lib/cascades/*`) that auto-advance status on event fire MUST still call `requireValidTransition`. If the cascade advances from a disallowed state, that's a bug — fail loudly, not silently.

**New records (status on INSERT).** If `status` is set on initial INSERT, no guard is needed (no prior state). Use the entity's canonical initial status (e.g. Order → `RECEIVED`, PO → `DRAFT`).

---

## Adoption order (priority tiers)

Start with hot paths that UI/customers hit every day. Migrations, seeds, and one-off fixes can come later or be skipped.

### Tier 1 — User-facing status changes (do first)

| Route | Entity | Status column | Notes |
|---|---|---|---|
| `src/app/api/ops/orders/[id]/route.ts` | order | status | **DONE — reference impl** |
| `src/app/api/ops/orders/bulk/route.ts` | order | status | Batch — iterate + guard |
| `src/app/api/ops/orders/route.ts` | order | status | POST only sets initial — GET unaffected |
| `src/app/api/orders/route.ts` | order | status | Builder portal create — initial status only |
| `src/app/api/ops/jobs/[id]/route.ts` | job | status | **Also fix stale FINAL_FRONT / FINISHING / TRIM_COMPLETE branch (line ~234) and the `EN_ROUTE` delivery write (line ~221)** |
| `src/app/api/ops/jobs/route.ts` | job | status | |
| `src/app/api/ops/manufacturing/advance-job/route.ts` | job | status | Purpose-built for advance — prime candidate |
| `src/app/api/ops/portal/installer/jobs/[jobId]/start/route.ts` | job | status | Installer portal start = INSTALLING |
| `src/app/api/ops/portal/installer/jobs/[jobId]\complete/route.ts` | job | status | Installer portal complete = COMPLETE or PUNCH_LIST |
| `src/app/api/ops/readiness-check/route.ts` | job | status | READINESS_CHECK → MATERIALS_LOCKED |
| `src/app/api/ops/invoices/[id]/route.ts` | invoice | status | |
| `src/app/api/ops/invoices/[id]/payments/route.ts` | invoice | status | Payment flip SENT → PARTIALLY_PAID / PAID |
| `src/app/api/ops/invoices/route.ts` | invoice | status | |
| `src/app/api/ops/invoices/from-order/route.ts` | invoice | status | Create — initial only |
| `src/app/api/invoices/batch-pay/route.ts` | invoice | status | Batch — iterate + guard |
| `src/app/api/ops/payments/route.ts` | invoice | status | |
| `src/app/api/payments/route.ts` | invoice | status | Builder portal |
| `src/app/api/ops/delivery/dispatch/route.ts` | delivery | status | SCHEDULED → LOADING |
| `src/app/api/ops/delivery/[deliveryId]/load/route.ts` | delivery | status | LOADING → IN_TRANSIT |
| `src/app/api/ops/delivery/[deliveryId]/complete/route.ts` | delivery | status | UNLOADING → COMPLETE / PARTIAL_DELIVERY |
| `src/app/api/ops/delivery/[deliveryId]/assign-driver/route.ts` | delivery | status | May no-op on status, verify |
| `src/app/api/ops/delivery/partial-shipment/route.ts` | delivery | status | |
| `src/app/api/ops/delivery/tracking/route.ts` | delivery | status | Only `DeliveryTracking.status` (free-form) — **skip**. But verify it doesn't touch `Delivery.status`. |
| `src/app/api/crew/delivery/[id]/route.ts` | delivery | status | Driver app |
| `src/app/api/builder/deliveries/[id]/reschedule/route.ts` | delivery | status | → RESCHEDULED → SCHEDULED |
| `src/app/api/ops/quotes/route.ts` | quote | status | |
| `src/app/api/quotes/route.ts` | quote | status | |
| `src/app/api/quotes/[id]/route.ts` | quote | status | |
| `src/app/api/quotes/[id]/convert/route.ts` | quote | status | APPROVED → ORDERED |
| `src/app/api/ops/purchasing/[id]/route.ts` | po | status | |
| `src/app/api/ops/purchasing/route.ts` | po | status | |
| `src/app/api/ops/procurement/purchase-orders/[id]/route.ts` | po | status | |
| `src/app/api/ops/receiving/route.ts` | po | status | SENT_TO_VENDOR → PARTIALLY_RECEIVED → RECEIVED |
| `src/app/api/ops/manufacturing-command/receiving/route.ts` | po | status | Duplicate path — same flow |
| `src/app/api/ops/sales/deals/[id]/route.ts` | deal | stage | DealStage not DealStatus — same guard, entity='deal' |
| `src/app/api/ops/sales/deals/route.ts` | deal | stage | |
| `src/app/api/ops/sales/pipeline/route.ts` | deal | stage | Pipeline drag/drop — most common deal mutation |

### Tier 2 — Automation / cron / cascades (do second)

| Route | Entity | Notes |
|---|---|---|
| `src/app/api/cron/quote-followups/route.ts` | quote | Auto-advance SENT → EXPIRED |
| `src/app/api/cron/collections-cycle/route.ts` | invoice | SENT → OVERDUE |
| `src/app/api/cron/collections-email/route.ts` | invoice | |
| `src/app/api/cron/run-automations/route.ts` | varies | Scans body for entity type |
| `src/app/api/cron/bpw-sync/route.ts` | order | External sync |
| `src/app/api/cron/bolt-sync/route.ts` | order | External sync |
| `src/app/api/ops/collections/run-cycle/route.ts` | invoice | |
| `src/app/api/ops/collections/route.ts` | invoice | |
| `src/app/api/ops/material-watch/route.ts` | order | AWAITING_MATERIAL → IN_PRODUCTION |
| `src/lib/cascades/*.ts` | varies | Every cascade that mutates status |

### Tier 3 — Imports, migrations, seeds (skip or bypass)

These set status on initial insert from external sources. No guard needed, but document the policy choice.

- `src/app/api/ops/import-bpw/**`
- `src/app/api/ops/import-bolt/route.ts`
- `src/app/api/ops/import-hyphen/route.ts`
- `src/app/api/ops/import-box/route.ts`
- `src/app/api/ops/seed*/route.ts`
- `src/app/api/ops/migrate*/**`
- `src/app/api/ops/data-fix/route.ts`
- `src/app/api/ops/brain-seed/route.ts`

**Policy:** Imports may write any valid enum value on INSERT. They MUST NOT update existing rows' status without going through the guard. Audit with `grep -E "UPDATE .* \"(status|stage)\"" src/app/api/ops/import*` after the codemod.

### Tier 4 — Stale bugs already found (fix in the same pass)

These surfaced during the state-machine audit. Fixing them is not optional — they write invalid enum values today and silently fail (or land inconsistent data).

1. **`src/app/api/ops/jobs/[id]/route.ts` line ~221:** `const delStatus = newStatus === 'IN_TRANSIT' ? 'EN_ROUTE' : 'SCHEDULED'` — `EN_ROUTE` is not in the `DeliveryStatus` enum. Write `IN_TRANSIT` instead, or remove the branch entirely (the Delivery's own lifecycle route handles this).
2. **`src/app/api/ops/jobs/[id]/route.ts` line ~234:** `['FINAL_FRONT', 'FINISHING', 'TRIM_COMPLETE'].includes(newStatus)` — none of these are valid `JobStatus` values (they belong to `POCategory`). The dunnage auto-trigger needs to fire on the correct JobStatus (likely `INSTALLING` or `PUNCH_LIST`) or be moved to a PO-side hook.

---

## Middleware wrapper (optional)

For new routes, prefer `withStatusGuard` so 409 responses are automatic:

```ts
import { withStatusGuard, requireValidTransition } from '@/lib/status-guard'

export const PATCH = withStatusGuard('order', async (req, { params }) => {
  const { status } = await req.json()
  const current = await loadOrderStatus(params.id)
  requireValidTransition('order', current, status)
  // ... do the update
  return NextResponse.json(result)
})
```

Existing routes can stay on the `try/catch + transitionErrorResponse` pattern — easier diff, same behavior.

---

## Checklist per route

- [ ] Import `requireValidTransition` and `transitionErrorResponse` from `@/lib/status-guard`.
- [ ] Before any status write, read the current status from the DB (or use the value already loaded).
- [ ] Wrap `requireValidTransition(...)` in try/catch; on catch, call `transitionErrorResponse` and return the 409.
- [ ] Verify `npx tsc --noEmit` clean.
- [ ] Test one success + one failure in Postman / curl: success returns 200 with updated row, failure returns 409 with the InvalidTransitionError payload.

---

## What NOT to guard

- `DeliveryTracking.status` — free-form string column, not a DB enum. Different model, different truth.
- `PaymentStatus` — has its own flow but no state machine defined yet. Revisit after `ORDER_TRANSITIONS` is landed everywhere.
- Staff / Builder / Product / Vendor status — not in `state-machines.ts` scope.
- `ActionQueue.status`, `AlertPipeline.status`, `Task.status` — engine/agent-hub internal. Out of scope for this pass.

---

## Rollout

1. Land `src/lib/status-guard.ts` + `src/lib/state-machines.ts` fixes + this doc (done in the same PR).
2. Retrofit `src/app/api/ops/orders/[id]/route.ts` (done — reference impl).
3. Tier 1 routes in a single PR per entity (order / job / invoice / delivery / quote / po / deal = 7 PRs, ~5-8 routes each).
4. Tier 2 routes in one cleanup PR.
5. Tier 4 stale bugs alongside their entity's Tier 1 PR (the Job ones come with the Job PR).
6. Add a CI grep check that fails if a new `::"(OrderStatus|JobStatus|...)"` literal shows up in `src/app/api/**` without an adjacent `requireValidTransition` call in the same function. (Cheap heuristic — catches 80% of new regressions.)
