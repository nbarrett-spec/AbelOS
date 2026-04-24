#!/usr/bin/env node
/**
 * scripts/resolve-vendor-ties.mjs
 *
 * Resolve the 57 SKUs that came out of `backfill-vendor-preferred.mjs` with
 * a tied PO count across two or more vendors in the last 12 months.
 *
 * TIEBREAK STACK (deterministic):
 *   1. ON-TIME RATE  — higher wins. Numerator: POs where receivedAt <=
 *      expectedDate. Denominator: POs with both timestamps set. Window: last
 *      12 months. Status excludes DRAFT + CANCELLED.
 *   2. LEAD TIME     — lower avg (receivedAt - orderedAt, days) wins.
 *   3. ALPHABETICAL  — lower vendor name wins (case-insensitive). Pure
 *      tiebreak of last resort so output is stable.
 *
 * ── WRITES (when --commit) ──
 *   - UPDATE VendorProduct.preferred=true on the winner for each tied SKU
 *   - UPDATE VendorProduct.preferred=false on the losers for that SKU
 *   - INSERT InboxItem (type=VENDOR_TIEBREAK_AUTO_PICK) so Nate can review
 *     each auto-decision before it hardens.
 *
 * Safe to re-run: the preferred flip is idempotent. Re-running will not
 * duplicate InboxItems because we dedupe on (entityType=Product, entityId,
 * type=VENDOR_TIEBREAK_AUTO_PICK) before insert.
 *
 * ── USAGE ──
 *   node scripts/resolve-vendor-ties.mjs              # dry-run (default)
 *   node scripts/resolve-vendor-ties.mjs --commit     # apply writes
 *   node scripts/resolve-vendor-ties.mjs --report-out path/to.csv
 *   node scripts/resolve-vendor-ties.mjs --csv path/to/_backfill-report.csv
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
const csvIdx = argv.indexOf('--csv')
const CSV_IN =
  csvIdx >= 0 && argv[csvIdx + 1]
    ? resolve(argv[csvIdx + 1])
    : resolve(REPO_ROOT, 'scripts', '_backfill-vendor-preferred-report.csv')
const reportIdx = argv.indexOf('--report-out')
const REPORT_OUT =
  reportIdx >= 0 && argv[reportIdx + 1]
    ? resolve(argv[reportIdx + 1])
    : resolve(REPO_ROOT, 'scripts', '_resolve-vendor-ties-report.csv')

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

// Minimal CSV line splitter that respects quoted fields + escaped quotes.
function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i += 1
      } else if (c === '"') {
        inQ = false
      } else {
        cur += c
      }
    } else {
      if (c === '"') inQ = true
      else if (c === ',') {
        out.push(cur)
        cur = ''
      } else cur += c
    }
  }
  out.push(cur)
  return out
}

// ── main ──
async function main() {
  bar('Resolve tied vendor preferred via on-time + lead-time heuristic')
  console.log(`  Mode:         ${DRY_RUN ? 'DRY-RUN (no writes)' : 'COMMIT (will write)'}`)
  console.log(`  CSV in:       ${CSV_IN}`)
  console.log(`  Report out:   ${REPORT_OUT}`)

  if (!existsSync(CSV_IN)) {
    throw new Error(`Input CSV not found: ${CSV_IN}. Run backfill-vendor-preferred.mjs first.`)
  }

  // ── parse CSV ──
  bar('Parse ties from CSV')
  const text = readFileSync(CSV_IN, 'utf8')
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  const header = parseCsvLine(lines[0])
  const col = (name) => header.indexOf(name)
  const idxType = col('type')
  const idxProductId = col('product_id')
  const idxProductSku = col('product_sku')
  const idxProductName = col('product_name')
  const idxAllCandidates = col('all_candidates')

  /** @type {{productId:string, productSku:string, productName:string, candidates:{vendorName:string, poCount:number}[]}[]} */
  const ties = []
  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i])
    if (row[idxType] !== 'tie') continue
    const allCand = row[idxAllCandidates] || ''
    const candidates = allCand
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        // "VendorName:count" — vendor name can contain colons so rsplit once.
        const lastColon = s.lastIndexOf(':')
        if (lastColon < 0) return { vendorName: s, poCount: 0 }
        return {
          vendorName: s.slice(0, lastColon).trim(),
          poCount: parseInt(s.slice(lastColon + 1).trim(), 10) || 0,
        }
      })
    // The "tie" set is the vendors whose count equals the max.
    const top = Math.max(...candidates.map((c) => c.poCount))
    const tied = candidates.filter((c) => c.poCount === top)
    ties.push({
      productId: row[idxProductId],
      productSku: row[idxProductSku],
      productName: row[idxProductName],
      candidates: tied,
    })
  }
  console.log(`  Ties parsed from CSV:  ${ties.length}`)
  if (ties.length === 0) {
    console.log('  Nothing to do.')
    return
  }

  // ── resolve vendor IDs for every distinct candidate vendor name ──
  bar('Resolve vendor names → IDs')
  const allNames = [...new Set(ties.flatMap((t) => t.candidates.map((c) => c.vendorName)))]
  const vendorRows = await sql`
    SELECT id, name, code
    FROM "Vendor"
    WHERE name = ANY(${allNames}::text[])
  `
  /** @type {Map<string, {id:string, code:string|null}>} */
  const byName = new Map()
  for (const v of vendorRows) byName.set(v.name, { id: v.id, code: v.code })
  const missing = allNames.filter((n) => !byName.has(n))
  if (missing.length) {
    console.warn(`  WARN — could not resolve ${missing.length} vendor name(s): ${missing.join(', ')}`)
  }
  console.log(`  Distinct tied vendor names: ${allNames.length}`)
  console.log(`  Resolved to IDs:            ${vendorRows.length}`)

  // ── compute per-vendor on-time + avg-lead metrics (one query covers all) ──
  bar('Compute on-time rate + avg lead days per tied vendor (12-month window)')
  const vendorIds = vendorRows.map((v) => v.id)
  const perf = await sql`
    WITH eligible AS (
      SELECT
        po."vendorId"                         AS vendor_id,
        po."orderedAt"                        AS ordered_at,
        po."expectedDate"                     AS expected_at,
        po."receivedAt"                       AS received_at
      FROM "PurchaseOrder" po
      WHERE po."vendorId" = ANY(${vendorIds}::text[])
        AND po."orderedAt" >= (NOW() - INTERVAL '12 months')
        AND po.status NOT IN ('DRAFT', 'CANCELLED')
    )
    SELECT
      vendor_id,
      COUNT(*) FILTER (WHERE received_at IS NOT NULL AND expected_at IS NOT NULL)::int AS ontime_denom,
      COUNT(*) FILTER (
        WHERE received_at IS NOT NULL
          AND expected_at IS NOT NULL
          AND received_at <= expected_at
      )::int AS ontime_num,
      AVG(
        EXTRACT(EPOCH FROM (received_at - ordered_at)) / 86400.0
      ) FILTER (
        WHERE received_at IS NOT NULL
          AND received_at > ordered_at
      ) AS avg_lead_days
    FROM eligible
    GROUP BY vendor_id
  `
  /** @type {Map<string, {ontimeRate:number|null, ontimeDenom:number, avgLead:number|null}>} */
  const byVendor = new Map()
  for (const p of perf) {
    byVendor.set(p.vendor_id, {
      ontimeRate: p.ontime_denom > 0 ? p.ontime_num / p.ontime_denom : null,
      ontimeDenom: p.ontime_denom,
      avgLead: p.avg_lead_days != null ? Number(p.avg_lead_days) : null,
    })
  }
  console.log(`  Vendors with PO performance data: ${perf.length}/${vendorIds.length}`)

  // ── compute recent PO spend per tied SKU (for "top 5 for Nate's eye") ──
  bar('Compute recent PO spend per tied SKU')
  const tiedProductIds = ties.map((t) => t.productId)
  const spendRows = await sql`
    SELECT
      poi."productId"          AS product_id,
      SUM(poi."lineTotal")::float AS recent_spend
    FROM "PurchaseOrderItem" poi
    JOIN "PurchaseOrder" po ON po.id = poi."purchaseOrderId"
    WHERE poi."productId" = ANY(${tiedProductIds}::text[])
      AND po."orderedAt" >= (NOW() - INTERVAL '12 months')
      AND po.status NOT IN ('DRAFT', 'CANCELLED')
    GROUP BY poi."productId"
  `
  /** @type {Map<string, number>} */
  const spendByProduct = new Map()
  for (const r of spendRows) spendByProduct.set(r.product_id, Number(r.recent_spend || 0))

  // ── apply tiebreaks ──
  bar('Apply tiebreaks')
  /**
   * @typedef {Object} Decision
   * @property {string} productId
   * @property {string} productSku
   * @property {string} productName
   * @property {'on-time'|'lead-time'|'alphabetical'|'unresolvable'} strategy
   * @property {{vendorId:string|null, vendorName:string, ontimeRate:number|null, ontimeDenom:number, avgLead:number|null}|null} winner
   * @property {{vendorId:string|null, vendorName:string, ontimeRate:number|null, ontimeDenom:number, avgLead:number|null}[]} losers
   * @property {number} recentSpend
   * @property {string} note
   */

  /** @type {Decision[]} */
  const decisions = []
  const strategyCounts = { 'on-time': 0, 'lead-time': 0, alphabetical: 0, unresolvable: 0 }

  for (const t of ties) {
    const enriched = t.candidates.map((c) => {
      const v = byName.get(c.vendorName)
      const stats = v ? byVendor.get(v.id) || { ontimeRate: null, ontimeDenom: 0, avgLead: null } : { ontimeRate: null, ontimeDenom: 0, avgLead: null }
      return {
        vendorId: v ? v.id : null,
        vendorName: c.vendorName,
        ontimeRate: stats.ontimeRate,
        ontimeDenom: stats.ontimeDenom,
        avgLead: stats.avgLead,
      }
    })

    // Skip SKUs where we couldn't resolve any vendor at all.
    if (enriched.every((e) => e.vendorId == null)) {
      decisions.push({
        productId: t.productId,
        productSku: t.productSku,
        productName: t.productName,
        strategy: 'unresolvable',
        winner: null,
        losers: enriched,
        recentSpend: spendByProduct.get(t.productId) || 0,
        note: 'No candidate vendor could be resolved in DB',
      })
      strategyCounts.unresolvable += 1
      continue
    }

    // Sort: ontime desc (null treated as -Infinity), avgLead asc (null as +Infinity),
    // name asc (case-insensitive).
    const sorted = [...enriched].sort((a, b) => {
      const ra = a.ontimeRate == null ? -Infinity : a.ontimeRate
      const rb = b.ontimeRate == null ? -Infinity : b.ontimeRate
      if (ra !== rb) return rb - ra
      const la = a.avgLead == null ? Infinity : a.avgLead
      const lb = b.avgLead == null ? Infinity : b.avgLead
      if (la !== lb) return la - lb
      return a.vendorName.toLowerCase().localeCompare(b.vendorName.toLowerCase())
    })

    const winner = sorted[0]
    const runner = sorted[1]
    let strategy = 'alphabetical'
    if (winner && runner) {
      const rw = winner.ontimeRate
      const rr = runner.ontimeRate
      if (rw != null && rr != null && rw !== rr) strategy = 'on-time'
      else if (rw != null && rr == null) strategy = 'on-time'
      else {
        const lw = winner.avgLead
        const lr = runner.avgLead
        if (lw != null && lr != null && lw !== lr) strategy = 'lead-time'
        else if (lw != null && lr == null) strategy = 'lead-time'
        else strategy = 'alphabetical'
      }
    }
    strategyCounts[strategy] += 1
    decisions.push({
      productId: t.productId,
      productSku: t.productSku,
      productName: t.productName,
      strategy,
      winner,
      losers: sorted.slice(1),
      recentSpend: spendByProduct.get(t.productId) || 0,
      note: '',
    })
  }

  console.log(`  Total ties:        ${ties.length}`)
  console.log(`    on-time wins:     ${strategyCounts['on-time']}`)
  console.log(`    lead-time wins:   ${strategyCounts['lead-time']}`)
  console.log(`    alphabetical:     ${strategyCounts.alphabetical}`)
  console.log(`    unresolvable:     ${strategyCounts.unresolvable}`)

  // ── top 5 highest-value tiebreaks ──
  bar("Top 5 tiebreaks by recent PO spend (for Nate's eye)")
  const resolvable = decisions.filter((d) => d.strategy !== 'unresolvable')
  const top5 = [...resolvable].sort((a, b) => b.recentSpend - a.recentSpend).slice(0, 5)
  for (let i = 0; i < top5.length; i += 1) {
    const d = top5[i]
    const w = d.winner
    const otStr =
      w.ontimeRate != null
        ? `${(w.ontimeRate * 100).toFixed(0)}% (n=${w.ontimeDenom})`
        : `no-data`
    const leadStr = w.avgLead != null ? `${w.avgLead.toFixed(1)}d` : '—'
    console.log(
      `  ${i + 1}. ${d.productSku.padEnd(12)} $${d.recentSpend.toFixed(0).padStart(8)}` +
        `  → ${w.vendorName}  [${d.strategy}]  ontime=${otStr}  lead=${leadStr}`,
    )
    console.log(`     ${d.productName.slice(0, 70)}`)
  }

  // ── write report ──
  bar('Write report')
  const header2 = [
    'product_id',
    'product_sku',
    'product_name',
    'recent_spend',
    'strategy',
    'winner_vendor_id',
    'winner_vendor',
    'winner_ontime_rate',
    'winner_ontime_denom',
    'winner_avg_lead',
    'losers',
    'note',
  ]
  const csv = [header2.map(csvEscape).join(',')]
  for (const d of decisions) {
    const w = d.winner || { vendorId: '', vendorName: '', ontimeRate: null, ontimeDenom: 0, avgLead: null }
    const losersStr = d.losers
      .map(
        (l) =>
          `${l.vendorName}(ot=${
            l.ontimeRate != null ? (l.ontimeRate * 100).toFixed(0) + '%' : 'n/a'
          },lead=${l.avgLead != null ? l.avgLead.toFixed(1) : 'n/a'})`,
      )
      .join(' | ')
    csv.push(
      [
        d.productId,
        d.productSku,
        d.productName,
        d.recentSpend.toFixed(2),
        d.strategy,
        w.vendorId || '',
        w.vendorName,
        w.ontimeRate != null ? w.ontimeRate.toFixed(3) : '',
        w.ontimeDenom,
        w.avgLead != null ? w.avgLead.toFixed(2) : '',
        losersStr,
        d.note,
      ]
        .map(csvEscape)
        .join(','),
    )
  }
  writeFileSync(REPORT_OUT, csv.join('\n') + '\n', 'utf8')
  console.log(`  Report written: ${REPORT_OUT}`)
  console.log(`  Rows: ${decisions.length}`)

  if (DRY_RUN) {
    bar('DRY-RUN — no writes')
    console.log('  Re-run with --commit to apply.')
    return
  }

  // ── COMMIT: write preferred flips + InboxItems ──
  bar('COMMIT: applying writes')
  const [{ n: preferredBefore }] = await sql`
    SELECT COUNT(*)::int AS n FROM "VendorProduct" WHERE preferred = true
  `
  console.log(`  preferred=true before: ${preferredBefore}`)

  let flipped = 0
  let upserted = 0
  let cleared = 0
  let inboxInserted = 0
  let inboxSkipped = 0
  let skipped = 0

  for (const d of decisions) {
    if (d.strategy === 'unresolvable' || !d.winner || !d.winner.vendorId) {
      skipped += 1
      continue
    }

    // Step 1: clear preferred on all losers for this product (and any other
    // VendorProduct rows for the product not in our winning pair).
    const clrRes = await sql`
      UPDATE "VendorProduct"
      SET preferred = false, "updatedAt" = NOW()
      WHERE "productId" = ${d.productId}
        AND "vendorId" <> ${d.winner.vendorId}
        AND preferred = true
    `
    if (Array.isArray(clrRes)) cleared += clrRes.length

    // Step 2: upsert the winner VendorProduct row with preferred=true and
    // leadTimeDays when we have it.
    const nowIso = new Date().toISOString()
    const vpId = cuid()
    const lead = d.winner.avgLead != null ? Math.round(d.winner.avgLead) : null
    if (lead != null) {
      await sql`
        INSERT INTO "VendorProduct" (
          id, "vendorId", "productId", "vendorSku",
          preferred, "leadTimeDays", "createdAt", "updatedAt"
        )
        VALUES (
          ${vpId}, ${d.winner.vendorId}, ${d.productId}, ${d.productSku},
          true, ${lead}, ${nowIso}::timestamp, ${nowIso}::timestamp
        )
        ON CONFLICT ("vendorId", "productId")
        DO UPDATE SET
          preferred = true,
          "leadTimeDays" = EXCLUDED."leadTimeDays",
          "updatedAt" = NOW()
      `
    } else {
      await sql`
        INSERT INTO "VendorProduct" (
          id, "vendorId", "productId", "vendorSku",
          preferred, "createdAt", "updatedAt"
        )
        VALUES (
          ${vpId}, ${d.winner.vendorId}, ${d.productId}, ${d.productSku},
          true, ${nowIso}::timestamp, ${nowIso}::timestamp
        )
        ON CONFLICT ("vendorId", "productId")
        DO UPDATE SET
          preferred = true,
          "updatedAt" = NOW()
      `
    }
    flipped += 1
    upserted += 1

    // Step 3: InboxItem so Nate can review. Dedupe on (entityId, type) so
    // re-runs don't pile up.
    const existing = await sql`
      SELECT id FROM "InboxItem"
      WHERE type = 'VENDOR_TIEBREAK_AUTO_PICK'
        AND "entityType" = 'Product'
        AND "entityId" = ${d.productId}
        AND status = 'PENDING'
      LIMIT 1
    `
    if (existing.length) {
      inboxSkipped += 1
      continue
    }
    const inboxId = cuid()
    const actionData = {
      productId: d.productId,
      productSku: d.productSku,
      productName: d.productName,
      strategy: d.strategy,
      recentSpend: d.recentSpend,
      winner: {
        vendorId: d.winner.vendorId,
        vendorName: d.winner.vendorName,
        ontimeRate: d.winner.ontimeRate,
        ontimeDenom: d.winner.ontimeDenom,
        avgLead: d.winner.avgLead,
      },
      losers: d.losers.map((l) => ({
        vendorId: l.vendorId,
        vendorName: l.vendorName,
        ontimeRate: l.ontimeRate,
        ontimeDenom: l.ontimeDenom,
        avgLead: l.avgLead,
      })),
    }
    const priority =
      d.recentSpend >= 10000 ? 'HIGH' : d.recentSpend >= 2000 ? 'MEDIUM' : 'LOW'
    const title = `Review auto-picked preferred vendor — ${d.productSku}`
    const desc =
      `Tied PO share between ${(d.losers.length + 1)} vendors. Auto-picked ` +
      `${d.winner.vendorName} via ${d.strategy}. ` +
      (d.winner.ontimeRate != null
        ? `Winner on-time: ${(d.winner.ontimeRate * 100).toFixed(0)}% (n=${d.winner.ontimeDenom}). `
        : `Winner on-time: no data. `) +
      (d.winner.avgLead != null ? `Avg lead: ${d.winner.avgLead.toFixed(1)}d.` : `Avg lead: —.`)
    await sql`
      INSERT INTO "InboxItem" (
        id, type, source, title, description, priority, status,
        "entityType", "entityId", "financialImpact", "actionData",
        "createdAt", "updatedAt"
      )
      VALUES (
        ${inboxId},
        'VENDOR_TIEBREAK_AUTO_PICK',
        'resolve-vendor-ties',
        ${title},
        ${desc},
        ${priority},
        'PENDING',
        'Product',
        ${d.productId},
        ${d.recentSpend},
        ${JSON.stringify(actionData)}::jsonb,
        NOW(),
        NOW()
      )
    `
    inboxInserted += 1
  }

  bar('Post-write verification')
  const [{ n: preferredAfter }] = await sql`
    SELECT COUNT(*)::int AS n FROM "VendorProduct" WHERE preferred = true
  `
  const [{ n: inboxTotal }] = await sql`
    SELECT COUNT(*)::int AS n FROM "InboxItem"
    WHERE type = 'VENDOR_TIEBREAK_AUTO_PICK' AND status = 'PENDING'
  `
  console.log(`  VendorProduct.preferred=true:  ${preferredBefore} → ${preferredAfter}  (+${preferredAfter - preferredBefore})`)
  console.log(`  Tiebreaks applied:             ${flipped}`)
  console.log(`  Losers demoted:                ${cleared}`)
  console.log(`  InboxItems inserted:           ${inboxInserted}  (skipped ${inboxSkipped} dupes)`)
  console.log(`  Skipped (unresolvable):        ${skipped}`)
  console.log(`  PENDING VENDOR_TIEBREAK_AUTO_PICK total: ${inboxTotal}`)
}

main().catch((err) => {
  console.error('\nFATAL:', err)
  process.exit(1)
})
