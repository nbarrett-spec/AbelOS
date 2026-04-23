/**
 * scripts/invoice-payment-recon.ts
 *
 * READ-ONLY Invoice ↔ Payment ↔ Order integrity pass.
 *
 * Context (as of run):
 *   - 104 Invoices, 66 Payments, 3,646 Orders, 131 CollectionActions
 *   - Prior audit (A63) flagged AR -73% gap: real AR lives in AccountTouchpoint,
 *     not Invoice. Boise AP +268%. This pass does not re-check those totals —
 *     it verifies internal consistency of the records that DO exist on
 *     Invoice / Payment / Order.
 *   - Cowork shipped AR aging + collections ladder (commit 5770583). Do NOT
 *     touch src/app/(app)/collections/** or prisma/**.
 *
 * Checks:
 *   1. Invoice ↔ Payment:
 *        sum(Payment.amount for invoice) vs (Invoice.total - Invoice.balanceDue)
 *        flag if |diff| > $1
 *   2. Invoice self-consistency:
 *        - status = PAID but balanceDue > 0
 *        - status = PAID but zero Payment rows
 *        - amountPaid field vs sum(Payment.amount)
 *   3. Payment orphans:
 *        - Payment.invoiceId pointing to a deleted/missing Invoice
 *   4. Order ↔ Invoice:
 *        - Order.status = DELIVERED but no Invoice with orderId
 *        - Order.paymentStatus = PAID but linked Invoice has balanceDue > 0
 *
 * Outputs:
 *   - stdout summary
 *   - AEGIS-FINANCIAL-RECON-v2.md (supersedes AEGIS-FINANCIAL-RECON.md)
 *   - up to 5 CRITICAL InboxItems (source tag FIN_RECON_v2_APR2026)
 *
 * READ-ONLY on: Invoice, InvoiceItem, Payment, Order, OrderItem.
 * WRITES (finding surfacing only): InboxItem (type=SYSTEM, source=recon-fin-recon-v2-apr2026).
 *
 * Source tag: FIN_RECON_v2_APR2026
 * Run: npx tsx scripts/invoice-payment-recon.ts
 */

import * as path from 'node:path'
import * as fs from 'node:fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const SOURCE_TAG = 'FIN_RECON_v2_APR2026'
const INBOX_SOURCE = `recon-${SOURCE_TAG.toLowerCase()}`
const RUN_TIMESTAMP = new Date().toISOString()
const REPORT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'AEGIS-FINANCIAL-RECON-v2.md',
)

const PENNY_TOLERANCE = 1.0 // dollar

type Section = { title: string; lines: string[] }
const sections: Section[] = []

function section(title: string, lines: string[]) {
  sections.push({ title, lines })
  console.log('\n' + '─'.repeat(72))
  console.log('  ' + title)
  console.log('─'.repeat(72))
  for (const l of lines) console.log(l)
}

function usd(n: number): string {
  const sign = n < 0 ? '-' : ''
  return sign + '$' + Math.round(Math.abs(n)).toLocaleString('en-US')
}

// ── Finding buckets ──────────────────────────────────────────────────
type PaymentSumMismatch = {
  invoiceId: string
  invoiceNumber: string
  status: string
  total: number
  balanceDue: number
  expectedPaid: number // total - balanceDue
  actualPaidSum: number // sum(Payment.amount)
  amountPaidField: number
  diff: number // actualPaidSum - expectedPaid
}

type InvoicePaidButBalance = {
  invoiceId: string
  invoiceNumber: string
  status: string
  balanceDue: number
  total: number
}

type InvoicePaidNoPayments = {
  invoiceId: string
  invoiceNumber: string
  total: number
}

type OrphanPayment = {
  paymentId: string
  invoiceId: string
  amount: number
  receivedAt: Date | null
  reference: string | null
}

type OrderMissingInvoice = {
  orderId: string
  orderNumber: string
  total: number
  status: string
  paymentStatus: string
  deliveryDate: Date | null
}

type OrderPaidInvoiceBalance = {
  orderId: string
  orderNumber: string
  paymentStatus: string
  invoiceId: string
  invoiceNumber: string
  balanceDue: number
}

const paymentSumMismatches: PaymentSumMismatch[] = []
const paidWithBalance: InvoicePaidButBalance[] = []
const paidNoPayments: InvoicePaidNoPayments[] = []
const orphanPayments: OrphanPayment[] = []
const deliveredNoInvoice: OrderMissingInvoice[] = []
const orderPaidInvoiceBalance: OrderPaidInvoiceBalance[] = []

// ── Check 1 & 2: Invoice ↔ Payment + invoice self-consistency ────────
async function reconcileInvoices() {
  const invoices = await prisma.invoice.findMany({
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      total: true,
      amountPaid: true,
      balanceDue: true,
      payments: {
        select: { id: true, amount: true },
      },
    },
  })

  let totalExpectedPaid = 0
  let totalActualPaid = 0

  for (const inv of invoices) {
    const paidSum = inv.payments.reduce((s, p) => s + (p.amount || 0), 0)
    const expectedPaid = (inv.total || 0) - (inv.balanceDue || 0)
    const diff = paidSum - expectedPaid

    totalExpectedPaid += expectedPaid
    totalActualPaid += paidSum

    if (Math.abs(diff) > PENNY_TOLERANCE) {
      paymentSumMismatches.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        status: inv.status,
        total: inv.total,
        balanceDue: inv.balanceDue,
        expectedPaid,
        actualPaidSum: paidSum,
        amountPaidField: inv.amountPaid,
        diff,
      })
    }

    if (inv.status === 'PAID') {
      if ((inv.balanceDue || 0) > PENNY_TOLERANCE) {
        paidWithBalance.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          status: inv.status,
          balanceDue: inv.balanceDue,
          total: inv.total,
        })
      }
      if (inv.payments.length === 0) {
        paidNoPayments.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          total: inv.total,
        })
      }
    }
  }

  // Sort mismatches by |diff| desc
  paymentSumMismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))

  const totalMismatchUsd = paymentSumMismatches.reduce(
    (s, m) => s + Math.abs(m.diff),
    0,
  )

  const lines = [
    `Invoices examined:                              ${invoices.length}`,
    `Σ(total − balanceDue) (expected paid):          ${usd(totalExpectedPaid)}`,
    `Σ(Payment.amount) (actual paid):                ${usd(totalActualPaid)}`,
    `Σ|diff| where |diff| > $${PENNY_TOLERANCE}:                ${usd(totalMismatchUsd)}`,
    '',
    `Payment-sum mismatches (|diff| > $${PENNY_TOLERANCE}):       ${paymentSumMismatches.length}`,
    ...paymentSumMismatches.slice(0, 10).map(
      (m) =>
        `  ! ${m.invoiceNumber.padEnd(20)} status=${m.status.padEnd(15)} expected=${usd(m.expectedPaid)} actual=${usd(m.actualPaidSum)} diff=${usd(m.diff)}`,
    ),
    paymentSumMismatches.length > 10
      ? `  (+${paymentSumMismatches.length - 10} more)`
      : '',
    '',
    `Status=PAID but balanceDue > $${PENNY_TOLERANCE}:            ${paidWithBalance.length}`,
    ...paidWithBalance.slice(0, 10).map(
      (p) =>
        `  ! ${p.invoiceNumber.padEnd(20)} balanceDue=${usd(p.balanceDue)} / total=${usd(p.total)}`,
    ),
    paidWithBalance.length > 10
      ? `  (+${paidWithBalance.length - 10} more)`
      : '',
    '',
    `Status=PAID but zero Payment rows:              ${paidNoPayments.length}`,
    ...paidNoPayments.slice(0, 10).map(
      (p) => `  ! ${p.invoiceNumber.padEnd(20)} total=${usd(p.total)}`,
    ),
    paidNoPayments.length > 10 ? `  (+${paidNoPayments.length - 10} more)` : '',
  ].filter(Boolean)
  section('Invoice ↔ Payment Reconciliation', lines)

  return {
    totalExpectedPaid,
    totalActualPaid,
    totalMismatchUsd,
    invoiceCount: invoices.length,
  }
}

// ── Check 3: Orphan payments (FK points to invoice that doesn't exist)
async function findOrphanPayments() {
  const payments = await prisma.payment.findMany({
    select: {
      id: true,
      invoiceId: true,
      amount: true,
      receivedAt: true,
      reference: true,
    },
  })

  if (payments.length === 0) {
    section('Orphan Payments (invoiceId → missing Invoice)', [
      `Payments examined: 0`,
      `Orphans:           0`,
    ])
    return { paymentCount: 0, orphanUsd: 0 }
  }

  const invoiceIds = Array.from(new Set(payments.map((p) => p.invoiceId)))
  const existing = await prisma.invoice.findMany({
    where: { id: { in: invoiceIds } },
    select: { id: true },
  })
  const existingSet = new Set(existing.map((e) => e.id))

  for (const p of payments) {
    if (!existingSet.has(p.invoiceId)) {
      orphanPayments.push({
        paymentId: p.id,
        invoiceId: p.invoiceId,
        amount: p.amount,
        receivedAt: p.receivedAt,
        reference: p.reference,
      })
    }
  }

  orphanPayments.sort((a, b) => b.amount - a.amount)
  const orphanUsd = orphanPayments.reduce((s, o) => s + o.amount, 0)

  const lines = [
    `Payments examined:        ${payments.length}`,
    `Orphans (missing invoice): ${orphanPayments.length}  (${usd(orphanUsd)})`,
    '',
    ...orphanPayments
      .slice(0, 10)
      .map(
        (o) =>
          `  ! payment=${o.paymentId.slice(0, 12)}… invoiceId=${o.invoiceId.slice(0, 12)}… ${usd(o.amount)}`,
      ),
    orphanPayments.length > 10 ? `  (+${orphanPayments.length - 10} more)` : '',
  ].filter(Boolean)
  section('Orphan Payments (invoiceId → missing Invoice)', lines)

  return { paymentCount: payments.length, orphanUsd }
}

// ── Check 4: Order ↔ Invoice ─────────────────────────────────────────
async function reconcileOrders() {
  // Pull orders with status/paymentStatus we care about.
  const orders = await prisma.order.findMany({
    select: {
      id: true,
      orderNumber: true,
      total: true,
      status: true,
      paymentStatus: true,
      deliveryDate: true,
      isForecast: true,
    },
  })

  const deliveredIds: string[] = []
  const paidIds: string[] = []
  for (const o of orders) {
    if (o.isForecast) continue // skip synthetic forecast rows
    if (o.status === 'DELIVERED') deliveredIds.push(o.id)
    if (o.paymentStatus === 'PAID') paidIds.push(o.id)
  }

  const relevantIds = Array.from(new Set([...deliveredIds, ...paidIds]))
  const invoicesForOrders =
    relevantIds.length === 0
      ? []
      : await prisma.invoice.findMany({
          where: { orderId: { in: relevantIds } },
          select: {
            id: true,
            invoiceNumber: true,
            orderId: true,
            balanceDue: true,
            status: true,
          },
        })

  // Map orderId → invoice[]
  const byOrder = new Map<string, typeof invoicesForOrders>()
  for (const inv of invoicesForOrders) {
    if (!inv.orderId) continue
    const arr = byOrder.get(inv.orderId) ?? []
    arr.push(inv)
    byOrder.set(inv.orderId, arr)
  }

  for (const o of orders) {
    if (o.isForecast) continue

    if (o.status === 'DELIVERED') {
      const invs = byOrder.get(o.id) ?? []
      if (invs.length === 0) {
        deliveredNoInvoice.push({
          orderId: o.id,
          orderNumber: o.orderNumber,
          total: o.total,
          status: o.status,
          paymentStatus: o.paymentStatus,
          deliveryDate: o.deliveryDate,
        })
      }
    }

    if (o.paymentStatus === 'PAID') {
      const invs = byOrder.get(o.id) ?? []
      for (const inv of invs) {
        if ((inv.balanceDue || 0) > PENNY_TOLERANCE) {
          orderPaidInvoiceBalance.push({
            orderId: o.id,
            orderNumber: o.orderNumber,
            paymentStatus: o.paymentStatus,
            invoiceId: inv.id,
            invoiceNumber: inv.invoiceNumber,
            balanceDue: inv.balanceDue,
          })
        }
      }
    }
  }

  deliveredNoInvoice.sort((a, b) => b.total - a.total)
  orderPaidInvoiceBalance.sort((a, b) => b.balanceDue - a.balanceDue)

  const deliveredNoInvUsd = deliveredNoInvoice.reduce(
    (s, o) => s + (o.total || 0),
    0,
  )
  const orderPaidInvBalUsd = orderPaidInvoiceBalance.reduce(
    (s, o) => s + o.balanceDue,
    0,
  )

  const lines = [
    `Orders examined (non-forecast):        ${orders.filter((o) => !o.isForecast).length}`,
    `Orders with status=DELIVERED:          ${deliveredIds.length}`,
    `Orders with paymentStatus=PAID:        ${paidIds.length}`,
    `Invoices linked to those orders:       ${invoicesForOrders.length}`,
    '',
    `DELIVERED orders with NO Invoice:      ${deliveredNoInvoice.length}  (${usd(deliveredNoInvUsd)})`,
    ...deliveredNoInvoice
      .slice(0, 10)
      .map(
        (o) =>
          `  ! ${o.orderNumber.padEnd(20)} total=${usd(o.total)} paymentStatus=${o.paymentStatus}`,
      ),
    deliveredNoInvoice.length > 10
      ? `  (+${deliveredNoInvoice.length - 10} more)`
      : '',
    '',
    `paymentStatus=PAID but linked Invoice.balanceDue>0:  ${orderPaidInvoiceBalance.length}  (${usd(orderPaidInvBalUsd)})`,
    ...orderPaidInvoiceBalance
      .slice(0, 10)
      .map(
        (o) =>
          `  ! order=${o.orderNumber.padEnd(16)} invoice=${o.invoiceNumber.padEnd(20)} balanceDue=${usd(o.balanceDue)}`,
      ),
    orderPaidInvoiceBalance.length > 10
      ? `  (+${orderPaidInvoiceBalance.length - 10} more)`
      : '',
  ].filter(Boolean)
  section('Order ↔ Invoice Reconciliation', lines)

  return {
    orderCount: orders.length,
    deliveredCount: deliveredIds.length,
    paidCount: paidIds.length,
    deliveredNoInvUsd,
    orderPaidInvBalUsd,
  }
}

// ── InboxItems ──────────────────────────────────────────────────────
async function createInboxItems() {
  type Candidate = {
    priority: 'CRITICAL' | 'HIGH'
    title: string
    description: string
    impact: number
  }
  const candidates: Candidate[] = []

  // 1. Payment-sum mismatches — total $ variance
  if (paymentSumMismatches.length > 0) {
    const total = paymentSumMismatches.reduce(
      (s, m) => s + Math.abs(m.diff),
      0,
    )
    candidates.push({
      priority: 'CRITICAL',
      title: `${paymentSumMismatches.length} invoices where Σ(Payment.amount) ≠ (total − balanceDue)`,
      description: `Σ|diff| = ${usd(total)} across ${paymentSumMismatches.length} invoices. Either Payment rows are missing, duplicated, or balanceDue field is stale. Largest: ${paymentSumMismatches[0].invoiceNumber} (${usd(paymentSumMismatches[0].diff)}).`,
      impact: total,
    })
  }

  // 2. Status=PAID but balanceDue > 0
  if (paidWithBalance.length > 0) {
    const total = paidWithBalance.reduce((s, p) => s + (p.balanceDue || 0), 0)
    candidates.push({
      priority: 'CRITICAL',
      title: `${paidWithBalance.length} invoices marked PAID but balanceDue > 0`,
      description: `${paidWithBalance.length} invoices carry status=PAID yet balanceDue totals ${usd(total)}. Status/balance fields out of sync — AR reports will under-count by this amount.`,
      impact: total,
    })
  }

  // 3. Status=PAID but no Payment rows
  if (paidNoPayments.length > 0) {
    const total = paidNoPayments.reduce((s, p) => s + (p.total || 0), 0)
    candidates.push({
      priority: 'CRITICAL',
      title: `${paidNoPayments.length} PAID invoices with zero Payment rows`,
      description: `${paidNoPayments.length} invoices marked PAID but have no Payment children — ${usd(total)} of revenue with no audit trail of receipt. QB sync will have no source for the cash.`,
      impact: total,
    })
  }

  // 4. Orphan payments
  if (orphanPayments.length > 0) {
    const total = orphanPayments.reduce((s, o) => s + o.amount, 0)
    candidates.push({
      priority: 'CRITICAL',
      title: `${orphanPayments.length} orphan Payments (invoice missing)`,
      description: `${orphanPayments.length} Payment rows point to invoiceId values that don't exist in Invoice. ${usd(total)} of cash receipts can't be tied back to an invoice.`,
      impact: total,
    })
  }

  // 5. DELIVERED orders with no invoice
  if (deliveredNoInvoice.length > 0) {
    const total = deliveredNoInvoice.reduce((s, o) => s + (o.total || 0), 0)
    candidates.push({
      priority: 'CRITICAL',
      title: `${deliveredNoInvoice.length} DELIVERED orders with no Invoice`,
      description: `${deliveredNoInvoice.length} orders (${usd(total)}) were delivered but no Invoice row links back. Revenue recognized in operations but never invoiced — direct hit to AR if these aren't in AccountTouchpoint either.`,
      impact: total,
    })
  }

  // 6. paymentStatus=PAID but invoice.balanceDue > 0
  if (orderPaidInvoiceBalance.length > 0) {
    const total = orderPaidInvoiceBalance.reduce(
      (s, o) => s + o.balanceDue,
      0,
    )
    candidates.push({
      priority: 'HIGH',
      title: `${orderPaidInvoiceBalance.length} Orders PAID but linked Invoice.balanceDue > 0`,
      description: `${orderPaidInvoiceBalance.length} orders have paymentStatus=PAID while their invoice still carries ${usd(total)} balanceDue. Order and Invoice payment state disagree.`,
      impact: total,
    })
  }

  candidates.sort((a, b) => b.impact - a.impact)
  const top = candidates.slice(0, 5)

  const created: Array<{ id: string; title: string }> = []
  for (const c of top) {
    const existing = await prisma.inboxItem.findFirst({
      where: {
        source: INBOX_SOURCE,
        title: c.title,
        status: 'PENDING',
      },
      select: { id: true },
    })
    if (existing) {
      created.push({ id: existing.id, title: c.title + ' (existing)' })
      continue
    }
    const item = await prisma.inboxItem.create({
      data: {
        type: 'SYSTEM',
        source: INBOX_SOURCE,
        title: c.title,
        description: c.description,
        priority: c.priority,
        status: 'PENDING',
        financialImpact: c.impact,
        actionData: {
          sourceTag: SOURCE_TAG,
          runAt: RUN_TIMESTAMP,
        } as any,
      },
      select: { id: true, title: true },
    })
    created.push(item)
  }

  const lines = [
    `Candidate findings:   ${candidates.length}`,
    `InboxItems created:   ${created.length} (cap = 5)`,
    '',
    ...created.map((c, i) => `  ${i + 1}. [${c.id}] ${c.title}`),
  ]
  section('InboxItems (CRITICAL reconciliation findings)', lines)

  return created
}

// ── Report ──────────────────────────────────────────────────────────
function writeMarkdownReport(
  gitSha: string,
  inboxItems: Array<{ id: string; title: string }>,
  totals: {
    invoiceCount: number
    paymentCount: number
    orderCount: number
    totalMismatchUsd: number
  },
) {
  const body: string[] = []
  body.push('# Aegis Financial Reconciliation Report — v2')
  body.push('')
  body.push(`**Run at:** ${RUN_TIMESTAMP}`)
  body.push(`**Source tag:** \`${SOURCE_TAG}\``)
  body.push(`**Git SHA:** \`${gitSha}\``)
  body.push('')
  body.push(
    '_Supersedes `AEGIS-FINANCIAL-RECON.md` (v1, source tag FIN_RECON_APR2026). v1 checked AR/AP totals vs baselines; v2 checks internal integrity of Invoice ↔ Payment ↔ Order._',
  )
  body.push('')
  body.push(
    'READ-ONLY on Invoice / InvoiceItem / Payment / Order / OrderItem. Up to 5 CRITICAL InboxItems created for surfacing findings.',
  )
  body.push('')

  body.push('## Scope')
  body.push('')
  body.push('```')
  body.push(`Invoices examined: ${totals.invoiceCount}`)
  body.push(`Payments examined: ${totals.paymentCount}`)
  body.push(`Orders examined:   ${totals.orderCount}`)
  body.push(`Σ|diff| (payment-sum mismatches): ${usd(totals.totalMismatchUsd)}`)
  body.push('```')
  body.push('')

  for (const s of sections) {
    body.push(`## ${s.title}`)
    body.push('')
    body.push('```')
    for (const l of s.lines) body.push(l)
    body.push('```')
    body.push('')
  }

  body.push('## Mismatch Counts Summary')
  body.push('')
  body.push('| Check | Count | $ Impact |')
  body.push('|---|---:|---:|')
  body.push(
    `| Payment-sum ≠ (total − balanceDue) | ${paymentSumMismatches.length} | ${usd(paymentSumMismatches.reduce((s, m) => s + Math.abs(m.diff), 0))} |`,
  )
  body.push(
    `| Status=PAID but balanceDue > 0 | ${paidWithBalance.length} | ${usd(paidWithBalance.reduce((s, p) => s + p.balanceDue, 0))} |`,
  )
  body.push(
    `| Status=PAID but zero Payments | ${paidNoPayments.length} | ${usd(paidNoPayments.reduce((s, p) => s + p.total, 0))} |`,
  )
  body.push(
    `| Orphan Payments (missing invoice) | ${orphanPayments.length} | ${usd(orphanPayments.reduce((s, o) => s + o.amount, 0))} |`,
  )
  body.push(
    `| DELIVERED orders with no Invoice | ${deliveredNoInvoice.length} | ${usd(deliveredNoInvoice.reduce((s, o) => s + o.total, 0))} |`,
  )
  body.push(
    `| Order PAID but Invoice.balanceDue>0 | ${orderPaidInvoiceBalance.length} | ${usd(orderPaidInvoiceBalance.reduce((s, o) => s + o.balanceDue, 0))} |`,
  )
  body.push('')

  body.push('## Top 5 Dollar Gaps')
  body.push('')
  const allFindings: Array<{ kind: string; label: string; impact: number }> = []
  for (const m of paymentSumMismatches)
    allFindings.push({
      kind: 'Payment-sum mismatch',
      label: m.invoiceNumber,
      impact: Math.abs(m.diff),
    })
  for (const p of paidWithBalance)
    allFindings.push({
      kind: 'PAID w/ balanceDue',
      label: p.invoiceNumber,
      impact: p.balanceDue,
    })
  for (const p of paidNoPayments)
    allFindings.push({
      kind: 'PAID no payments',
      label: p.invoiceNumber,
      impact: p.total,
    })
  for (const o of orphanPayments)
    allFindings.push({
      kind: 'Orphan payment',
      label: o.paymentId.slice(0, 16),
      impact: o.amount,
    })
  for (const o of deliveredNoInvoice)
    allFindings.push({
      kind: 'DELIVERED no invoice',
      label: o.orderNumber,
      impact: o.total,
    })
  for (const o of orderPaidInvoiceBalance)
    allFindings.push({
      kind: 'Order PAID, invoice balance>0',
      label: `${o.orderNumber} / ${o.invoiceNumber}`,
      impact: o.balanceDue,
    })

  allFindings.sort((a, b) => b.impact - a.impact)
  if (allFindings.length === 0) {
    body.push('_No findings._')
  } else {
    body.push('| # | Kind | Reference | $ Impact |')
    body.push('|---:|---|---|---:|')
    allFindings.slice(0, 5).forEach((f, i) => {
      body.push(`| ${i + 1} | ${f.kind} | ${f.label} | ${usd(f.impact)} |`)
    })
  }
  body.push('')

  body.push('## InboxItems Created')
  body.push('')
  if (inboxItems.length === 0) {
    body.push('_None._')
  } else {
    for (const i of inboxItems) body.push(`- \`${i.id}\` — ${i.title}`)
  }
  body.push('')

  body.push('---')
  body.push('')
  body.push(
    `_Generated by \`scripts/invoice-payment-recon.ts\` — source tag \`${SOURCE_TAG}\`. Read-only on finance tables; InboxItem creates permitted for surfacing findings._`,
  )
  body.push('')

  fs.writeFileSync(REPORT_PATH, body.join('\n'), 'utf8')
  console.log(`\nReport written → ${REPORT_PATH}`)
}

async function getGitSha(): Promise<string> {
  try {
    const { execSync } = await import('node:child_process')
    return execSync('git rev-parse HEAD', {
      cwd: path.resolve(__dirname, '..'),
    })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

async function main() {
  console.log('═'.repeat(72))
  console.log(`  Aegis Invoice ↔ Payment ↔ Order Recon — ${SOURCE_TAG}`)
  console.log(`  ${RUN_TIMESTAMP}`)
  console.log('═'.repeat(72))

  const inv = await reconcileInvoices()
  const pay = await findOrphanPayments()
  const ord = await reconcileOrders()
  const inbox = await createInboxItems()

  const sha = await getGitSha()
  writeMarkdownReport(sha, inbox, {
    invoiceCount: inv.invoiceCount,
    paymentCount: pay.paymentCount,
    orderCount: ord.orderCount,
    totalMismatchUsd: inv.totalMismatchUsd,
  })

  console.log('\n' + '═'.repeat(72))
  console.log('  Reconciliation complete.')
  console.log(`  Payment-sum mismatches:         ${paymentSumMismatches.length}`)
  console.log(`  PAID w/ balanceDue>0:           ${paidWithBalance.length}`)
  console.log(`  PAID w/ zero payments:          ${paidNoPayments.length}`)
  console.log(`  Orphan payments:                ${orphanPayments.length}`)
  console.log(`  DELIVERED orders no invoice:    ${deliveredNoInvoice.length}`)
  console.log(`  Order PAID, Inv balance>0:      ${orderPaidInvoiceBalance.length}`)
  console.log(`  InboxItems created:             ${inbox.length}`)
  console.log(`  Git SHA:                        ${sha}`)
  console.log('═'.repeat(72))
}

main()
  .catch((err) => {
    console.error('Reconciliation failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
