# Demand-Driven MRP for Abel OS

**Status:** Building (April 2026)
**Author:** Engineering
**Owner:** Nate Barrett

## Why

Today Abel OS reorders **reactively**: smart-po looks at `onHand` vs `reorderPoint` and the last 30 days of order activity. It does not look forward at scheduled jobs, expand BOMs, or project a stockout date. So we discover shortages when we go to pick instead of when we still have time to order.

This spec adds **forward, time-phased Material Requirements Planning (MRP)** that walks `Job → Order → OrderItem → BomEntry expansion → daily consumption schedule`, intersects that with on-hand inventory and inbound POs, and produces:

1. A **time-phased projected balance** per product per day for the next 90 days.
2. A **stockout list** with the first date a product goes negative, ranked by lead-time risk.
3. Auto-suggested **DRAFT POs** (using `SmartPORecommendation` + the existing convert-to-PO flow) sized to cover projected demand including safety stock.

Plus the quick wins that came out alongside this: missing indices, `committed` auto-wiring on job lifecycle, `avgDailyUsage` rolling calc on receiving, and PO `expectedDate` defaulting from `VendorProduct.leadTimeDays`.

## Non-goals (v1)

- **No new schema models.** Everything derives at query time. `JobMaterial`/`JobBOM` would let us snap a frozen BOM to a job at lock time, but that's v2 once we've validated the math.
- No reservation/locking semantics beyond what `committed` already gives us.
- No multi-warehouse balancing (Abel has one main warehouse in v1).
- No vendor RFQ flow — drafted POs reuse the preferred vendor from `VendorProduct.preferred = true`.
- No replacement of `smart-po` — MRP runs alongside it and feeds the same `SmartPORecommendation` table so the existing approval UI still works.

## Architecture

### Core insight

A job's material needs can be derived on the fly from existing data:

```
Job (jobId, scheduledDate)
  └─ Order (orderId)
      └─ OrderItem (productId, quantity)
          └─ BomEntry (parentId = productId, componentId, quantity)  -- optional, recursive
              └─ component Product (terminal SKU we actually stock)
```

For a job ordering 12 pre-hung doors scheduled 2026-05-01, MRP expands each pre-hung door to its components (slab, jamb, casing, hinges, lockset) via `BomEntry` and schedules consumption on the install date minus a configurable lead-time buffer (default: order needs to be **on hand 3 days before** scheduledDate).

Products with **no BomEntry** are treated as terminal — they consume themselves. So a builder ordering raw casing also schedules raw casing.

### Daily projection formula

For each product `p` and each day `d` in the next 90 days:

```
projected_balance(p, d) =
    onHand(p)                         -- starting balance today
  + Σ inbound_PO(p, d')  for d' ≤ d   -- POs expected on or before d
  - Σ job_demand(p, d')  for d' ≤ d   -- BOM-expanded demand on or before d
```

Where `inbound_PO(p, d')` uses the PO's `expectedDate` if set, otherwise `orderedAt + VendorProduct.leadTimeDays`. Demand is bucketed by `Job.scheduledDate - lead_buffer_days`.

A product **stocks out** on the first day where `projected_balance < safety_stock`.

### Why a recursive CTE

`BomEntry` is parent → component, but a component could itself be a parent (e.g. a "door package" → "pre-hung door slab" → "raw slab"). We use Postgres `WITH RECURSIVE` to flatten BOMs at query time.

## Data model touch points (all read-only — no schema changes in v1)

| Table | Fields used | Used as |
|---|---|---|
| `Job` | `id`, `orderId`, `scheduledDate`, `status` | Demand source. Filter to active jobs (`status NOT IN ('COMPLETE','CLOSED','CANCELLED')`) |
| `Order` | `id`, `status` | Join Job → OrderItem |
| `OrderItem` | `productId`, `quantity` | Top-level demand quantity |
| `BomEntry` | `parentId`, `componentId`, `quantity` | Recursive expansion |
| `Product` | `id`, `sku`, `name`, `category` | Display + filter |
| `InventoryItem` | `onHand`, `committed`, `safetyStock`, `reorderQty` | Balance + thresholds |
| `PurchaseOrder` | `status`, `expectedDate`, `orderedAt` | Inbound supply |
| `PurchaseOrderItem` | `productId`, `quantity`, `receivedQty` | Inbound qty |
| `VendorProduct` | `preferred`, `vendorCost`, `leadTimeDays` | PO sizing + ETA |
| `SmartPORecommendation` | (write) | Where MRP outputs land for approval |

## API surface

### `GET /api/ops/mrp/projection`
Time-phased projection for the next N days (default 90). Optional `?productId=` to focus.

Response:
```json
{
  "horizonDays": 90,
  "leadBufferDays": 3,
  "asOf": "2026-04-14T...",
  "products": [
    {
      "productId": "...",
      "sku": "DOOR-2068-RH",
      "name": "...",
      "category": "Interior Doors",
      "onHand": 42,
      "safetyStock": 5,
      "preferredVendor": { "vendorId": "...", "name": "DW Distribution", "leadTimeDays": 7 },
      "totalDemand": 156,
      "totalInbound": 80,
      "endingBalance": -34,
      "stockoutDate": "2026-05-08",
      "daysUntilStockout": 24,
      "schedule": [
        { "date": "2026-04-14", "demand": 0, "inbound": 0, "balance": 42 },
        { "date": "2026-04-21", "demand": 12, "inbound": 0, "balance": 30 },
        ...
      ]
    }
  ]
}
```

### `GET /api/ops/mrp/stockouts`
Just the products projected to go negative or below safety stock, ranked by `daysUntilStockout` ascending. Has `?vendorId=` filter.

### `POST /api/ops/mrp/draft-pos`
Body: `{ vendorId?: string, productIds?: string[], dryRun?: boolean }`

For each stockout, computes recommended order qty (= projected shortfall + safety stock margin, rounded up to `VendorProduct.minOrderQty`) and writes `SmartPORecommendation` rows with:
- `recommendationType = 'MRP_FORWARD'`
- `urgency` derived from `daysUntilStockout` (CRITICAL <7, HIGH <14, NORMAL <30, LOW otherwise)
- `triggerReason` = human string with stockout date and demand source
- `relatedJobIds` = JSON array of jobs that drive the demand
- `aiReasoning` = short explainer

These are picked up by the existing smart-po approval UI so they can be converted to DRAFT POs through the same channel.

### `GET /api/ops/mrp/job-materials/[jobId]`
For one job, returns the full BOM-expanded list of materials needed, current availability, and a per-line readiness status (`OK | SHORT | NEEDS_PO`). Used by the job-detail page (and later by the readiness check at T-72).

## UI

`/ops/mrp` page with three tabs:

1. **Stockouts** (default) — table of projected stockouts with date, days-until, qty short, preferred vendor, "Generate POs" button.
2. **90-day projection** — searchable table of all tracked products with sparkline-style bars showing the 90-day balance trajectory.
3. **By job** — drill-in to a job to see its materials readiness.

A "Refresh & generate" button on the Stockouts tab calls `POST /api/ops/mrp/draft-pos` and routes the user to `/ops/procurement-intelligence` with the new SmartPO recs surfaced.

## Cron

`/api/cron/mrp-nightly` runs at 04:00 UTC daily:
1. Run projection.
2. Insert any new MRP-tagged `SmartPORecommendation` rows for stockouts that don't already have an open PENDING rec for the same product.
3. Mark stale recs (where the stockout has been resolved by a received PO) as `RESOLVED`.

Wired in `vercel.json` crons.

## Quick wins shipped alongside MRP

These are small but high-leverage; they all live in one migration and one helper:

1. **Indices** — add the missing performance indices flagged in the audit:
   - `Order.paymentStatus`
   - `PurchaseOrder.expectedDate`
   - `PurchaseOrder.receivedAt`
   - `Job.boltJobId`
   - `Job.inflowJobId`
   - `OrderItem.productId, orderId` composite (helps MRP CTE)
   - `BomEntry.parentId` (already has it but safe to ensure)

2. **PO `expectedDate` auto-default** — when a PO transitions to `SENT_TO_VENDOR` and `expectedDate` is null, set it to `orderedAt + VendorProduct.leadTimeDays` (or 14 days if unknown). New helper in `src/lib/mrp.ts` so other routes can use it.

3. **`avgDailyUsage` rolling calc on receiving** — when a `PurchaseOrderItem` is received OR a `MaterialPick` is verified, recompute `InventoryItem.avgDailyUsage` for that product as `total_consumed_last_30_days / 30`. Also recompute `daysOfSupply = onHand / NULLIF(avgDailyUsage, 0)`. Lives in the same `src/lib/mrp.ts` helper.

4. **`committed` auto-allocate on `MATERIALS_LOCKED`** — when a Job moves to `MATERIALS_LOCKED`, walk its BOM-expanded demand and increment `InventoryItem.committed` for each component. When the Job moves to a terminal state (`DELIVERED`/`COMPLETE`/`CLOSED`) decrement those same commitments. Idempotent: track on the Job whether commitments have been recorded so we don't double-count. Stored as a JSON snapshot in `Job.activities` of type `MATERIALS_COMMITTED` — keeps the schema unchanged.

## Risk & rollback

- **Performance:** the recursive CTE walks `BomEntry` for every active job. Today Abel has ~600 active products and a few dozen open jobs; query is tens of ms. We add a 2-level depth cap to be safe.
- **Empty BOMs:** most products have no `BomEntry`. They fall through to "self-consume", which is the correct behavior — a builder ordering raw casing schedules raw casing.
- **Wrong demand dates:** if a Job has no `scheduledDate`, we ignore it (logged in response as `unscheduledDemand`). Today most jobs do have scheduledDate; we add a warning banner if the unscheduled count is high.
- **Rollback:** all new code lives under `/api/ops/mrp/*`, `/ops/mrp`, `src/lib/mrp.ts`, and one cron route. Removing the route folders + reverting the migration restores prior behavior. The migration is idempotent (`CREATE INDEX IF NOT EXISTS`).

## Out of scope / v2

- Frozen BOM snapshot at job lock (new `JobMaterial` table).
- Substitute / equivalent SKU resolution.
- Multi-warehouse balancing.
- Demand sensing from quote pipeline (not just confirmed orders).
- Vendor RFQ / multi-vendor split orders.
- Min/max stock policy ML tuning.

## Acceptance

- [ ] `/api/ops/mrp/projection` returns a 90-day balance schedule for at least 100 active products in <2s.
- [ ] `/api/ops/mrp/stockouts` correctly identifies products that would go negative given current jobs.
- [ ] `POST /api/ops/mrp/draft-pos` writes `SmartPORecommendation` rows with `recommendationType = 'MRP_FORWARD'` and they appear in the existing procurement-intelligence UI.
- [ ] `/ops/mrp` page renders all three tabs.
- [ ] Nightly cron runs clean.
- [ ] Quick-win indices applied in production.
- [ ] Production deploy verified and smoke-tested.
