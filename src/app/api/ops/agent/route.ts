export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET: List agent conversations and schedule change requests for ops
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const view = searchParams.get('view') || 'conversations' // conversations | schedule-requests | stats

    if (view === 'schedule-requests') {
      const status = searchParams.get('status') || 'PENDING'
      const requests: any[] = await prisma.$queryRawUnsafe(`
        SELECT scr.*,
               b."companyName", b."contactName", b.phone, b.email,
               j."jobNumber", j."community", j."jobAddress", j."lotBlock",
               d."deliveryNumber",
               (s."firstName" || ' ' || s."lastName") as "reviewerName"
        FROM "ScheduleChangeRequest" scr
        JOIN "Builder" b ON scr."builderId" = b.id
        LEFT JOIN "Job" j ON scr."jobId" = j.id
        LEFT JOIN "Delivery" d ON scr."deliveryId" = d.id
        LEFT JOIN "Staff" s ON scr."reviewedById" = s.id
        WHERE scr.status = $1
        ORDER BY scr."createdAt" DESC
        LIMIT 50
      `, status)

      return NextResponse.json({ requests })
    }

    if (view === 'stats') {
      const stats: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          (SELECT COUNT(*)::int FROM "AgentConversation" WHERE status = 'ACTIVE') as "activeConversations",
          (SELECT COUNT(*)::int FROM "AgentConversation" WHERE status = 'ESCALATED') as "escalatedConversations",
          (SELECT COUNT(*)::int FROM "ScheduleChangeRequest" WHERE status = 'PENDING') as "pendingScheduleChanges",
          (SELECT COUNT(*)::int FROM "AgentConversation" WHERE "createdAt" >= CURRENT_DATE) as "todayConversations",
          (SELECT COUNT(*)::int FROM "AgentMessage" WHERE "createdAt" >= CURRENT_DATE) as "todayMessages",
          (SELECT COUNT(*)::int FROM "ScheduleChangeRequest" WHERE "autoApproved" = true) as "autoApproved",
          (SELECT COUNT(*)::int FROM "ScheduleChangeRequest") as "totalScheduleRequests"
      `)
      return NextResponse.json({ stats: stats[0] })
    }

    // Default: conversations list
    const status = searchParams.get('status') || ''
    const channel = searchParams.get('channel') || ''
    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    if (status) {
      conditions.push(`c.status = $${idx}`)
      params.push(status)
      idx++
    }
    if (channel) {
      conditions.push(`c.channel = $${idx}`)
      params.push(channel)
      idx++
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const conversations: any[] = await prisma.$queryRawUnsafe(`
      SELECT c.id, c.channel, c.status, c.subject, c."lastMessageAt", c."createdAt",
             c."escalatedAt",
             b."companyName", b."contactName", b.email,
             (s."firstName" || ' ' || s."lastName") as "escalatedToName",
             0 as "messageCount",
             NULL::text as "lastMessage"
      FROM "AgentConversation" c
      JOIN "Builder" b ON c."builderId" = b.id
      LEFT JOIN "Staff" s ON c."escalatedTo" = s.id
      ${where}
      ORDER BY
        CASE WHEN c.status = 'ESCALATED' THEN 0 ELSE 1 END,
        c."lastMessageAt" DESC
      LIMIT 50
    `, ...params)

    return NextResponse.json({ conversations })
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}

// POST: Actions on conversations and schedule requests
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { action } = body

    // Approve a schedule change request
    if (action === 'approve_schedule_change') {
      const { requestId, staffId, notes } = body
      if (!requestId || !staffId) {
        return NextResponse.json({ error: 'requestId and staffId required' }, { status: 400 })
      }

      // Get the request
      const reqs: any[] = await prisma.$queryRawUnsafe(
        `SELECT * FROM "ScheduleChangeRequest" WHERE id = $1 AND status = 'PENDING'`, requestId
      )
      if (reqs.length === 0) {
        return NextResponse.json({ error: 'Request not found or already processed' }, { status: 404 })
      }

      const scr = reqs[0]

      // Update request
      await prisma.$queryRawUnsafe(`
        UPDATE "ScheduleChangeRequest"
        SET status = 'APPROVED', "reviewedById" = $1, "reviewedAt" = NOW(), "reviewNotes" = $2, "updatedAt" = NOW()
        WHERE id = $3
      `, staffId, notes || null, requestId)

      // Apply the change to job/schedule
      if (scr.jobId) {
        // Update Job's scheduledDate instead of Delivery
        await prisma.$queryRawUnsafe(`
          UPDATE "Job" SET "scheduledDate" = $1::date
          WHERE id = $2
        `, scr.requestedDate, scr.jobId)
      }
      if (scr.scheduleEntryId) {
        await prisma.$queryRawUnsafe(`
          UPDATE "ScheduleEntry" SET "scheduledDate" = $1::date, status = 'RESCHEDULED'::"ScheduleStatus"
          WHERE id = $2
        `, scr.requestedDate, scr.scheduleEntryId)
      }

      await audit(request, 'APPROVE', 'ScheduleChangeRequest', requestId, { deliveryId: scr.deliveryId, requestedDate: scr.requestedDate })
      return NextResponse.json({ success: true, message: 'Schedule change approved and applied' })
    }

    // Deny a schedule change request
    if (action === 'deny_schedule_change') {
      const { requestId, staffId, notes } = body
      if (!requestId || !staffId) {
        return NextResponse.json({ error: 'requestId and staffId required' }, { status: 400 })
      }

      await prisma.$queryRawUnsafe(`
        UPDATE "ScheduleChangeRequest"
        SET status = 'DENIED', "reviewedById" = $1, "reviewedAt" = NOW(), "reviewNotes" = $2, "updatedAt" = NOW()
        WHERE id = $3
      `, staffId, notes || 'Request denied', requestId)

      await audit(request, 'DENY', 'ScheduleChangeRequest', requestId, { notes })
      return NextResponse.json({ success: true, message: 'Schedule change denied' })
    }

    // Take over an escalated conversation
    if (action === 'take_over') {
      const { conversationId, staffId } = body
      if (!conversationId || !staffId) {
        return NextResponse.json({ error: 'conversationId and staffId required' }, { status: 400 })
      }

      await prisma.$queryRawUnsafe(`
        UPDATE "AgentConversation"
        SET "escalatedTo" = $1, "escalatedAt" = COALESCE("escalatedAt", NOW()), status = 'ESCALATED', "updatedAt" = NOW()
        WHERE id = $2
      `, staffId, conversationId)

      await audit(request, 'ESCALATE', 'Conversation', conversationId, { assignedTo: staffId })
      return NextResponse.json({ success: true })
    }

    // Resolve a conversation
    if (action === 'resolve') {
      const { conversationId } = body
      if (!conversationId) {
        return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
      }

      await prisma.$queryRawUnsafe(`
        UPDATE "AgentConversation"
        SET status = 'RESOLVED', "resolvedAt" = NOW(), "updatedAt" = NOW()
        WHERE id = $1
      `, conversationId)

      await audit(request, 'RESOLVE', 'Conversation', conversationId, {})
      return NextResponse.json({ success: true })
    }

    // Send staff reply into a conversation
    if (action === 'staff_reply') {
      const { conversationId, message, staffId } = body
      if (!conversationId || !message) {
        return NextResponse.json({ error: 'conversationId and message required' }, { status: 400 })
      }

      await prisma.$queryRawUnsafe(`
        INSERT INTO "AgentMessage" (id, "conversationId", role, content, intent)
        VALUES (gen_random_uuid()::text, $1, 'assistant', $2, 'STAFF_REPLY')
      `, conversationId, `[Staff] ${message}`)

      await prisma.$queryRawUnsafe(`
        UPDATE "AgentConversation" SET "lastMessageAt" = NOW(), "updatedAt" = NOW() WHERE id = $1
      `, conversationId)

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}
