#!/usr/bin/env node
/**
 * scripts/backfill-vendor-preferred.mjs
 *
 * Backfill VendorProduct.preferred=true from historical PO data so the
 * ATP / SmartPO / shortage-forecast cron can auto-generate recs for the
 * whole catalog (not just Masonite).
 *
 * ── LOGIC ──────────────────────────────────────────────────────────────
 * For every Product that has PO history in the last 12 months:
 *   1. Group (productId, vendorId) from PurchaseOrderItem → PurchaseOrder
 *      restricted to po."orderedAt" >= NOW() - INTERVAL '12 months' and a
 *      status that represents a real purchase (everything except DRAFT +
 *      CANCELLED).
 *   2. Pick the vendor whose PO-volume (count of distinct POs that include
 *      this product) is the winner. A winner is defined as:
 *        - The only vendor we've bought it from, OR
 *        - The leader with >50% of PO-volume, OR
 *        - The leader with more than 5 POs.
 *   3. If two or more vendors tie (same count), emit to TIES report —
 *      do not set preferred.
 *   4. Products with no PO history in the window → emit to NO-HISTORY
 *      report. Leave preferred=false.
 *
 * Before setting new flags, this script CLEARS existing
 * VendorProduct.preferred for every product that will be touched by the
 * backfill (idempotent — no stale dual-preferred after re-run).
 *
 * Lead-days rolling mean:
 *   - We don't have PurchaseOrder.actualLeadDays populated yet (all null),
 *     so lead days are derived from receivedAt - orderedAt (in days) across
 *     POs in the 12-month window, averaged per (vendorId, productId), and
 *     written to VendorProduct.leadTimeDays (Int). Also upserts a
 *     VendorProduct row if one doesn't exist for the winning pair.
 *
 * ── USAGE ──────────────────────────────────────────────────────────────
 *   node scripts/backfill-vendor-preferred.mjs              # dry-run (default)
 *   node scripts/backfill-vendor-preferred.mjs --commit     # apply writes
 *   node scripts/backfill-vendor-preferred.mjs --commit --window-months 24
 *   node scripts/backfill-vendor-preferred.mjs --report-out ties.csv
 *
 * Safe to re-run. Only touches VendorProduct.preferred + leadTimeDays, and
 * creates VendorProduct rows when a winning (vendor, product) pair has no
 * existing row.
 */

import { neon } from '@neondatabase/serverless'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

// ── args ──
const argv = process.argv.slice(2)
const DRY_RUN = !argv.includes('--commit')
const windowIdx = argv.indexOf('--window-months')
const WINDOW_MONTHS =
  windowIdx >= 0 && argv[windowIdx + 1] ? parseInt(argv[windowIdx + 1], 10) : 12
const reportIdx = argv.indexOf('--report-out')
const REPORT_OUT =
  reportIdx >= 0 && argv[reportIdx + 1]
    ? resolve(argv[reportIdx + 1])
    : resolve(REPO_ROOT, 'scripts', '_backfill-vendor-preferred-report.csv')

// ── env ──
function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envPath = resolve(REPO_ROOT, '.env')
  if (!existsSync(envPath)) {
    throw new Error(`.env not found at ${envPath} and DATABASE_URL not set`)
  }
  const text = readFileSync(envPath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[1].trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    return v
  }
  throw new Error('DATABASE_URL not found in .env')
}

const DATABASE_URL = loadDatabaseUrl()
const sql = neon(DATABASE_URL)

// ── helpers ──
function bar(t) {
  console.log('\n' + '='.repeat(72))
  console.log('  ' + t)
  console.log('='.repeat(72))
}
function cuid() {
  return 'c' + randomBytes(12).toString('hex')
}
function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

// ── main ──
async function main() {
  bar('Backfill VendorProduct.preferred from PO history')
  console.log(`  Mode:           ${DRY_RUN ? 'DRY-RUN (no writes)' : 'COMMIT (will write)'}`)
  console.log(`  Window:         last ${WINDOW_MONTHS} months`)
  console.log(`  Report path:    ${REPORT_OUT}`)

  // ── snapshot: before counts ──
  bar('Before state')
  const [{ n: preferredBefore }] = await sql`
    SELECT COUNT(*)::int as n FROM "VendorProduct" WHERE preferred = true
  `
  const [{ n: totalVp }] = await sql`
    SELECT COUNT(*)::int as n FROM "VendorProduct"
  `
  const [{ n: totalProducts }] = await sql`
    SELECT COUNT(*)::int as n FROM "Product"
  `
  const [{ n: totalVendors }] = await sql`
    SELECT COUNT(*)::int as n FROM "Vendor"
  `
  console.log(`  Products:                 ${totalProducts}`)
  console.log(`  Vendors:                  ${totalVendors}`)
  console.log(`  VendorProduct rows:       ${totalVp}`)
  console.log(`  VendorProduct.preferred:  ${preferredBefore}`)

  // ── compute winners ──
  bar('Compute winners (single SQL CTE)')
  // A PO "counts" if it has orderedAt within window AND status in
  // (RECEIVED, SENT_TO_VENDOR, APPROVED, PENDING_APPROVAL). We exclude
  // DRAFT + CANCELLED because they don't represent a real vendor choice.
  //
  // For each (productId, vendorId): PO-count = DISTINCT PO ids. Summed
  // line quantity is tracked too for tiebreak visibility.
  //
  // avgLeadDays per (productId, vendorId) = AVG(receivedAt - orderedAt)
  // in days across POs in-window with both timestamps set. Null otherwise.
  const rows = await sql`
    WITH recent_po AS (
      SELECT
        po.id          AS po_id,
        po."vendorId"  AS vendor_id,
        po."orderedAt" AS ordered_at,
        po."receivedAt" AS received_at
      FROM "PurchaseOrder" po
      WHERE po."orderedAt" IS NOT NULL
        AND po."orderedAt" >= (NOW() - (${WINDOW_MONTHS} || ' months')::interval)
        AND po.status NOT IN ('DRAFT', 'CANCELLED')
    ),
    pair AS (
      SELECT
        poi."productId"          AS product_id,
        rp.vendor_id             AS vendor_id,
        COUNT(DISTINCT rp.po_id) AS po_count,
        SUM(poi.quantity)::int   AS qty_sum,
        AVG(
          EXTRACT(EPOCH FROM (rp.received_at - rp.ordered_at)) / 86400.0
        ) FILTER (
          WHERE rp.received_at IS NOT NULL
            AND rp.received_at > rp.ordered_at
        ) AS avg_lead_days
      FROM "PurchaseOrderItem" poi
      JOIN recent_po rp ON rp.po_id = poi."purchaseOrderId"
      WHERE poi."productId" IS NOT NULL
      GROUP BY poi."productId", rp.vendor_id
    ),
    ranked AS (
      SELECT
        p.product_id,
        p.vendor_id,
        p.po_count,
        p.qty_sum,
        p.avg_lead_days,
        SUM(p.po_count)       OVER (PARTITION BY p.product_id) AS total_po,
        COUNT(*)              OVER (PARTITION BY p.product_id) AS vendor_ct,
        MAX(p.po_count)       OVER (PARTITION BY p.product_id) AS leader_po,
        ROW_NUMBER() OVER (
          PARTITION BY p.product_id
          ORDER BY p.po_count DESC, p.qty_sum DESC, p.vendor_id ASC
        ) AS rk
      FROM pair p
    )
    SELECT
      r.product_id,
      r.vendor_id,
      r.po_count::int      AS po_count,
      r.qty_sum::int       AS qty_sum,
      r.avg_lead_days::float AS avg_lead_days,
      r.total_po::int      AS total_po,
      r.vendor_ct::int     AS vendor_ct,
      r.leader_po::int     AS leader_po,
      r.rk::int            AS rk,
      pr.sku               AS product_sku,
      pr.name              AS product_name,
      v.name               AS vendor_name,
      v.code               AS vendor_code,
      -- detect tie at the top: second row has same po_count as leader
      (SELECT po_count FROM ranked r2
        WHERE r2.product_id = r.product_id AND r2.rk = 2) AS second_po
    FROM ranked r
    JOIN "Product" pr ON pr.id = r.product_id
    JOIN "Vendor"  v  ON v.id  = r.vendor_id
    ORDER BY r.product_id, r.rk
  `
  console.log(`  Product-vendor pair rows: ${rows.length}`)

  // ── classify ──
  const byProduct = new Map()
  for (const r of rows) {
    if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, [])
    byProduct.get(r.product_id).push(r)
  }

  const winners = [] // {productId, vendorId, poCount, totalPo, leadDays, pct, productSku, vendorName}
  const ties = []   // {productId, productSku, productName, candidates: [{vendorId, vendorName, poCount}]}
  for (const [productId, list] of byProduct) {
    const leader = list[0]
    const leaderPct = leader.po_count / leader.total_po
    const isTie =
      leader.vendor_ct > 1 &&
      leader.second_po != null &&
      Number(leader.second_po) === Number(leader.po_count)
    const wins =
      !isTie &&
      (leader.vendor_ct === 1 || leaderPct > 0.5 || leader.po_count > 5)
    if (isTie || !wins) {
      ties.push({
        productId,
        productSku: leader.product_sku,
        productName: leader.product_name,
        totalPo: leader.total_po,
        leader: {
          vendorId: leader.vendor_id,
          vendorName: leader.vendor_name,
          poCount: leader.po_count,
          pct: leaderPct,
        },
        candidates: list.map((r) => ({
          vendorId: r.vendor_id,
          vendorName: r.vendor_name,
          poCount: r.po_count,
        })),
      })
      continue
    }
    winners.push({
      productId,
      vendorId: leader.vendor_id,
      poCount: leader.po_count,
      totalPo: leader.total_po,
      pct: leaderPct,
      leadDays:
        leader.avg_lead_days != null ? Math.round(leader.avg_lead_days) : null,
      productSku: leader.product_sku,
      productName: leader.product_name,
      vendorName: leader.vendor_name,
      vendorCode: leader.vendor_code,
      vendorCt: leader.vendor_ct,
    })
  }

  // Products with no PO history in window — find via a LEFT-ANTI
  const [{ n: productsWithAnyPoi }] = await sql`
    SELECT COUNT(DISTINCT poi."productId")::int AS n
    FROM "PurchaseOrderItem" poi
    WHERE poi."productId" IS NOT NULL
  `
  const noHistoryCount = totalProducts - byProduct.size
  console.log(`  Products w/ any PO line item:      ${productsWithAnyPoi}`)
  console.log(`  Products w/ history in window:     ${byProduct.size}`)
  console.log(`  Products w/ NO history in window:  ${noHistoryCount}`)
  console.log(`  Winners (clear preferred vendor):  ${winners.length}`)
  console.log(`  Ties (Nate decides):               ${ties.length}`)

  // ── 5 sample winners ──
  bar('Sample preferred assignments (first 5)')
  for (let i = 0; i < Math.min(5, winners.length); i += 1) {
    const w = winners[i]
    console.log(
      `  ${i + 1}. ${w.productSku.padEnd(16)} → ${w.vendorName}` +
        ` (${w.vendorCode})  ${w.poCount}/${w.totalPo} POs` +
        ` (${(w.pct * 100).toFixed(0)}%)` +
        (w.leadDays != null ? `  leadDays=${w.leadDays}` : `  leadDays=—`),
    )
  }

  // ── write report ──
  bar('Write report')
  const header = [
    'type',
    'product_id',
    'product_sku',
    'product_name',
    'vendor_id',
    'vendor_name',
    'vendor_code',
    'po_count',
    'total_po',
    'pct',
    'lead_days',
    'all_candidates',
  ]
  const csv = [header.map(csvEscape).join(',')]
  for (const w of winners) {
    csv.push(
      [
        'winner',
        w.productId,
        w.productSku,
        w.productName,
        w.vendorId,
        w.vendorName,
        w.vendorCode,
        w.poCount,
        w.totalPo,
        w.pct.toFixed(3),
        w.leadDays ?? '',
        '',
      ]
        .map(csvEscape)
        .join(','),
    )
  }
  for (const t of ties) {
    const candSummary = t.candidates
      .map((c) => `${c.vendorName}:${c.poCount}`)
      .join(' | ')
    csv.push(
      [
        'tie',
        t.productId,
        t.productSku,
        t.productName,
        t.leader.vendorId,
        t.leader.vendorName,
        '',
        t.leader.poCount,
        t.totalPo,
        t.leader.pct.toFixed(3),
        '',
        candSummary,
      ]
        .map(csvEscape)
        .join(','),
    )
  }
  writeFileSync(REPORT_OUT, csv.join('\n') + '\n', 'utf8')
  console.log(`  Report written: ${REPORT_OUT}`)
  console.log(`  Rows: ${csv.length - 1} (winners=${winners.length}, ties=${ties.length})`)

  if (DRY_RUN) {
    bar('DRY-RUN — no writes')
    console.log('  Re-run with --commit to apply.')
    await printSummary({
      preferredBefore,
      winnersCount: winners.length,
      tiesCount: ties.length,
      noHistoryCount,
      leadDaysCount: winners.filter((w) => w.leadDays != null).length,
    })
    return
  }

  // ── COMMIT: write in a transaction ──
  bar('COMMIT: applying writes')

  // Only clear preferred for products we're about to reassign — this
  // keeps previously-set preferreds for untouched products intact while
  // preventing stale dual-preferred for touched products.
  const winningProductIds = winners.map((w) => w.productId)
  if (winningProductIds.length === 0) {
    console.log('  No winners to write. Done.')
    return
  }

  let cleared = 0
  let upserted = 0
  let marked = 0
  let leadWritten = 0

  // Use begin() from neon for a single-connection transaction.
  // neon's serverless client auto-commits individual queries; we issue
  // the statements sequentially which is acceptable here (final state
  // is idempotent even if interrupted mid-run — re-running will converge).
  //
  // Step 1: clear preferred flag for products we're touching.
  const clrRes = await sql`
    UPDATE "VendorProduct"
    SET preferred = false, "updatedAt" = NOW()
    WHERE "productId" = ANY(${winningProductIds}::text[])
      AND preferred = true
  `
  cleared = clrRes.length != null ? clrRes.length : 0
  // neon returns [] for UPDATE; count via a follow-up query if needed. We
  // skip that — `cleared` reporting is informational.
  console.log(`  Step 1: cleared preferred flags (touched products): ${winningProductIds.length} products scanned`)

  // Step 2: upsert VendorProduct rows for winners (vendor,product) pairs —
  // handles case where no VendorProduct row exists for the winning pair.
  // We set preferred=true and leadTimeDays in one go.
  for (const w of winners) {
    const nowIso = new Date().toISOString()
    const cid = cuid()
    // Find existing vendorSku if there's a PurchaseOrderItem record —
    // fall back to product.sku if none. This keeps the NOT NULL contract
    // on VendorProduct.vendorSku even for fresh upserts.
    const fallbackSku = w.productSku
    if (w.leadDays != null) {
      await sql`
        INSERT INTO "VendorProduct" (
          id, "vendorId", "productId", "vendorSku",
          preferred, "leadTimeDays", "createdAt", "updatedAt"
        )
        VALUES (
          ${cid}, ${w.vendorId}, ${w.productId}, ${fallbackSku},
          true, ${w.leadDays}, ${nowIso}::timestamp, ${nowIso}::timestamp
        )
        ON CONFLICT ("vendorId", "productId")
        DO UPDATE SET
          preferred = true,
          "leadTimeDays" = EXCLUDED."leadTimeDays",
          "updatedAt" = NOW()
      `
      leadWritten += 1
    } else {
      await sql`
        INSERT INTO "VendorProduct" (
          id, "vendorId", "productId", "vendorSku",
          preferred, "createdAt", "updatedAt"
        )
        VALUES (
          ${cid}, ${w.vendorId}, ${w.productId}, ${fallbackSku},
          true, ${nowIso}::timestamp, ${nowIso}::timestamp
        )
        ON CONFLICT ("vendorId", "productId")
        DO UPDATE SET
          preferred = true,
          "updatedAt" = NOW()
      `
    }
    marked += 1
    if (marked % 100 === 0) {
      console.log(`    upserted ${marked}/${winners.length} ...`)
    }
  }
  upserted = marked

  bar('Post-write verification')
  const [{ n: preferredAfter }] = await sql`
    SELECT COUNT(*)::int as n FROM "VendorProduct" WHERE preferred = true
  `
  const [{ n: vpAfter }] = await sql`
    SELECT COUNT(*)::int as n FROM "VendorProduct"
  `
  const [{ n: leadAfter }] = await sql`
    SELECT COUNT(*)::int as n FROM "VendorProduct" WHERE "leadTimeDays" IS NOT NULL
  `
  console.log(`  VendorProduct rows:        ${totalVp} → ${vpAfter}`)
  console.log(`  preferred=true:            ${preferredBefore} → ${preferredAfter}`)
  console.log(`  leadTimeDays populated:    ${leadAfter}`)

  await printSummary({
    preferredBefore,
    preferredAfter,
    winnersCount: winners.length,
    tiesCount: ties.length,
    noHistoryCount,
    leadDaysCount: leadWritten,
    vpBefore: totalVp,
    vpAfter,
  })
}

async function printSummary(x) {
  bar('SUMMARY')
  console.log(`  preferred=true before:        ${x.preferredBefore}`)
  if (x.preferredAfter != null) {
    console.log(`  preferred=true after:         ${x.preferredAfter}`)
    console.log(`  Delta:                        +${x.preferredAfter - x.preferredBefore}`)
  }
  console.log(`  Products processed:           ${x.winnersCount + x.tiesCount}`)
  console.log(`  Preferred assigned (winners): ${x.winnersCount}`)
  console.log(`  Lead-days populated:          ${x.leadDaysCount}`)
  console.log(`  Ties (for Nate to decide):    ${x.tiesCount}`)
  console.log(`  Products w/ no PO history:    ${x.noHistoryCount}`)
  if (x.vpBefore != null) {
    console.log(`  VendorProduct rows:           ${x.vpBefore} → ${x.vpAfter}`)
  }
}

main().catch((err) => {
  console.error('\nFATAL:', err)
  process.exit(1)
})
