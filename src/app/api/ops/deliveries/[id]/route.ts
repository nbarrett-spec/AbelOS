export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/ops/deliveries/[id]
 *
 * Ops-side Delivery detail — slim payload for the /ops/deliveries/[id]
 * page. Surfaces enough to confirm a delivery went through AND to drive
 * the "Resend confirmation" control (delivery.confirmationSentAt /
 * confirmationSentTo). The columns are added lazily by the email sender
 * via ALTER TABLE IF NOT EXISTS; we read them tolerantly in case the
 * first cascade call hasn't run yet on this environment.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT d."id", d."deliveryNumber", d."address", d."completedAt",
              d."status"::text AS status, d."signedBy",
              COALESCE(
                (SELECT column_name FROM information_schema.columns
                  WHERE table_name = 'Delivery' AND column_name = 'confirmationSentAt'
                  LIMIT 1),
                ''
              ) AS col_probe,
              j."jobNumber", j."jobAddress",
              o."orderNumber",
              b."companyName" AS "builderName", b."email" AS "builderEmail"
         FROM "Delivery" d
    LEFT JOIN "Job"     j ON j."id" = d."jobId"
    LEFT JOIN "Order"   o ON o."id" = j."orderId"
    LEFT JOIN "Builder" b ON b."id" = o."builderId"
        WHERE d."id" = $1
        LIMIT 1`,
      params.id,
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
    }
    const r = rows[0]

    // Pull the confirmation columns separately so we don't 500 on a fresh
    // DB where they haven't been ALTERed in yet.
    let confirmationSentAt: string | null = null
    let confirmationSentTo: string | null = null
    try {
      const c: any[] = await prisma.$queryRawUnsafe(
        `SELECT "confirmationSentAt", "confirmationSentTo" FROM "Delivery" WHERE "id" = $1`,
        params.id,
      )
      if (c.length > 0) {
        confirmationSentAt = c[0].confirmationSentAt
          ? new Date(c[0].confirmationSentAt).toISOString()
          : null
        confirmationSentTo = c[0].confirmationSentTo || null
      }
    } catch {
      /* columns not added yet — cascade or POST will ALTER on first use */
    }

    return NextResponse.json({
      id: r.id,
      deliveryNumber: r.deliveryNumber,
      address: r.address || r.jobAddress || null,
      completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : null,
      status: r.status,
      signedBy: r.signedBy || null,
      jobNumber: r.jobNumber || null,
      orderNumber: r.orderNumber || null,
      builderName: r.builderName || null,
      builderEmail: r.builderEmail || null,
      confirmationSentAt,
      confirmationSentTo,
    })
  } catch (err: any) {
    console.error('[ops/deliveries GET] error', err)
    return NextResponse.json(
      { error: err?.message || 'failed' },
      { status: 500 },
    )
  }
}
