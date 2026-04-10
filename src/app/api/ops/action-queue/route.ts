export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/action-queue — Today's prioritized action items for ops staff
export async function GET(request: NextRequest) {
  const authResult = checkStaffAuth(request)
  if (authResult) return authResult

  try {
    const actions: Array<{
      id: string
      type: string
      priority: 'HIGH' | 'MEDIUM' | 'LOW'
      title: string
      subtitle: string
      href: string
      age?: string
      amount?: number
    }> = []

    // 1. Orders received but not confirmed (need acknowledgment)
    const newOrders: any[] = await prisma.$queryRawUnsafe(
      `SELECT o.id, o."orderNumber", b."companyName", o.total, o."createdAt"
       FROM "Order" o
       JOIN "Builder" b ON b.id = o."builderId"
       WHERE o.status = 'RECEIVED'::"OrderStatus"
       ORDER BY o."createdAt" ASC
       LIMIT 10`
    )
    for (const o of newOrders) {
      const age = daysSince(o.createdAt)
      actions.push({
        id: `order-confirm-${o.id}`,
        type: 'ORDER_CONFIRM',
        priority: age > 1 ? 'HIGH' : 'MEDIUM',
        title: `Confirm order ${o.orderNumber}`,
        subtitle: `${o.companyName} — ${fmtUSD(o.total)}`,
        href: `/ops/orders/${o.id}`,
        age: age > 0 ? `${age}d ago` : 'Today',
        amount: Number(o.total),
      })
    }

    // 2. Overdue invoices
    const overdueInvoices: any[] = await prisma.$queryRawUnsafe(
      `SELECT i.id, i."invoiceNumber", b."companyName", i."balanceDue", i."dueDate"
       FROM "Invoice" i
       JOIN "Builder" b ON b.id = i."builderId"
       WHERE i.status = 'OVERDUE'::"InvoiceStatus" AND i."balanceDue" > 0
       ORDER BY i."dueDate" ASC
       LIMIT 10`
    )
    for (const inv of overdueInvoices) {
      const overdueDays = daysSince(inv.dueDate)
      actions.push({
        id: `invoice-overdue-${inv.id}`,
        type: 'INVOICE_OVERDUE',
        priority: overdueDays > 14 ? 'HIGH' : 'MEDIUM',
        title: `Overdue: ${inv.invoiceNumber}`,
        subtitle: `${inv.companyName} — ${fmtUSD(inv.balanceDue)} (${overdueDays}d past due)`,
        href: `/ops/invoices/${inv.id}`,
        age: `${overdueDays}d overdue`,
        amount: Number(inv.balanceDue),
      })
    }

    // 3. POs pending approval
    try {
      const pendingPOs: any[] = await prisma.$queryRawUnsafe(
        `SELECT po.id, po."poNumber", v.name as "vendorName", po.total, po."createdAt"
         FROM "PurchaseOrder" po
         JOIN "Vendor" v ON v.id = po."vendorId"
         WHERE po.status = 'PENDING_APPROVAL'
         ORDER BY po."createdAt" ASC
         LIMIT 10`
      )
      for (const po of pendingPOs) {
        const age = daysSince(po.createdAt)
        actions.push({
          id: `po-approve-${po.id}`,
          type: 'PO_APPROVAL',
          priority: age > 2 ? 'HIGH' : 'MEDIUM',
          title: `Approve PO ${po.poNumber}`,
          subtitle: `${po.vendorName} — ${fmtUSD(po.total)}`,
          href: `/ops/purchasing/${po.id}`,
          age: age > 0 ? `${age}d waiting` : 'Today',
          amount: Number(po.total),
        })
      }
    } catch (e: any) { console.warn('[ActionQueue] PurchaseOrder query failed:', e?.message) }

    // 4. Jobs needing schedule (CREATED status with no scheduledDate)
    const unscheduledJobs: any[] = await prisma.$queryRawUnsafe(
      `SELECT j.id, j."jobNumber", j."builderName", j."jobAddress", j."createdAt"
       FROM "Job" j
       WHERE j.status = 'CREATED'::"JobStatus" AND j."scheduledDate" IS NULL
       ORDER BY j."createdAt" ASC
       LIMIT 10`
    )
    for (const j of unscheduledJobs) {
      const age = daysSince(j.createdAt)
      actions.push({
        id: `job-schedule-${j.id}`,
        type: 'JOB_SCHEDULE',
        priority: age > 3 ? 'HIGH' : 'LOW',
        title: `Schedule job ${j.jobNumber}`,
        subtitle: `${j.builderName || 'Unknown'} — ${j.jobAddress || 'No address'}`,
        href: `/ops/jobs/${j.id}`,
        age: age > 0 ? `${age}d old` : 'Today',
      })
    }

    // 5. Quotes sent but not yet approved (older than 3 days)
    try {
      const pendingQuotes: any[] = await prisma.$queryRawUnsafe(
        `SELECT q.id, q."quoteNumber", p.name as "projectName", b."companyName", q.total, q."createdAt"
         FROM "Quote" q
         JOIN "Project" p ON p.id = q."projectId"
         JOIN "Builder" b ON b.id = p."builderId"
         WHERE q.status = 'SENT'::"QuoteStatus"
           AND q."createdAt" < NOW() - INTERVAL '3 days'
         ORDER BY q."createdAt" ASC
         LIMIT 5`
      )
      for (const q of pendingQuotes) {
        const age = daysSince(q.createdAt)
        actions.push({
          id: `quote-followup-${q.id}`,
          type: 'QUOTE_FOLLOWUP',
          priority: age > 7 ? 'HIGH' : 'LOW',
          title: `Follow up: ${q.quoteNumber}`,
          subtitle: `${q.companyName} — ${fmtUSD(q.total)} (sent ${age}d ago)`,
          href: `/ops/quotes`,
          age: `${age}d no response`,
          amount: Number(q.total),
        })
      }
    } catch (e: any) { console.warn('[ActionQueue] Quote/Project query failed:', e?.message) }

    // 6. Deliveries scheduled for today or tomorrow
    try {
      const upcomingDeliveries: any[] = await prisma.$queryRawUnsafe(
        `SELECT d.id, d."trackingNumber", j."jobNumber", j."builderName", j."jobAddress",
                d."createdAt", d.status
         FROM "Delivery" d
         JOIN "Job" j ON j.id = d."jobId"
         WHERE d."createdAt" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '1 day'
           AND d."status"::text NOT IN ('DELIVERED', 'CANCELLED')
         ORDER BY d."createdAt" ASC
         LIMIT 10`
      )
      for (const d of upcomingDeliveries) {
        const isToday = new Date(d.createdAt).toDateString() === new Date().toDateString()
        actions.push({
          id: `delivery-${d.id}`,
          type: 'DELIVERY_TODAY',
          priority: isToday ? 'HIGH' : 'MEDIUM',
          title: `${isToday ? 'Today' : 'Tomorrow'}: Deliver ${d.trackingNumber || d.jobNumber || 'shipment'}`,
          subtitle: `${d.builderName || 'Unknown'} — ${d.jobAddress || 'No address'}`,
          href: `/ops/schedule`,
          age: isToday ? 'Today' : 'Tomorrow',
        })
      }
    } catch (e: any) { console.warn('[ActionQueue] Delivery query failed:', e?.message) }

    // Sort by priority then age
    const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 }
    actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

    // Summary counts
    const summary = {
      total: actions.length,
      high: actions.filter(a => a.priority === 'HIGH').length,
      medium: actions.filter(a => a.priority === 'MEDIUM').length,
      low: actions.filter(a => a.priority === 'LOW').length,
    }

    return NextResponse.json({ actions: actions.slice(0, 15), summary })
  } catch (error: any) {
    console.error('Action queue error:', error)
    return NextResponse.json({ actions: [], summary: { total: 0, high: 0, medium: 0, low: 0 } })
  }
}

function daysSince(date: string | Date): number {
  const d = new Date(date)
  const now = new Date()
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
}

function fmtUSD(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}
