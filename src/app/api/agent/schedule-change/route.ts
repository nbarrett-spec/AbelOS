export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

// POST: Submit a schedule change request from builder chat
export async function POST(request: NextRequest) {
  try {
    const sessionCookie = request.cookies.get('abel_session')
    if (!sessionCookie) return NextResponse.json({ error: 'Auth required' }, { status: 401 })
    const session = await verifyToken(sessionCookie.value)
    if (!session?.builderId) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })

    const builderId = session.builderId
    const body = await request.json()
    const { conversationId, jobNumber, deliveryNumber, requestedDate, requestedTime, reason } = body

    if (!requestedDate) {
      return NextResponse.json({ error: 'requestedDate is required' }, { status: 400 })
    }

    // Find the job/delivery by number
    let jobId: string | null = null
    let deliveryId: string | null = null
    let scheduleEntryId: string | null = null
    let currentDate: string | null = null

    if (deliveryNumber) {
      const deliveries: any[] = await prisma.$queryRawUnsafe(`
        SELECT d.id, d."jobId", d."createdAt", d.status, j."scheduledDate"
        FROM "Delivery" d
        JOIN "Job" j ON d."jobId" = j.id
        JOIN "Order" o ON j."orderId" = o.id
        WHERE o."builderId" = $1 AND d."deliveryNumber" = $2
        LIMIT 1
      `, builderId, deliveryNumber)

      if (deliveries.length === 0) {
        return NextResponse.json({ error: `Delivery ${deliveryNumber} not found on your account` }, { status: 404 })
      }
      deliveryId = deliveries[0].id
      jobId = deliveries[0].jobId
      currentDate = deliveries[0].scheduledDate
    } else if (jobNumber) {
      const jobs: any[] = await prisma.$queryRawUnsafe(`
        SELECT j.id, j."scheduledDate"
        FROM "Job" j
        JOIN "Order" o ON j."orderId" = o.id
        WHERE o."builderId" = $1 AND j."jobNumber" = $2
        LIMIT 1
      `, builderId, jobNumber)

      if (jobs.length === 0) {
        return NextResponse.json({ error: `Job ${jobNumber} not found on your account` }, { status: 404 })
      }
      jobId = jobs[0].id
      currentDate = jobs[0].scheduledDate

      // Find associated schedule entry
      const entries: any[] = await prisma.$queryRawUnsafe(`
        SELECT id FROM "ScheduleEntry"
        WHERE "jobId" = $1 AND status::text NOT IN ('CANCELLED', 'COMPLETED')
        ORDER BY "scheduledDate" ASC LIMIT 1
      `, jobId)
      if (entries.length > 0) scheduleEntryId = entries[0].id

      // Find associated delivery
      const dels: any[] = await prisma.$queryRawUnsafe(`
        SELECT id FROM "Delivery"
        WHERE "jobId" = $1 AND status::text NOT IN ('COMPLETE', 'REFUSED')
        ORDER BY "createdAt" ASC LIMIT 1
      `, jobId)
      if (dels.length > 0) deliveryId = dels[0].id
    } else {
      return NextResponse.json({ error: 'jobNumber or deliveryNumber required' }, { status: 400 })
    }

    // ── Tiered approval logic ──────────────────────────────────────────
    // Same-week changes: auto-approve if crew is available
    // Further out: require staff approval
    const reqDate = new Date(requestedDate)
    const now = new Date()
    const daysOut = Math.ceil((reqDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    const isSameWeek = daysOut >= 0 && daysOut <= 7

    let autoApproved = false
    let status = 'PENDING'

    if (isSameWeek) {
      // Check crew availability for the requested date
      const availableCrews: any[] = await prisma.$queryRawUnsafe(`
        SELECT c.id, c.name, c."crewType",
               COUNT(se.id)::int as bookings
        FROM "Crew" c
        LEFT JOIN "ScheduleEntry" se ON se."crewId" = c.id
          AND se."scheduledDate" = $1::date
          AND se.status::text NOT IN ('CANCELLED')
        WHERE c.active = true AND c."crewType"::text IN ('DELIVERY', 'DELIVERY_AND_INSTALL')
        GROUP BY c.id
        HAVING COUNT(se.id) < 4
        ORDER BY COUNT(se.id) ASC
      `, requestedDate)

      if (availableCrews.length > 0) {
        autoApproved = true
        status = 'APPROVED'
      }
    }

    // Generate request number
    const countRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as c FROM "ScheduleChangeRequest"`
    )
    const count = (countRows[0]?.c || 0) + 1
    const requestNumber = `SCR-${new Date().getFullYear()}-${String(count).padStart(4, '0')}`

    // Create the request
    const rows: any[] = await prisma.$queryRawUnsafe(`
      INSERT INTO "ScheduleChangeRequest" (
        id, "requestNumber", "builderId", "conversationId",
        "jobId", "deliveryId", "scheduleEntryId",
        "requestType", "currentDate", "requestedDate", "requestedTime",
        reason, "autoApproved", status
      ) VALUES (
        gen_random_uuid()::text, $1, $2, $3,
        $4, $5, $6,
        'RESCHEDULE', $7::date, $8::date, $9,
        $10, $11, $12
      )
      RETURNING id, "requestNumber", status, "autoApproved"
    `, requestNumber, builderId, conversationId || null,
       jobId, deliveryId, scheduleEntryId,
       currentDate, requestedDate, requestedTime || null,
       reason || null, autoApproved, status)

    const scr = rows[0]

    // If auto-approved, update the actual delivery/schedule
    if (autoApproved) {
      if (jobId) {
        // Update Job's scheduledDate instead of Delivery
        await prisma.$queryRawUnsafe(`
          UPDATE "Job" SET "scheduledDate" = $1::date
          WHERE id = $2
        `, requestedDate, jobId)
      }
      if (scheduleEntryId) {
        await prisma.$queryRawUnsafe(`
          UPDATE "ScheduleEntry" SET "scheduledDate" = $1::date, status = 'RESCHEDULED'::"ScheduleStatus"
          WHERE id = $2
        `, requestedDate, scheduleEntryId)
      }
    }

    // Build response message for the chat
    let responseMessage = ''
    if (autoApproved) {
      responseMessage = `Your schedule change has been **automatically approved**! ✅\n\n`
      responseMessage += `**Request:** ${scr.requestNumber}\n`
      responseMessage += `**New Date:** ${new Date(requestedDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}\n`
      if (requestedTime) responseMessage += `**Time:** ${requestedTime}\n`
      responseMessage += `\nYour delivery has been rescheduled. The crew will be notified.`
    } else {
      responseMessage = `Your schedule change request has been submitted for review. ⏳\n\n`
      responseMessage += `**Request:** ${scr.requestNumber}\n`
      responseMessage += `**Requested Date:** ${new Date(requestedDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}\n`
      if (requestedTime) responseMessage += `**Time:** ${requestedTime}\n`
      responseMessage += `\nOur scheduling team will review and respond within 1 business day. Changes more than a week out require staff approval.`
    }

    return NextResponse.json({
      success: true,
      request: scr,
      message: responseMessage,
      autoApproved,
    })
  } catch (error: any) {
    console.error('Schedule change error:', error)
    return NextResponse.json({ error: 'Failed to process schedule change' }, { status: 500 })
  }
}

// GET: Check schedule change request status
export async function GET(request: NextRequest) {
  try {
    const sessionCookie = request.cookies.get('abel_session')
    if (!sessionCookie) return NextResponse.json({ error: 'Auth required' }, { status: 401 })
    const session = await verifyToken(sessionCookie.value)
    if (!session?.builderId) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })

    const requests: any[] = await prisma.$queryRawUnsafe(`
      SELECT scr.*,
             j."jobNumber", j."community", j."jobAddress",
             d."deliveryNumber",
             s."contactName" as "reviewerName"
      FROM "ScheduleChangeRequest" scr
      LEFT JOIN "Job" j ON scr."jobId" = j.id
      LEFT JOIN "Delivery" d ON scr."deliveryId" = d.id
      LEFT JOIN "Staff" s ON scr."reviewedById" = s.id
      WHERE scr."builderId" = $1
      ORDER BY scr."createdAt" DESC
      LIMIT 20
    `, session.builderId)

    return NextResponse.json({ requests })
  } catch (error: any) {
    return NextResponse.json({ error: 'Failed to process schedule change' }, { status: 500 })
  }
}
