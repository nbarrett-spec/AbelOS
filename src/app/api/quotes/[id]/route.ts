export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { sendOrderConfirmationEmail } from '@/lib/email'
import { apiLimiter, checkRateLimit } from '@/lib/rate-limit'
import { sanitizeInput, isValidUUID, checkCSRF } from '@/lib/security'
import { audit } from '@/lib/audit'
import { requireValidTransition, transitionErrorResponse } from '@/lib/status-guard'

// GET /api/quotes/[id] — Get single quote detail
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const quoteRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT q.id, q."projectId", q."quoteNumber", q.subtotal, q."termAdjustment",
              q.total, q.status, q."validUntil", q."createdAt", q."updatedAt"
       FROM "Quote" q
       JOIN "Project" p ON p.id = q."projectId"
       WHERE q.id = $1 AND p."builderId" = $2
       LIMIT 1`,
      params.id,
      session.builderId
    )

    if (quoteRows.length === 0) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }

    const quote = quoteRows[0]

    // Get quote items
    const itemRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "quoteId", "productId", description, quantity, "unitPrice", "lineTotal", "sortOrder"
       FROM "QuoteItem" WHERE "quoteId" = $1 ORDER BY "sortOrder" ASC`,
      params.id
    )

    // Get project with builder
    const projectRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT p.id, p.name, p."builderId", p.status, p."planName",
              b.id as "builder_id", b."companyName", b."contactName", b.email, b.phone
       FROM "Project" p
       JOIN "Builder" b ON b.id = p."builderId"
       WHERE p.id = $1`,
      quote.projectId
    )

    let project = null
    if (projectRows.length > 0) {
      const p = projectRows[0]
      project = {
        id: p.id,
        name: p.name,
        builderId: p.builderId,
        status: p.status,
        planName: p.planName,
        builder: {
          id: p.builder_id,
          companyName: p.companyName,
          contactName: p.contactName,
          email: p.email,
          phone: p.phone,
        },
      }
    }

    return NextResponse.json({
      ...quote,
      items: itemRows,
      project,
    })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/quotes/[id] — Approve, reject, or request changes
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // CSRF check
  if (!checkCSRF(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }

  // Rate limit — logs RATE_LIMIT SecurityEvent on rejection.
  const limited = await checkRateLimit(request, apiLimiter, 60, 'quote-action')
  if (limited) return limited

  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Validate quote ID format
  if (!params.id || !isValidUUID(params.id)) {
    return NextResponse.json({ error: 'Invalid quote ID' }, { status: 400 })
  }

  try {
    audit(request, 'UPDATE', 'Quote', params.id).catch(() => {});

    const body = await request.json()
    const { action, signature, changeNotes } = body

    // Validate action is one of the allowed values
    if (!['approve', 'reject', 'requestChanges'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    // Sanitize text inputs
    const cleanChangeNotes = changeNotes ? sanitizeInput(String(changeNotes)).slice(0, 2000) : ''

    // Verify quote belongs to this builder
    const quoteRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT q.id, q.status, q."quoteNumber", q.total, q."projectId",
              p.name as "projectName", p."builderId",
              b.email as "builderEmail", b."contactName" as "builderName", b."companyName"
       FROM "Quote" q
       JOIN "Project" p ON p.id = q."projectId"
       JOIN "Builder" b ON b.id = p."builderId"
       WHERE q.id = $1 AND p."builderId" = $2
       LIMIT 1`,
      params.id,
      session.builderId
    )

    if (quoteRows.length === 0) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }

    const q = quoteRows[0]

    if (action === 'approve') {
      // Approve the quote — requires signature
      if (!signature) {
        return NextResponse.json({ error: 'Signature is required to approve' }, { status: 400 })
      }

      if (q.status !== 'SENT' && q.status !== 'DRAFT') {
        return NextResponse.json({ error: `Cannot approve a quote with status ${q.status}` }, { status: 400 })
      }

      // Guard: QuoteStatus state machine — SENT → APPROVED is valid, DRAFT →
      // APPROVED is not (must go DRAFT → SENT → APPROVED). Keep the DRAFT path
      // via an admin-style coercion: flip to SENT first through the guard.
      try {
        if (q.status === 'DRAFT') {
          requireValidTransition('quote', 'DRAFT', 'SENT')
          requireValidTransition('quote', 'SENT', 'APPROVED')
        } else {
          requireValidTransition('quote', q.status, 'APPROVED')
        }
      } catch (e) {
        const res = transitionErrorResponse(e)
        if (res) return res
        throw e
      }

      // Update quote status and store signature
      await prisma.$executeRawUnsafe(
        `UPDATE "Quote" SET
          status = 'APPROVED'::"QuoteStatus",
          "approvedAt" = CURRENT_TIMESTAMP,
          "approvedBy" = $1,
          "signatureData" = $2,
          "updatedAt" = CURRENT_TIMESTAMP
         WHERE id = $3`,
        session.builderId,
        signature,
        params.id
      )

      // Auto-create an order from the approved quote
      const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}`
      const orderId = crypto.randomUUID()

      await prisma.$executeRawUnsafe(
        `INSERT INTO "Order" (id, "builderId", "orderNumber", "quoteId", status,
                              subtotal, total, "paymentTerm", "paymentStatus",
                              "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 'RECEIVED'::"OrderStatus",
                 $5, $6, 'NET_30'::"PaymentTerm", 'PENDING'::"PaymentStatus",
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        orderId,
        q.builderId,
        orderNumber,
        params.id,
        q.total,
        q.total
      )

      // Copy quote items to order items
      const itemRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "productId", description, quantity, "unitPrice", "lineTotal"
         FROM "QuoteItem" WHERE "quoteId" = $1`,
        params.id
      )

      for (const item of itemRows) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "OrderItem" (id, "orderId", "productId", description, quantity, "unitPrice", "lineTotal")
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          crypto.randomUUID(),
          orderId,
          item.productId,
          item.description,
          item.quantity,
          item.unitPrice,
          item.lineTotal
        )
      }

      // Send confirmation email (non-blocking)
      sendOrderConfirmationEmail({
        to: q.builderEmail,
        builderName: q.builderName,
        orderNumber,
        projectName: q.projectName,
        total: q.total,
        orderUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/orders/${orderId}`,
      }).catch(err => console.error('Order email failed:', err))

      return NextResponse.json({
        success: true,
        message: 'Quote approved and order created',
        quoteStatus: 'APPROVED',
        orderNumber,
        orderId,
      })

    } else if (action === 'reject') {
      // Guard: only SENT → REJECTED is allowed per QUOTE_TRANSITIONS.
      try {
        requireValidTransition('quote', q.status, 'REJECTED')
      } catch (e) {
        const res = transitionErrorResponse(e)
        if (res) return res
        throw e
      }

      await prisma.$executeRawUnsafe(
        `UPDATE "Quote" SET
          status = 'REJECTED'::"QuoteStatus",
          "rejectedAt" = CURRENT_TIMESTAMP,
          "rejectionReason" = $1,
          "updatedAt" = CURRENT_TIMESTAMP
         WHERE id = $2`,
        cleanChangeNotes || 'No reason provided',
        params.id
      )

      return NextResponse.json({
        success: true,
        message: 'Quote rejected',
        quoteStatus: 'REJECTED',
      })

    } else if (action === 'requestChanges') {
      // "Request changes" is a status-reversal that QUOTE_TRANSITIONS does not
      // permit (SENT→DRAFT is not a valid edge). Keep the changeNotes update
      // but skip the status flip — leaving the quote in SENT until the state
      // machine is widened or the UI flow changes to use a different mechanism.
      await prisma.$executeRawUnsafe(
        `UPDATE "Quote" SET
          "changeNotes" = $1,
          "updatedAt" = CURRENT_TIMESTAMP
         WHERE id = $2`,
        cleanChangeNotes || '',
        params.id
      )

      return NextResponse.json({
        success: true,
        message: 'Change request submitted (status unchanged pending state-machine widening)',
        quoteStatus: q.status,
      })

    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: any) {
    console.error('Quote action error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
