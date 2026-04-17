export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { fireAutomationEvent } from '@/lib/automation-executor'
import { audit } from '@/lib/audit'

/**
 * GET /api/ops/delivery/tracking
 * List all active deliveries with latest tracking info
 * Filters: ?status=IN_TRANSIT&crewId=xxx&date=2026-03-27
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const crewId = searchParams.get('crewId')
    const date = searchParams.get('date')

    // Build WHERE clause
    const where: any = {}
    if (status) where.status = status
    if (crewId) where.crewId = crewId
    if (date) {
      const startOfDay = new Date(date)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(date)
      endOfDay.setHours(23, 59, 59, 999)
      where.createdAt = {
        gte: startOfDay,
        lte: endOfDay,
      }
    }

    // Get deliveries with related data
    const deliveries = await prisma.delivery.findMany({
      where,
      include: {
        job: {
          include: {
            order: {
              include: {
                builder: {
                  select: {
                    id: true,
                    companyName: true,
                    contactName: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
        crew: {
          include: {
            members: {
              include: {
                staff: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                  },
                },
              },
            },
          },
        },
        tracking: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      } as any,
      orderBy: { createdAt: 'desc' },
    }) as any[]

    // Transform response
    const response = deliveries.map((del: any) => ({
      id: del.id,
      deliveryNumber: del.deliveryNumber,
      jobId: del.jobId,
      jobNumber: del.job.jobNumber,
      address: del.address,
      status: del.status,
      crewId: del.crewId,
      crewName: del.crew?.name || null,
      crewMembers: del.crew?.members.map((m: any) => ({
        id: m.staff.id,
        name: `${m.staff.firstName} ${m.staff.lastName}`,
        role: m.role,
        phone: m.staff.phone,
      })) || [],
      builder: del.job.order?.builder || null,
      jobAddress: del.job.jobAddress,
      latestTracking: del.tracking[0] || null,
      eta: del.tracking[0]?.eta || null,
      lastUpdate: del.tracking[0]?.timestamp || del.updatedAt,
    }))

    return NextResponse.json({ deliveries: response })
  } catch (error) {
    console.error('Error fetching deliveries:', error)
    return NextResponse.json(
      { error: 'Failed to fetch deliveries' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/ops/delivery/tracking
 * Add a tracking update to a delivery
 * Body: { deliveryId, status, location?, notes?, eta? }
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Delivery', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { deliveryId, status, location, notes, eta } = body

    if (!deliveryId || !status) {
      return NextResponse.json(
        { error: 'deliveryId and status are required' },
        { status: 400 }
      )
    }

    // Get staff ID from headers (set by middleware)
    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json(
        { error: 'Staff authentication required' },
        { status: 401 }
      )
    }

    // Verify delivery exists
    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: {
        job: {
          include: {
            order: {
              include: {
                builder: {
                  select: {
                    id: true,
                    email: true,
                    companyName: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!delivery) {
      return NextResponse.json(
        { error: 'Delivery not found' },
        { status: 404 }
      )
    }

    // Create tracking record
    const tracking = await (prisma as any).deliveryTracking.create({
      data: {
        deliveryId,
        status,
        location: location || null,
        notes: notes || null,
        eta: eta ? new Date(eta) : null,
        updatedBy: staffId,
      },
    })

    // If status is COMPLETE, update delivery status to DELIVERED
    if (status === 'COMPLETE') {
      await prisma.delivery.update({
        where: { id: deliveryId },
        data: {
          status: 'COMPLETE',
          completedAt: new Date(),
        },
      })
      // Fire automation event (non-blocking)
      fireAutomationEvent('DELIVERY_COMPLETE', deliveryId).catch(e => console.warn('[Automation] event fire failed:', e))
    }

    // Create notification for builder
    if (delivery.job.order?.builder) {
      const builderId = delivery.job.order.builder.id
      const builderEmail = delivery.job.order.builder.email

      // Find a staff member with the builder's email to notify
      // (builders have their own accounts, so we notify via their account/email)
      let notificationTitle = `Delivery ${delivery.deliveryNumber} - ${status}`
      let notificationBody = `Your delivery for order has been updated.`

      if (status === 'NEARBY') {
        notificationTitle = 'Delivery Arriving Soon'
        const etaStr = eta
          ? new Date(eta).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            })
          : 'shortly'
        notificationBody = `Your delivery is nearby and arriving at approximately ${etaStr}.`
      } else if (status === 'COMPLETE') {
        notificationTitle = 'Delivery Complete'
        notificationBody = `Your delivery has been completed and signed for.`
      } else if (status === 'EN_ROUTE') {
        notificationTitle = 'Delivery En Route'
        notificationBody = `Your delivery is on the way.`
      }

      // Note: In a real implementation, you would create a builder notification
      // For now, we log it. The actual notification system would depend on
      // how builder notifications are handled in your system.
      console.log('Builder notification would be sent:', {
        builderId,
        builderEmail,
        title: notificationTitle,
        body: notificationBody,
      })
    }

    return NextResponse.json({
      success: true,
      tracking,
    })
  } catch (error) {
    console.error('Error creating tracking update:', error)
    return NextResponse.json(
      { error: 'Failed to create tracking update' },
      { status: 500 }
    )
  }
}
