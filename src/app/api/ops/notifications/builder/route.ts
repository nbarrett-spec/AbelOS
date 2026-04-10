export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/notifications/builder — View builder notification history (ops dashboard)
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const view = searchParams.get('view') || 'list'
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')

    if (view === 'stats') {
      let stats: any = {
        totalNotifications: 0, pendingEmails: 0, sentEmails: 0,
        failedEmails: 0, todayNotifications: 0, weekNotifications: 0,
      }
      try {
        const result: any[] = await prisma.$queryRawUnsafe(`
          SELECT
            (SELECT COUNT(*)::int FROM "BuilderNotification") as "totalNotifications",
            (SELECT COUNT(*)::int FROM "EmailQueue" WHERE status = 'PENDING') as "pendingEmails",
            (SELECT COUNT(*)::int FROM "EmailQueue" WHERE status = 'SENT') as "sentEmails",
            (SELECT COUNT(*)::int FROM "EmailQueue" WHERE status = 'FAILED') as "failedEmails",
            (SELECT COUNT(*)::int FROM "BuilderNotification" WHERE "createdAt" >= CURRENT_DATE) as "todayNotifications",
            (SELECT COUNT(*)::int FROM "BuilderNotification" WHERE "createdAt" >= NOW() - INTERVAL '7 days') as "weekNotifications"
        `)
        stats = result[0]
      } catch {
        // Tables may not exist — return zeros
      }
      return NextResponse.json({ stats })
    }

    // List builder notifications with builder info
    let notifications: any[] = []
    try {
      notifications = await prisma.$queryRawUnsafe(`
        SELECT bn.id, bn."builderId", bn.type, bn.title, bn.message, bn.link,
               bn.read, bn."createdAt",
               b."companyName", b."contactName", b.email
        FROM "BuilderNotification" bn
        LEFT JOIN "Builder" b ON bn."builderId" = b.id
        ORDER BY bn."createdAt" DESC
        LIMIT $1 OFFSET $2
      `, limit, offset)
    } catch {
      // Tables may not exist yet
    }

    return NextResponse.json({ notifications })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
