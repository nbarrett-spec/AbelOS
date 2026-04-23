/**
 * scripts/etl-shipping-priority.ts
 *
 * Loads `Sales Orders Shipping Next 2 Weeks.xlsx` (Orders Summary sheet) into
 * Aegis `InboxItem` rows so shipping orders in the next 2 weeks surface in the
 * ops inbox for Sean Phillips / Jordyn Steider.
 *
 * SAFETY:
 *   - Never modifies Order / Delivery / Job / Builder rows.
 *   - Only creates/updates InboxItem rows.
 *   - Idempotent: re-running with the same source tag is a no-op for items
 *     that already exist (keyed by source + entityId|orderNumber).
 *
 * Modes:
 *   (default)   — DRY-RUN: compute the diff, print summary, write nothing
 *   --commit    — actually apply upserts
 *
 * Usage:
 *   npx tsx scripts/etl-shipping-priority.ts
 *   npx tsx scripts/etl-shipping-priority.ts --commit
 *
 * Source columns (Orders Summary sheet):
 *   Order # | Customer | Ship Date | Subtotal | Tax | Total | # Products | Status
 *
 * Target (InboxItem):
 *   type         = "SCHEDULE_CHANGE"
 *   source       = "SHIPPING_2WK_2026-04-22"
 *   title        = "Ship <Order#> to <Customer> on <ShipDate>"
 *   description  = "<# Products> items · $<Total> · Status: <Status>"
 *   priority     = HIGH if shipping within 3 days, else MEDIUM
 *   status       = PENDING
 *   entityType   = "Order" (only if matched)
 *   entityId     = Order.id (only if matched)
 *   financialImpact = Total
 *   dueBy        = Ship Date
 *   actionData   = { orderNumber, customer, shipDate, total, itemCount,
 *                    orderStatus, matchedAegisOrder }
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const prisma = new PrismaClient()

const COMMIT = process.argv.includes('--commit')
const SOURCE_TAG = 'SHIPPING_2WK_2026-04-22'
const SOURCE_FILE = path.resolve(
  __dirname,
  '..',
  '..',
  'Sales Orders Shipping Next 2 Weeks.xlsx',
)

// Window: today (2026-04-22) + 14 days. Ship dates in file span Mar 31 – Apr,
// so to be safe we include any row with a parseable date <= (today + 14d).
// Orders already in the past still matter if they haven't shipped (Status !=
// "Complete"), so we keep past ship dates too and let ops triage.
const TODAY = new Date('2026-04-22T00:00:00Z')
const WINDOW_END = new Date(TODAY.getTime() + 14 * 24 * 60 * 60 * 1000)

type Row = {
  orderNumber: string
  customer: string
  shipDate: Date | null
  shipDateRaw: string
  subtotal: number
  tax: number
  total: number
  itemCount: number
  status: string
}

function parseShipDate(v: unknown): Date | null {
  if (!v) return null
  if (v instanceof Date && !isNaN(v.getTime())) return v
  const s = String(v).trim()
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function num(v: unknown): number {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function readRows(): Row[] {
  if (!fs.existsSync(SOURCE_FILE)) {
    console.error(`Missing source file: ${SOURCE_FILE}`)
    process.exit(1)
  }
  const wb = XLSX.readFile(SOURCE_FILE, { cellDates: true })
  const ws = wb.Sheets['Orders Summary']
  if (!ws) {
    console.error('Sheet "Orders Summary" not found')
    process.exit(1)
  }
  const matrix = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    raw: true,
  }) as unknown[][]
  // Row 0 is headers.
  const rows: Row[] = []
  for (let i = 1; i < matrix.length; i++) {
    const r = matrix[i] || []
    if (r.every((v) => v == null || v === '')) continue
    const orderNumber = String(r[0] ?? '').trim()
    if (!orderNumber) continue
    const customer = String(r[1] ?? '').trim()
    const shipDateRaw = String(r[2] ?? '').trim()
    const shipDate = parseShipDate(r[2])
    rows.push({
      orderNumber,
      customer,
      shipDate,
      shipDateRaw,
      subtotal: num(r[3]),
      tax: num(r[4]),
      total: num(r[5]),
      itemCount: Math.round(num(r[6])),
      status: String(r[7] ?? '').trim(),
    })
  }
  return rows
}

function inWindow(d: Date | null): boolean {
  if (!d) return false
  // Include ship dates at or before WINDOW_END. Past dates are kept too — ops
  // needs to see un-shipped backlog.
  return d <= WINDOW_END
}

function priorityFor(d: Date | null): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' {
  if (!d) return 'MEDIUM'
  const daysOut = Math.floor((d.getTime() - TODAY.getTime()) / 86400000)
  if (daysOut < 0) return 'HIGH' // past-due ship date
  if (daysOut <= 3) return 'HIGH'
  if (daysOut <= 7) return 'MEDIUM'
  return 'LOW'
}

async function main() {
  console.log('═'.repeat(66))
  console.log(`  Shipping Priority ETL — ${SOURCE_TAG}`)
  console.log(`  Mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`)
  console.log('═'.repeat(66))

  const allRows = readRows()
  console.log(`\nLoaded ${allRows.length} rows from Orders Summary`)

  const rows = allRows.filter((r) => inWindow(r.shipDate))
  console.log(`In ship window (<= ${WINDOW_END.toISOString().slice(0, 10)}): ${rows.length}`)

  // Match to Aegis Order.
  const orderNumbers = rows.map((r) => r.orderNumber)
  const existing = await prisma.order.findMany({
    where: { OR: [{ orderNumber: { in: orderNumbers } }, { inflowOrderId: { in: orderNumbers } }] },
    select: { id: true, orderNumber: true, inflowOrderId: true },
  })
  const byOrderNumber = new Map(existing.map((o) => [o.orderNumber, o]))
  const byInflowId = new Map(
    existing.filter((o) => o.inflowOrderId).map((o) => [o.inflowOrderId as string, o]),
  )

  let matched = 0
  let unmatched = 0
  let totalDollars = 0
  const plan: Array<{
    row: Row
    aegisOrderId: string | null
    priority: string
    upsertKey: string
  }> = []

  for (const r of rows) {
    const aegis =
      byOrderNumber.get(r.orderNumber) ?? byInflowId.get(r.orderNumber) ?? null
    if (aegis) matched++
    else unmatched++
    totalDollars += r.total
    plan.push({
      row: r,
      aegisOrderId: aegis?.id ?? null,
      priority: priorityFor(r.shipDate),
      // idempotency key: source tag + orderNumber. We dedupe via `source` +
      // `actionData.orderNumber` lookup below.
      upsertKey: r.orderNumber,
    })
  }

  console.log(`Matched to Aegis Order:   ${matched}`)
  console.log(`Unmatched (note added):   ${unmatched}`)
  console.log(`Total $ in window:        $${totalDollars.toFixed(2)}`)

  // Preview
  console.log('\nPreview (first 10):')
  for (const p of plan.slice(0, 10)) {
    const mark = p.aegisOrderId ? '[LINKED]' : '[UNMATCHED]'
    console.log(
      `  ${mark} ${p.row.orderNumber.padEnd(11)} ` +
        `${p.row.customer.slice(0, 24).padEnd(24)} ` +
        `${p.row.shipDateRaw.padEnd(14)} ` +
        `$${p.row.total.toFixed(2).padStart(9)} ` +
        `[${p.priority}]`,
    )
  }

  // Idempotency: pull existing inbox items for this source tag, key by
  // actionData.orderNumber. Raw SQL to sidestep drifted `brainAcknowledgedAt`.
  const existingInbox = await prisma.$queryRaw<
    Array<{ id: string; actionData: any }>
  >`SELECT "id", "actionData" FROM "InboxItem" WHERE "source" = ${SOURCE_TAG}`
  const existingByOrder = new Map<string, string>()
  for (const it of existingInbox) {
    const ad = (it.actionData as any) ?? {}
    if (ad.orderNumber) existingByOrder.set(String(ad.orderNumber), it.id)
  }
  const toCreate = plan.filter((p) => !existingByOrder.has(p.row.orderNumber))
  const toUpdate = plan.filter((p) => existingByOrder.has(p.row.orderNumber))

  console.log(`\nInbox items to create: ${toCreate.length}`)
  console.log(`Inbox items to update: ${toUpdate.length}`)

  if (!COMMIT) {
    console.log('\nDRY-RUN — no writes. Re-run with --commit to apply.')
    await prisma.$disconnect()
    return
  }

  let created = 0
  let updated = 0
  for (const p of plan) {
    const r = p.row
    const title = `Ship ${r.orderNumber} to ${r.customer}${
      r.shipDateRaw ? ` on ${r.shipDateRaw}` : ''
    }`
    const descPieces = [
      `${r.itemCount} items`,
      `$${r.total.toFixed(2)}`,
      r.status ? `Status: ${r.status}` : null,
      p.aegisOrderId ? null : 'order not in Aegis',
    ].filter(Boolean)
    const description = descPieces.join(' · ')
    const actionData = {
      orderNumber: r.orderNumber,
      customer: r.customer,
      shipDate: r.shipDate ? r.shipDate.toISOString() : null,
      shipDateRaw: r.shipDateRaw,
      subtotal: r.subtotal,
      tax: r.tax,
      total: r.total,
      itemCount: r.itemCount,
      orderStatus: r.status,
      matchedAegisOrder: !!p.aegisOrderId,
    }

    // NOTE: use raw SQL because `InboxItem.brainAcknowledgedAt` is present in
    // schema.prisma but not yet migrated to the prod DB. Prisma's generated
    // client SELECTs every modelled column on create/update and will fail
    // with P2022. Raw SQL lets us touch only columns that exist.
    const existingId = existingByOrder.get(r.orderNumber)
    if (existingId) {
      await prisma.$executeRaw`
        UPDATE "InboxItem"
        SET "title" = ${title},
            "description" = ${description},
            "priority" = ${p.priority},
            "entityType" = ${p.aegisOrderId ? 'Order' : null},
            "entityId" = ${p.aegisOrderId},
            "financialImpact" = ${r.total},
            "dueBy" = ${r.shipDate},
            "actionData" = ${JSON.stringify(actionData)}::jsonb,
            "updatedAt" = NOW()
        WHERE "id" = ${existingId}
      `
      updated++
    } else {
      // cuid-ish id: 25 chars, base36, prefixed with 'c'. Good enough for
      // a tagged ETL insert that avoids pulling in the cuid dep.
      const id =
        'c' +
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 12) +
        Math.random().toString(36).slice(2, 6)
      await prisma.$executeRaw`
        INSERT INTO "InboxItem"
          ("id", "type", "source", "title", "description", "priority",
           "status", "entityType", "entityId", "financialImpact", "dueBy",
           "actionData", "createdAt", "updatedAt")
        VALUES
          (${id}, 'SCHEDULE_CHANGE', ${SOURCE_TAG}, ${title}, ${description},
           ${p.priority}, 'PENDING',
           ${p.aegisOrderId ? 'Order' : null}, ${p.aegisOrderId},
           ${r.total}, ${r.shipDate},
           ${JSON.stringify(actionData)}::jsonb,
           NOW(), NOW())
      `
      created++
    }
  }

  console.log(`\nCreated: ${created}`)
  console.log(`Updated: ${updated}`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
