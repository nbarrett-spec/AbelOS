/**
 * scripts/order-health-scan.ts
 *
 * READ-ONLY health scan across Aegis Orders / Invoices / Payments.
 * Identifies four categories of problem orders and writes InboxItem
 * summaries + top-20-by-$ ID lists for each category.
 *
 * Categories:
 *   1. RECEIVED > 30 days              — should have progressed
 *   2. IN_PRODUCTION > 21 days         — stuck in manufacturing
 *   3. CONFIRMED with no deliveryDate  — missing schedule
 *   4. DELIVERED > 30 days ago, zero
 *      payments against linked invoice — unpaid post-delivery
 *
 * Order/Invoice/Payment tables are READ-ONLY here.
 * Writes happen only to InboxItem, and only with --commit.
 *
 * Source tag: ORDER_HEALTH_APR2026 (stored on each InboxItem.actionData.sourceTag)
 *
 * Usage:
 *   npx tsx scripts/order-health-scan.ts                # DRY-RUN
 *   npx tsx scripts/order-health-scan.ts --commit       # write InboxItems
 */

import { PrismaClient } from '@prisma/client'
import * as dotenv from 'dotenv'
import * as path from 'node:path'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const SOURCE_TAG = 'ORDER_HEALTH_APR2026'
const COMMIT = process.argv.includes('--commit')

const prisma = new PrismaClient()

type OrderRow = {
  id: string
  orderNumber: string
  total: number
  status: string
  deliveryDate: Date | null
  orderDate: Date | null
  createdAt: Date
  updatedAt: Date
  builderId: string
}

type Finding = {
  key: 'STUCK_RECEIVED' | 'STUCK_IN_PRODUCTION' | 'CONFIRMED_NO_DELIVERY' | 'DELIVERED_UNPAID'
  title: string
  description: string
  orders: OrderRow[]
  totalImpact: number
}

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function fmt$(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

async function main() {
  console.log(`[order-health-scan] mode=${COMMIT ? 'COMMIT' : 'DRY-RUN'} sourceTag=${SOURCE_TAG}`)

  const now = new Date()
  const d30 = daysAgo(30)
  const d21 = daysAgo(21)

  // Anchor "age" on updatedAt — the last time the row's status or fields changed.
  // This is the best available proxy for "time in current status" without a
  // dedicated status-transition audit table.

  // ── Category 1: RECEIVED > 30 days ─────────────────────────────────
  const stuckReceived = (await prisma.order.findMany({
    where: { status: 'RECEIVED', updatedAt: { lt: d30 } },
    select: {
      id: true,
      orderNumber: true,
      total: true,
      status: true,
      deliveryDate: true,
      orderDate: true,
      createdAt: true,
      updatedAt: true,
      builderId: true,
    },
    orderBy: { total: 'desc' },
  })) as OrderRow[]

  // ── Category 2: IN_PRODUCTION > 21 days ────────────────────────────
  const stuckInProduction = (await prisma.order.findMany({
    where: { status: 'IN_PRODUCTION', updatedAt: { lt: d21 } },
    select: {
      id: true,
      orderNumber: true,
      total: true,
      status: true,
      deliveryDate: true,
      orderDate: true,
      createdAt: true,
      updatedAt: true,
      builderId: true,
    },
    orderBy: { total: 'desc' },
  })) as OrderRow[]

  // ── Category 3: CONFIRMED with no deliveryDate ─────────────────────
  const confirmedNoDelivery = (await prisma.order.findMany({
    where: { status: 'CONFIRMED', deliveryDate: null },
    select: {
      id: true,
      orderNumber: true,
      total: true,
      status: true,
      deliveryDate: true,
      orderDate: true,
      createdAt: true,
      updatedAt: true,
      builderId: true,
    },
    orderBy: { total: 'desc' },
  })) as OrderRow[]

  // ── Category 4: DELIVERED > 30 days ago, unpaid ────────────────────
  // Strategy: pull every Order.status=DELIVERED with updatedAt<d30, then
  // look up Invoices (by orderId) and their Payments. An order is "unpaid"
  // if there is an invoice with amountPaid<=0 AND no Payment rows, OR
  // there is no invoice at all (can't collect what we didn't invoice — still
  // a flag). Payment.receivedAt is the source of truth for "payment recorded".
  const deliveredCandidates = (await prisma.order.findMany({
    where: { status: 'DELIVERED', updatedAt: { lt: d30 } },
    select: {
      id: true,
      orderNumber: true,
      total: true,
      status: true,
      deliveryDate: true,
      orderDate: true,
      createdAt: true,
      updatedAt: true,
      builderId: true,
    },
  })) as OrderRow[]

  const deliveredIds = deliveredCandidates.map((o) => o.id)
  const invoices = deliveredIds.length
    ? await prisma.invoice.findMany({
        where: { orderId: { in: deliveredIds } },
        select: {
          id: true,
          orderId: true,
          amountPaid: true,
          balanceDue: true,
          total: true,
        },
      })
    : []

  const invoiceIds = invoices.map((i) => i.id)
  const payments = invoiceIds.length
    ? await prisma.payment.findMany({
        where: { invoiceId: { in: invoiceIds } },
        select: { invoiceId: true, amount: true },
      })
    : []

  const paidByInvoice = new Map<string, number>()
  for (const p of payments) {
    paidByInvoice.set(p.invoiceId, (paidByInvoice.get(p.invoiceId) ?? 0) + (p.amount ?? 0))
  }

  const invoicesByOrder = new Map<string, typeof invoices>()
  for (const inv of invoices) {
    if (!inv.orderId) continue
    const arr = invoicesByOrder.get(inv.orderId) ?? []
    arr.push(inv)
    invoicesByOrder.set(inv.orderId, arr)
  }

  const deliveredUnpaid: OrderRow[] = []
  for (const o of deliveredCandidates) {
    const invs = invoicesByOrder.get(o.id) ?? []
    if (invs.length === 0) {
      // Delivered but never invoiced — flag it.
      deliveredUnpaid.push(o)
      continue
    }
    const totalPaid = invs.reduce(
      (sum, inv) => sum + (inv.amountPaid ?? 0) + (paidByInvoice.get(inv.id) ?? 0),
      0,
    )
    if (totalPaid <= 0) deliveredUnpaid.push(o)
  }
  deliveredUnpaid.sort((a, b) => b.total - a.total)

  // ── Assemble findings ──────────────────────────────────────────────
  const findings: Finding[] = [
    {
      key: 'STUCK_RECEIVED',
      title: `Stuck in RECEIVED > 30 days (${stuckReceived.length} orders)`,
      description: `Orders sitting in RECEIVED without progressing for more than 30 days as of ${now.toISOString().slice(0, 10)}. These should be confirmed, cancelled, or reassigned.`,
      orders: stuckReceived,
      totalImpact: stuckReceived.reduce((s, o) => s + o.total, 0),
    },
    {
      key: 'STUCK_IN_PRODUCTION',
      title: `Stuck in IN_PRODUCTION > 21 days (${stuckInProduction.length} orders)`,
      description: `Orders in IN_PRODUCTION for more than 21 days. Typical production SLA should be under 3 weeks — investigate for material holds, vendor delays, or lost jobs.`,
      orders: stuckInProduction,
      totalImpact: stuckInProduction.reduce((s, o) => s + o.total, 0),
    },
    {
      key: 'CONFIRMED_NO_DELIVERY',
      title: `CONFIRMED without delivery date (${confirmedNoDelivery.length} orders)`,
      description: `Orders accepted into CONFIRMED status with no deliveryDate populated. Schedule gap — PMs need to slot these into the delivery calendar.`,
      orders: confirmedNoDelivery,
      totalImpact: confirmedNoDelivery.reduce((s, o) => s + o.total, 0),
    },
    {
      key: 'DELIVERED_UNPAID',
      title: `DELIVERED > 30 days, no payment recorded (${deliveredUnpaid.length} orders)`,
      description: `Orders marked DELIVERED more than 30 days ago with zero payments logged against their invoice(s) (or no invoice at all). Collections / AR risk — escalate to Dawn.`,
      orders: deliveredUnpaid,
      totalImpact: deliveredUnpaid.reduce((s, o) => s + o.total, 0),
    },
  ]

  // ── Report to console ──────────────────────────────────────────────
  console.log('\n────────────── ORDER HEALTH FINDINGS ──────────────')
  for (const f of findings) {
    console.log(`\n[${f.key}] ${f.title}`)
    console.log(`  Impact: ${fmt$(f.totalImpact)}`)
    const top5 = f.orders.slice(0, 5)
    for (const o of top5) {
      const age = Math.round((now.getTime() - o.updatedAt.getTime()) / (1000 * 60 * 60 * 24))
      console.log(`   - ${o.orderNumber}  ${fmt$(o.total)}  age=${age}d  id=${o.id}`)
    }
    if (f.orders.length > 5) console.log(`   … and ${f.orders.length - 5} more`)
  }

  // ── Build InboxItem payloads ───────────────────────────────────────
  type NewInbox = {
    type: string
    source: string
    title: string
    description: string
    priority: string
    entityType?: string
    entityId?: string
    financialImpact?: number
    actionData: unknown
  }

  const toCreate: NewInbox[] = []

  for (const f of findings) {
    if (f.orders.length === 0) continue

    const top20 = f.orders.slice(0, 20)

    // 1 — summary card
    toCreate.push({
      type: 'SYSTEM',
      source: 'order-health-scan',
      title: `[Order Health] ${f.title}`,
      description: `${f.description}\n\nTotal financial exposure: ${fmt$(f.totalImpact)}.\nTop order: ${f.orders[0]?.orderNumber ?? '—'} at ${fmt$(f.orders[0]?.total ?? 0)}.`,
      priority: f.key === 'DELIVERED_UNPAID' ? 'HIGH' : 'MEDIUM',
      financialImpact: f.totalImpact,
      actionData: {
        sourceTag: SOURCE_TAG,
        kind: 'summary',
        category: f.key,
        orderCount: f.orders.length,
        totalImpact: f.totalImpact,
        scannedAt: now.toISOString(),
      },
    })

    // 2 — top-20 by $ as a follow-up drill-in card
    toCreate.push({
      type: 'SYSTEM',
      source: 'order-health-scan',
      title: `[Order Health] ${f.key} — top ${top20.length} by $`,
      description: `Top ${top20.length} ${f.key} orders ranked by total dollar value. Combined: ${fmt$(top20.reduce((s, o) => s + o.total, 0))}.`,
      priority: f.key === 'DELIVERED_UNPAID' ? 'HIGH' : 'MEDIUM',
      financialImpact: top20.reduce((s, o) => s + o.total, 0),
      actionData: {
        sourceTag: SOURCE_TAG,
        kind: 'id-list',
        category: f.key,
        scannedAt: now.toISOString(),
        orderIds: top20.map((o) => o.id),
        orders: top20.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          total: o.total,
          status: o.status,
          updatedAt: o.updatedAt.toISOString(),
          builderId: o.builderId,
        })),
      },
    })
  }

  console.log(`\nInboxItems staged: ${toCreate.length}`)

  if (!COMMIT) {
    console.log('\n[DRY-RUN] No InboxItems written. Re-run with --commit to persist.')
    await prisma.$disconnect()
    return
  }

  // ── Commit ─────────────────────────────────────────────────────────
  let created = 0
  for (const item of toCreate) {
    await prisma.inboxItem.create({
      data: {
        type: item.type,
        source: item.source,
        title: item.title,
        description: item.description,
        priority: item.priority,
        status: 'PENDING',
        financialImpact: item.financialImpact ?? null,
        actionData: item.actionData as never,
      },
    })
    created++
  }

  console.log(`\n[COMMIT] Created ${created} InboxItem rows (sourceTag=${SOURCE_TAG}).`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('[order-health-scan] FAILED', e)
  process.exit(1)
})
