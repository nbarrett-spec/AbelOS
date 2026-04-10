export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Ensure the table exists
async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BuilderNotificationPrefs" (
      "builderId" TEXT PRIMARY KEY,
      "orderUpdates" BOOLEAN NOT NULL DEFAULT true,
      "quoteReady" BOOLEAN NOT NULL DEFAULT true,
      "deliveryAlerts" BOOLEAN NOT NULL DEFAULT true,
      "warrantyUpdates" BOOLEAN NOT NULL DEFAULT true,
      "promotions" BOOLEAN NOT NULL DEFAULT false,
      "invoiceAlerts" BOOLEAN NOT NULL DEFAULT true,
      "weeklyDigest" BOOLEAN NOT NULL DEFAULT false,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

export async function GET() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await ensureTable()

    const rows = await prisma.$queryRawUnsafe(`
      SELECT * FROM "BuilderNotificationPrefs" WHERE "builderId" = $1
    `, session.builderId) as any[]

    if (rows.length === 0) {
      // Return defaults
      return NextResponse.json({
        orderUpdates: true,
        quoteReady: true,
        deliveryAlerts: true,
        warrantyUpdates: true,
        promotions: false,
        invoiceAlerts: true,
        weeklyDigest: false,
      })
    }

    const prefs = rows[0]
    return NextResponse.json({
      orderUpdates: prefs.orderUpdates,
      quoteReady: prefs.quoteReady,
      deliveryAlerts: prefs.deliveryAlerts,
      warrantyUpdates: prefs.warrantyUpdates,
      promotions: prefs.promotions,
      invoiceAlerts: prefs.invoiceAlerts ?? true,
      weeklyDigest: prefs.weeklyDigest ?? false,
    })
  } catch (error) {
    console.error('Get preferences error:', error)
    return NextResponse.json({ error: 'Failed to load preferences' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    await ensureTable()

    const {
      orderUpdates = true,
      quoteReady = true,
      deliveryAlerts = true,
      warrantyUpdates = true,
      promotions = false,
      invoiceAlerts = true,
      weeklyDigest = false,
    } = body

    // Upsert preferences
    await prisma.$executeRawUnsafe(`
      INSERT INTO "BuilderNotificationPrefs" (
        "builderId", "orderUpdates", "quoteReady", "deliveryAlerts",
        "warrantyUpdates", "promotions", "invoiceAlerts", "weeklyDigest", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT ("builderId") DO UPDATE SET
        "orderUpdates" = $2,
        "quoteReady" = $3,
        "deliveryAlerts" = $4,
        "warrantyUpdates" = $5,
        "promotions" = $6,
        "invoiceAlerts" = $7,
        "weeklyDigest" = $8,
        "updatedAt" = NOW()
    `,
      session.builderId,
      Boolean(orderUpdates),
      Boolean(quoteReady),
      Boolean(deliveryAlerts),
      Boolean(warrantyUpdates),
      Boolean(promotions),
      Boolean(invoiceAlerts),
      Boolean(weeklyDigest),
    )

    return NextResponse.json({
      orderUpdates,
      quoteReady,
      deliveryAlerts,
      warrantyUpdates,
      promotions,
      invoiceAlerts,
      weeklyDigest,
    })
  } catch (error) {
    console.error('Save preferences error:', error)
    return NextResponse.json({ error: 'Failed to save preferences' }, { status: 500 })
  }
}
