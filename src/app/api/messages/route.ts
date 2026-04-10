export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { createNotification } from '@/lib/notifications'

/**
 * POST /api/messages — Send a message from builder to Abel Lumber
 * Alias for /api/builders/messages POST with simplified interface
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Ensure table exists
    try {
      await prisma.$queryRaw`
        CREATE TABLE IF NOT EXISTS "BuilderMessage" (
          "id" TEXT PRIMARY KEY,
          "builderId" TEXT NOT NULL,
          "subject" TEXT NOT NULL,
          "body" TEXT NOT NULL,
          "category" TEXT NOT NULL DEFAULT 'GENERAL',
          "status" TEXT NOT NULL DEFAULT 'OPEN',
          "staffReply" TEXT,
          "staffReplyById" TEXT,
          "staffReplyAt" TIMESTAMP(3),
          "readByBuilder" BOOLEAN NOT NULL DEFAULT false,
          "readByStaff" BOOLEAN NOT NULL DEFAULT false,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `
    } catch (e: any) { console.warn('[Messages] Failed to ensure BuilderMessage table schema:', e?.message) }

    const body = await request.json()
    const { subject, message, category, orderId, projectId } = body

    if (!subject || !message) {
      return NextResponse.json({ error: 'Subject and message are required' }, { status: 400 })
    }

    const validCategories = ['GENERAL', 'ORDER_INQUIRY', 'BILLING', 'WARRANTY', 'DELIVERY', 'PRODUCT', 'QUESTION', 'ISSUE', 'CHANGE']
    const cat = validCategories.includes(category) ? category : 'GENERAL'

    const id = 'msg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

    // Include order/project context in the body
    let fullBody = message
    if (orderId) fullBody += `\n\n[Related Order: ${orderId}]`
    if (projectId) fullBody += `\n[Related Project: ${projectId}]`

    await prisma.$executeRawUnsafe(
      `INSERT INTO "BuilderMessage" ("id", "builderId", "subject", "body", "category", "status", "readByBuilder", "readByStaff", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'OPEN', true, false, NOW(), NOW())`,
      id, session.builderId, subject, fullBody, cat
    )

    // Notify sales/account management staff
    const staffMembers: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Staff" WHERE "department"::text IN ('SALES', 'EXECUTIVE') AND "active" = true`
    ) as any[]

    for (const staff of staffMembers) {
      createNotification({
        staffId: staff.id,
        type: 'MESSAGE',
        title: 'New Builder Message',
        message: `${session.companyName}: ${subject}`,
        link: '/ops/builder-messages',
      }).catch(() => {})
    }

    return NextResponse.json({ success: true, messageId: id })
  } catch (error: any) {
    console.error('POST /api/messages error:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
