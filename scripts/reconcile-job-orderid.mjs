#!/usr/bin/env node
// scripts/reconcile-job-orderid.mjs
//
// Reconcile Job.orderId for active jobs that are missing it.
//
// Why this exists: 471 of 878 active Jobs have orderId = NULL. Without it,
// the chain Job -> Order -> OrderItem -> Product -> BoM breaks, and the
// allocation engine can't compute material requirements. Fixing orderId
// unlocks allocation + ATP + PM-dashboard readiness for these jobs.
//
// Strategy (highest confidence first — first hit wins):
//
//   1. PO number match        Job.bwpPoNumber           -> Order.poNumber
//   2. Hyphen PO              Job.hyphenJobId/address   -> HyphenOrder
//                             (refOrderId/builderOrderNum) -> Order.orderNumber
//   3. Bolt reconciliation    Job.boltJobId             -> BoltWorkOrderLink
//                             -> BoltWorkOrder.jobAddress -> Order.deliveryNotes
//   4. InFlow match           Job.inflowJobId           -> Order.inflowOrderId
//   5. Address fuzzy (last)   Job.jobAddress normalized -> Order.deliveryNotes
//                             within same builder, optionally proximate date
//
// For every match we stamp:
//   Job.orderId              = <matched order id>
//   Job.orderIdMatchMethod   = 'po' | 'hyphen' | 'bolt' | 'inflow' | 'address_fuzzy'
//
// We also add a new column `orderIdMatchMethod` to Job (ADD COLUMN IF NOT
// EXISTS — idempotent, does not require a Prisma migration).
//
// Idempotency: we skip any Job.orderId IS NOT NULL row. Re-running is safe.
//
// After reconciliation we re-run allocateForJob(jobId) for every job that
// just got its orderId, so InventoryAllocation picks up the new demand.
// Allocation is itself idempotent (ON CONFLICT DO NOTHING).
//
// USAGE:
//   node scripts/reconcile-job-orderid.mjs            # dry run
//   node scripts/reconcile-job-orderid.mjs --commit   # write
//   node scripts/reconcile-job-orderid.mjs --commit --no-allocate
//
// DO NOT run --commit without reviewing the dry-run output.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const argv = new Set(process.argv.slice(2))
const COMMIT = argv.has('--commit')
const SKIP_ALLOC = argv.has('--no-allocate')
const VERBOSE = argv.has('--verbose')

const ACTIVE_STATUSES = [
  'CREATED',
  'READINESS_CHECK',
  'MATERIALS_LOCKED',
  'IN_PRODUCTION',
  'STAGED',
  'LOADED',
  'IN_TRANSIT',
  'DELIVERED',
  'INSTALLING',
  'PUNCH_LIST',
]
const ACTIVE_IN = `(${ACTIVE_STATUSES.map((s) => `'${s}'`).join(',')})`

// Lazy-load the TS allocation module via the compiled build if present, else
// fall back to a direct tsx import. scripts here are plain mjs and we want to
// avoid adding a TS-loader dep just for this — we'll shell out to node with
// tsx only if the built artifact isn't there. Same shape as scripts/backfill-*
// use the Prisma client directly, so we inline the allocation call below to
// avoid the import gymnastics.

// ── Helpers ────────────────────────────────────────────────────────────────

function normalizeAddress(raw) {
  if (!raw) return ''
  return String(raw).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function normalizeAddressLoose(raw) {
  // First line only, stripped of punctuation. Used for prefix comparisons
  // where the builder side has city-tails the job side doesn't.
  if (!raw) return ''
  const firstLine = String(raw).split(/,|\n/)[0] || ''
  return firstLine.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

// Extract <streetNumber> + first street-name token (lowercased, alphanum).
// Used for aggressive fuzzy address key when Job.jobAddress is the full
// "1608 Kendell Street Anna, TX 75409" and Order.deliveryNotes is the terse
// "1608 Kendell" form the operators actually type.
function addressStreetKey(raw) {
  if (!raw) return ''
  const firstLine = String(raw).split(/,|\n/)[0] || ''
  // Extract leading digits (house number) + next 1-2 word tokens.
  const m = firstLine
    .trim()
    .match(/^(\d+)\s+([A-Za-z0-9.'-]+)(?:\s+([A-Za-z0-9.'-]+))?/)
  if (!m) return ''
  const num = m[1]
  const t1 = (m[2] || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  const t2 = (m[3] || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  // Skip direction tokens when they exist (N/S/E/W, n., north, etc.)
  const directionals = new Set(['n', 's', 'e', 'w', 'north', 'south', 'east', 'west'])
  if (directionals.has(t1) && t2) return `${num}|${t2}`
  return t2 ? `${num}|${t1}` : `${num}|${t1}`
}

// Alias-tolerant builder normalization. "Pulte" === "Pulte Homes" === "PulteGroup".
// Returns an array of canonical tokens for an ILIKE match.
function builderCanonicalTokens(raw) {
  if (!raw) return []
  const s = String(raw).toLowerCase()
  // take first meaningful word (strip things like "homes", "group", "inc", "llc")
  const stops = new Set([
    'homes', 'home', 'group', 'inc', 'llc', 'ltd', 'co', 'company',
    'builders', 'residential', 'construction', 'custom', 'of', 'and', '&',
    'the', 'usa',
  ])
  const tokens = s.split(/[^a-z0-9]+/).filter(Boolean).filter((t) => !stops.has(t))
  return tokens
}

function builderCanonicalKey(raw) {
  const t = builderCanonicalTokens(raw)
  return t[0] || String(raw || '').toLowerCase().trim()
}

function pct(n, d) {
  if (!d) return '0.0%'
  return `${((n / d) * 100).toFixed(1)}%`
}

// ── Step 0: ensure Job.orderIdMatchMethod column exists ────────────────────

async function ensureMatchMethodColumn() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Job"
      ADD COLUMN IF NOT EXISTS "orderIdMatchMethod" TEXT
  `)
}

// ── Step 1: load orphan jobs ───────────────────────────────────────────────

async function loadOrphans() {
  return prisma.$queryRawUnsafe(`
    SELECT
      j."id",
      j."jobNumber",
      j."builderName",
      j."bwpPoNumber",
      j."hyphenJobId",
      j."boltJobId",
      j."inflowJobId",
      j."jobAddress",
      j."scheduledDate",
      j."status"::text AS status
    FROM "Job" j
    WHERE j."orderId" IS NULL
      AND j."status"::text IN ${ACTIVE_IN}
  `)
}

// ── Matcher 1: PO number ───────────────────────────────────────────────────

async function matchByPoNumber(jobs) {
  const withPo = jobs.filter((j) => j.bwpPoNumber)
  if (withPo.length === 0) return new Map()
  const pos = [...new Set(withPo.map((j) => j.bwpPoNumber))]
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id", "poNumber" FROM "Order" WHERE "poNumber" = ANY($1::text[])`,
    pos,
  )
  const byPo = new Map(rows.map((r) => [r.poNumber, r.id]))
  const out = new Map()
  for (const j of withPo) {
    const oid = byPo.get(j.bwpPoNumber)
    if (oid) out.set(j.id, oid)
  }
  return out
}

// ── Matcher 2: Hyphen ──────────────────────────────────────────────────────

async function matchByHyphen(jobs) {
  const out = new Map()

  // 2a — direct via Job.hyphenJobId = HyphenOrder.jobId
  const withHyph = jobs.filter((j) => j.hyphenJobId)
  if (withHyph.length > 0) {
    const ids = [...new Set(withHyph.map((j) => j.hyphenJobId))]
    const rows = await prisma.$queryRawUnsafe(
      `SELECT h."jobId" AS hjob, o."id" AS order_id
         FROM "HyphenOrder" h
         JOIN "Order" o ON o."orderNumber" = h."refOrderId"
                        OR o."orderNumber" = h."builderOrderNum"
        WHERE h."jobId" = ANY($1::text[])`,
      ids,
    )
    const byHyph = new Map(rows.map((r) => [r.hjob, r.order_id]))
    for (const j of withHyph) {
      const oid = byHyph.get(j.hyphenJobId)
      if (oid) out.set(j.id, oid)
    }
  }

  // 2b — fuzzy via HyphenOrder.address + builderName ILIKE
  const remaining = jobs.filter((j) => !out.has(j.id) && j.jobAddress)
  if (remaining.length === 0) return out

  // Pull all hyphen addrs once.
  const hyphRows = await prisma.$queryRawUnsafe(`
    SELECT h."refOrderId", h."builderOrderNum", h."address", h."builderName", o."id" AS order_id
      FROM "HyphenOrder" h
      LEFT JOIN "Order" o ON o."orderNumber" = h."refOrderId"
                          OR o."orderNumber" = h."builderOrderNum"
     WHERE h."address" IS NOT NULL AND o."id" IS NOT NULL
  `)

  // Index by (normalizedAddress, builderName lower)
  const byKey = new Map()
  for (const h of hyphRows) {
    const naddr = normalizeAddress(h.address)
    if (naddr.length < 8) continue
    const builder = String(h.builderName || '').toLowerCase()
    const key = `${naddr}|${builder}`
    if (!byKey.has(key)) byKey.set(key, h.order_id)
  }

  for (const j of remaining) {
    const naddr = normalizeAddress(j.jobAddress)
    if (naddr.length < 8) continue
    const builder = String(j.builderName || '').toLowerCase()
    const key = `${naddr}|${builder}`
    const oid = byKey.get(key)
    if (oid) out.set(j.id, oid)
  }

  return out
}

// ── Matcher 3: Bolt ────────────────────────────────────────────────────────

async function matchByBolt(jobs) {
  const out = new Map()
  const byJobId = jobs.filter((j) => j.boltJobId)
  if (byJobId.length === 0) return out

  // BoltWorkOrderLink links Job <-> BoltWorkOrder. BoltWorkOrder has jobAddress
  // which we can try to match against Order.deliveryNotes. If Job already
  // appears in BoltWorkOrderLink we'll use that first.
  const jobIds = byJobId.map((j) => j.id)
  const links = await prisma.$queryRawUnsafe(
    `SELECT bwl."jobId" AS job_id,
            bwo."jobAddress" AS bwo_addr
       FROM "BoltWorkOrderLink" bwl
       JOIN "BoltWorkOrder" bwo ON bwo."id" = bwl."boltWorkOrderId"
      WHERE bwl."jobId" = ANY($1::text[])`,
    jobIds,
  )
  // First: try an address-match from the Bolt side.
  if (links.length > 0) {
    const addrKeys = [...new Set(links.map((l) => normalizeAddress(l.bwo_addr)).filter((a) => a.length >= 10))]
    if (addrKeys.length > 0) {
      // Pull all Orders with a deliveryNotes and compare normalized.
      const orderRows = await prisma.$queryRawUnsafe(
        `SELECT o."id", o."deliveryNotes", o."builderId"
           FROM "Order" o
          WHERE o."deliveryNotes" IS NOT NULL`,
      )
      const byAddrKey = new Map()
      for (const r of orderRows) {
        const naddr = normalizeAddress(r.deliveryNotes)
        if (naddr.length < 10) continue
        for (const key of addrKeys) {
          if (naddr === key || naddr.includes(key)) {
            if (!byAddrKey.has(key)) byAddrKey.set(key, r.id)
          }
        }
      }
      const byJob = new Map()
      for (const l of links) {
        const key = normalizeAddress(l.bwo_addr)
        const oid = byAddrKey.get(key)
        if (oid && !byJob.has(l.job_id)) byJob.set(l.job_id, oid)
      }
      for (const j of byJobId) {
        const oid = byJob.get(j.id)
        if (oid) out.set(j.id, oid)
      }
    }
  }

  return out
}

// ── Matcher 4: InFlow ──────────────────────────────────────────────────────

async function matchByInflow(jobs) {
  const withInflow = jobs.filter((j) => j.inflowJobId)
  if (withInflow.length === 0) return new Map()
  const ids = [...new Set(withInflow.map((j) => j.inflowJobId))]
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id", "inflowOrderId" FROM "Order" WHERE "inflowOrderId" = ANY($1::text[])`,
    ids,
  )
  const byInflow = new Map(rows.map((r) => [r.inflowOrderId, r.id]))
  const out = new Map()
  for (const j of withInflow) {
    const oid = byInflow.get(j.inflowJobId)
    if (oid) out.set(j.id, oid)
  }
  return out
}

// ── Matcher 5: Address + builder (fuzzy, low confidence) ───────────────────

async function matchByAddressFuzzy(jobs) {
  const out = new Map()
  const candidates = jobs.filter((j) => j.jobAddress && j.builderName)
  if (candidates.length === 0) return out

  // Load all Orders that have a deliveryNotes + builder we can resolve.
  const rows = await prisma.$queryRawUnsafe(`
    SELECT o."id" AS order_id,
           o."deliveryNotes",
           o."orderDate",
           b."companyName" AS builder_name
      FROM "Order" o
      JOIN "Builder" b ON b."id" = o."builderId"
     WHERE o."deliveryNotes" IS NOT NULL
  `)

  // Index by (canonical builder key) -> map<streetKey, [{order_id, orderDate, naddr}]>
  // We keep every candidate for a street key because a builder may have shipped
  // the same address multiple times (each shipment is its own Order).
  const byBuilder = new Map()
  for (const r of rows) {
    const bkey = builderCanonicalKey(r.builder_name)
    if (!bkey) continue
    if (!byBuilder.has(bkey)) byBuilder.set(bkey, new Map())
    const sub = byBuilder.get(bkey)

    const skey = addressStreetKey(r.deliveryNotes)
    if (skey) {
      if (!sub.has(skey)) sub.set(skey, [])
      sub.get(skey).push({
        order_id: r.order_id,
        orderDate: r.orderDate,
        naddr: normalizeAddress(r.deliveryNotes),
      })
    }
    // Also index by normalized full address for exact match fallback.
    const naddr = normalizeAddress(r.deliveryNotes)
    if (naddr.length >= 10) {
      const fullKey = `__full__${naddr}`
      if (!sub.has(fullKey)) sub.set(fullKey, [])
      sub.get(fullKey).push({ order_id: r.order_id, orderDate: r.orderDate, naddr })
    }
  }

  for (const j of candidates) {
    const bkey = builderCanonicalKey(j.builderName)
    const sub = byBuilder.get(bkey)
    if (!sub) continue

    const skey = addressStreetKey(j.jobAddress)
    const jNaddr = normalizeAddress(j.jobAddress)
    const jLoose = normalizeAddressLoose(j.jobAddress)

    // 1. Exact normalized-address match (tightest)
    const exact = sub.get(`__full__${jNaddr}`)
    if (exact && exact.length > 0) {
      out.set(j.id, exact[0].order_id)
      continue
    }

    // 2. Street-key (house-number + primary street token) match
    if (skey) {
      const bucket = sub.get(skey)
      if (bucket && bucket.length > 0) {
        // If multiple candidates, prefer the one whose orderDate is closest
        // to j.scheduledDate. That's a meaningful signal since Pulte ships
        // the same address multiple times over years.
        let pick = bucket[0]
        if (bucket.length > 1 && j.scheduledDate) {
          const target = new Date(j.scheduledDate).getTime()
          let best = Infinity
          for (const b of bucket) {
            const od = b.orderDate ? new Date(b.orderDate).getTime() : null
            if (od == null) continue
            const d = Math.abs(od - target)
            if (d < best) { best = d; pick = b }
          }
        }
        out.set(j.id, pick.order_id)
        continue
      }
    }

    // 3. Substring — Order addr contains job loose addr, or vice versa.
    if (jLoose.length >= 10) {
      for (const [key, bucket] of sub) {
        if (!key.startsWith('__full__')) continue
        for (const b of bucket) {
          if (b.naddr.includes(jLoose) || jLoose.includes(b.naddr)) {
            out.set(j.id, b.order_id)
            break
          }
        }
        if (out.has(j.id)) break
      }
    }
  }

  return out
}

// ── Step 2: run matchers in priority order ─────────────────────────────────

async function runMatchers(orphans) {
  const assigned = new Map() // jobId -> { orderId, method }

  const apply = (map, method) => {
    let n = 0
    for (const [jid, oid] of map) {
      if (!assigned.has(jid)) {
        assigned.set(jid, { orderId: oid, method })
        n++
      }
    }
    return n
  }

  const m1 = await matchByPoNumber(orphans)
  const n1 = apply(m1, 'po')

  const remaining1 = orphans.filter((j) => !assigned.has(j.id))
  const m2 = await matchByHyphen(remaining1)
  const n2 = apply(m2, 'hyphen')

  const remaining2 = orphans.filter((j) => !assigned.has(j.id))
  const m3 = await matchByBolt(remaining2)
  const n3 = apply(m3, 'bolt')

  const remaining3 = orphans.filter((j) => !assigned.has(j.id))
  const m4 = await matchByInflow(remaining3)
  const n4 = apply(m4, 'inflow')

  const remaining4 = orphans.filter((j) => !assigned.has(j.id))
  const m5 = await matchByAddressFuzzy(remaining4)
  const n5 = apply(m5, 'address_fuzzy')

  return { assigned, breakdown: { po: n1, hyphen: n2, bolt: n3, inflow: n4, address_fuzzy: n5 } }
}

// ── Step 3: write + re-allocate ────────────────────────────────────────────

async function writeAssignments(assigned) {
  const entries = [...assigned.entries()]
  let updated = 0
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100)
    await prisma.$transaction(
      chunk.map(([jobId, { orderId, method }]) =>
        prisma.$executeRawUnsafe(
          `UPDATE "Job"
             SET "orderId" = $1,
                 "orderIdMatchMethod" = $2,
                 "updatedAt" = NOW()
           WHERE "id" = $3
             AND "orderId" IS NULL`,
          orderId,
          method,
          jobId,
        ),
      ),
    )
    updated += chunk.length
    console.log(`  wrote ${updated}/${entries.length}`)
  }
  return updated
}

async function reallocateJobs(jobIds) {
  // Inline allocateForJob — replicate the SQL from src/lib/allocation/allocate.ts
  // so we don't drag in the TS import toolchain. Same semantics (idempotent
  // INSERT, ON CONFLICT DO NOTHING for active statuses).
  let allocated = 0
  let backordered = 0
  let skipped = 0
  let allocRowsBefore = 0
  let allocRowsAfter = 0

  const pre = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "InventoryAllocation"`)
  allocRowsBefore = pre[0].n

  for (const jobId of jobIds) {
    try {
      const res = await allocateForJobInline(jobId)
      allocated += res.allocated
      backordered += res.backordered
      if (res.skipped) skipped++
    } catch (e) {
      if (VERBOSE) console.log(`  alloc error for ${jobId}: ${e.message}`)
    }
  }

  const post = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "InventoryAllocation"`)
  allocRowsAfter = post[0].n

  return { allocated, backordered, skipped, allocRowsBefore, allocRowsAfter }
}

async function allocateForJobInline(jobId) {
  const base = { allocated: 0, backordered: 0, skipped: false, reason: null }
  const jobRows = await prisma.$queryRawUnsafe(
    `SELECT "id","orderId","status"::text AS status FROM "Job" WHERE "id" = $1 LIMIT 1`,
    jobId,
  )
  if (jobRows.length === 0) return { ...base, skipped: true, reason: 'job_not_found' }
  const job = jobRows[0]
  if (!job.orderId) return { ...base, skipped: true, reason: 'no_order_linked' }
  if (['CLOSED', 'COMPLETE', 'INVOICED', 'DELIVERED'].includes(String(job.status))) {
    return { ...base, skipped: true, reason: `terminal_status:${job.status}` }
  }

  const lines = await prisma.$queryRawUnsafe(
    `
    WITH RECURSIVE
    job_demand AS (
      SELECT oi."productId" AS product_id, oi."quantity"::float AS qty, 0 AS depth
        FROM "Job" j
        JOIN "OrderItem" oi ON oi."orderId" = j."orderId"
       WHERE j."id" = $1
      UNION ALL
      SELECT b."componentId", jd.qty * b."quantity", jd.depth + 1
        FROM job_demand jd
        JOIN "BomEntry" b ON b."parentId" = jd.product_id
       WHERE jd.depth < 4
    ),
    has_children AS (
      SELECT DISTINCT "parentId" AS product_id FROM "BomEntry"
    )
    SELECT jd.product_id AS "productId", SUM(jd.qty)::int AS quantity
      FROM job_demand jd
      LEFT JOIN has_children hc ON hc.product_id = jd.product_id
     WHERE (hc.product_id IS NULL OR jd.depth > 0)
       AND jd.product_id IS NOT NULL
     GROUP BY jd.product_id
     HAVING SUM(jd.qty)::int > 0
    `,
    jobId,
  )
  if (lines.length === 0) return { ...base, skipped: true, reason: 'no_demand' }

  const productIds = lines.map((l) => l.productId)
  const invRows = await prisma.$queryRawUnsafe(
    `SELECT "productId",
            COALESCE("onHand",0)::int AS on_hand,
            COALESCE("available",0)::int AS available
       FROM "InventoryItem"
      WHERE "productId" = ANY($1::text[])`,
    productIds,
  )
  const invByProd = new Map(invRows.map((r) => [r.productId, Number(r.available)]))

  const touched = new Set()
  let allocatedCount = 0
  let backorderedCount = 0

  for (const line of lines) {
    const need = Number(line.quantity) || 0
    if (need <= 0) continue
    const avail = invByProd.get(line.productId) ?? 0
    const canReserve = Math.min(need, Math.max(0, avail))
    const short = Math.max(0, need - canReserve)

    if (canReserve > 0) {
      const rowId = `ia_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      try {
        const ins = await prisma.$queryRawUnsafe(
          `INSERT INTO "InventoryAllocation"
             ("id","productId","orderId","jobId","quantity",
              "allocationType","status","allocatedBy",
              "allocatedAt","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,$5,'JOB','RESERVED','system-auto',NOW(),NOW(),NOW())
           ON CONFLICT ("jobId","productId")
             WHERE "status" IN ('RESERVED','PICKED','BACKORDERED')
           DO NOTHING
           RETURNING "id"`,
          rowId, line.productId, job.orderId, jobId, canReserve,
        )
        if (ins.length > 0) {
          touched.add(line.productId)
          allocatedCount++
        }
      } catch {}
    }
    if (short > 0) {
      const rowId = `ia_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      try {
        const ins = await prisma.$queryRawUnsafe(
          `INSERT INTO "InventoryAllocation"
             ("id","productId","orderId","jobId","quantity",
              "allocationType","status","allocatedBy","notes",
              "allocatedAt","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,$5,'JOB','BACKORDERED','system-auto',
                   'short by ' || $5 || ' at allocation time',
                   NOW(),NOW(),NOW())
           ON CONFLICT ("jobId","productId")
             WHERE "status" IN ('RESERVED','PICKED','BACKORDERED')
           DO NOTHING
           RETURNING "id"`,
          rowId, line.productId, job.orderId, jobId, short,
        )
        if (ins.length > 0) {
          touched.add(line.productId)
          backorderedCount++
        }
      } catch {}
    }
  }

  for (const pid of touched) {
    try {
      await prisma.$executeRawUnsafe(`SELECT recompute_inventory_committed($1)`, pid)
    } catch {
      // fallback
      await prisma.$executeRawUnsafe(
        `UPDATE "InventoryItem" ii
           SET "committed" = COALESCE((
                 SELECT SUM(ia."quantity") FROM "InventoryAllocation" ia
                  WHERE ia."productId" = ii."productId"
                    AND ia."status" IN ('RESERVED','PICKED')
               ), 0),
               "available" = GREATEST(COALESCE(ii."onHand",0) - COALESCE((
                 SELECT SUM(ia."quantity") FROM "InventoryAllocation" ia
                  WHERE ia."productId" = ii."productId"
                    AND ia."status" IN ('RESERVED','PICKED')
               ), 0), 0),
               "updatedAt" = NOW()
         WHERE ii."productId" = $1`,
        pid,
      )
    }
  }

  return { allocated: allocatedCount, backordered: backorderedCount, skipped: false }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now()
  console.log(`\n${'='.repeat(74)}`)
  console.log(`Job.orderId reconciliation — mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'}`)
  console.log(`${'='.repeat(74)}\n`)

  // 0. Make sure orderIdMatchMethod column exists. This is safe + idempotent
  // and needed even during dry run (for when --commit runs next).
  if (COMMIT) {
    await ensureMatchMethodColumn()
    console.log('orderIdMatchMethod column ensured\n')
  }

  // 1. Pull orphans
  const orphans = await loadOrphans()
  console.log(`Orphan active jobs (orderId IS NULL): ${orphans.length}`)

  const total = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "Job" WHERE "status"::text IN ${ACTIVE_IN}`)
  console.log(`Total active jobs                  : ${total[0].n}`)
  console.log(`Orphan rate                        : ${pct(orphans.length, total[0].n)}\n`)

  if (orphans.length === 0) {
    console.log('Nothing to reconcile. Done.')
    await prisma.$disconnect()
    return
  }

  // 2. Run matchers
  const { assigned, breakdown } = await runMatchers(orphans)

  console.log('─── Match breakdown ───')
  for (const [method, n] of Object.entries(breakdown)) {
    console.log(`  ${method.padEnd(15)} ${n}`)
  }
  console.log(`  ${'TOTAL matched'.padEnd(15)} ${assigned.size}`)
  console.log(`  ${'unmatched'.padEnd(15)} ${orphans.length - assigned.size}\n`)

  if (VERBOSE) {
    console.log('─── Sample matches (first 10) ───')
    let i = 0
    for (const [jid, v] of assigned) {
      if (i++ >= 10) break
      const j = orphans.find((o) => o.id === jid)
      console.log(`  ${v.method.padEnd(14)} ${j?.jobNumber || jid}  ${j?.builderName || '?'}  ${j?.jobAddress || '?'}  -> ${v.orderId}`)
    }
    console.log('')
  }

  // 3. Write or stay dry
  if (!COMMIT) {
    console.log('DRY RUN — no writes performed. Re-run with --commit to apply.')
    await prisma.$disconnect()
    return
  }

  console.log('─── Writing Job.orderId ───')
  const updated = await writeAssignments(assigned)
  console.log(`Updated ${updated} Job rows.\n`)

  // 4. Re-allocate newly linked jobs
  const finalOrphan = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n FROM "Job" WHERE "orderId" IS NULL AND "status"::text IN ${ACTIVE_IN}`)
  console.log(`Final orphan count (post-write): ${finalOrphan[0].n}\n`)

  if (SKIP_ALLOC) {
    console.log('Skipping re-allocation (--no-allocate).')
    await prisma.$disconnect()
    return
  }

  console.log('─── Re-running allocation for newly linked jobs ───')
  const newlyLinked = [...assigned.keys()]
  const allocRes = await reallocateJobs(newlyLinked)
  console.log(`  jobs processed           : ${newlyLinked.length}`)
  console.log(`  allocations created      : ${allocRes.allocated}`)
  console.log(`  backorder rows created   : ${allocRes.backordered}`)
  console.log(`  skipped (terminal/etc.)  : ${allocRes.skipped}`)
  console.log(`  InventoryAllocation before: ${allocRes.allocRowsBefore}`)
  console.log(`  InventoryAllocation after : ${allocRes.allocRowsAfter}`)
  console.log(`  delta                     : +${allocRes.allocRowsAfter - allocRes.allocRowsBefore}`)

  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
