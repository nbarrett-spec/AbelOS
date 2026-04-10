export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

// GET /api/dashboard/actions — Smart action items for builder dashboard
export async function GET(request: NextRequest) {
  const token = request.cookies.get('abel_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let session: any
  try { session = await verifyToken(token) } catch {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const builderId = session.builderId
  const actions: any[] = []

  try {
    // 1. Overdue invoices (highest priority)
    const overdue: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, "invoiceNumber", total, "balanceDue", "dueDate"
      FROM "Invoice"
      WHERE "builderId" = $1 AND status = 'OVERDUE'
      ORDER BY "dueDate" ASC LIMIT 5
    `, builderId)

    overdue.forEach(inv => {
      const days = Math.ceil((Date.now() - new Date(inv.dueDate).getTime()) / 86400000)
      actions.push({
        id: `overdue-${inv.id}`,
        type: 'overdue_invoice',
        priority: 'urgent',
        icon: '🔴',
        title: `Invoice #${inv.invoiceNumber} is ${days} days overdue`,
        subtitle: `Balance due: $${Number(inv.balanceDue || inv.total).toFixed(2)}`,
        action: 'Pay Now',
        href: '/dashboard/payments',
      })
    })

    // 2. Invoices due within 7 days
    const dueSoon: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, "invoiceNumber", total, "balanceDue", "dueDate"
      FROM "Invoice"
      WHERE "builderId" = $1
        AND status IN ('ISSUED', 'SENT', 'PARTIALLY_PAID')
        AND "dueDate" BETWEEN NOW() AND NOW() + INTERVAL '7 days'
      ORDER BY "dueDate" ASC LIMIT 5
    `, builderId)

    dueSoon.forEach(inv => {
      const days = Math.ceil((new Date(inv.dueDate).getTime() - Date.now()) / 86400000)
      actions.push({
        id: `due-${inv.id}`,
        type: 'invoice_due_soon',
        priority: 'high',
        icon: '🟡',
        title: `Invoice #${inv.invoiceNumber} due ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`,
        subtitle: `$${Number(inv.balanceDue || inv.total).toFixed(2)}`,
        action: 'View Invoice',
        href: '/dashboard/invoices',
      })
    })

    // 3. Pending quotes to review
    const quotes: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, "quoteNumber", "projectName", total
      FROM "Quote"
      WHERE "builderId" = $1 AND status::text = 'SENT'
      ORDER BY "createdAt" DESC LIMIT 3
    `, builderId)

    quotes.forEach(q => {
      actions.push({
        id: `quote-${q.id}`,
        type: 'quote_review',
        priority: 'medium',
        icon: '📋',
        title: `Quote #${q.quoteNumber} ready for review`,
        subtitle: q.projectName ? `${q.projectName} — $${Number(q.total).toFixed(2)}` : `$${Number(q.total).toFixed(2)}`,
        action: 'Review Quote',
        href: `/dashboard/quotes/${q.id}`,
      })
    })

    // 4. Upcoming deliveries (next 7 days)
    const deliveries: any[] = await prisma.$queryRawUnsafe(`
      SELECT o.id, o."orderNumber", o."deliveryDate", o.status::text as status
      FROM "Order" o
      WHERE o."builderId" = $1
        AND o.status::text IN ('SHIPPED', 'READY_TO_SHIP')
        AND o."deliveryDate" BETWEEN NOW() AND NOW() + INTERVAL '7 days'
      ORDER BY o."deliveryDate" ASC LIMIT 3
    `, builderId)

    deliveries.forEach(d => {
      const days = Math.ceil((new Date(d.deliveryDate).getTime() - Date.now()) / 86400000)
      actions.push({
        id: `delivery-${d.id}`,
        type: 'upcoming_delivery',
        priority: 'info',
        icon: '🚚',
        title: `Order ${d.orderNumber} ${d.status === 'SHIPPED' ? 'arriving' : 'shipping'} ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`,
        subtitle: new Date(d.deliveryDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        action: 'Track',
        href: '/dashboard/deliveries',
      })
    })

    // 5. Unread notifications count
    try {
      const notifCount: any[] = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::int as count FROM "BuilderNotification"
        WHERE "builderId" = $1 AND read = false
      `, builderId)
      const count = notifCount[0]?.count || 0
      if (count > 0) {
        actions.push({
          id: 'unread-notifs',
          type: 'unread_notifications',
          priority: 'low',
          icon: '🔔',
          title: `${count} unread notification${count !== 1 ? 's' : ''}`,
          subtitle: 'Tap to view',
          action: 'View',
          href: '/dashboard/notifications',
        })
      }
    } catch (e: any) { console.warn('[Action Items] Failed to fetch unread notifications:', e?.message) }

    return NextResponse.json({ actions })
  } catch (error: any) {
    console.error('Actions error:', error)
    return NextResponse.json({ actions: [] })
  }
}
