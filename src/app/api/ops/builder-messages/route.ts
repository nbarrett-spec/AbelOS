export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getStaffSession } from '@/lib/staff-auth'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET /api/ops/builder-messages — List all builder messages for ops staff
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const session = await getStaffSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const category = searchParams.get('category')

    let whereClause = '1=1'
    const params: any[] = []
    let paramIndex = 1

    if (status && status !== 'ALL') {
      whereClause += ` AND bm."status" = $${paramIndex}`
      params.push(status)
      paramIndex++
    }

    if (category && category !== 'ALL') {
      whereClause += ` AND bm."category" = $${paramIndex}`
      params.push(category)
      paramIndex++
    }

    const messages = await prisma.$queryRawUnsafe(
      `SELECT bm.*,
              b."companyName" as "builderName",
              b."email" as "builderEmail",
              s."firstName" || ' ' || s."lastName" as "repliedByName"
       FROM "BuilderMessage" bm
       LEFT JOIN "Builder" b ON bm."builderId" = b."id"
       LEFT JOIN "Staff" s ON bm."staffReplyById" = s."id"
       WHERE ${whereClause}
       ORDER BY
         CASE WHEN bm."status" = 'OPEN' THEN 0 ELSE 1 END,
         bm."updatedAt" DESC
       LIMIT 100`,
      ...params
    )

    // Get counts by status
    const counts: any[] = await prisma.$queryRawUnsafe(
      `SELECT "status", COUNT(*)::int as "count" FROM "BuilderMessage" GROUP BY "status"`
    ) as any[]

    const statusCounts: Record<string, number> = {}
    for (const c of counts) {
      statusCounts[c.status] = c.count
    }

    return NextResponse.json({ messages, statusCounts })
  } catch (error: any) {
    console.error('GET /api/ops/builder-messages error:', error)
    return NextResponse.json({ error: 'Failed to fetch builder messages' }, { status: 500 })
  }
}

// PATCH /api/ops/builder-messages — Reply to a builder message
export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'UPDATE', 'BuilderMessage', undefined, { method: 'PATCH' }).catch(() => {})

    const session = await getStaffSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { messageId, reply, status } = body

    if (!messageId) {
      return NextResponse.json({ error: 'Message ID required' }, { status: 400 })
    }

    const updates: string[] = []
    const params: any[] = [messageId]
    let paramIndex = 2

    if (reply) {
      updates.push(`"staffReply" = $${paramIndex}`)
      params.push(reply)
      paramIndex++

      updates.push(`"staffReplyById" = $${paramIndex}`)
      params.push(session.staffId)
      paramIndex++

      updates.push(`"staffReplyAt" = NOW()`)
      updates.push(`"status" = 'REPLIED'`)
    }

    if (status && !reply) {
      updates.push(`"status" = $${paramIndex}`)
      params.push(status)
      paramIndex++
    }

    updates.push(`"readByStaff" = true`)
    updates.push(`"updatedAt" = NOW()`)

    await prisma.$executeRawUnsafe(
      `UPDATE "BuilderMessage" SET ${updates.join(', ')} WHERE "id" = $1`,
      ...params
    )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('PATCH /api/ops/builder-messages error:', error)
    return NextResponse.json({ error: 'Failed to update message' }, { status: 500 })
  }
}
