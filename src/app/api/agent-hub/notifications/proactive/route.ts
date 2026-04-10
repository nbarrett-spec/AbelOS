export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * POST /api/agent-hub/notifications/proactive
 * Generate proactive notifications based on builder activity and intelligence.
 * Called by Customer Success Agent daily.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const notifications: any[] = []

    // 1. Builders who typically reorder around now (based on frequency)
    const reorderCandidates: any[] = await prisma.$queryRawUnsafe(`
      SELECT bi."builderId", b."companyName", b."contactName", b."email",
             bi."orderFrequencyDays", bi."daysSinceLastOrder",
             bi."avgOrderValue", bi."topProductCategories",
             bi."nextOrderEstimate"
      FROM "BuilderIntelligence" bi
      JOIN "Builder" b ON b."id" = bi."builderId"
      WHERE b."status"::text = 'ACTIVE'
        AND bi."orderFrequencyDays" > 0
        AND bi."daysSinceLastOrder" >= bi."orderFrequencyDays" - 5
        AND bi."daysSinceLastOrder" <= bi."orderFrequencyDays" + 10
        AND bi."orderTrend"::text NOT IN ('CHURNING')
      ORDER BY bi."totalLifetimeValue" DESC
      LIMIT 20
    `)

    for (const c of reorderCandidates) {
      notifications.push({
        type: 'REORDER_REMINDER',
        builderId: c.builderId,
        companyName: c.companyName,
        contactEmail: c.email,
        priority: 'NORMAL',
        message: `${c.companyName} typically orders every ${c.orderFrequencyDays} days. It's been ${c.daysSinceLastOrder} days since their last order (~$${Math.round(Number(c.avgOrderValue))}). Good time for a check-in.`,
        suggestedAction: 'CHECK_IN',
      })
    }

    // 2. Quotes expiring soon (within 3 days)
    const expiringQuotes: any[] = await prisma.$queryRawUnsafe(`
      SELECT q."id", q."quoteNumber", q."total", q."validUntil",
             b."companyName", b."contactName", b."id" AS "builderId"
      FROM "Quote" q
      JOIN "Project" pr ON pr."id" = q."projectId"
      JOIN "Builder" b ON b."id" = pr."builderId"
      WHERE q."status"::text = 'SENT'
        AND q."validUntil" BETWEEN NOW() AND NOW() + INTERVAL '3 days'
      ORDER BY q."total" DESC
    `)

    for (const q of expiringQuotes) {
      notifications.push({
        type: 'QUOTE_EXPIRING',
        builderId: q.builderId,
        companyName: q.companyName,
        priority: 'HIGH',
        message: `Quote ${q.quoteNumber} ($${Number(q.total).toFixed(2)}) for ${q.companyName} expires ${new Date(q.validUntil).toLocaleDateString()}. Send a reminder.`,
        suggestedAction: 'SEND_REMINDER',
        metadata: { quoteId: q.id, quoteNumber: q.quoteNumber },
      })
    }

    // 3. Deliveries happening today
    const todayDeliveries: any[] = await prisma.$queryRawUnsafe(`
      SELECT d."id", d."deliveryNumber", d."address", d."status"::text AS "status",
             j."builderName", j."jobNumber",
             b."id" AS "builderId", b."email"
      FROM "Delivery" d
      JOIN "Job" j ON j."id" = d."jobId"
      LEFT JOIN "Order" o ON o."id" = j."orderId"
      LEFT JOIN "Builder" b ON b."id" = o."builderId"
      WHERE j."scheduledDate"::date = CURRENT_DATE
        AND d."status"::text IN ('SCHEDULED', 'LOADING')
    `)

    for (const d of todayDeliveries) {
      notifications.push({
        type: 'DELIVERY_TODAY',
        builderId: d.builderId,
        companyName: d.builderName,
        priority: 'NORMAL',
        message: `Delivery ${d.deliveryNumber} for ${d.builderName} (${d.address}) is scheduled today. Status: ${d.status}.`,
        suggestedAction: 'SEND_UPDATE',
        metadata: { deliveryId: d.id, jobNumber: d.jobNumber },
      })
    }

    // 4. Invoices paid recently — send thank you
    const recentPayments: any[] = await prisma.$queryRawUnsafe(`
      SELECT p."id", p."amount", p."receivedAt",
             i."invoiceNumber", i."builderId",
             b."companyName", b."email"
      FROM "Payment" p
      JOIN "Invoice" i ON i."id" = p."invoiceId"
      JOIN "Builder" b ON b."id" = i."builderId"
      WHERE p."receivedAt" >= NOW() - INTERVAL '1 day'
        AND p."amount" > 1000
      ORDER BY p."amount" DESC
      LIMIT 10
    `)

    for (const p of recentPayments) {
      notifications.push({
        type: 'PAYMENT_RECEIVED',
        builderId: p.builderId,
        companyName: p.companyName,
        priority: 'LOW',
        message: `${p.companyName} paid $${Number(p.amount).toFixed(2)} on invoice ${p.invoiceNumber}. Consider sending a thank-you.`,
        suggestedAction: 'THANK_YOU',
      })
    }

    return NextResponse.json({
      generated: notifications.length,
      notifications,
      summary: {
        reorderReminders: notifications.filter(n => n.type === 'REORDER_REMINDER').length,
        expiringQuotes: notifications.filter(n => n.type === 'QUOTE_EXPIRING').length,
        deliveriesToday: notifications.filter(n => n.type === 'DELIVERY_TODAY').length,
        paymentsReceived: notifications.filter(n => n.type === 'PAYMENT_RECEIVED').length,
      },
    })
  } catch (error) {
    console.error('POST /api/agent-hub/notifications/proactive error:', error)
    return NextResponse.json({ error: 'Failed to generate notifications' }, { status: 500 })
  }
}
