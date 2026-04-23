#!/usr/bin/env node
/**
 * scripts/refresh-inventory-from-inflow.mjs
 *
 * Refresh InventoryItem rows from the latest InFlow StockLevels export.
 *
 * SOURCE (freshest real-stock snapshot on disk, 2026-04-12 19:33):
 *   C:/Users/natha/OneDrive/Abel Lumber/InFlow_Upload_StockLevels.csv
 *
 * Columns: SKU, ProductName, Location, Sublocation, Quantity
 *
 * Why this source over the brain JSONL:
 *   - The brain JSONL carried 593 stock_level rows (what got loaded on 4/13).
 *   - This InFlow export dump is the raw pre-upload snapshot of InFlow's own
 *     stock ledger — ~3,034 SKU rows, including zero-stock items that
 *     weren't emitted into the JSONL.
 *   - Abel's live inventory lives in InFlow; this is the best offline mirror
 *     until the InFlow API sync cron is unpaused.
 *
 * WRITE SEMANTICS:
 *   - onHand    = row.Quantity (rounded to int; negatives clamped to 0)
 *   - committed = preserved on existing rows, 0 on insert
 *   - available = onHand - committed
 *   - location  = row.Location or 'Gainesville Warehouse'
 *   - status    = onHand > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK'
 *   - updatedAt = NOW()
 *
 * MATCH KEY: CSV SKU ↔ Product.sku (exact). Orphan SKUs (no matching
 * Product) are logged and skipped — this script does NOT create products.
 *
 * IDEMPOTENT: upserts via ON CONFLICT ("productId") DO UPDATE.
 *
 * Usage:
 *   node scripts/refresh-inventory-from-inflow.mjs               # dry-run
 *   node scripts/refresh-inventory-from-inflow.mjs --commit      # write
 *   node scripts/refresh-inventory-from-inflow.mjs --source PATH # override CSV
 */

import { neon } from '@neondatabase/serverless'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

// ── args ──
const argv = process.argv.slice(2)
const DRY_RUN = !argv.includes('--commit')
const srcIdx = argv.indexOf('--source')
const DEFAULT_SRC = resolve(
  REPO_ROOT,
  '..',
  'InFlow_Upload_StockLevels.csv',
)
const SOURCE_FILE =
  srcIdx >= 0 && argv[srcIdx + 1] ? resolve(argv[srcIdx + 1]) : DEFAULT_SRC

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
  console.log('\n' + '='.repeat(68))
  console.log('  ' + t)
  console.log('='.repeat(68))
}
function cuid() {
  return 'c' + randomBytes(12).toString('hex')
}

// Simple CSV line parser: handles quoted fields with commas and escaped
// doubled-double-quotes ("" -> ").
function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else {
      if (ch === ',') {
        out.push(cur)
        cur = ''
      } else if (ch === '"') {
        inQuotes = true
      } else {
        cur += ch
      }
    }
  }
  out.push(cur)
  return out
}

// ── main ──
async function main() {
  bar('Refresh InventoryItem from InFlow StockLevels export')
  console.log(`  Mode:   ${DRY_RUN ? 'DRY-RUN (no writes)' : 'COMMIT (will write)'}`)
  console.log(`  Source: ${SOURCE_FILE}`)

  if (!existsSync(SOURCE_FILE)) {
    console.error(`\nERROR: source CSV not found at ${SOURCE_FILE}`)
    process.exit(1)
  }

  // ── parse CSV ──
  let text = readFileSync(SOURCE_FILE, 'utf8')
  // strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)

  bar('Parse CSV')
  if (lines.length === 0) {
    console.error('ERROR: CSV is empty')
    process.exit(1)
  }

  const header = parseCsvLine(lines[0]).map((h) => h.trim())
  const idxSku = header.indexOf('SKU')
  const idxName = header.indexOf('ProductName')
  const idxLoc = header.indexOf('Location')
  const idxQty = header.indexOf('Quantity')
  if (idxSku < 0 || idxQty < 0) {
    console.error(`ERROR: CSV missing required columns (SKU, Quantity). Got: ${header.join(', ')}`)
    process.exit(1)
  }

  let scanned = 0
  let skippedNoSku = 0
  let skippedBadQty = 0
  let duplicateSku = 0
  const bySku = new Map() // sku → { sku, productName, location, quantity }

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i])
    scanned++
    const sku = (cols[idxSku] || '').trim()
    if (!sku) {
      skippedNoSku++
      continue
    }
    const qtyRaw = (cols[idxQty] || '').trim()
    const qty = Number(qtyRaw)
    if (!Number.isFinite(qty)) {
      skippedBadQty++
      continue
    }
    const rec = {
      sku,
      productName: idxName >= 0 ? (cols[idxName] || '').trim() : null,
      location: (idxLoc >= 0 ? (cols[idxLoc] || '').trim() : '') || 'Gainesville Warehouse',
      // onHand is int; clamp negatives (adjustment artefacts) to 0
      quantity: Math.max(0, Math.round(qty)),
    }
    // If a SKU appears twice (e.g., same SKU at two sublocations), sum the
    // quantities — InFlow stock can be split across locations/bins.
    const existing = bySku.get(sku)
    if (existing) {
      duplicateSku++
      existing.quantity += rec.quantity
    } else {
      bySku.set(sku, rec)
    }
  }
  console.log(`  Rows scanned:           ${scanned}`)
  console.log(`  Unique SKUs:            ${bySku.size}`)
  console.log(`  Duplicate SKU rows:     ${duplicateSku} (summed across sublocations)`)
  console.log(`  Skipped (blank sku):    ${skippedNoSku}`)
  console.log(`  Skipped (bad qty):      ${skippedBadQty}`)

  // ── before snapshot ──
  bar('Before snapshot')
  const beforeTotals = (
    await sql`SELECT COUNT(*)::int AS total,
                     COUNT(*) FILTER (WHERE "onHand" > 0)::int AS onhand_gt0
              FROM "InventoryItem"`
  )[0]
  console.log(`  InventoryItem total:     ${beforeTotals.total}`)
  console.log(`  InventoryItem onHand>0:  ${beforeTotals.onhand_gt0}`)

  // ── resolve SKUs to productId ──
  const skus = Array.from(bySku.keys())
  const products = await sql`
    SELECT id, sku, name, category
    FROM "Product"
    WHERE sku = ANY(${skus})
  `
  const productBySku = new Map(products.map((p) => [p.sku, p]))
  const matched = skus.filter((s) => productBySku.has(s))
  const orphans = skus.filter((s) => !productBySku.has(s))
  bar('SKU -> Product match')
  console.log(`  Matched:   ${matched.length}/${skus.length}`)
  console.log(`  Orphans:   ${orphans.length} (InFlow SKU has no Product row)`)
  if (orphans.length > 0) {
    console.log(`  First 15 orphans: ${orphans.slice(0, 15).join(', ')}`)
  }

  // ── plan ──
  const matchedPids = matched.map((s) => productBySku.get(s).id)
  const existingRows = matchedPids.length
    ? await sql`
        SELECT "productId", "onHand", committed
        FROM "InventoryItem"
        WHERE "productId" = ANY(${matchedPids})
      `
    : []
  const existingByPid = new Map(existingRows.map((r) => [r.productId, r]))
  let plannedUpdate = 0
  let plannedInsert = 0
  for (const sku of matched) {
    const p = productBySku.get(sku)
    if (existingByPid.has(p.id)) plannedUpdate++
    else plannedInsert++
  }
  bar('Plan')
  console.log(`  Upsert target SKUs:  ${matched.length}`)
  console.log(`    -> UPDATE existing: ${plannedUpdate}`)
  console.log(`    -> INSERT new:      ${plannedInsert}`)
  console.log(`  SKUs skipped (orphans): ${orphans.length}`)

  if (DRY_RUN) {
    bar('DRY-RUN complete - no writes')
    console.log('  Re-run with --commit to apply.')
    const preview = matched.slice(0, 5).map((sku) => {
      const p = productBySku.get(sku)
      const rec = bySku.get(sku)
      const cur = existingByPid.get(p.id)
      return {
        sku,
        name: (rec.productName || p.name || '').slice(0, 40),
        current_onHand: cur ? cur.onHand : null,
        new_onHand: rec.quantity,
        location: rec.location,
      }
    })
    console.table(preview)
    return
  }

  // ── commit ──
  bar('COMMIT - upserting InventoryItem rows')
  let updated = 0
  let inserted = 0
  for (const sku of matched) {
    const p = productBySku.get(sku)
    const rec = bySku.get(sku)
    const onHand = rec.quantity
    const location = rec.location || 'Gainesville Warehouse'
    const status = onHand > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK'
    const productName = rec.productName || p.name || null
    const category = p.category || null

    const result = await sql`
      INSERT INTO "InventoryItem" (
        id, "productId", sku, "productName", category,
        "onHand", committed, available, location, status, "updatedAt"
      ) VALUES (
        ${cuid()}, ${p.id}, ${p.sku}, ${productName}, ${category},
        ${onHand}, 0, ${onHand}, ${location}, ${status}, NOW()
      )
      ON CONFLICT ("productId") DO UPDATE SET
        "onHand"      = EXCLUDED."onHand",
        available     = EXCLUDED."onHand" - "InventoryItem".committed,
        location      = EXCLUDED.location,
        status        = EXCLUDED.status,
        sku           = EXCLUDED.sku,
        "productName" = COALESCE(EXCLUDED."productName", "InventoryItem"."productName"),
        category      = COALESCE(EXCLUDED.category, "InventoryItem".category),
        "updatedAt"   = NOW()
      RETURNING (xmax = 0) AS inserted
    `
    if (result[0]?.inserted) inserted++
    else updated++
  }
  console.log(`  Inserted: ${inserted}`)
  console.log(`  Updated:  ${updated}`)
  console.log(`  Orphans:  ${orphans.length} (skipped, no matching Product)`)

  // ── after snapshot ──
  bar('After snapshot')
  const afterTotals = (
    await sql`SELECT COUNT(*)::int AS total,
                     COUNT(*) FILTER (WHERE "onHand" > 0)::int AS onhand_gt0
              FROM "InventoryItem"`
  )[0]
  console.log(`  InventoryItem total:     ${afterTotals.total}   (was ${beforeTotals.total})`)
  console.log(`  InventoryItem onHand>0:  ${afterTotals.onhand_gt0}   (was ${beforeTotals.onhand_gt0})`)

  // ── 5 sample rows ──
  bar('Sample rows (5)')
  const samplePids = matched.slice(0, 5).map((s) => productBySku.get(s).id)
  if (samplePids.length) {
    const samples = await sql`
      SELECT sku, "productName", "onHand", committed, available, location, status
      FROM "InventoryItem"
      WHERE "productId" = ANY(${samplePids})
      ORDER BY sku
    `
    console.table(
      samples.map((r) => ({
        sku: r.sku,
        name: (r.productName || '').slice(0, 35),
        onHand: r.onHand,
        committed: r.committed,
        available: r.available,
        location: r.location,
        status: r.status,
      })),
    )
  }

  bar('DONE')
}

main().catch((e) => {
  console.error('\nFATAL:', e)
  process.exit(1)
})
