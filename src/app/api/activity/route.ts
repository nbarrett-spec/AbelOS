export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const builderId = session.builderId
    const activities: any[] = []

    // Fetch recent orders (Order table is in Prisma schema)
    try {
      const orders = await prisma.$queryRawUnsafe(`
        SELECT id, "orderNumber", status, total, "createdAt", "updatedAt"
        FROM "Order"
        WHERE "builderId" = $1
        ORDER BY "updatedAt" DESC
        LIMIT 20
      `, builderId) as any[]

      for (const o of orders) {
        activities.push({
          id: `order-${o.id}`,
          type: 'ORDER',
          title: `Order ${o.orderNumber}`,
          description: getOrderDescription(o.status),
          status: o.status,
          amount: Number(o.total) || 0,
          link: `/dashboard/orders`,
          timestamp: o.updatedAt || o.createdAt,
        })
      }
    } catch (e) {
      console.error('Activity: orders query failed', e)
    }

    // Fetch recent quotes (Quote -> Project -> Builder)
    try {
      const quotes = await prisma.$queryRawUnsafe(`
        SELECT q.id, q."quoteNumber", q.status, q.total, q."createdAt", q."updatedAt",
               p.name as "projectName"
        FROM "Quote" q
        JOIN "Project" p ON q."projectId" = p.id
        WHERE p."builderId" = $1
        ORDER BY q."updatedAt" DESC
        LIMIT 20
      `, builderId) as any[]

      for (const q of quotes) {
        activities.push({
          id: `quote-${q.id}`,
          type: 'QUOTE',
          title: `Quote ${q.quoteNumber}${q.projectName ? ` — ${q.projectName}` : ''}`,
          description: getQuoteDescription(q.status),
          status: q.status,
          amount: Number(q.total) || 0,
          link: `/dashboard/quotes`,
          timestamp: q.updatedAt || q.createdAt,
        })
      }
    } catch (e) {
      console.error('Activity: quotes query failed', e)
    }

    // Fetch recent warranty claims (self-created table)
    try {
      const warrantyClaims = await prisma.$queryRawUnsafe(`
        SELECT id, subject, status, "createdAt", "updatedAt"
        FROM "WarrantyClaim"
        WHERE "builderId" = $1
        ORDER BY "createdAt" DESC
        LIMIT 10
      `, builderId) as any[]

      for (const w of warrantyClaims) {
        activities.push({
          id: `warranty-${w.id}`,
          type: 'WARRANTY',
          title: `Warranty: ${w.subject}`,
          description: getWarrantyDescription(w.status),
          status: w.status,
          link: `/dashboard/warranty`,
          timestamp: w.updatedAt || w.createdAt,
        })
      }
    } catch (e) {
      console.error('Activity: warranty query failed', e)
    }

    // Fetch recent invoices (self-created table)
    try {
      const invoices = await prisma.$queryRawUnsafe(`
        SELECT id, "invoiceNumber", status, total, "createdAt", "updatedAt"
        FROM "Invoice"
        WHERE "builderId" = $1
        ORDER BY "createdAt" DESC
        LIMIT 10
      `, builderId) as any[]

      for (const inv of invoices) {
        activities.push({
          id: `invoice-${inv.id}`,
          type: 'INVOICE',
          title: `Invoice ${inv.invoiceNumber}`,
          description: getInvoiceDescription(inv.status),
          status: inv.status,
          amount: Number(inv.total) || 0,
          link: `/dashboard/invoices`,
          timestamp: inv.updatedAt || inv.createdAt,
        })
      }
    } catch (e) {
      console.error('Activity: invoices query failed', e)
    }

    // Sort by timestamp descending
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    return NextResponse.json({ activities: activities.slice(0, 50) })
  } catch (error) {
    console.error('Activity feed error:', error)
    return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 })
  }
}

function getOrderDescription(status: string): string {
  const map: Record<string, string> = {
    RECEIVED: 'Order received and being processed',
    CONFIRMED: 'Order confirmed by Abel Lumber',
    IN_PRODUCTION: 'Materials are being prepared',
    READY_TO_SHIP: 'Order is ready for shipping',
    SHIPPED: 'Order has been shipped',
    DELIVERED: 'Order delivered successfully',
    COMPLETE: 'Order completed',
  }
  return map[status] || `Status: ${status}`
}

function getQuoteDescription(status: string): string {
  const map: Record<string, string> = {
    DRAFT: 'Quote is being prepared',
    SENT: 'Quote sent for your review',
    APPROVED: 'Quote approved',
    REJECTED: 'Quote was declined',
    EXPIRED: 'Quote has expired',
    ORDERED: 'Quote converted to order',
  }
  return map[status] || `Status: ${status}`
}

function getWarrantyDescription(status: string): string {
  const map: Record<string, string> = {
    SUBMITTED: 'Claim submitted and under review',
    OPEN: 'Claim is open',
    IN_PROGRESS: 'Claim is being investigated',
    RESOLVED: 'Claim has been resolved',
    CLOSED: 'Claim closed',
  }
  return map[status] || `Status: ${status}`
}

function getInvoiceDescription(status: string): string {
  const map: Record<string, string> = {
    DRAFT: 'Invoice being prepared',
    SENT: 'Invoice sent',
    PAID: 'Invoice paid',
    OVERDUE: 'Invoice is overdue',
    CANCELLED: 'Invoice cancelled',
  }
  return map[status] || `Status: ${status}`
}
