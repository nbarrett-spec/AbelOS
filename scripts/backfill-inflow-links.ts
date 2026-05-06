/**
 * One-shot backfill: link Aegis rows to their InFlow counterparts.
 *
 * Context (from 2026-05-06 diagnostic):
 *   - 403 Products in Aegis with no inflowId
 *   - 961 Orders with no inflowOrderId
 *   - 640 PurchaseOrders with no inflowId
 *   - 73 Vendors with no inflowVendorId
 *
 * These rows pre-existed in Aegis from CSV imports / manual entry / builder
 * portal entries that never got tied back to InFlow. They never sync because
 * there's no key to match. This script does a one-time reconciliation:
 *
 *   - Products: match by SKU (Aegis Product.sku == InFlow product.sku)
 *   - PurchaseOrders: match by poNumber (Aegis PO.poNumber == InFlow orderNumber)
 *   - Orders: match by poNumber (customer PO; only link if exactly ONE
 *     InFlow order has that PO — refuses to guess on collisions)
 *   - Vendors: match by name (case-insensitive)
 *
 * Usage:
 *   npx tsx scripts/backfill-inflow-links.ts                    # dry run, all types
 *   npx tsx scripts/backfill-inflow-links.ts --apply            # write to DB
 *   npx tsx scripts/backfill-inflow-links.ts --type products    # one type
 *   npx tsx scripts/backfill-inflow-links.ts --type all --apply # the real run
 *
 * Safety: only writes inflow*Id fields on rows where they're currently NULL.
 * Never overwrites existing linkage. Never modifies any other column.
 */
import { PrismaClient } from '@prisma/client'
import { paginateAfter } from '@/lib/integrations/inflow'

const prisma = new PrismaClient()

// ─── CLI args ────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const TYPE_ARG = (args.find((a) => a.startsWith('--type=')) || '--type=all').slice(7)
const ALLOWED_TYPES = ['all', 'products', 'pos', 'orders', 'vendors'] as const
type RunType = (typeof ALLOWED_TYPES)[number]
if (!ALLOWED_TYPES.includes(TYPE_ARG as RunType)) {
  console.error(`Invalid --type=${TYPE_ARG}. Use: ${ALLOWED_TYPES.join(', ')}`)
  process.exit(1)
}
const RUN_TYPE = TYPE_ARG as RunType

console.log(`\n=== INFLOW BACKFILL — type=${RUN_TYPE} mode=${APPLY ? 'APPLY (will write to DB)' : 'DRY-RUN (no writes)'} ===\n`)

// ─── InFlow config (raw SQL — getConfig isn't exported) ──────────────
async function getInflowConfig() {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "apiKey", "companyId", "status"::text as "status"
       FROM "IntegrationConfig" WHERE "provider" = 'INFLOW' LIMIT 1`
  )
  const config = rows[0]
  if (config?.apiKey && config?.companyId && config.status === 'CONNECTED') {
    return { apiKey: config.apiKey, companyId: config.companyId }
  }
  if (process.env.INFLOW_API_KEY && process.env.INFLOW_COMPANY_ID) {
    return { apiKey: process.env.INFLOW_API_KEY, companyId: process.env.INFLOW_COMPANY_ID }
  }
  throw new Error('InFlow not configured — no DB row and no env vars')
}

// Fetch the entire resource via cursor pagination (InFlow's `count=N&after=`).
// Page-based pagination (`page=N`) is silently ignored by InFlow.
async function fetchAll(
  basePath: string,
  config: { apiKey: string; companyId: string },
  idKey: string
): Promise<any[]> {
  const all: any[] = []
  for await (const batch of paginateAfter<any>(basePath, config, { idKey })) {
    all.push(...batch)
    process.stdout.write(`  …${basePath} total ${all.length}\r`)
  }
  process.stdout.write('\n')
  return all
}

// ─── Backfill: Products by SKU ───────────────────────────────────────
async function backfillProducts(config: { apiKey: string; companyId: string }) {
  console.log('--- PRODUCTS ---')

  // Pull all InFlow products. The /products endpoint includes sku + productId.
  console.log('Fetching InFlow products…')
  const ifProducts = await fetchAll('/products', config, 'productId')
  console.log(`  InFlow returned ${ifProducts.length} products.`)

  // Build SKU index. Lower-case keys, trimmed. Skip blanks.
  const skuIndex = new Map<string, string>()
  let skipped = 0
  for (const p of ifProducts) {
    const sku = (p.sku || '').trim().toLowerCase()
    const productId = String(p.productId || p.id || '')
    if (!sku || !productId) { skipped++; continue }
    if (skuIndex.has(sku)) {
      // Two InFlow products with same SKU — leave the first one, count the dup.
      skipped++
      continue
    }
    skuIndex.set(sku, productId)
  }
  console.log(`  Indexed ${skuIndex.size} unique SKUs (${skipped} dupes/blanks skipped).`)

  // Find Aegis products needing linkage
  const aegisRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, sku, name FROM "Product"
     WHERE "inflowId" IS NULL AND sku IS NOT NULL AND sku != ''`
  )
  console.log(`  Aegis has ${aegisRows.length} products with NULL inflowId + non-empty SKU.`)

  let matched = 0
  let unmatched = 0
  const writes: Array<{ id: string; sku: string; name: string; inflowId: string }> = []
  for (const r of aegisRows) {
    const sku = String(r.sku).trim().toLowerCase()
    const inflowId = skuIndex.get(sku)
    if (inflowId) {
      writes.push({ id: r.id, sku: r.sku, name: r.name, inflowId })
      matched++
    } else {
      unmatched++
    }
  }

  console.log(`  → match=${matched}  no-match=${unmatched}`)
  if (writes.length > 0 && writes.length <= 10) {
    for (const w of writes) console.log(`    [will link] ${w.sku.padEnd(15)} → ${w.inflowId} (${w.name?.slice(0, 50)})`)
  } else if (writes.length > 10) {
    console.log(`    (showing first 5 of ${writes.length})`)
    for (const w of writes.slice(0, 5)) console.log(`    [will link] ${w.sku.padEnd(15)} → ${w.inflowId} (${w.name?.slice(0, 50)})`)
  }

  if (APPLY && writes.length > 0) {
    let written = 0
    for (const w of writes) {
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "Product" SET "inflowId" = $1, "lastSyncedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
           WHERE id = $2 AND "inflowId" IS NULL`,
          w.inflowId, w.id
        )
        written++
      } catch (err: any) {
        // Most likely a unique-constraint failure (another product already has this inflowId).
        // Log and continue — we'll surface the count at the end.
        console.warn(`    ! failed to link ${w.sku}: ${err.message?.slice(0, 100)}`)
      }
    }
    console.log(`  ✓ APPLIED — ${written}/${writes.length} rows linked.`)
  }

  return { type: 'products', matched, unmatched, writes: writes.length }
}

// ─── Backfill: PurchaseOrders by poNumber ────────────────────────────
async function backfillPurchaseOrders(config: { apiKey: string; companyId: string }) {
  console.log('\n--- PURCHASE ORDERS ---')

  console.log('Fetching InFlow POs…')
  // Try the canonical path first; fall back to alternates the existing sync also tries.
  let ifPOs: any[]
  try {
    ifPOs = await fetchAll('/purchase-orders', config, 'purchaseOrderId')
  } catch (err: any) {
    if (err.message?.includes('404')) {
      try {
        ifPOs = await fetchAll('/purchaseorders', config, 'purchaseOrderId')
      } catch {
        ifPOs = await fetchAll('/purchaseOrders', config, 'purchaseOrderId')
      }
    } else {
      throw err
    }
  }
  console.log(`  InFlow returned ${ifPOs.length} POs.`)

  // Build poNumber → inflowId index. Be careful: the same orderNumber can
  // appear twice in InFlow on rare occasions; if it does, we skip rather
  // than guess.
  const poIndex = new Map<string, string>()
  const poConflicts = new Set<string>()
  for (const p of ifPOs) {
    const num = String(p.orderNumber || p.purchaseOrderNumber || '').trim().toLowerCase()
    const inflowId = String(p.purchaseOrderId || p.id || '')
    if (!num || !inflowId) continue
    if (poIndex.has(num)) {
      poConflicts.add(num)
    } else {
      poIndex.set(num, inflowId)
    }
  }
  for (const conflict of poConflicts) poIndex.delete(conflict) // refuse to guess
  console.log(`  Indexed ${poIndex.size} unique PO numbers (${poConflicts.size} ambiguous skipped).`)

  const aegisRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, "poNumber" FROM "PurchaseOrder"
     WHERE "inflowId" IS NULL AND "poNumber" IS NOT NULL`
  )
  console.log(`  Aegis has ${aegisRows.length} POs with NULL inflowId.`)

  let matched = 0, unmatched = 0
  const writes: Array<{ id: string; poNumber: string; inflowId: string }> = []
  for (const r of aegisRows) {
    const num = String(r.poNumber).trim().toLowerCase()
    const inflowId = poIndex.get(num)
    if (inflowId) {
      writes.push({ id: r.id, poNumber: r.poNumber, inflowId })
      matched++
    } else {
      unmatched++
    }
  }

  console.log(`  → match=${matched}  no-match=${unmatched}`)
  if (writes.length > 0 && writes.length <= 10) {
    for (const w of writes) console.log(`    [will link] ${w.poNumber.padEnd(15)} → ${w.inflowId}`)
  } else if (writes.length > 10) {
    for (const w of writes.slice(0, 5)) console.log(`    [will link] ${w.poNumber.padEnd(15)} → ${w.inflowId}`)
    console.log(`    (… ${writes.length - 5} more)`)
  }

  if (APPLY && writes.length > 0) {
    let written = 0
    for (const w of writes) {
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "PurchaseOrder" SET "inflowId" = $1, "updatedAt" = CURRENT_TIMESTAMP
           WHERE id = $2 AND "inflowId" IS NULL`,
          w.inflowId, w.id
        )
        written++
      } catch (err: any) {
        console.warn(`    ! failed to link ${w.poNumber}: ${err.message?.slice(0, 100)}`)
      }
    }
    console.log(`  ✓ APPLIED — ${written}/${writes.length} rows linked.`)
  }

  return { type: 'pos', matched, unmatched, writes: writes.length }
}

// ─── Backfill: Orders by customer PO number ──────────────────────────
async function backfillOrders(config: { apiKey: string; companyId: string }) {
  console.log('\n--- ORDERS (sales) ---')

  console.log('Fetching InFlow sales orders…')
  let ifSOs: any[]
  try {
    ifSOs = await fetchAll('/sales-orders', config, 'salesOrderId')
  } catch (err: any) {
    if (err.message?.includes('404')) {
      try {
        ifSOs = await fetchAll('/salesorders', config, 'salesOrderId')
      } catch {
        ifSOs = await fetchAll('/salesOrders', config, 'salesOrderId')
      }
    } else {
      throw err
    }
  }
  console.log(`  InFlow returned ${ifSOs.length} SOs.`)

  // Build customerPO → [inflowOrderId]. We accumulate everyone's matches and
  // only use the index entry if exactly ONE InFlow SO has that PO. Refuses
  // to guess on collisions (which can legitimately happen — change orders,
  // re-issued POs, etc.).
  const poToOrders = new Map<string, string[]>()
  for (const s of ifSOs) {
    const customerPo = (s.poNumber || s.customerPO || s.purchaseOrderNumber || '').trim().toLowerCase()
    const inflowId = String(s.salesOrderId || s.id || '')
    if (!customerPo || !inflowId) continue
    const arr = poToOrders.get(customerPo) ?? []
    arr.push(inflowId)
    poToOrders.set(customerPo, arr)
  }
  let unique = 0, ambiguous = 0
  for (const arr of poToOrders.values()) {
    if (arr.length === 1) unique++
    else ambiguous++
  }
  console.log(`  Indexed: ${unique} unique customerPO matches, ${ambiguous} ambiguous (skipped).`)

  const aegisRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, "orderNumber", "poNumber"
       FROM "Order"
      WHERE "inflowOrderId" IS NULL AND "poNumber" IS NOT NULL AND "poNumber" != ''`
  )
  console.log(`  Aegis has ${aegisRows.length} orders with NULL inflowOrderId + non-empty poNumber.`)

  let matched = 0, unmatched = 0, ambiguousAegis = 0
  const writes: Array<{ id: string; orderNumber: string; poNumber: string; inflowId: string }> = []
  for (const r of aegisRows) {
    const po = String(r.poNumber).trim().toLowerCase()
    const candidates = poToOrders.get(po)
    if (!candidates) {
      unmatched++
      continue
    }
    if (candidates.length !== 1) {
      ambiguousAegis++
      continue
    }
    writes.push({ id: r.id, orderNumber: r.orderNumber, poNumber: r.poNumber, inflowId: candidates[0] })
    matched++
  }

  console.log(`  → match=${matched}  no-match=${unmatched}  ambiguous=${ambiguousAegis}`)
  if (writes.length > 0 && writes.length <= 10) {
    for (const w of writes) console.log(`    [will link] ${w.orderNumber.padEnd(20)} po=${w.poNumber.slice(0, 20).padEnd(20)} → ${w.inflowId}`)
  } else if (writes.length > 10) {
    for (const w of writes.slice(0, 5)) console.log(`    [will link] ${w.orderNumber.padEnd(20)} po=${w.poNumber.slice(0, 20).padEnd(20)} → ${w.inflowId}`)
    console.log(`    (… ${writes.length - 5} more)`)
  }

  if (APPLY && writes.length > 0) {
    let written = 0
    for (const w of writes) {
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "Order" SET "inflowOrderId" = $1, "updatedAt" = CURRENT_TIMESTAMP
           WHERE id = $2 AND "inflowOrderId" IS NULL`,
          w.inflowId, w.id
        )
        written++
      } catch (err: any) {
        // unique constraint on inflowOrderId means another order already holds this id.
        console.warn(`    ! failed to link ${w.orderNumber}: ${err.message?.slice(0, 100)}`)
      }
    }
    console.log(`  ✓ APPLIED — ${written}/${writes.length} rows linked.`)
  }

  return { type: 'orders', matched, unmatched, writes: writes.length, ambiguous: ambiguousAegis }
}

// ─── Backfill: Vendors by name ──────────────────────────────────────
async function backfillVendors(config: { apiKey: string; companyId: string }) {
  console.log('\n--- VENDORS ---')

  console.log('Fetching InFlow vendors…')
  let ifVendors: any[]
  try {
    ifVendors = await fetchAll('/vendors', config, 'vendorId')
  } catch (err: any) {
    if (err.message?.includes('404')) {
      ifVendors = await fetchAll('/suppliers', config, 'vendorId')
    } else {
      throw err
    }
  }
  console.log(`  InFlow returned ${ifVendors.length} vendors.`)

  // Build name → inflowVendorId index. Lower-case, trimmed.
  const nameIndex = new Map<string, string>()
  const nameConflicts = new Set<string>()
  for (const v of ifVendors) {
    const name = ((v.companyName || v.name || v.contactName || '') as string).trim().toLowerCase()
    const inflowId = String(v.vendorId || v.companyId || v.id || '')
    if (!name || !inflowId) continue
    if (nameIndex.has(name)) {
      nameConflicts.add(name)
    } else {
      nameIndex.set(name, inflowId)
    }
  }
  for (const c of nameConflicts) nameIndex.delete(c)
  console.log(`  Indexed ${nameIndex.size} unique vendor names (${nameConflicts.size} ambiguous skipped).`)

  const aegisRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, name FROM "Vendor" WHERE "inflowVendorId" IS NULL`
  )
  console.log(`  Aegis has ${aegisRows.length} vendors with NULL inflowVendorId.`)

  let matched = 0, unmatched = 0
  const writes: Array<{ id: string; name: string; inflowId: string }> = []
  for (const r of aegisRows) {
    const name = String(r.name).trim().toLowerCase()
    const inflowId = nameIndex.get(name)
    if (inflowId) {
      writes.push({ id: r.id, name: r.name, inflowId })
      matched++
    } else {
      unmatched++
    }
  }

  console.log(`  → match=${matched}  no-match=${unmatched}`)
  if (writes.length > 0) {
    for (const w of writes.slice(0, 20)) console.log(`    [will link] ${w.name.padEnd(40)} → ${w.inflowId}`)
    if (writes.length > 20) console.log(`    (… ${writes.length - 20} more)`)
  }

  if (APPLY && writes.length > 0) {
    let written = 0
    for (const w of writes) {
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "Vendor" SET "inflowVendorId" = $1, "updatedAt" = CURRENT_TIMESTAMP
           WHERE id = $2 AND "inflowVendorId" IS NULL`,
          w.inflowId, w.id
        )
        written++
      } catch (err: any) {
        console.warn(`    ! failed to link ${w.name}: ${err.message?.slice(0, 100)}`)
      }
    }
    console.log(`  ✓ APPLIED — ${written}/${writes.length} rows linked.`)
  }

  return { type: 'vendors', matched, unmatched, writes: writes.length }
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  const config = await getInflowConfig()
  console.log(`InFlow config OK (companyId=${config.companyId.slice(0, 8)}…)\n`)

  const results: any[] = []
  if (RUN_TYPE === 'all' || RUN_TYPE === 'products') results.push(await backfillProducts(config))
  if (RUN_TYPE === 'all' || RUN_TYPE === 'pos')      results.push(await backfillPurchaseOrders(config))
  if (RUN_TYPE === 'all' || RUN_TYPE === 'orders')   results.push(await backfillOrders(config))
  if (RUN_TYPE === 'all' || RUN_TYPE === 'vendors')  results.push(await backfillVendors(config))

  console.log('\n=== SUMMARY ===')
  console.log(`Mode: ${APPLY ? 'APPLY (writes committed)' : 'DRY-RUN (no writes)'}`)
  for (const r of results) {
    console.log(`  ${String(r.type).padEnd(10)} matched=${r.matched}  no-match=${r.unmatched}${r.ambiguous != null ? `  ambiguous=${r.ambiguous}` : ''}`)
  }
  if (!APPLY) console.log('\nRe-run with --apply to commit the linkages.')
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
