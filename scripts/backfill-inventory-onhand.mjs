#!/usr/bin/env node
/**
 * scripts/backfill-inventory-onhand.mjs
 *
 * Backfill InventoryItem.onHand from the canonical brain_export JSONL.
 *
 * SOURCE (per AEGIS-TEAM-READINESS-PLAN.md Phase 1.4):
 *   C:/Users/natha/OneDrive/Abel Lumber/NUC_CLUSTER/brain_export/products_inventory.jsonl
 *
 *   Each line is a knowledge-base record. Inventory rows look like:
 *     { "data": { "sku": "BC004337", "product": "...", "location": "...",
 *                 "quantity": 174.0, "type": "stock_level" } }
 *
 *   Non-stock-level rows (data.sku missing or data.type != 'stock_level')
 *   are skipped — they are product descriptions / knowledge entries that
 *   share the JSONL but don't carry inventory state.
 *
 * MATCH KEY: JSONL data.sku ↔ Product.sku (exact).
 *
 * WRITE SEMANTICS (per task brief):
 *   - onHand    = record.quantity
 *   - available = onHand   (committed defaults to 0; we preserve existing
 *                           committed on update and compute available =
 *                           onHand - committed to stay consistent with
 *                           the rest of the app)
 *   - location  = record.location || 'MAIN_WAREHOUSE'
 *   - status    = onHand > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK'
 *
 * IDEMPOTENT: upserts via ON CONFLICT ("productId") DO UPDATE.
 * Safe to re-run. Only touches SKUs present in the JSONL — existing
 * InventoryItems for SKUs not in the source are left alone.
 *
 * Usage:
 *   node scripts/backfill-inventory-onhand.mjs               # dry-run
 *   node scripts/backfill-inventory-onhand.mjs --commit      # write
 *   node scripts/backfill-inventory-onhand.mjs --source PATH # override JSONL path
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
  'NUC_CLUSTER',
  'brain_export',
  'products_inventory.jsonl',
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

// ── main ──
async function main() {
  bar('Backfill InventoryItem.onHand from brain_export JSONL')
  console.log(`  Mode:   ${DRY_RUN ? 'DRY-RUN (no writes)' : 'COMMIT (will write)'}`)
  console.log(`  Source: ${SOURCE_FILE}`)

  if (!existsSync(SOURCE_FILE)) {
    console.error(`\nERROR: source JSONL not found at ${SOURCE_FILE}`)
    process.exit(1)
  }

  // ── parse JSONL ──
  const raw = readFileSync(SOURCE_FILE, 'utf8').trim().split(/\r?\n/)
  bar('Parse JSONL')
  let totalLines = 0
  let stockRows = 0
  let skippedNoSku = 0
  let skippedNonStock = 0
  let skippedBadQty = 0
  const bySku = new Map() // sku → { sku, productName, location, quantity }
  for (const ln of raw) {
    if (!ln.trim()) continue
    totalLines++
    let rec
    try {
      rec = JSON.parse(ln)
    } catch {
      continue
    }
    const d = rec?.data
    if (!d || typeof d !== 'object') {
      skippedNonStock++
      continue
    }
    // non-inventory knowledge entries: no sku (or no quantity)
    if (!d.sku) {
      skippedNoSku++
      continue
    }
    if (d.type && d.type !== 'stock_level') {
      skippedNonStock++
      continue
    }
    const qty = typeof d.quantity === 'number' ? d.quantity : Number(d.quantity)
    if (!Number.isFinite(qty)) {
      skippedBadQty++
      continue
    }
    const sku = String(d.sku).trim()
    if (!sku) {
      skippedNoSku++
      continue
    }
    // prefer higher qty if the same sku appears twice (defensive; source
    // currently has zero duplicates)
    const existing = bySku.get(sku)
    if (!existing || qty > existing.quantity) {
      bySku.set(sku, {
        sku,
        productName: d.product ? String(d.product).trim() : null,
        location: d.location ? String(d.location).trim() : 'MAIN_WAREHOUSE',
        quantity: Math.round(qty), // onHand is int
      })
    }
    stockRows++
  }
  console.log(`  Lines read:          ${totalLines}`)
  console.log(`  Stock rows:          ${stockRows}`)
  console.log(`  Unique SKUs:         ${bySku.size}`)
  console.log(`  Skipped (no sku):    ${skippedNoSku}`)
  console.log(`  Skipped (non-stock): ${skippedNonStock}`)
  console.log(`  Skipped (bad qty):   ${skippedBadQty}`)

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
  const unmatched = skus.filter((s) => !productBySku.has(s))
  bar('SKU -> Product match')
  console.log(`  Matched:   ${matched.length}/${skus.length}`)
  console.log(`  Unmatched: ${unmatched.length}`)
  if (unmatched.length > 0) {
    console.log(`  First 10 unmatched: ${unmatched.slice(0, 10).join(', ')}`)
  }

  // ── plan ──
  const existingRows = await sql`
    SELECT "productId", "onHand", committed
    FROM "InventoryItem"
    WHERE "productId" = ANY(${matched.map((s) => productBySku.get(s).id)})
  `
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
  console.log(`  SKUs skipped (no Product match): ${unmatched.length}`)

  if (DRY_RUN) {
    bar('DRY-RUN complete - no writes')
    console.log('  Re-run with --commit to apply.')
    // Still show a 5-row preview of what would change
    const preview = matched.slice(0, 5).map((sku) => {
      const p = productBySku.get(sku)
      const rec = bySku.get(sku)
      const cur = existingByPid.get(p.id)
      return {
        sku,
        productName: (rec.productName || p.name || '').slice(0, 40),
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
    const location = rec.location || 'MAIN_WAREHOUSE'
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
  const samplePids = matched
    .slice(0, 5)
    .map((s) => productBySku.get(s).id)
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
