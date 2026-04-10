export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { createNotification } from '@/lib/notifications'

/**
 * Ensure BuilderMessage table exists
 */
async function ensureTable() {
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
    await prisma.$queryRaw`
      CREATE INDEX IF NOT EXISTS "idx_bmsg_builder" ON "BuilderMessage"("builderId")
    `
    await prisma.$queryRaw`
      CREATE INDEX IF NOT EXISTS "idx_bmsg_status" ON "BuilderMessage"("status")
    `
  } catch (e) {
    // Table likely exists
  }
}

// GET /api/builders/messages — List builder's messages
export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    await ensureTable()

    const messages = await prisma.$queryRawUnsafe(
      `SELECT bm.*,
              s."firstName" || ' ' || s."lastName" as "repliedByName"
       FROM "BuilderMessage" bm
       LEFT JOIN "Staff" s ON bm."staffReplyById" = s."id"
       WHERE bm."builderId" = $1
       ORDER BY bm."updatedAt" DESC`,
      session.builderId
    )

    return NextResponse.json({ messages })
  } catch (error: any) {
    console.error('GET /api/builders/messages error:', error)
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
  }
}

// POST /api/builders/messages — Send a new message to Abel Lumber
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    await ensureTable()

    const body = await request.json()
    const { subject, message, category } = body

    if (!subject || !message) {
      return NextResponse.json({ error: 'Subject and message are required' }, { status: 400 })
    }

    const validCategories = ['GENERAL', 'ORDER_INQUIRY', 'BILLING', 'WARRANTY', 'DELIVERY', 'PRODUCT']
    const cat = validCategories.includes(category) ? category : 'GENERAL'

    const id = 'msg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

    await prisma.$executeRawUnsafe(
      `INSERT INTO "BuilderMessage" ("id", "builderId", "subject", "body", "category", "status", "readByBuilder", "readByStaff", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'OPEN', true, false, NOW(), NOW())`,
      id, session.builderId, subject, message, cat
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
        link: '/ops/messages',
      }).catch(() => {})
    }

    return NextResponse.json({
      success: true,
      messageId: id,
      message: 'Message sent successfully',
    }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/builders/messages error:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
