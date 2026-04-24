export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { recordCommunicationActivity } from '@/lib/events/activity'
import { toCsv } from '@/lib/csv'

// GET /api/ops/communication-logs — List communication logs with filters
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const format = searchParams.get('format') || ''
    const builderId = searchParams.get('builderId') || ''
    const organizationId = searchParams.get('organizationId') || ''
    const jobId = searchParams.get('jobId') || ''
    const channel = searchParams.get('channel') || ''
    const status = searchParams.get('status') || ''
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '25')
    const offset = (page - 1) * limit

    let whereClause = `WHERE 1=1`
    const params: any[] = []
    let idx = 1

    if (builderId) {
      whereClause += ` AND cl."builderId" = $${idx}`
      params.push(builderId)
      idx++
    }
    if (organizationId) {
      whereClause += ` AND cl."organizationId" = $${idx}`
      params.push(organizationId)
      idx++
    }
    if (jobId) {
      whereClause += ` AND cl."jobId" = $${idx}`
      params.push(jobId)
      idx++
    }
    if (channel) {
      whereClause += ` AND cl."channel" = $${idx}::"CommChannel"`
      params.push(channel)
      idx++
    }
    if (status) {
      whereClause += ` AND cl."status" = $${idx}::"CommLogStatus"`
      params.push(status)
      idx++
    }

    // CSV export — metadata only (NO body) to keep it shareable. Same filters,
    // capped at 5000 rows. Returned before the heavier listing path.
    if (format === 'csv') {
      const csvRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT cl."id", cl."channel"::text AS "channel", cl."direction"::text AS "direction",
                cl."subject", cl."fromAddress", cl."toAddresses", cl."sentAt", cl."duration",
                cl."hasAttachments", cl."attachmentCount", cl."status"::text AS "status",
                b."companyName" AS "builderCompanyName",
                o."name" AS "orgName"
         FROM "CommunicationLog" cl
         LEFT JOIN "Builder" b ON b."id" = cl."builderId"
         LEFT JOIN "BuilderOrganization" o ON o."id" = cl."organizationId"
         ${whereClause}
         ORDER BY cl."sentAt" DESC NULLS LAST
         LIMIT 5000`,
        ...params
      )

      const fmtDate = (d: any) => (d ? new Date(d).toISOString().split('T')[0] : '')
      const rows = csvRows.map(r => ({
        sentAt: fmtDate(r.sentAt),
        channel: r.channel ?? '',
        direction: r.direction ?? '',
        builder: r.builderCompanyName ?? '',
        organization: r.orgName ?? '',
        fromAddress: r.fromAddress ?? '',
        toAddresses: Array.isArray(r.toAddresses) ? r.toAddresses.join('; ') : (r.toAddresses ?? ''),
        subject: r.subject ?? '',
        durationSec: r.duration ?? '',
        hasAttachments: r.hasAttachments ? 'true' : 'false',
        attachmentCount: r.attachmentCount ?? 0,
        status: r.status ?? '',
      }))

      const csv = toCsv(rows, [
        { key: 'sentAt', label: 'Sent' },
        { key: 'channel', label: 'Channel' },
        { key: 'direction', label: 'Direction' },
        { key: 'builder', label: 'Builder' },
        { key: 'organization', label: 'Organization' },
        { key: 'fromAddress', label: 'From' },
        { key: 'toAddresses', label: 'To' },
        { key: 'subject', label: 'Subject' },
        { key: 'durationSec', label: 'Duration (s)' },
        { key: 'hasAttachments', label: 'Has Attachments' },
        { key: 'attachmentCount', label: 'Attachment Count' },
        { key: 'status', label: 'Status' },
      ])

      const filename = `communication-log-${new Date().toISOString().split('T')[0]}.csv`
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      })
    }

    const [logs, countResult] = await Promise.all([
      prisma.$queryRawUnsafe(
        `SELECT cl.*,
          b."companyName" AS "builderCompanyName", b."contactName" AS "builderContactName",
          o."name" AS "orgName"
         FROM "CommunicationLog" cl
         LEFT JOIN "Builder" b ON b."id" = cl."builderId"
         LEFT JOIN "BuilderOrganization" o ON o."id" = cl."organizationId"
         ${whereClause}
         ORDER BY cl."sentAt" DESC NULLS LAST
         LIMIT ${limit} OFFSET ${offset}`,
        ...params
      ) as Promise<any[]>,
      prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS total FROM "CommunicationLog" cl ${whereClause}`,
        ...params
      ) as Promise<any[]>,
    ])

    // Fetch attachments for logs that have them
    for (const log of logs as any[]) {
      log.builder = log.builderId ? { id: log.builderId, companyName: log.builderCompanyName, contactName: log.builderContactName } : null
      log.organization = log.organizationId ? { id: log.organizationId, name: log.orgName } : null

      if (log.hasAttachments) {
        const attachments: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id", "fileName", "fileType", "fileSize" FROM "CommAttachment" WHERE "communicationLogId" = $1`,
          log.id
        )
        log.attachments = attachments
      } else {
        log.attachments = []
      }
    }

    const total = (countResult as any[])[0]?.total || 0

    return NextResponse.json({
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/ops/communication-logs — Manually log a communication
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'CommunicationLog', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { builderId, organizationId, staffId, jobId, channel, direction, subject, body: msgBody, fromAddress, toAddresses, sentAt, duration, notes, status: logStatus } = body

    if (!channel || !direction) {
      return NextResponse.json({ error: 'channel and direction are required' }, { status: 400 })
    }

    const result: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "CommunicationLog" ("builderId", "organizationId", "staffId", "jobId", "channel", "direction", "subject", "body", "fromAddress", "toAddresses", "ccAddresses", "sentAt", "duration", "status")
       VALUES ($1, $2, $3, $4, $5::"CommChannel", $6::"CommDirection", $7, $8, $9, $10, ARRAY[]::TEXT[], $11, $12, $13::"CommLogStatus") RETURNING *`,
      builderId || null, organizationId || null, staffId || null, jobId || null,
      channel, direction, subject || null, msgBody || notes || null,
      fromAddress || null, toAddresses || '{}',
      sentAt ? new Date(sentAt) : new Date(),
      duration || null, logStatus || 'LOGGED'
    )

    // Event: mirror this comm into Activity so CRM portals can render it.
    // Fire-and-forget; must never block the primary response.
    if (result[0]?.id) {
      recordCommunicationActivity(result[0].id).catch(() => {})
    }

    return NextResponse.json(result[0], { status: 201 })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
