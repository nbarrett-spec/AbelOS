export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET /api/ops/notifications — List notifications for current staff
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const notifications: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "Notification"
       WHERE "staffId" = $1
       ORDER BY "createdAt" DESC
       LIMIT 50`,
      staffId
    )

    const unreadCount: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "Notification"
       WHERE "staffId" = $1 AND "read" = false`,
      staffId
    )

    return NextResponse.json({
      notifications,
      unreadCount: parseInt(unreadCount[0].count) || 0,
    })
  } catch (error: any) {
    console.error('GET /api/ops/notifications error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/ops/notifications — Create a notification
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Notification', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { staffId, type = 'INFO', title, message, link } = body

    if (!staffId || !title) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const id = 'ntf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

    await prisma.$queryRawUnsafe(
      `INSERT INTO "Notification" ("id", "staffId", "type", "title", "message", "link", "read", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, false, NOW())`,
      id,
      staffId,
      type,
      title,
      message || null,
      link || null
    )

    return NextResponse.json({ id, staffId, type, title, message, link, read: false }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/ops/notifications error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/ops/notifications — Mark notifications as read
export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'UPDATE', 'Notification', undefined, { method: 'PATCH' }).catch(() => {})

    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { ids, markAllRead } = body

    if (markAllRead) {
      await prisma.$queryRawUnsafe(
        `UPDATE "Notification" SET "read" = true WHERE "staffId" = $1 AND "read" = false`,
        staffId
      )
    } else if (ids && Array.isArray(ids) && ids.length > 0) {
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',')
      await prisma.$queryRawUnsafe(
        `UPDATE "Notification" SET "read" = true WHERE "id" IN (${placeholders})`,
        ...ids
      )
    } else {
      return NextResponse.json({ error: 'Missing ids or markAllRead' }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('PATCH /api/ops/notifications error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
