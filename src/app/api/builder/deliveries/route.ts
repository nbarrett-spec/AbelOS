export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth'

/**
 * GET /api/builder/deliveries
 * Returns all deliveries for authenticated builder with full tracking info
 * Groups into: upcoming, in_transit, completed, all
 */
export async function GET(request: NextRequest) {
  try {
    // Get builder session from cookie
    const cookieStore = await cookies()
    const token = cookieStore.get('abel_session')?.value

    if (!token) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const session = await verifyToken(token)
    if (!session) {
      return NextResponse.json(
        { error: 'Invalid or expired session' },
        { status: 401 }
      )
    }

    const builderId = session.builderId

    // Get all deliveries for this builder using raw SQL
    // Join through Order → Job → Delivery chain
    const deliveries = await prisma.$queryRawUnsafe<
      Array<{
        id: string
        deliveryNumber: string
        status: string
        address: string
        departedAt: string | null
        arrivedAt: string | null
        completedAt: string | null
        loadPhotos: string | string[]
        sitePhotos: string | string[]
        signedBy: string | null
        damageNotes: string | null
        notes: string | null
        createdAt: string
        updatedAt: string
        jobId: string
        crewId: string | null
        routeOrder: number
        jobNumber: string
        jobAddress: string
        community: string | null
        orderNumber: string
        projectId: string | null
        projectName: string | null
        scheduledDate: string | null
      }>
    >(
      `SELECT
        d.id, d."deliveryNumber", d.status, d.address, d."departedAt",
        d."arrivedAt", d."completedAt", d."loadPhotos", d."sitePhotos",
        d."signedBy", d."damageNotes", d.notes, d."createdAt", d."updatedAt",
        d."jobId", d."crewId", d."routeOrder",
        j."jobNumber", j."jobAddress", j.community,
        o."orderNumber", q."projectId",
        p."name" as "projectName",
        j."scheduledDate"
      FROM "Delivery" d
      JOIN "Job" j ON d."jobId" = j."id"
      JOIN "Order" o ON j."orderId" = o."id"
      JOIN "Quote" q ON o."quoteId" = q."id"
      LEFT JOIN "Project" p ON q."projectId" = p."id"
      WHERE o."builderId" = $1
      ORDER BY COALESCE(j."scheduledDate", d."createdAt") DESC`,
      builderId
    )

    // Get all delivery tracking events
    const trackingEvents = await prisma.$queryRawUnsafe<
      Array<{
        id: string
        deliveryId: string
        status: string
        location: string | null
        notes: string | null
        eta: string | null
        timestamp: string
      }>
    >(
      `SELECT id, "deliveryId", status, location, notes, eta, timestamp
       FROM "DeliveryTracking"
       WHERE "deliveryId" = ANY($1::text[])
       ORDER BY timestamp ASC`,
      deliveries.map((d) => d.id)
    )

    // Group tracking events by delivery
    const trackingByDelivery = trackingEvents.reduce(
      (acc, event) => {
        if (!acc[event.deliveryId]) {
          acc[event.deliveryId] = []
        }
        acc[event.deliveryId].push(event)
        return acc
      },
      {} as Record<string, typeof trackingEvents>
    )

    // Determine today's date for grouping
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Transform and group deliveries
    const transformedDeliveries = deliveries.map((d) => {
      const tracking = trackingByDelivery[d.id] || []
      const latestTracking = tracking[tracking.length - 1]
      const scheduledDate = d.scheduledDate
        ? new Date(d.scheduledDate)
        : new Date(d.createdAt)

      return {
        id: d.id,
        deliveryNumber: d.deliveryNumber,
        jobNumber: d.jobNumber,
        address: d.address || d.jobAddress,
        community: d.community,
        orderNumber: d.orderNumber,
        projectName: d.projectName,
        status: d.status,
        scheduledDate: scheduledDate.toISOString(),
        departedAt: d.departedAt,
        arrivedAt: d.arrivedAt,
        completedAt: d.completedAt,
        loadPhotos: Array.isArray(d.loadPhotos) ? d.loadPhotos : [],
        sitePhotos: Array.isArray(d.sitePhotos) ? d.sitePhotos : [],
        signedBy: d.signedBy,
        damageNotes: d.damageNotes,
        notes: d.notes,
        tracking: tracking.map((t) => ({
          id: t.id,
          status: t.status,
          location: t.location,
          notes: t.notes,
          eta: t.eta,
          timestamp: new Date(t.timestamp).toISOString(),
        })),
        latestStatus: latestTracking?.status || d.status,
        latestLocation: latestTracking?.location || null,
        latestEta: latestTracking?.eta || null,
        latestTimestamp: latestTracking
          ? new Date(latestTracking.timestamp).toISOString()
          : new Date(d.updatedAt).toISOString(),
      }
    })

    // Group by category
    const grouped = {
      upcoming: transformedDeliveries.filter((d) => {
        const scheduled = new Date(d.scheduledDate)
        return (
          scheduled >= today &&
          ['SCHEDULED', 'LOADING'].includes(d.latestStatus)
        )
      }),
      in_transit: transformedDeliveries.filter((d) =>
        ['IN_TRANSIT', 'ARRIVED', 'UNLOADING'].includes(d.latestStatus)
      ),
      completed: transformedDeliveries.filter((d) =>
        ['COMPLETE', 'PARTIAL_DELIVERY', 'REFUSED', 'RESCHEDULED'].includes(
          d.latestStatus
        )
      ),
      all: transformedDeliveries,
    }

    return NextResponse.json(grouped)
  } catch (error) {
    console.error('Error fetching builder deliveries:', error)
    return NextResponse.json(
      { error: 'Failed to fetch deliveries' },
      { status: 500 }
    )
  }
}
