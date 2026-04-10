export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// POST /api/ops/notifications/builder/send — Create a notification for a builder (staff only)
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { builderId, type = 'GENERAL', title, message, link } = body

    if (!builderId || !title) {
      return NextResponse.json(
        { error: 'builderId and title are required' },
        { status: 400 }
      )
    }

    // Validate type
    const validTypes = ['ORDER_STATUS', 'DELIVERY_UPDATE', 'QUOTE_READY', 'INVOICE_CREATED', 'PAYMENT_RECEIVED', 'GENERAL']
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      )
    }

    // Ensure table exists
    try {
      await prisma.$executeRawUnsafe(`
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
      `)
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "idx_bnotif_builder" ON "BuilderNotification"("builderId")
      `)
    } catch (e) {
      // Table likely already exists
    }

    // Generate notification ID
    const id = `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

    // Insert notification
    await prisma.$executeRawUnsafe(
      `INSERT INTO "BuilderNotification" ("id", "builderId", "type", "title", "message", "link", "read", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, false, NOW())`,
      id,
      builderId,
      type,
      title,
      message || null,
      link || null
    )

    return NextResponse.json(
      {
        id,
        builderId,
        type,
        title,
        message,
        link,
        read: false,
        createdAt: new Date().toISOString(),
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error('POST /api/ops/notifications/builder/send error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    )
  }
}
