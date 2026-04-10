export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/communication-logs — List communication logs with filters
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
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

    return NextResponse.json(result[0], { status: 201 })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
