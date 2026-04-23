/**
 * Curri Delivery Integration — live.
 *
 * GET  → returns in-flight Curri deliveries + comparison vs in-house
 * POST → { action: 'quote' | 'book' | 'status' | 'cancel' }
 *
 * Gracefully degrades when CURRI_API_KEY is not set.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import {
  isCurriConfigured,
  getQuote,
  bookDelivery,
  getDeliveryStatus,
  cancelDelivery,
} from '@/lib/integrations/curri'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const url = new URL(request.url)
  const windowDays = Math.min(parseInt(url.searchParams.get('windowDays') || '30', 10), 90)

  try {
    const curriDeliveries: any[] = await prisma.$queryRawUnsafe(
      `SELECT d.id, d."deliveryNumber", d.status::text AS status, d."curriBookingId",
              d."curriTrackingUrl", d."curriCost", d."completedAt", d."createdAt",
              j."jobNumber"
       FROM "Delivery" d
       LEFT JOIN "Job" j ON j.id = d."jobId"
       WHERE d."curriBookingId" IS NOT NULL
         AND d."createdAt" >= NOW() - INTERVAL '${windowDays} days'
       ORDER BY d."createdAt" DESC
       LIMIT 200`
    )

    const inHouseSummary: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(CASE WHEN status::text = 'COMPLETE' THEN 1 ELSE 0 END), 0)::int AS delivered,
              COALESCE(SUM(CASE WHEN status::text IN ('SCHEDULED','LOADING','IN_TRANSIT') THEN 1 ELSE 0 END), 0)::int AS active
       FROM "Delivery"
       WHERE "curriBookingId" IS NULL
         AND "createdAt" >= NOW() - INTERVAL '${windowDays} days'`
    )

    const curriSummary: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count,
              COALESCE(AVG("curriCost")::float, 0) AS "avgCost",
              COALESCE(SUM(CASE WHEN status::text = 'COMPLETE' THEN 1 ELSE 0 END), 0)::int AS delivered,
              COALESCE(SUM(CASE WHEN status::text IN ('SCHEDULED','LOADING','IN_TRANSIT') THEN 1 ELSE 0 END), 0)::int AS active
       FROM "Delivery"
       WHERE "curriBookingId" IS NOT NULL
         AND "createdAt" >= NOW() - INTERVAL '${windowDays} days'`
    )

    return NextResponse.json({
      integrated: isCurriConfigured(),
      provider: 'CURRI',
      deliveries: curriDeliveries,
      comparison: {
        inHouse: {
          count: inHouseSummary[0]?.count || 0,
          avgCost: 0,
          delivered: inHouseSummary[0]?.delivered || 0,
          active: inHouseSummary[0]?.active || 0,
        },
        curri: {
          count: curriSummary[0]?.count || 0,
          avgCost: curriSummary[0]?.avgCost || 0,
          delivered: curriSummary[0]?.delivered || 0,
          active: curriSummary[0]?.active || 0,
        },
      },
      curriConfigured: isCurriConfigured(),
      windowDays,
    })
  } catch (err: any) {
    console.error('Curri GET error:', err?.message)
    return NextResponse.json({ error: 'Failed to load Curri data' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  if (!isCurriConfigured()) {
    return NextResponse.json(
      { error: 'Curri not configured', hint: 'Set CURRI_API_KEY in Vercel env to enable.' },
      { status: 503 }
    )
  }

  try {
    const body = await request.json()
    const action = body.action as 'quote' | 'book' | 'cancel' | 'status'

    if (action === 'quote') {
      const res = await getQuote({
        pickupAddress: body.pickup,
        dropoffAddress: body.dropoff,
        items: body.items || [],
        requestedBy: body.requestedBy,
        vehicleType: body.vehicleType,
      })
      if (!res.ok) return NextResponse.json({ error: res.error || res.reason }, { status: 502 })
      audit(request, 'CURRI_QUOTE', 'Delivery', undefined, { quoteCount: res.data?.length }).catch(() => {})
      return NextResponse.json({ quotes: res.data })
    }

    if (action === 'book') {
      const res = await bookDelivery(body.quoteId, {
        pickupContactName: body.pickupContactName,
        pickupPhone: body.pickupPhone,
        dropoffContactName: body.dropoffContactName,
        dropoffPhone: body.dropoffPhone,
        notes: body.notes,
      })
      if (!res.ok || !res.data) return NextResponse.json({ error: res.error || 'Book failed' }, { status: 502 })
      if (body.deliveryId) {
        await prisma.$executeRawUnsafe(
          `UPDATE "Delivery" SET "curriBookingId" = $1, "curriTrackingUrl" = $2, "curriCost" = $3, "updatedAt" = NOW() WHERE id = $4`,
          res.data.id,
          res.data.trackingUrl,
          res.data.price,
          body.deliveryId
        )
      }
      audit(request, 'CURRI_BOOK', 'Delivery', body.deliveryId, {
        curriBookingId: res.data.id,
        price: res.data.price,
      }).catch(() => {})
      return NextResponse.json({ booking: res.data })
    }

    if (action === 'status') {
      const res = await getDeliveryStatus(body.curriBookingId)
      if (!res.ok) return NextResponse.json({ error: res.error || res.reason }, { status: 502 })
      return NextResponse.json({ status: res.data })
    }

    if (action === 'cancel') {
      const res = await cancelDelivery(body.curriBookingId)
      if (!res.ok) return NextResponse.json({ error: res.error || res.reason }, { status: 502 })
      if (body.deliveryId) {
        await prisma.$executeRawUnsafe(
          `UPDATE "Delivery" SET status = 'CANCELLED'::"DeliveryStatus", "updatedAt" = NOW() WHERE id = $1`,
          body.deliveryId
        )
      }
      audit(request, 'CURRI_CANCEL', 'Delivery', body.deliveryId, { curriBookingId: body.curriBookingId }).catch(() => {})
      return NextResponse.json({ cancelled: res.data })
    }

    return NextResponse.json(
      { error: 'Unknown action', expected: ['quote', 'book', 'status', 'cancel'] },
      { status: 400 }
    )
  } catch (err: any) {
    console.error('Curri POST error:', err?.message)
    return NextResponse.json({ error: err?.message?.slice(0, 300) || 'Curri action failed' }, { status: 500 })
  }
}
