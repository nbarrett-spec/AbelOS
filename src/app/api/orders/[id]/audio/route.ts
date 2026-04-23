export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { generateOrderStatusAudio, isElevenLabsConfigured } from '@/lib/elevenlabs'

/**
 * GET /api/orders/[id]/audio — Generate spoken order status for builder portal
 * Returns MP3 audio stream that builders can play in-browser
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  if (!isElevenLabsConfigured()) {
    return NextResponse.json({ error: 'Voice feature not available' }, { status: 503 })
  }

  try {
    const orders: any[] = await prisma.$queryRawUnsafe(`
      SELECT o."orderNumber", o."status"::text AS "status", o."total",
             o."itemCount", o."createdAt",
             b."companyName",
             COALESCE(p."name", b."companyName") AS "projectName",
             p."jobAddress"
      FROM "Order" o
      JOIN "Builder" b ON b."id" = o."builderId"
      LEFT JOIN "Quote" q ON q."id" = o."quoteId"
      LEFT JOIN "Project" p ON p."id" = q."projectId"
      WHERE o."id" = $1 AND o."builderId" = $2
      LIMIT 1
    `, params.id, session.builderId)

    if (orders.length === 0) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const order = orders[0]

    // Build natural-language status message
    const statusMessages: Record<string, string> = {
      DRAFT: `Your order is currently in draft. Our team is reviewing the details.`,
      SUBMITTED: `Your order has been submitted and is being processed by our team.`,
      CONFIRMED: `Your order has been confirmed. We're preparing your materials.`,
      IN_PRODUCTION: `Your order is in production. ${order.itemCount ? `${order.itemCount} items are being assembled.` : ''}`,
      READY: `Your order is ready for pickup or delivery.`,
      SHIPPED: `Your order has shipped${order.jobAddress ? ` to ${order.jobAddress}` : ''}.`,
      DELIVERED: `Your order has been delivered. All items confirmed.`,
      COMPLETE: `Your order is complete. Thank you for your business.`,
      CANCELLED: `This order has been cancelled. Please contact us with any questions.`,
    }

    const statusMsg = statusMessages[order.status] || `Your order status is ${order.status}.`
    const totalStr = order.total ? ` Order total is $${Number(order.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}.` : ''

    const result = await generateOrderStatusAudio({
      companyName: order.companyName,
      orderNumber: order.orderNumber,
      statusMessage: `${statusMsg}${totalStr}`,
    })

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return new Response(result.audio, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Length': result.byteLength.toString(),
        'Cache-Control': 'private, max-age=300',
        'Content-Disposition': `inline; filename="order-${order.orderNumber}-status.mp3"`,
      },
    })
  } catch (error: any) {
    console.error('[Order Audio] Error:', error)
    return NextResponse.json({ error: 'Failed to generate audio' }, { status: 500 })
  }
}
