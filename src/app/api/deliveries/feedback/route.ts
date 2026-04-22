export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

// Ensure table exists
async function ensureFeedbackTable() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "DeliveryFeedback" (
        id TEXT PRIMARY KEY,
        "orderId" TEXT NOT NULL,
        "builderId" TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        "onTimeRating" INTEGER CHECK ("onTimeRating" >= 1 AND "onTimeRating" <= 5),
        "conditionRating" INTEGER CHECK ("conditionRating" >= 1 AND "conditionRating" <= 5),
        "crewRating" INTEGER CHECK ("crewRating" >= 1 AND "crewRating" <= 5),
        comment TEXT,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "idx_delivery_feedback_builder" ON "DeliveryFeedback"("builderId")`
    )
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "idx_delivery_feedback_order" ON "DeliveryFeedback"("orderId")`
    )
  } catch (e: any) { console.warn('[Delivery Feedback] Failed to ensure feedback table schema:', e?.message) }
}

// POST /api/deliveries/feedback — Submit delivery feedback
export async function POST(request: NextRequest) {
  const token = request.cookies.get('abel_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let session: any
  try { session = await verifyToken(token) } catch {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  try {
    await ensureFeedbackTable()

    const body = await request.json()
    const { orderId, rating, onTimeRating, conditionRating, crewRating, comment } = body

    if (!orderId || !rating) {
      return NextResponse.json({ error: 'orderId and rating required' }, { status: 400 })
    }

    // Verify order belongs to builder and is delivered
    const orders: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "orderNumber", status::text as status FROM "Order" WHERE id = $1 AND "builderId" = $2`,
      orderId, session.builderId
    )
    if (orders.length === 0) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Check for existing feedback
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "DeliveryFeedback" WHERE "orderId" = $1 AND "builderId" = $2`,
      orderId, session.builderId
    )
    if (existing.length > 0) {
      return NextResponse.json({ error: 'Feedback already submitted for this delivery' }, { status: 409 })
    }

    const feedbackId = 'fb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

    await prisma.$queryRawUnsafe(`
      INSERT INTO "DeliveryFeedback" (id, "orderId", "builderId", rating, "onTimeRating", "conditionRating", "crewRating", comment, "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `,
      feedbackId, orderId, session.builderId,
      rating, onTimeRating || null, conditionRating || null, crewRating || null,
      comment || null
    )

    return NextResponse.json({ success: true, feedbackId })
  } catch (error: any) {
    console.error('Feedback error:', error)
    return NextResponse.json({ error: 'Failed to submit feedback' }, { status: 500 })
  }
}

// GET /api/deliveries/feedback?orderId=X — Check if feedback exists for an order
export async function GET(request: NextRequest) {
  const token = request.cookies.get('abel_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let session: any
  try { session = await verifyToken(token) } catch {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  try {
    await ensureFeedbackTable()

    const orderId = new URL(request.url).searchParams.get('orderId')

    if (orderId) {
      const feedback: any[] = await prisma.$queryRawUnsafe(
        `SELECT * FROM "DeliveryFeedback" WHERE "orderId" = $1 AND "builderId" = $2`,
        orderId, session.builderId
      )
      return NextResponse.json({ feedback: feedback[0] || null })
    }

    // Return all feedback for this builder
    const allFeedback: any[] = await prisma.$queryRawUnsafe(
      `SELECT df.*, o."orderNumber"
       FROM "DeliveryFeedback" df
       JOIN "Order" o ON df."orderId" = o.id
       WHERE df."builderId" = $1
       ORDER BY df."createdAt" DESC LIMIT 50`,
      session.builderId
    )

    return NextResponse.json({ feedback: allFeedback })
  } catch (error: any) {
    return NextResponse.json({ feedback: null })
  }
}
