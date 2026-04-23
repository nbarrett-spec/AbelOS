export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { auditBuilder } from '@/lib/audit'
import { requireValidTransition, transitionErrorResponse } from '@/lib/status-guard'

type DeliveryWindow = 'EARLY_AM' | 'LATE_AM' | 'EARLY_PM' | 'LATE_PM' | 'ANYTIME'

interface RescheduleRequest {
  preferredDate: string // ISO date
  preferredWindow: DeliveryWindow
  reason?: string
}

// Get available delivery windows for next 5 business days
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    if (!session || !session.builderId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify builder owns this delivery
    const delivery = await prisma.$queryRawUnsafe<
      Array<{ id: string }>
    >(
      `SELECT d.id FROM "Delivery" d
       JOIN "Job" j ON d."jobId" = j.id
       JOIN "Order" o ON j."orderId" = o.id
       WHERE d.id = $1 AND o."builderId" = $2`,
      params.id,
      session.builderId
    )

    if (!delivery || delivery.length === 0) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
    }

    // Get available windows for next 5 business days
    const today = new Date()
    const availableSlots: Array<{
      date: string
      window: DeliveryWindow
      spotsLeft: number
    }> = []

    const windows: DeliveryWindow[] = [
      'EARLY_AM',
      'LATE_AM',
      'EARLY_PM',
      'LATE_PM',
      'ANYTIME',
    ]

    // Calculate next 5 business days
    let businessDayCount = 0
    let checkDate = new Date(today)
    checkDate.setDate(checkDate.getDate() + 1) // Start from tomorrow

    while (businessDayCount < 5) {
      const dayOfWeek = checkDate.getDay()
      // Skip weekends (Saturday = 6, Sunday = 0)
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        const dateStr = checkDate.toISOString().split('T')[0]

        // Get existing schedule entries for this date
        const existingEntries = await prisma.$queryRawUnsafe<
          Array<{ window: string; count: number }>
        >(
          `SELECT
             COALESCE(d.notes, 'ANYTIME') as window,
             COUNT(*)::int as count
           FROM "Delivery" d
           WHERE DATE(d."createdAt") = $1
           AND d.status IN ('SCHEDULED', 'CONFIRMED')
           GROUP BY COALESCE(d.notes, 'ANYTIME')`,
          dateStr
        )

        const windowCounts: Record<DeliveryWindow, number> = {
          EARLY_AM: 0,
          LATE_AM: 0,
          EARLY_PM: 0,
          LATE_PM: 0,
          ANYTIME: 0,
        }

        existingEntries.forEach((entry) => {
          const key = (entry.window as DeliveryWindow) || 'ANYTIME'
          windowCounts[key] = entry.count
        })

        // Each window has capacity of ~12 deliveries
        windows.forEach((window) => {
          const spotsLeft = Math.max(0, 12 - (windowCounts[window] || 0))
          availableSlots.push({
            date: dateStr,
            window,
            spotsLeft,
          })
        })

        businessDayCount++
      }

      checkDate.setDate(checkDate.getDate() + 1)
    }

    return NextResponse.json({ availableSlots })
  } catch (error) {
    console.error('Error fetching available windows:', error)
    return NextResponse.json(
      { error: 'Failed to fetch available windows' },
      { status: 500 }
    )
  }
}

// POST: Request delivery reschedule
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    if (!session || !session.builderId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    auditBuilder(session.builderId, session.companyName || 'Unknown', 'UPDATE', 'DeliveryReschedule').catch(() => {});

    const body: RescheduleRequest = await request.json()
    const { preferredDate, preferredWindow, reason } = body

    if (!preferredDate || !preferredWindow) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Verify builder owns this delivery
    const delivery = await prisma.$queryRawUnsafe<
      Array<{
        id: string
        status: string
        jobId: string
      }>
    >(
      `SELECT d.id, d.status, d."jobId" FROM "Delivery" d
       JOIN "Job" j ON d."jobId" = j.id
       JOIN "Order" o ON j."orderId" = o.id
       WHERE d.id = $1 AND o."builderId" = $2`,
      params.id,
      session.builderId
    )

    if (!delivery || delivery.length === 0) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
    }

    const currentDelivery = delivery[0]

    // Check delivery status - only allow reschedule if SCHEDULED
    // (CONFIRMED is not a DeliveryStatus enum value — legacy string).
    if (currentDelivery.status !== 'SCHEDULED') {
      return NextResponse.json(
        {
          error: `Cannot reschedule delivery with status ${currentDelivery.status}`,
        },
        { status: 400 }
      )
    }

    // Guard: SCHEDULED → SCHEDULED is a silent no-op in the state-machine
    // helper, which is what a reschedule actually is at the status level —
    // the meaningful state change is the notes/schedule entry update.
    try {
      requireValidTransition('delivery', currentDelivery.status, 'SCHEDULED')
    } catch (e) {
      const res = transitionErrorResponse(e)
      if (res) return res
      throw e
    }

    // Update delivery with reschedule request
    await prisma.$executeRawUnsafe(
      `UPDATE "Delivery"
       SET
         notes = $1,
         status = 'SCHEDULED',
         "updatedAt" = NOW()
       WHERE id = $2`,
      JSON.stringify({
        rescheduleRequest: {
          preferredDate,
          preferredWindow,
          reason: reason || null,
          requestedAt: new Date().toISOString(),
        },
      }),
      params.id
    )

    // Update or create ScheduleEntry if one exists for this delivery
    const existingScheduleEntry = await prisma.$queryRawUnsafe<
      Array<{ id: string }>
    >(
      `SELECT se.id FROM "ScheduleEntry" se
       WHERE se."jobId" = $1
       AND se."entryType" = 'DELIVERY'`,
      currentDelivery.jobId
    )

    if (existingScheduleEntry && existingScheduleEntry.length > 0) {
      const newScheduledTime = getTimeRangeForWindow(preferredWindow)
      await prisma.$executeRawUnsafe(
        `UPDATE "ScheduleEntry"
         SET
           "scheduledDate" = $1,
           "scheduledTime" = $2,
           status = 'TENTATIVE',
           notes = $3,
           "updatedAt" = NOW()
         WHERE id = $4`,
        preferredDate,
        newScheduledTime,
        reason || null,
        existingScheduleEntry[0].id
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Reschedule requested! You will be notified when confirmed.',
    })
  } catch (error) {
    console.error('Error processing reschedule request:', error)
    return NextResponse.json(
      { error: 'Failed to process reschedule request' },
      { status: 500 }
    )
  }
}

function getTimeRangeForWindow(window: DeliveryWindow): string {
  const timeRanges: Record<DeliveryWindow, string> = {
    EARLY_AM: '7:00 AM - 9:00 AM',
    LATE_AM: '9:00 AM - 11:00 AM',
    EARLY_PM: '12:00 PM - 2:00 PM',
    LATE_PM: '2:00 PM - 4:00 PM',
    ANYTIME: 'Flexible',
  }
  return timeRanges[window]
}
