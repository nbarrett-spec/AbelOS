export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth'

/**
 * GET /api/builder/deliveries/track/[orderId]
 * Builder-facing tracking endpoint
 * Returns delivery info with full tracking timeline
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  try {
    const orderId = params.orderId

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

    // Verify the order belongs to this builder
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { builderId: true, id: true },
    })

    if (!order || order.builderId !== session.builderId) {
      return NextResponse.json(
        { error: 'Order not found or access denied' },
        { status: 403 }
      )
    }

    // Get all deliveries for this order's jobs
    const deliveries = await prisma.delivery.findMany({
      where: {
        job: {
          orderId: orderId,
        },
      },
      include: {
        job: {
          select: {
            id: true,
            jobNumber: true,
            jobAddress: true,
          },
        },
        crew: {
          select: {
            id: true,
            name: true,
            vehiclePlate: true,
          },
        },
        tracking: {
          orderBy: { timestamp: 'asc' },
          select: {
            id: true,
            status: true,
            location: true,
            notes: true,
            eta: true,
            timestamp: true,
          },
        },
      } as any,
      orderBy: { createdAt: 'asc' },
    }) as any[]

    // Transform response to include latest status and timeline
    const response = deliveries.map((delivery: any) => ({
      id: delivery.id,
      deliveryNumber: delivery.deliveryNumber,
      jobNumber: delivery.job.jobNumber,
      address: delivery.address || delivery.job.jobAddress,
      status: delivery.status,
      crew: delivery.crew
        ? {
            id: delivery.crew.id,
            name: delivery.crew.name,
            vehiclePlate: delivery.crew.vehiclePlate,
          }
        : null,
      currentStatus: {
        status:
          delivery.tracking.length > 0
            ? delivery.tracking[delivery.tracking.length - 1].status
            : 'SCHEDULED',
        eta:
          delivery.tracking.length > 0
            ? delivery.tracking[delivery.tracking.length - 1].eta
            : null,
        location:
          delivery.tracking.length > 0
            ? delivery.tracking[delivery.tracking.length - 1].location
            : null,
        notes:
          delivery.tracking.length > 0
            ? delivery.tracking[delivery.tracking.length - 1].notes
            : null,
        timestamp:
          delivery.tracking.length > 0
            ? delivery.tracking[delivery.tracking.length - 1].timestamp
            : delivery.createdAt,
      },
      timeline: delivery.tracking.map((t: any) => ({
        id: t.id,
        status: t.status,
        location: t.location,
        notes: t.notes,
        eta: t.eta,
        timestamp: t.timestamp,
      })),
      departedAt: delivery.departedAt,
      arrivedAt: delivery.arrivedAt,
      completedAt: delivery.completedAt,
    }))

    return NextResponse.json({
      orderId,
      deliveries: response,
    })
  } catch (error) {
    console.error('Error fetching delivery tracking:', error)
    return NextResponse.json(
      { error: 'Failed to fetch delivery tracking' },
      { status: 500 }
    )
  }
}
