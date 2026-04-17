export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { isStripeConfigured, getOrCreateCustomer, createCheckoutSession, getCheckoutSession } from '@/lib/stripe'
import { auditBuilder } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/payments — List builder's payments, or verify a checkout session
// ──────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const token = request.cookies.get('abel_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let session: any
  try { session = await verifyToken(token) } catch {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)

  // Check for session verification (after Stripe redirect)
  const checkoutSessionId = searchParams.get('verify_session')
  if (checkoutSessionId) {
    if (!isStripeConfigured()) {
      return NextResponse.json({ error: 'Payments not configured' }, { status: 503 })
    }
    try {
      const cs = await getCheckoutSession(checkoutSessionId)
      return NextResponse.json({
        status: cs.payment_status, // 'paid', 'unpaid', 'no_payment_required'
        invoiceId: cs.metadata?.invoiceId,
        invoiceNumber: cs.metadata?.invoiceNumber,
        amount: cs.amount_total ? cs.amount_total / 100 : 0,
      })
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
  }

  // Default: list builder's invoices with payment status
  try {
    let invoices: any[] = []
    try {
      invoices = await prisma.$queryRawUnsafe(`
        SELECT i.id, i."invoiceNumber", i.total, i."amountPaid", i."balanceDue",
               i.status, i."dueDate", i."issuedAt",
               i."stripeSessionId", i."stripePaymentUrl"
        FROM "Invoice" i
        WHERE i."builderId" = $1
          AND i.status NOT IN ('DRAFT', 'VOID', 'WRITE_OFF')
        ORDER BY i."createdAt" DESC
        LIMIT 50
      `, session.builderId)
    } catch {
      // Stripe columns may not exist yet — fallback query without them
      invoices = await prisma.$queryRawUnsafe(`
        SELECT i.id, i."invoiceNumber", i.total, i."amountPaid", i."balanceDue",
               i.status, i."dueDate", i."issuedAt"
        FROM "Invoice" i
        WHERE i."builderId" = $1
          AND i.status NOT IN ('DRAFT', 'VOID', 'WRITE_OFF')
        ORDER BY i."createdAt" DESC
        LIMIT 50
      `, session.builderId)
    }

    return NextResponse.json({
      invoices,
      stripeEnabled: isStripeConfigured(),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/payments — Create a checkout session for an invoice
// ──────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const token = request.cookies.get('abel_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let session: any
  try { session = await verifyToken(token) } catch {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Online payments are not yet configured. Please contact Abel Lumber to pay by check or ACH.' }, { status: 503 })
  }

  try {
    const { invoiceId } = await request.json()
    if (!invoiceId) {
      return NextResponse.json({ error: 'invoiceId required' }, { status: 400 })
    }

    // Fetch the invoice
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT i.id, i."invoiceNumber", i."balanceDue", i."builderId", i.status,
             b.email, b."companyName"
      FROM "Invoice" i
      JOIN "Builder" b ON i."builderId" = b.id
      WHERE i.id = $1 AND i."builderId" = $2
    `, invoiceId, session.builderId)

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const invoice = rows[0]
    const balance = Number(invoice.balanceDue)

    if (balance <= 0) {
      return NextResponse.json({ error: 'Invoice is already paid' }, { status: 400 })
    }

    if (['PAID', 'VOID', 'WRITE_OFF'].includes(invoice.status)) {
      return NextResponse.json({ error: 'Invoice cannot be paid' }, { status: 400 })
    }

    // Get or create Stripe customer
    const customerId = await getOrCreateCustomer(session.builderId, invoice.email, invoice.companyName)

    // Create Checkout Session
    const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'https://app.abellumber.com'
    const { url, sessionId } = await createCheckoutSession({
      amount: balance,
      invoiceNumber: invoice.invoiceNumber,
      invoiceId: invoice.id,
      builderId: session.builderId,
      customerEmail: invoice.email,
      successUrl: `${origin}/dashboard/payments?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/dashboard/payments?cancelled=true`,
    })

    // Store the session ID on the invoice for tracking
    await prisma.$executeRawUnsafe(`
      UPDATE "Invoice"
      SET "stripeSessionId" = $1, "stripePaymentUrl" = $2, "updatedAt" = NOW()
      WHERE id = $3
    `, sessionId, url, invoiceId).catch(() => {
      // Columns may not exist yet — that's OK, payment still works
    })

    await auditBuilder(session.builderId, invoice.companyName, 'INITIATE_PAYMENT', 'Invoice', invoiceId, {
      invoiceNumber: invoice.invoiceNumber, amount: balance, stripeSessionId: sessionId,
    })

    return NextResponse.json({ url, sessionId })
  } catch (e: any) {
    console.error('Payment creation error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
