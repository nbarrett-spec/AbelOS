/**
 * scripts/etl-backorder-compute.ts
 *
 * Backorder-position autocomputer. For every OPEN Order (status in
 * RECEIVED / CONFIRMED / IN_PRODUCTION) we sum qty-required per SKU
 * across all OrderItems, compare against InventoryItem.available, and
 * flag the top-20 shortages by dollar impact (shortage qty * Product.cost)
 * as InboxItems for the ops team.
 *
 *   Priority CRITICAL if shortage > 5 units, otherwise HIGH.
 *
 * Writes InboxItem rows ONLY. Order / OrderItem / InventoryItem / Product
 * are read-only. BackorderItem rows are intentionally NOT written — the
 * schema requires an orderId FK per row and resolving which single order
 * "owns" a multi-order shortage is out of scope for this pass.
 *
 * Modes:
 *   --dry-run  (default) — plan + report, write nothing
 *   --commit             — actually insert InboxItem rows
 *
 * Source tag: BACKORDER_AUTOCOMPUTE
 */

import { PrismaClient } from '@prisma/client'
import * as path from 'node:path'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const argv = process.argv.slice(2)
const DRY_RUN = !argv.includes('--commit')

const SOURCE_TAG = 'BACKORDER_AUTOCOMPUTE'
const OPEN_STATUSES = ['RECEIVED', 'CONFIRMED', 'IN_PRODUCTION'] as const
const TOP_N = 20
const CRITICAL_UNIT_THRESHOLD = 5

const prisma = new PrismaClient()

function bar(title: string) {
  console.log('\n' + '='.repeat(68))
  console.log('  ' + title)
  console.log('='.repeat(68))
}

function money(n: number): string {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

type Shortage = {
  productId: string
  sku: string
  productName: string
  category: string
  unitCost: number
  demand: number
  available: number
  shortage: number
  dollarImpact: number
  ordersAffected: string[] // order IDs
}

async function main() {
  bar(`etl-backorder-compute — ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`  Open statuses: ${OPEN_STATUSES.join(', ')}`)
  console.log(`  Top N by $ impact: ${TOP_N}`)
  console.log(`  Source tag: ${SOURCE_TAG}`)

  try {
    // ─── 1. pull open orders + items ─────────────────────────────────
    bar('Step 1: load open orders and items (READ-ONLY)')
    const openOrders = await prisma.order.findMany({
      where: { status: { in: [...OPEN_STATUSES] } },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        items: {
          select: {
            productId: true,
            quantity: true,
          },
        },
      },
    })
    console.log(`  Open orders found: ${openOrders.length}`)
    const totalOrderItems = openOrders.reduce((s, o) => s + o.items.length, 0)
    console.log(`  Total OrderItem lines: ${totalOrderItems}`)

    if (openOrders.length === 0) {
      bar('No open orders — nothing to do.')
      await prisma.$disconnect()
      return
    }

    // ─── 2. aggregate demand per productId ───────────────────────────
    const demandByProduct = new Map<
      string,
      { demand: number; orderIds: Set<string> }
    >()
    for (const o of openOrders) {
      for (const it of o.items) {
        const slot = demandByProduct.get(it.productId) ?? {
          demand: 0,
          orderIds: new Set<string>(),
        }
        slot.demand += it.quantity
        slot.orderIds.add(o.id)
        demandByProduct.set(it.productId, slot)
      }
    }
    console.log(`  Unique productIds with demand: ${demandByProduct.size}`)

    // ─── 3. pull Product + InventoryItem for those productIds ───────
    bar('Step 2: load Product + InventoryItem (READ-ONLY)')
    const productIds = [...demandByProduct.keys()]
    const [products, invItems] = await Promise.all([
      prisma.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          sku: true,
          name: true,
          category: true,
          cost: true,
        },
      }),
      prisma.inventoryItem.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true, available: true },
      }),
    ])
    const productById = new Map(products.map((p) => [p.id, p]))
    const availByProduct = new Map(invItems.map((i) => [i.productId, i.available]))
    console.log(`  Products loaded:       ${products.length}`)
    console.log(`  InventoryItems loaded: ${invItems.length}`)
    console.log(`  Products missing inv record (treated as 0 available): ${productIds.length - invItems.length}`)

    // ─── 4. compute shortages ────────────────────────────────────────
    bar('Step 3: compute shortages (demand > available)')
    const shortages: Shortage[] = []
    for (const [productId, { demand, orderIds }] of demandByProduct) {
      const available = availByProduct.get(productId) ?? 0
      if (demand <= available) continue
      const product = productById.get(productId)
      if (!product) {
        // Orphan productId — has orders but no Product row. Skip (data issue).
        continue
      }
      const shortage = demand - available
      const dollarImpact = shortage * (product.cost ?? 0)
      shortages.push({
        productId,
        sku: product.sku,
        productName: product.name,
        category: product.category,
        unitCost: product.cost ?? 0,
        demand,
        available,
        shortage,
        dollarImpact,
        ordersAffected: [...orderIds],
      })
    }

    shortages.sort((a, b) => b.dollarImpact - a.dollarImpact)
    const top = shortages.slice(0, TOP_N)

    const totalOrdersAffected = new Set<string>()
    for (const s of shortages) for (const oid of s.ordersAffected) totalOrdersAffected.add(oid)

    const totalDollar = shortages.reduce((s, r) => s + r.dollarImpact, 0)
    const topDollar = top.reduce((s, r) => s + r.dollarImpact, 0)

    console.log(`  SKUs in shortage:              ${shortages.length}`)
    console.log(`  Orders affected (any SKU):     ${totalOrdersAffected.size}`)
    console.log(`  Total $ exposure (all SKUs):   ${money(totalDollar)}`)
    console.log(`  Top ${TOP_N} $ exposure:              ${money(topDollar)}`)

    bar(`Top ${TOP_N} shortages by $ impact`)
    console.log(
      `  ${'SKU'.padEnd(12)} ${'Demand'.padStart(7)} ${'Avail'.padStart(7)} ${'Short'.padStart(7)} ${'Cost'.padStart(10)} ${'$ Impact'.padStart(14)} ${'Orders'.padStart(7)}  Product`,
    )
    for (const r of top) {
      console.log(
        `  ${r.sku.padEnd(12)} ${String(r.demand).padStart(7)} ${String(r.available).padStart(7)} ${String(r.shortage).padStart(7)} ${money(r.unitCost).padStart(10)} ${money(r.dollarImpact).padStart(14)} ${String(r.ordersAffected.length).padStart(7)}  ${r.productName.slice(0, 45)}`,
      )
    }

    if (DRY_RUN) {
      bar('DRY-RUN complete — no changes written')
      console.log(`  Would create ${top.length} InboxItem rows (source=${SOURCE_TAG}).`)
      console.log('  Re-run with --commit to apply.')
      await prisma.$disconnect()
      return
    }

    // ─── 5. COMMIT: insert one InboxItem per top-N shortage ─────────
    bar('COMMIT — writing InboxItem rows')

    async function insertInbox(r: Shortage) {
      const priority: 'CRITICAL' | 'HIGH' =
        r.shortage > CRITICAL_UNIT_THRESHOLD ? 'CRITICAL' : 'HIGH'
      const title = `Backorder: ${r.sku} short ${r.shortage} unit${r.shortage === 1 ? '' : 's'} — ${r.productName.slice(0, 50)}`
      const description =
        `Open-order demand = ${r.demand}, InventoryItem.available = ${r.available}. ` +
        `Shortage = ${r.shortage} unit${r.shortage === 1 ? '' : 's'} ` +
        `@ ${money(r.unitCost)}/ea = ${money(r.dollarImpact)} exposure. ` +
        `Affects ${r.ordersAffected.length} open order${r.ordersAffected.length === 1 ? '' : 's'}. ` +
        `Category: ${r.category}.`

      // Raw SQL mirror of scripts/etl-inventory-count.ts to avoid the
      // brainAcknowledgedAt P2022 issue on not-yet-migrated DBs.
      const id = 'c' + Math.random().toString(36).slice(2, 14) + Date.now().toString(36)
      const actionData = {
        reason: 'BACKORDER_AUTOCOMPUTE',
        sku: r.sku,
        productId: r.productId,
        demand: r.demand,
        available: r.available,
        shortage: r.shortage,
        unitCost: r.unitCost,
        dollarImpact: r.dollarImpact,
        ordersAffected: r.ordersAffected,
      }
      await prisma.$executeRaw`
        INSERT INTO "InboxItem" (
          id, type, source, title, description, priority, status,
          "entityType", "entityId", "financialImpact",
          "actionData", "createdAt", "updatedAt"
        ) VALUES (
          ${id}, 'MATERIAL_ARRIVAL', ${SOURCE_TAG},
          ${title}, ${description}, ${priority}, 'PENDING',
          'Product', ${r.productId}, ${r.dollarImpact},
          ${JSON.stringify(actionData)}::jsonb,
          NOW(), NOW()
        )
      `
    }

    let inboxCreated = 0
    for (const r of top) {
      await insertInbox(r)
      inboxCreated++
    }
    console.log(`  InboxItem rows created: ${inboxCreated}`)

    bar('DONE')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
