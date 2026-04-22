export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'

/**
 * POST /api/ops/delivery/optimize-hint
 *
 * Body: { deliveryIds: string[] }
 *
 * Returns a nearest-neighbor-suggested sequence. No real geocoding yet —
 * we heuristic-sort by address ZIP code + street alphabetic as a cheap
 * proxy for geographic clustering. This is labelled "Suggested order"
 * in the UI — supervisor stays in control.
 *
 * TODO: replace with Mapbox matrix API once we have proper geocodes.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const ids: string[] = body?.deliveryIds || []
    if (ids.length === 0) {
      return NextResponse.json({ error: 'deliveryIds required' }, { status: 400 })
    }

    const deliveries = await prisma.delivery.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        deliveryNumber: true,
        address: true,
        job: { select: { jobAddress: true } },
      },
    })

    const enriched = deliveries.map((d) => {
      const addr = d.address || d.job?.jobAddress || ''
      const zipMatch = addr.match(/\b(\d{5})\b/)
      return {
        id: d.id,
        deliveryNumber: d.deliveryNumber,
        address: addr,
        zip: zipMatch?.[1] || '00000',
        street: addr.replace(/\s*,\s*.*$/, '').trim(),
      }
    })

    // Simple sort: zip then street
    enriched.sort((a, b) => {
      if (a.zip !== b.zip) return a.zip.localeCompare(b.zip)
      return a.street.localeCompare(b.street)
    })

    // Compute estimated savings (rough) — we count how many delta "zip jumps"
    // we removed. Each jump ≈ 8 mi heuristic.
    const zipJumpsAfter = countZipJumps(enriched.map((e) => e.zip))
    const savingsMiles = Math.max(0, deliveries.length * 2 - zipJumpsAfter * 8)

    await audit(request, 'COMPUTE', 'DeliveryRoute', 'optimization', { deliveryCount: ids.length, estimatedSavingsMiles: savingsMiles })

    return NextResponse.json({
      sequence: enriched.map((e, i) => ({
        routeOrder: i + 1,
        deliveryId: e.id,
        deliveryNumber: e.deliveryNumber,
        address: e.address,
      })),
      heuristic: 'zip-street alphabetic',
      estimatedSavingsMiles: savingsMiles,
    })
  } catch (err: any) {
    console.error('[delivery optimize-hint] error', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}

function countZipJumps(zips: string[]): number {
  let jumps = 0
  for (let i = 1; i < zips.length; i++) {
    if (zips[i] !== zips[i - 1]) jumps++
  }
  return jumps
}
