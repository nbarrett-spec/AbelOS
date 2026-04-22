export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

interface PaymentRecord {
  id: string
  invoiceId: string
  invoiceNumber?: string
  builderId?: string
  companyName?: string
  amount: number
  method: string
  reference?: string
  notes?: string
  receivedAt: Date
}

/**
 * GET /api/ops/payments — List payments with filters
 * Query params: builderId, invoiceId, status, method, startDate, endDate, page, limit
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams

    // Parse query parameters
    const builderId = searchParams.get('builderId')
    const invoiceId = searchParams.get('invoiceId')
    const status = searchParams.get('status')
    const method = searchParams.get('method')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')))
    const offset = (page - 1) * limit

    // Build WHERE clause filters
    const whereConditions: string[] = []
    const params: any[] = []
    let paramIndex = 1

    if (builderId) {
      whereConditions.push(`i."builderId" = $${paramIndex}`)
      params.push(builderId)
      paramIndex++
    }

    if (invoiceId) {
      whereConditions.push(`p."invoiceId" = $${paramIndex}`)
      params.push(invoiceId)
      paramIndex++
    }

    if (method) {
      whereConditions.push(`p."method"::text = $${paramIndex}`)
      params.push(method)
      paramIndex++
    }

    if (startDate) {
      whereConditions.push(`p."receivedAt" >= $${paramIndex}::timestamp`)
      params.push(startDate)
      paramIndex++
    }

    if (endDate) {
      whereConditions.push(`p."receivedAt" <= $${paramIndex}::timestamp`)
      params.push(endDate)
      paramIndex++
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

    // Get total count
    const countQuery = `
      SELECT COUNT(*)::int as count
      FROM "Payment" p
      LEFT JOIN "Invoice" i ON p."invoiceId" = i."id"
      ${whereClause}
    `

    const countResult: any[] = await prisma.$queryRawUnsafe(countQuery, ...params) as any[]
    const total = countResult[0]?.count || 0

    // Get paginated results
    const query = `
      SELECT
        p."id",
        p."invoiceId",
        p."amount",
        p."method"::text as "method",
        p."reference",
        p."notes",
        p."receivedAt",
        i."invoiceNumber",
        i."builderId",
        b."companyName"
      FROM "Payment" p
      LEFT JOIN "Invoice" i ON p."invoiceId" = i."id"
      LEFT JOIN "Builder" b ON i."builderId" = b."id"
      ${whereClause}
      ORDER BY p."receivedAt" DESC NULLS LAST
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `

    const payments: PaymentRecord[] = await prisma.$queryRawUnsafe(
      query,
      ...params,
      limit,
      offset
    ) as PaymentRecord[]

    // Calculate totals
    const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0)

    return NextResponse.json({
      success: true,
      payments,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      totals: {
        amount: totalAmount,
        count: payments.length,
      },
    })
  } catch (error) {
    console.error('Failed to fetch payments:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/ops/payments — Record a new payment
 * Body: { invoiceId, builderId, amount, method, referenceNumber?, notes? }
 * Header: x-staff-id (staff who recorded the payment)
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Payment', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const staffId = request.headers.get('x-staff-id')

    // Validate required fields
    const { invoiceId, amount, method, referenceNumber, notes } = body

    if (!invoiceId || !amount || !method) {
      return NextResponse.json(
        { error: 'Missing required fields: invoiceId, amount, method' },
        { status: 400 }
      )
    }

    if (amount <= 0) {
      return NextResponse.json(
        { error: 'Amount must be greater than 0' },
        { status: 400 }
      )
    }

    // Validate payment method
    const validMethods = ['CHECK', 'ACH', 'WIRE', 'CREDIT_CARD', 'CASH', 'OTHER']
    if (!validMethods.includes(method)) {
      return NextResponse.json(
        { error: `Invalid payment method. Must be one of: ${validMethods.join(', ')}` },
        { status: 400 }
      )
    }

    // Generate payment ID
    const paymentId = 'pmt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

    // Insert payment record — Payment has: id, invoiceId, amount, method, reference, receivedAt, notes
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Payment" ("id", "invoiceId", "amount", "method", "reference", "notes", "receivedAt")
       VALUES ($1, $2, $3, $4::"PaymentMethod", $5, $6, NOW())`,
      paymentId,
      invoiceId,
      amount,
      method,
      referenceNumber || null,
      notes || null
    )

    // Update invoice balance if invoice exists
    try {
      const invoiceResult: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id", ("total" - COALESCE("amountPaid",0))::float AS "balanceDue", "amountPaid", "total" FROM "Invoice" WHERE "id" = $1`,
        invoiceId
      ) as any[]

      if (invoiceResult.length > 0) {
        const invoice = invoiceResult[0]
        const newAmountPaid = (invoice.amountPaid || 0) + amount
        const newBalanceDue = Math.max(0, invoice.total - newAmountPaid)

        // Determine new status
        let newStatus = 'PARTIALLY_PAID'
        if (newBalanceDue === 0) {
          newStatus = 'PAID'
        }

        await prisma.$executeRawUnsafe(
          `UPDATE "Invoice"
           SET "amountPaid" = $1, "balanceDue" = $2, "status" = $3, "updatedAt" = NOW()
           WHERE "id" = $4`,
          newAmountPaid,
          newBalanceDue,
          newStatus,
          invoiceId
        )
      }
    } catch (e) {
      // Invoice might not exist, continue
      // console.log('Invoice not found or error updating balance:', e)
    }

    // Fetch and return created payment
    const createdPayment: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        p."id",
        p."invoiceId",
        i."invoiceNumber",
        i."builderId",
        b."companyName",
        p."amount",
        p."method"::text as "method",
        p."reference",
        p."notes",
        p."receivedAt"
      FROM "Payment" p
      LEFT JOIN "Invoice" i ON p."invoiceId" = i."id"
      LEFT JOIN "Builder" b ON i."builderId" = b."id"
      WHERE p."id" = $1`,
      paymentId
    ) as any[]

    return NextResponse.json(
      {
        success: true,
        message: 'Payment recorded successfully',
        payment: createdPayment[0] || {
          id: paymentId,
          invoiceId,
          amount,
          method,
          reference: referenceNumber,
          notes,
          receivedAt: new Date(),
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Failed to record payment:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
