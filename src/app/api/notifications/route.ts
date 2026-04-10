export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

// Ensure the BuilderNotification table exists
async function ensureTable() {
  try {
    await prisma.$queryRaw`
      CREATE TABLE IF NOT EXISTS "BuilderNotification" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "builderId" TEXT NOT NULL,
        "type" TEXT NOT NULL DEFAULT 'GENERAL',
        "title" TEXT NOT NULL,
        "message" TEXT NOT NULL,
        "link" TEXT,
        "read" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
    await prisma.$queryRaw`
      CREATE INDEX IF NOT EXISTS "idx_bnotif_builder" ON "BuilderNotification"("builderId")
    `
  } catch (e) {
    // Table likely already exists
  }
}

// GET /api/notifications — List builder's notifications
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    await ensureTable()

    const searchParams = request.nextUrl.searchParams
    const unreadOnly = searchParams.get('unread') === 'true'

    let notifications: any[]
    if (unreadOnly) {
      notifications = await prisma.$queryRaw`
        SELECT * FROM "BuilderNotification"
        WHERE "builderId" = ${session.builderId} AND "read" = false
        ORDER BY "createdAt" DESC
        LIMIT 50
      ` as any[]
    } else {
      notifications = await prisma.$queryRaw`
        SELECT * FROM "BuilderNotification"
        WHERE "builderId" = ${session.builderId}
        ORDER BY "createdAt" DESC
        LIMIT 50
      ` as any[]
    }

    // Get unread count
    const countResult: any[] = await prisma.$queryRaw`
      SELECT COUNT(*)::integer as "count"
      FROM "BuilderNotification"
      WHERE "builderId" = ${session.builderId} AND "read" = false
    ` as any[]

    return NextResponse.json({
      notifications,
      unreadCount: countResult[0]?.count || 0,
    })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/notifications — Mark notifications as read
export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { notificationIds, markAllRead } = body

    if (markAllRead) {
      await prisma.$queryRaw`
        UPDATE "BuilderNotification"
        SET "read" = true
        WHERE "builderId" = ${session.builderId} AND "read" = false
      `
    } else if (notificationIds?.length) {
      // Mark specific notifications as read
      for (const id of notificationIds) {
        await prisma.$queryRaw`
          UPDATE "BuilderNotification"
          SET "read" = true
          WHERE "id" = ${id} AND "builderId" = ${session.builderId}
        `
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
