export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/ops/delivery/today
 *
 * Returns today's deliveries grouped by driver (crew lead) with sequence,
 * customer, address, window, order total, and the latest status.
 *
 * Driver assignment: uses Delivery.crew -> CrewMember.staff. If no driver
 * is on the crew we list the crew name only.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const now = new Date()
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)

    const deliveries = await prisma.delivery.findMany({
      where: {
        OR: [
          {
            createdAt: { gte: startOfToday, lt: startOfTomorrow },
          },
          {
            status: { in: ['SCHEDULED', 'LOADING', 'IN_TRANSIT', 'ARRIVED', 'UNLOADING'] },
          },
          {
            job: { scheduledDate: { gte: startOfToday, lt: startOfTomorrow } },
          },
        ],
      },
      select: {
        id: true,
        deliveryNumber: true,
        address: true,
        routeOrder: true,
        status: true,
        departedAt: true,
        arrivedAt: true,
        completedAt: true,
        signedBy: true,
        notes: true,
        crew: {
          select: {
            id: true,
            name: true,
            members: {
              select: {
                role: true,
                staff: { select: { id: true, firstName: true, lastName: true } },
              },
            },
          },
        },
        job: {
          select: {
            id: true,
            jobNumber: true,
            builderName: true,
            jobAddress: true,
            scheduledDate: true,
            order: {
              select: {
                id: true,
                orderNumber: true,
                total: true,
                deliveryNotes: true,
                builder: { select: { id: true, companyName: true, phone: true } },
              },
            },
          },
        },
      },
      orderBy: [{ routeOrder: 'asc' }, { createdAt: 'asc' }],
    })

    // Group by driver
    interface DriverBucket {
      driverId: string | null
      driverName: string
      crewName: string | null
      deliveries: any[]
    }
    const byDriver = new Map<string, DriverBucket>()
    for (const d of deliveries) {
      const driver = d.crew?.members.find(
        (m) => m.role === 'Driver' || m.role === 'Lead'
      )?.staff
      const key = driver?.id || d.crew?.id || 'unassigned'
      const driverName = driver
        ? `${driver.firstName} ${driver.lastName}`.trim()
        : d.crew?.name || 'Unassigned'
      let bucket = byDriver.get(key)
      if (!bucket) {
        bucket = {
          driverId: driver?.id || null,
          driverName,
          crewName: d.crew?.name || null,
          deliveries: [],
        }
        byDriver.set(key, bucket)
      }
      bucket.deliveries.push({
        id: d.id,
        deliveryNumber: d.deliveryNumber,
        address: d.address || d.job?.jobAddress,
        routeOrder: d.routeOrder,
        status: d.status,
        builderName: d.job?.order?.builder?.companyName || d.job?.builderName,
        builderPhone: d.job?.order?.builder?.phone,
        orderNumber: d.job?.order?.orderNumber,
        orderTotal: d.job?.order?.total,
        jobNumber: d.job?.jobNumber,
        window: d.job?.scheduledDate,
        notes: [d.notes, d.job?.order?.deliveryNotes].filter(Boolean).join(' · '),
        signedBy: d.signedBy,
        completedAt: d.completedAt,
        departedAt: d.departedAt,
        arrivedAt: d.arrivedAt,
      })
    }

    const drivers = Array.from(byDriver.values()).sort((a, b) =>
      a.driverName.localeCompare(b.driverName)
    )

    return NextResponse.json({
      asOf: now.toISOString(),
      date: startOfToday.toISOString().slice(0, 10),
      drivers,
      summary: {
        total: deliveries.length,
        scheduled: deliveries.filter((d) => d.status === 'SCHEDULED').length,
        inTransit: deliveries.filter((d) => d.status === 'IN_TRANSIT').length,
        complete: deliveries.filter((d) => d.status === 'COMPLETE').length,
      },
    })
  } catch (err: any) {
    console.error('[delivery today] error', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
