#!/usr/bin/env node
/**
 * scripts/reconcile-inflow-products-stock.mjs
 *
 * One-shot reconcile of Aegis Product + InventoryItem against fresh InFlow
 * exports (and the week-of-4/27 door inventory sheet).
 *
 * SOURCES (defaults; override with --downloads PATH):
 *   inFlow_ProductDetails (13).csv  - full product catalog
 *   inFlow_ProductGroups (1).csv    - category hierarchy (often empty)
 *   inFlow_ProductImages (1).csv    - SKU -> image URL
 *   inFlow_StockLevels (13).csv / (14).csv - stock snapshot; newer wins
 *   Door Inventory for Builds from 042726 thru 050426.xlsx - shortage sheet
 *
 * WRITES (only when --commit is passed):
 *   Product       - INSERT new SKUs; UPDATE null fields ONLY on existing rows
 *                   (NEVER overwrite prior non-null catalog/attribute data)
 *   InventoryItem - UPSERT by productId; updates onHand/available/location/status;
 *                   preserves committed (allocation-derived)
 *   ProductGroup  - created via raw SQL IF NOT EXISTS; seeded if CSV has content
 *   ProductImage  - created via raw SQL IF NOT EXISTS; URL-per-SKU; also fills
 *                   Product.imageUrl where NULL
 *   InboxItem     - type=UPCOMING_BUILD_SHORTAGE per row flagged in the door
 *                   inventory xlsx, priority=CRITICAL, assignedTo=Gunner
 *
 * SCOPE GUARDRAILS:
 *   - Does NOT touch PurchaseOrder, Order, BomEntry, Builder.
 *   - Does NOT delete rows. Aegis-only SKUs are reported, not removed.
 *   - Does NOT modify Product.committed / PO-on-order data.
 *
 * USAGE:
 *   node scripts/reconcile-inflow-products-stock.mjs                # dry-run
 *   node scripts/reconcile-inflow-products-stock.mjs --commit       # write
 *   node scripts/reconcile-inflow-products-stock.mjs --downloads X  # override
 */

import { neon } from '@neondatabase/serverless'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import XLSX from 'xlsx'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

// ── args ──
const argv = process.argv.slice(2)
const DRY_RUN = !argv.includes('--commit')
const dlIdx = argv.indexOf('--downloads')
const DOWNLOADS = dlIdx >= 0 && argv[dlIdx + 1]
  ? resolve(argv[dlIdx + 1])
  : 'C:/Users/natha/Downloads'

// Known filenames
const FN_PRODUCTS = 'inFlow_ProductDetails (13).csv'
const FN_GROUPS = 'inFlow_ProductGroups (1).csv'
const FN_IMAGES = 'inFlow_ProductImages (1).csv'
const FN_STOCK_A = 'inFlow_StockLevels (13).csv'
const FN_STOCK_B = 'inFlow_StockLevels (14).csv'
const FN_DOORS = 'Door Inventory for Builds from 042726 thru 050426.xlsx'

// Staff assignee for shortage inbox items — Gunner Hacker, Production Line Lead
const GUNNER_STAFF_ID = 'staff_mobpd37pze8736'

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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
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
function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else { inQuotes = false }
      } else cur += ch
    } else {
      if (ch === ',') { out.push(cur); cur = '' }
      else if (ch === '"') inQuotes = true
      else cur += ch
    }
  }
  out.push(cur)
  return out
}
function readCsv(path) {
  let text = readFileSync(path, 'utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length === 0) return { header: [], rows: [] }
  const header = parseCsvLine(lines[0]).map((h) => h.trim())
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i])
    const row = {}
    for (let j = 0; j < header.length; j++) row[header[j]] = (cols[j] ?? '').trim()
    rows.push(row)
  }
  return { header, rows }
}
function toNum(s) {
  if (s === undefined || s === null || s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// ── main ──
async function main() {
  bar('InFlow ↔ Aegis reconcile (Product + InventoryItem + Images + Door Inventory)')
  console.log(`  Mode:      ${DRY_RUN ? 'DRY-RUN (no writes)' : 'COMMIT (will write)'}`)
  console.log(`  Downloads: ${DOWNLOADS}`)

  const pathProducts = join(DOWNLOADS, FN_PRODUCTS)
  const pathGroups = join(DOWNLOADS, FN_GROUPS)
  const pathImages = join(DOWNLOADS, FN_IMAGES)
  const pathStockA = join(DOWNLOADS, FN_STOCK_A)
  const pathStockB = join(DOWNLOADS, FN_STOCK_B)
  const pathDoors = join(DOWNLOADS, FN_DOORS)

  for (const [label, p] of [
    ['ProductDetails', pathProducts],
    ['ProductImages', pathImages],
    ['Door Inventory', pathDoors],
  ]) {
    if (!existsSync(p)) {
      console.error(`\nERROR: required ${label} file not found at ${p}`)
      process.exit(1)
    }
  }

  // ── pick newer StockLevels ──
  bar('Step 1: Pick newer StockLevels snapshot')
  let stockPath = null
  if (existsSync(pathStockA) && existsSync(pathStockB)) {
    const sA = (await import('node:fs')).statSync(pathStockA)
    const sB = (await import('node:fs')).statSync(pathStockB)
    stockPath = sA.mtimeMs >= sB.mtimeMs ? pathStockA : pathStockB
    console.log(`  (13) mtime: ${sA.mtime.toISOString()}`)
    console.log(`  (14) mtime: ${sB.mtime.toISOString()}`)
    console.log(`  -> chose: ${stockPath.split(/[\\/]/).pop()}`)
  } else if (existsSync(pathStockA)) {
    stockPath = pathStockA
  } else if (existsSync(pathStockB)) {
    stockPath = pathStockB
  } else {
    console.error('ERROR: no StockLevels file found'); process.exit(1)
  }

  // ── parse ProductDetails ──
  bar('Step 2: Parse inFlow ProductDetails')
  const { rows: prodRows } = readCsv(pathProducts)
  console.log(`  Total rows:     ${prodRows.length}`)
  const activeInflow = prodRows.filter((r) => (r.IsActive || '').toLowerCase() === 'true')
  console.log(`  Active=true:    ${activeInflow.length}`)
  const inflowBySku = new Map()
  let skippedNoSku = 0
  for (const r of activeInflow) {
    const sku = (r.SKU || '').trim()
    if (!sku) { skippedNoSku++; continue }
    if (inflowBySku.has(sku)) continue // de-dup, first wins
    inflowBySku.set(sku, r)
  }
  console.log(`  Distinct active SKUs: ${inflowBySku.size}`)
  console.log(`  Skipped (no SKU):     ${skippedNoSku}`)

  // ── parse ProductGroups (may be empty) ──
  bar('Step 3: Parse inFlow ProductGroups')
  let groupRows = []
  if (existsSync(pathGroups)) {
    const g = readCsv(pathGroups)
    groupRows = g.rows
    console.log(`  Group rows: ${groupRows.length}`)
    if (groupRows.length === 0) {
      console.log('  (empty — nothing to seed into ProductGroup; column falls back to InFlow Category)')
    }
  } else {
    console.log('  (file missing — skipping ProductGroup step)')
  }

  // ── parse ProductImages ──
  bar('Step 4: Parse inFlow ProductImages')
  const { rows: imgRows } = readCsv(pathImages)
  const imgBySku = new Map()
  for (const r of imgRows) {
    const sku = (r.Sku || r.SKU || '').trim()
    const url = (r.ImageUrl || '').trim()
    if (sku && url) imgBySku.set(sku, url)
  }
  console.log(`  Image rows: ${imgRows.length}`)
  console.log(`  SKU→URL:    ${imgBySku.size}`)

  // ── parse StockLevels ──
  bar('Step 5: Parse StockLevels')
  const { rows: stockRows } = readCsv(stockPath)
  const stockBySku = new Map()
  let stockSkippedNoSku = 0
  let stockDupSum = 0
  for (const r of stockRows) {
    const sku = (r.SKU || '').trim()
    if (!sku) { stockSkippedNoSku++; continue }
    const qty = Math.max(0, Math.round(Number(r.Quantity || 0) || 0))
    const rec = {
      sku,
      productName: r.ProductName || null,
      location: r.Location || 'Gainesville Warehouse',
      quantity: qty,
    }
    if (stockBySku.has(sku)) {
      stockBySku.get(sku).quantity += qty
      stockDupSum++
    } else {
      stockBySku.set(sku, rec)
    }
  }
  console.log(`  Stock rows:         ${stockRows.length}`)
  console.log(`  Distinct SKUs:      ${stockBySku.size}`)
  console.log(`  Dup-sub-locs summed: ${stockDupSum}`)
  console.log(`  Skipped (no SKU):    ${stockSkippedNoSku}`)

  // ── parse Door Inventory xlsx ──
  bar('Step 6: Parse Door Inventory for 4/27 - 5/4')
  const wb = XLSX.readFile(pathDoors)
  const sh = wb.Sheets[wb.SheetNames[0]]
  const arrRows = XLSX.utils.sheet_to_json(sh, { header: 1, blankrows: false })
  // Row 1 is title, row 2 is header; real data starts at row index 2
  const doorHeader = arrRows[1]
  const doorDataRows = []
  for (let i = 2; i < arrRows.length; i++) {
    const r = arrRows[i]
    if (!r || !r[0]) continue
    doorDataRows.push({
      address: r[0],
      customer: r[1],
      buildDate: r[2],  // Excel serial
      shipDate: r[3],
      status: r[4] || '',
    })
  }
  const shortageRows = doorDataRows.filter((r) => /^missing\b/i.test((r.status || '').trim()))
  const tbdRows = doorDataRows.filter((r) => /dalton|verify/i.test(r.status || ''))
  console.log(`  Data rows:        ${doorDataRows.length}`)
  console.log(`  Shortages:        ${shortageRows.length}`)
  console.log(`  Pending verify:   ${tbdRows.length}`)
  console.log(`  All-doors-in-stock: ${doorDataRows.length - shortageRows.length - tbdRows.length}`)

  // ── before snapshot ──
  bar('Step 7: Before snapshot')
  const before = (await sql`
    SELECT
      (SELECT COUNT(*)::int FROM "Product")                      AS prod_total,
      (SELECT COUNT(*)::int FROM "Product" WHERE active)         AS prod_active,
      (SELECT COUNT(*)::int FROM "Product" WHERE "imageUrl" IS NULL AND active) AS prod_noimg,
      (SELECT COUNT(*)::int FROM "InventoryItem")                AS inv_total,
      (SELECT COUNT(*)::int FROM "InventoryItem" WHERE "onHand" > 0) AS inv_onhand_gt0
  `)[0]
  console.log(`  Product.total:        ${before.prod_total}`)
  console.log(`  Product.active:       ${before.prod_active}`)
  console.log(`  Product.no-image:     ${before.prod_noimg}`)
  console.log(`  InventoryItem.total:  ${before.inv_total}`)
  console.log(`  InventoryItem.onHand>0: ${before.inv_onhand_gt0}`)

  // ── diff InFlow vs Aegis Product ──
  bar('Step 8: Product diff (InFlow active vs Aegis)')
  const aegisProducts = await sql`SELECT id, sku, name, category, cost, "basePrice", "imageUrl", "displayName", "inflowId", "inflowCategory", active FROM "Product"`
  const aegisBySku = new Map(aegisProducts.map((p) => [p.sku, p]))
  const inflowSkus = Array.from(inflowBySku.keys())

  const inflowOnly = inflowSkus.filter((s) => !aegisBySku.has(s))
  const aegisOnly = aegisProducts.filter((p) => !inflowBySku.has(p.sku)).map((p) => p.sku)
  const both = inflowSkus.filter((s) => aegisBySku.has(s))

  console.log(`  InFlow active SKUs:   ${inflowSkus.length}`)
  console.log(`  Aegis Product total:  ${aegisProducts.length}`)
  console.log(`  -> InFlow-only (INSERT):       ${inflowOnly.length}`)
  console.log(`  -> Aegis-only (report only):   ${aegisOnly.length}`)
  console.log(`  -> Both-sides (fill NULLs):    ${both.length}`)

  // ── plan Product updates on both-sides ──
  bar('Step 9: Plan NULL-fill updates on existing Products')
  const updatePlan = [] // {sku, id, fields:{...}}
  for (const sku of both) {
    const inf = inflowBySku.get(sku)
    const ag = aegisBySku.get(sku)
    const patch = {}
    const infCost = toNum(inf.Cost)
    const infPrice = toNum(inf.DefaultUnitPrice)
    const infCat = (inf.Category || '').trim()
    // Only fill when Aegis field is NULL OR zero (0 is our signal for "missing cost/price" per the
    // counters shown: 446 active products have cost=0 and basePrice=0 simultaneously).
    if ((ag.cost == null || ag.cost === 0) && infCost != null && infCost > 0) patch.cost = infCost
    if ((ag.basePrice == null || ag.basePrice === 0) && infPrice != null && infPrice > 0) patch.basePrice = infPrice
    // Category: Aegis always has a value (NOT NULL); map inflowCategory separately
    if (!ag.inflowCategory && infCat) patch.inflowCategory = infCat
    if (!ag.inflowId && (inf.SKU || '').trim()) patch.inflowId = inf.SKU.trim()
    // displayName: only populate if NULL
    if (!ag.displayName && (inf.ProductName || '').trim()) patch.displayName = inf.ProductName.trim()
    if (Object.keys(patch).length > 0) updatePlan.push({ sku, id: ag.id, patch })
  }
  console.log(`  Products with fillable nulls: ${updatePlan.length} / ${both.length}`)
  const fieldHist = { cost: 0, basePrice: 0, inflowCategory: 0, inflowId: 0, displayName: 0 }
  for (const u of updatePlan) for (const k of Object.keys(u.patch)) fieldHist[k]++
  console.table(fieldHist)

  // ── image fill plan ──
  bar('Step 10: Plan image fills (Product.imageUrl where NULL)')
  let imgInsertCount = 0
  let imgSkippedNoProd = 0
  for (const [sku, url] of imgBySku) {
    const ag = aegisBySku.get(sku) || (inflowOnly.includes(sku) ? { id: null, sku } : null)
    if (!ag) { imgSkippedNoProd++; continue }
    if (ag && (ag.imageUrl == null)) imgInsertCount++
  }
  console.log(`  Images to set:         ${imgInsertCount}`)
  console.log(`  Images skipped (no product, will also be resolved after insert): ${imgSkippedNoProd}`)

  // ── plan stock upserts ──
  bar('Step 11: Plan InventoryItem upserts')
  // After inserts in step 13, we'll re-resolve productIds. For now we just report matchable counts.
  const stockSkus = Array.from(stockBySku.keys())
  const stockMatchedNow = stockSkus.filter((s) => aegisBySku.has(s) || inflowBySku.has(s))
  const stockOrphansNow = stockSkus.filter((s) => !aegisBySku.has(s) && !inflowBySku.has(s))
  console.log(`  Stock SKUs total:      ${stockSkus.length}`)
  console.log(`  Matchable (aegis OR new inflow insert): ${stockMatchedNow.length}`)
  console.log(`  Orphans (truly unknown): ${stockOrphansNow.length}`)

  // ── DRY RUN exit with sample preview ──
  if (DRY_RUN) {
    bar('Sample: 5 InFlow-only SKUs that would be INSERTED')
    const sample = inflowOnly.slice(0, 5).map((sku) => {
      const inf = inflowBySku.get(sku)
      return {
        sku,
        name: (inf.ProductName || '').slice(0, 40),
        category: (inf.Category || '').slice(0, 30),
        cost: inf.Cost || '',
        price: inf.DefaultUnitPrice || '',
      }
    })
    console.table(sample)

    bar('Sample: 5 NULL-fill updates')
    console.table(updatePlan.slice(0, 5).map((u) => ({ sku: u.sku, fields: Object.keys(u.patch).join(',') })))

    bar('Sample: 5 door shortages')
    console.table(shortageRows.slice(0, 5).map((r) => ({
      address: r.address,
      customer: r.customer,
      status: (r.status || '').slice(0, 80),
    })))

    bar('DRY-RUN complete - no writes. Re-run with --commit to apply.')
    return
  }

  // ╔════════════════════════════════════════════════════════════════════╗
  // ║                         COMMIT PHASE                              ║
  // ╚════════════════════════════════════════════════════════════════════╝

  // Step A: Ensure aux tables exist (raw SQL — won't touch schema.prisma)
  bar('COMMIT A: Ensure ProductGroup + ProductImage tables')
  await sql`
    CREATE TABLE IF NOT EXISTS "ProductGroup" (
      id              TEXT PRIMARY KEY,
      "groupName"     TEXT NOT NULL,
      "groupCategory" TEXT,
      "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      UNIQUE ("groupName")
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS "ProductImage" (
      id          TEXT PRIMARY KEY,
      sku         TEXT NOT NULL,
      "productId" TEXT,
      "imageUrl"  TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
      UNIQUE (sku)
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS "ProductImage_productId_idx" ON "ProductImage"("productId")`
  console.log('  ✓ ProductGroup + ProductImage ensured (no-op if already present)')

  // Step B: INSERT new Products (InFlow-only SKUs)
  bar(`COMMIT B: Insert ${inflowOnly.length} new Products`)
  let insertedProducts = 0
  let skippedInsertMissingName = 0
  for (const sku of inflowOnly) {
    const inf = inflowBySku.get(sku)
    const name = (inf.ProductName || '').trim()
    if (!name) { skippedInsertMissingName++; continue }
    const category = (inf.Category || '').trim() || 'Other'
    const cost = toNum(inf.Cost) ?? 0
    const basePrice = toNum(inf.DefaultUnitPrice) ?? 0
    const inflowCategory = category
    await sql`
      INSERT INTO "Product" (
        id, sku, name, category, cost, "basePrice", active,
        "inflowId", "inflowCategory", "lastSyncedAt", "createdAt", "updatedAt"
      ) VALUES (
        ${cuid()}, ${sku}, ${name}, ${category},
        ${cost}, ${basePrice}, TRUE,
        ${sku}, ${inflowCategory}, NOW(), NOW(), NOW()
      )
      ON CONFLICT (sku) DO NOTHING
    `
    insertedProducts++
  }
  console.log(`  Inserted: ${insertedProducts}`)
  console.log(`  Skipped (missing name): ${skippedInsertMissingName}`)

  // Step C: NULL-fill existing Products
  bar(`COMMIT C: NULL-fill ${updatePlan.length} existing Products`)
  let updatedCount = 0
  const fieldUpdates = { cost: 0, basePrice: 0, inflowCategory: 0, inflowId: 0, displayName: 0 }
  for (const u of updatePlan) {
    const p = u.patch
    // Use COALESCE semantics inline: our plan already excluded non-null overwrites,
    // but double-guard at SQL level.
    if ('cost' in p) {
      await sql`UPDATE "Product" SET cost = ${p.cost}, "updatedAt" = NOW() WHERE id = ${u.id} AND (cost IS NULL OR cost = 0)`
      fieldUpdates.cost++
    }
    if ('basePrice' in p) {
      await sql`UPDATE "Product" SET "basePrice" = ${p.basePrice}, "updatedAt" = NOW() WHERE id = ${u.id} AND ("basePrice" IS NULL OR "basePrice" = 0)`
      fieldUpdates.basePrice++
    }
    if ('inflowCategory' in p) {
      await sql`UPDATE "Product" SET "inflowCategory" = ${p.inflowCategory}, "updatedAt" = NOW() WHERE id = ${u.id} AND "inflowCategory" IS NULL`
      fieldUpdates.inflowCategory++
    }
    if ('inflowId' in p) {
      await sql`UPDATE "Product" SET "inflowId" = ${p.inflowId}, "updatedAt" = NOW() WHERE id = ${u.id} AND "inflowId" IS NULL`
      fieldUpdates.inflowId++
    }
    if ('displayName' in p) {
      await sql`UPDATE "Product" SET "displayName" = ${p.displayName}, "updatedAt" = NOW() WHERE id = ${u.id} AND "displayName" IS NULL`
      fieldUpdates.displayName++
    }
    updatedCount++
  }
  console.log(`  Rows touched: ${updatedCount}`)
  console.table(fieldUpdates)

  // Step D: Seed ProductGroup (if groupRows present)
  bar(`COMMIT D: Seed ProductGroup rows`)
  let groupsInserted = 0
  if (groupRows.length > 0) {
    for (const g of groupRows) {
      const name = (g.ProductGroupName || '').trim()
      const cat = (g.ProductGroupCategory || '').trim() || null
      if (!name) continue
      await sql`
        INSERT INTO "ProductGroup" (id, "groupName", "groupCategory", "createdAt", "updatedAt")
        VALUES (${cuid()}, ${name}, ${cat}, NOW(), NOW())
        ON CONFLICT ("groupName") DO UPDATE SET "groupCategory" = EXCLUDED."groupCategory", "updatedAt" = NOW()
      `
      groupsInserted++
    }
  }
  console.log(`  Groups upserted: ${groupsInserted} (empty source = 0, expected)`)

  // Step E: ProductImage + Product.imageUrl fill
  bar(`COMMIT E: ProductImage rows + Product.imageUrl`)
  // Re-fetch product IDs post-insert
  const prodMap = new Map(
    (await sql`SELECT id, sku FROM "Product" WHERE sku = ANY(${Array.from(imgBySku.keys())})`).map((r) => [r.sku, r.id])
  )
  let imgRowsUpserted = 0
  let productImgUrlFilled = 0
  for (const [sku, url] of imgBySku) {
    const pid = prodMap.get(sku) || null
    await sql`
      INSERT INTO "ProductImage" (id, sku, "productId", "imageUrl", "createdAt", "updatedAt")
      VALUES (${cuid()}, ${sku}, ${pid}, ${url}, NOW(), NOW())
      ON CONFLICT (sku) DO UPDATE SET "imageUrl" = EXCLUDED."imageUrl", "productId" = EXCLUDED."productId", "updatedAt" = NOW()
    `
    imgRowsUpserted++
    if (pid) {
      const r = await sql`UPDATE "Product" SET "imageUrl" = ${url}, "updatedAt" = NOW() WHERE id = ${pid} AND "imageUrl" IS NULL`
      if (r.length >= 0) productImgUrlFilled += 1 // neon returns affected rows count in result length; we'll trust it
    }
  }
  console.log(`  ProductImage rows upserted: ${imgRowsUpserted}`)
  console.log(`  Product.imageUrl filled:    (best-effort) ${productImgUrlFilled} attempts`)

  // Step F: InventoryItem upsert
  bar(`COMMIT F: Upsert InventoryItem (from StockLevels)`)
  const allStockSkus = Array.from(stockBySku.keys())
  const productsForStock = await sql`SELECT id, sku, name, category FROM "Product" WHERE sku = ANY(${allStockSkus})`
  const prodBySkuForStock = new Map(productsForStock.map((p) => [p.sku, p]))
  const inventoryMatched = allStockSkus.filter((s) => prodBySkuForStock.has(s))
  const inventoryOrphans = allStockSkus.filter((s) => !prodBySkuForStock.has(s))

  let invInserted = 0
  let invUpdated = 0
  const onhandChanges = [] // {sku, was, now}
  // Pre-fetch existing inventory rows for delta tracking
  const existingInv = new Map(
    (await sql`
      SELECT "productId", "onHand" FROM "InventoryItem" WHERE "productId" = ANY(${inventoryMatched.map((s) => prodBySkuForStock.get(s).id)})
    `).map((r) => [r.productId, r.onHand])
  )
  for (const sku of inventoryMatched) {
    const p = prodBySkuForStock.get(sku)
    const rec = stockBySku.get(sku)
    const onHand = rec.quantity
    const location = rec.location || 'Gainesville Warehouse'
    const status = onHand > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK'
    const productName = rec.productName || p.name || null
    const category = p.category || null
    const wasOnHand = existingInv.get(p.id)
    const result = await sql`
      INSERT INTO "InventoryItem" (
        id, "productId", sku, "productName", category,
        "onHand", committed, available, location, status,
        "lastReceivedAt", "updatedAt"
      ) VALUES (
        ${cuid()}, ${p.id}, ${p.sku}, ${productName}, ${category},
        ${onHand}, 0, ${onHand}, ${location}, ${status},
        NOW(), NOW()
      )
      ON CONFLICT ("productId") DO UPDATE SET
        "onHand"      = EXCLUDED."onHand",
        available     = EXCLUDED."onHand" - "InventoryItem".committed,
        location      = EXCLUDED.location,
        status        = EXCLUDED.status,
        sku           = EXCLUDED.sku,
        "productName" = COALESCE(EXCLUDED."productName", "InventoryItem"."productName"),
        category      = COALESCE(EXCLUDED.category, "InventoryItem".category),
        "lastReceivedAt" = NOW(),
        "updatedAt"      = NOW()
      RETURNING (xmax = 0) AS inserted
    `
    if (result[0]?.inserted) invInserted++
    else {
      invUpdated++
      if (wasOnHand != null && wasOnHand !== onHand) onhandChanges.push({ sku, was: wasOnHand, now: onHand })
    }
  }
  console.log(`  Inserted: ${invInserted}`)
  console.log(`  Updated:  ${invUpdated}`)
  console.log(`  onHand changes: ${onhandChanges.length}`)
  if (onhandChanges.length > 0) {
    const shrinkage = onhandChanges.filter((c) => c.now < c.was)
    console.log(`  -> shrinkage (went down): ${shrinkage.length}`)
    console.log(`  -> growth  (went up):     ${onhandChanges.length - shrinkage.length}`)
  }
  console.log(`  Orphans (stock SKU, no Product): ${inventoryOrphans.length}`)
  if (inventoryOrphans.length > 0) {
    console.log(`    first 10: ${inventoryOrphans.slice(0, 10).join(', ')}`)
  }

  // Step G: Door-inventory shortage InboxItems
  bar(`COMMIT G: UPCOMING_BUILD_SHORTAGE InboxItems`)
  let shortagesInserted = 0
  let shortagesSkippedExisting = 0
  for (const r of shortageRows) {
    // dedup: same address + same status on same day
    const existing = await sql`
      SELECT id FROM "InboxItem"
      WHERE type = 'UPCOMING_BUILD_SHORTAGE'
        AND title = ${`Shortage: ${r.address}`}
        AND status = 'PENDING'
      LIMIT 1
    `
    if (existing.length > 0) { shortagesSkippedExisting++; continue }
    const desc = `${r.customer} | build ${excelSerialToIso(r.buildDate)} | ship ${excelSerialToIso(r.shipDate)} | ${r.status}`
    await sql`
      INSERT INTO "InboxItem" (
        id, type, source, title, description, priority, status,
        "assignedTo", "actionData", "createdAt", "updatedAt"
      ) VALUES (
        ${cuid()}, 'UPCOMING_BUILD_SHORTAGE', 'reconcile-inflow-products-stock', ${`Shortage: ${r.address}`},
        ${desc}, 'CRITICAL', 'PENDING',
        ${GUNNER_STAFF_ID},
        ${JSON.stringify({
          address: r.address,
          customer: r.customer,
          buildDateExcel: r.buildDate,
          shipDateExcel: r.shipDate,
          rawStatus: r.status,
        })}::jsonb,
        NOW(), NOW()
      )
    `
    shortagesInserted++
  }
  console.log(`  Inserted: ${shortagesInserted}`)
  console.log(`  Already pending (skipped): ${shortagesSkippedExisting}`)

  // ── after snapshot ──
  bar('Step 12: After snapshot')
  const after = (await sql`
    SELECT
      (SELECT COUNT(*)::int FROM "Product")                      AS prod_total,
      (SELECT COUNT(*)::int FROM "Product" WHERE active)         AS prod_active,
      (SELECT COUNT(*)::int FROM "Product" WHERE "imageUrl" IS NULL AND active) AS prod_noimg,
      (SELECT COUNT(*)::int FROM "InventoryItem")                AS inv_total,
      (SELECT COUNT(*)::int FROM "InventoryItem" WHERE "onHand" > 0) AS inv_onhand_gt0
  `)[0]
  console.log(`  Product.total:        ${after.prod_total}   (was ${before.prod_total})`)
  console.log(`  Product.active:       ${after.prod_active}  (was ${before.prod_active})`)
  console.log(`  Product.no-image:     ${after.prod_noimg}   (was ${before.prod_noimg})`)
  console.log(`  InventoryItem.total:  ${after.inv_total}    (was ${before.inv_total})`)
  console.log(`  InventoryItem.onHand>0: ${after.inv_onhand_gt0} (was ${before.inv_onhand_gt0})`)

  // ── 5 newly-added sample SKUs ──
  bar('Sample: 5 newly-added SKUs')
  const sample = await sql`
    SELECT sku, name, category, cost, "basePrice", "imageUrl"
    FROM "Product"
    WHERE sku = ANY(${inflowOnly.slice(0, 5)})
    ORDER BY sku
  `
  console.table(sample.map((r) => ({
    sku: r.sku,
    name: (r.name || '').slice(0, 45),
    category: (r.category || '').slice(0, 20),
    cost: r.cost,
    basePrice: r.basePrice,
    hasImage: r.imageUrl ? 'yes' : '',
  })))

  bar('DONE')
  console.log(`\n  SUMMARY`)
  console.log(`  -------`)
  console.log(`  Products inserted:           ${insertedProducts}`)
  console.log(`  Products null-filled:        ${updatedCount}`)
  console.log(`  ProductImage rows upserted:  ${imgRowsUpserted}`)
  console.log(`  InventoryItem inserted:      ${invInserted}`)
  console.log(`  InventoryItem updated:       ${invUpdated}`)
  console.log(`  InventoryItem onHand-deltas: ${onhandChanges.length}`)
  console.log(`  Door-build shortages flagged: ${shortagesInserted}`)
  console.log(`  Aegis-only SKUs (not touched): ${aegisOnly.length}`)
}

function excelSerialToIso(serial) {
  if (serial == null || serial === '' || isNaN(Number(serial))) return String(serial ?? '')
  const n = Number(serial)
  // Excel epoch is 1899-12-30 (accounting for Lotus 1-2-3 leap year bug)
  const ms = (n - 25569) * 86400 * 1000
  const d = new Date(ms)
  if (isNaN(d.getTime())) return String(serial)
  return d.toISOString().slice(0, 10)
}

main().catch((e) => {
  console.error('\nFATAL:', e)
  process.exit(1)
})
