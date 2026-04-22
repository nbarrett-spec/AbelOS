export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// Curri Third-Party Delivery Integration
//
// GET  — List Curri-dispatched deliveries with cost/performance stats
// POST — Book a delivery through Curri (calls Curri API if configured,
//         otherwise records the booking for manual dispatch via curri.com)
//
// Curri API docs: https://docs.curri.com/
// Requires: CURRI_API_KEY, CURRI_API_URL env vars for live API calls
// ──────────────────────────────────────────────────────────────────────────

const CURRI_API_URL = process.env.CURRI_API_URL || 'https://api.curri.com/v1'
const CURRI_API_KEY = process.env.CURRI_API_KEY

interface CurriBookingPayload {
  deliveryId: string
  pickupAddress?: string
  dropoffAddress: string
  vehicleType?: 'car' | 'suv' | 'pickup_truck' | 'cargo_van' | 'box_truck' | 'flatbed'
  scheduledAt?: string
  notes?: string
  contactName?: string
  contactPhone?: string
}

// Ensure tracking columns exist on Delivery table
let columnsEnsured = false
async function ensureCurriColumns() {
  if (columnsEnsured) return
  try {
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Delivery' AND column_name='provider') THEN
          ALTER TABLE "Delivery" ADD COLUMN "provider" TEXT DEFAULT 'IN_HOUSE';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Delivery' AND column_name='curriBookingId') THEN
          ALTER TABLE "Delivery" ADD COLUMN "curriBookingId" TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Delivery' AND column_name='curriTrackingUrl') THEN
          ALTER TABLE "Delivery" ADD COLUMN "curriTrackingUrl" TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Delivery' AND column_name='curriCost') THEN
          ALTER TABLE "Delivery" ADD COLUMN "curriCost" DECIMAL(10,2);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Delivery' AND column_name='curriVehicleType') THEN
          ALTER TABLE "Delivery" ADD COLUMN "curriVehicleType" TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Delivery' AND column_name='curriBookedAt') THEN
          ALTER TABLE "Delivery" ADD COLUMN "curriBookedAt" TIMESTAMPTZ;
        END IF;
      END $$;
    `)
    columnsEnsured = true
  } catch (e) {
    columnsEnsured = true // Don't retry on error
  }
}

/**
 * GET /api/ops/delivery/curri — List Curri deliveries + comparison stats
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    await ensureCurriColumns()

    // Get Curri deliveries
    const curriDeliveries: any[] = await prisma.$queryRawUnsafe(`
      SELECT d."id", d."deliveryNumber", d."address", d."status"::text AS "status",
             d."provider", d."curriBookingId", d."curriTrackingUrl", d."curriCost",
             d."curriVehicleType", d."curriBookedAt",
             d."createdAt", d."updatedAt",
             j."jobNumber", j."builderName"
      FROM "Delivery" d
      LEFT JOIN "Job" j ON j."id" = d."jobId"
      WHERE d."provider" = 'CURRI'
      ORDER BY d."curriBookedAt" DESC NULLS LAST, d."createdAt" DESC
      LIMIT 100
    `)

    // Comparison stats (last 90 days)
    const stats: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        d."provider",
        COUNT(*)::int AS "count",
        AVG(d."curriCost")::numeric(10,2) AS "avgCost",
        COUNT(*) FILTER (WHERE d."status"::text = 'DELIVERED')::int AS "deliveredCount",
        COUNT(*) FILTER (WHERE d."status"::text IN ('EN_ROUTE', 'SCHEDULED'))::int AS "activeCount"
      FROM "Delivery" d
      WHERE d."createdAt" > NOW() - INTERVAL '90 days'
      GROUP BY d."provider"
    `)

    const inHouseStats = stats.find((s: any) => s.provider !== 'CURRI') || { count: 0, avgCost: 0, deliveredCount: 0, activeCount: 0 }
    const curriStats = stats.find((s: any) => s.provider === 'CURRI') || { count: 0, avgCost: 0, deliveredCount: 0, activeCount: 0 }

    return NextResponse.json({
      deliveries: curriDeliveries,
      comparison: {
        inHouse: {
          count: inHouseStats.count,
          avgCost: Number(inHouseStats.avgCost) || 0,
          delivered: inHouseStats.deliveredCount,
          active: inHouseStats.activeCount,
        },
        curri: {
          count: curriStats.count,
          avgCost: Number(curriStats.avgCost) || 0,
          delivered: curriStats.deliveredCount,
          active: curriStats.activeCount,
        },
      },
      curriConfigured: !!CURRI_API_KEY,
    })
  } catch (error: any) {
    console.error('[Curri GET] Error:', error)
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}

/**
 * POST /api/ops/delivery/curri — Book a Curri delivery
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id') || 'system'

  try {
    await ensureCurriColumns()

    const body: CurriBookingPayload = await request.json()
    const { deliveryId, pickupAddress, dropoffAddress, vehicleType, scheduledAt, notes, contactName, contactPhone } = body

    if (!deliveryId || !dropoffAddress) {
      return NextResponse.json({ error: 'deliveryId and dropoffAddress required' }, { status: 400 })
    }

    // Verify delivery exists
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "deliveryNumber", "provider" FROM "Delivery" WHERE "id" = $1 LIMIT 1`,
      deliveryId
    )
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
    }
    if (existing[0].provider === 'CURRI' && existing[0].curriBookingId) {
      return NextResponse.json({ error: 'This delivery is already booked with Curri' }, { status: 409 })
    }

    let curriBookingId: string | null = null
    let curriTrackingUrl: string | null = null
    let curriCost: number | null = null

    // If Curri API key is configured, make the actual API call
    if (CURRI_API_KEY) {
      try {
        const curriRes = await fetch(`${CURRI_API_URL}/deliveries`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${CURRI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pickup: {
              address: pickupAddress || '1401 E Division St, Arlington, TX 76011', // Abel Lumber HQ
              contact: { name: 'Abel Lumber Warehouse', phone: '(817) 261-4141' },
            },
            dropoff: {
              address: dropoffAddress,
              contact: contactName && contactPhone ? { name: contactName, phone: contactPhone } : undefined,
            },
            vehicle_type: vehicleType || 'flatbed',
            scheduled_at: scheduledAt || undefined,
            notes: notes || `Abel Lumber delivery - ${existing[0].deliveryNumber}`,
          }),
        })

        if (curriRes.ok) {
          const curriData = await curriRes.json()
          curriBookingId = curriData.id || curriData.delivery_id
          curriTrackingUrl = curriData.tracking_url || `https://app.curri.com/track/${curriBookingId}`
          curriCost = curriData.price?.amount || curriData.estimated_cost || null
        } else {
          const errText = await curriRes.text()
          console.error('[Curri API] Booking failed:', curriRes.status, errText)
          // Fall through to manual booking mode
        }
      } catch (apiErr: any) {
        console.error('[Curri API] Network error:', apiErr.message)
        // Fall through to manual booking mode
      }
    }

    // If API call failed or no API key, generate a manual booking reference
    if (!curriBookingId) {
      curriBookingId = `manual-${Date.now().toString(36)}`
      curriTrackingUrl = null // Operator will book manually at curri.com
    }

    // Update delivery record
    await prisma.$executeRawUnsafe(`
      UPDATE "Delivery"
      SET "provider" = 'CURRI',
          "curriBookingId" = $2,
          "curriTrackingUrl" = $3,
          "curriCost" = $4,
          "curriVehicleType" = $5,
          "curriBookedAt" = NOW(),
          "updatedAt" = NOW()
      WHERE "id" = $1
    `,
      deliveryId,
      curriBookingId,
      curriTrackingUrl,
      curriCost,
      vehicleType || 'flatbed'
    )

    await audit(request, 'CREATE', 'CurriBooking', deliveryId, {
      curriBookingId,
      vehicleType,
      dropoffAddress,
      cost: curriCost,
      apiUsed: !!CURRI_API_KEY && !curriBookingId.startsWith('manual-'),
    })

    return NextResponse.json({
      success: true,
      deliveryId,
      deliveryNumber: existing[0].deliveryNumber,
      curriBookingId,
      curriTrackingUrl,
      estimatedCost: curriCost,
      apiBooking: !!CURRI_API_KEY && !curriBookingId.startsWith('manual-'),
      message: curriBookingId.startsWith('manual-')
        ? 'Delivery marked for Curri dispatch. Book manually at app.curri.com.'
        : 'Delivery booked through Curri API.',
    }, { status: 201 })
  } catch (error: any) {
    console.error('[Curri POST] Error:', error)
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}
