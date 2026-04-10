export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const status = searchParams.get('status')
    const builderId = searchParams.get('builderId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const overdue = searchParams.get('overdue') === 'true'
    const sortBy = searchParams.get('sortBy') || 'createdAt'
    const sortDir = searchParams.get('sortDir') === 'asc' ? 'ASC' : 'DESC'
    const search = searchParams.get('search')

    const offset = (page - 1) * limit

    // Build WHERE conditions
    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    if (status) {
      conditions.push(`i."status" = $${idx}::"InvoiceStatus"`)
      params.push(status)
      idx++
    }

    if (overdue) {
      conditions.push(`i."status" = 'OVERDUE'::"InvoiceStatus"`)
    }

    if (builderId) {
      conditions.push(`i."builderId" = $${idx}`)
      params.push(builderId)
      idx++
    }

    const effectiveDateFrom = dateFrom || startDate
    const effectiveDateTo = dateTo || endDate

    if (effectiveDateFrom) {
      conditions.push(`i."createdAt" >= $${idx}::timestamptz`)
      params.push(effectiveDateFrom)
      idx++
    }
    if (effectiveDateTo) {
      conditions.push(`i."createdAt" <= $${idx}::timestamptz`)
      params.push(effectiveDateTo + 'T23:59:59.999Z')
      idx++
    }

    if (search) {
      conditions.push(`(i."invoiceNumber" ILIKE $${idx} OR b."companyName" ILIKE $${idx})`)
      params.push(`%${search}%`)
      idx++
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Determine sort column (whitelist approach)
    const invSortMap: Record<string, string> = {
      invoiceNumber: `i."invoiceNumber" ${sortDir}`,
      builder: `b."companyName" ${sortDir}`,
      total: `i."total" ${sortDir}`,
      balanceDue: `i."balanceDue" ${sortDir}`,
      status: `i."status" ${sortDir}`,
      dueDate: `i."dueDate" ${sortDir}`,
      issuedAt: `i."issuedAt" ${sortDir}`,
      createdAt: `i."createdAt" ${sortDir}`,
    }
    const orderClause = invSortMap[sortBy] || `i."createdAt" ${sortDir}`

    // Get invoices with builder info
    const invoices: any[] = await prisma.$queryRawUnsafe(`
      SELECT i."id", i."invoiceNumber", i."builderId", i."orderId", i."jobId",
             i."createdById", i."subtotal", i."taxAmount", i."total",
             i."amountPaid", i."balanceDue", i."status"::text AS "status",
             i."paymentTerm"::text AS "paymentTerm",
             i."issuedAt", i."dueDate", i."paidAt", i."notes",
             i."createdAt", i."updatedAt",
             b."companyName" AS "builderName", b."contactName" AS "builderContact",
             s."firstName" AS "createdByFirstName", s."lastName" AS "createdByLastName"
      FROM "Invoice" i
      LEFT JOIN "Builder" b ON b."id" = i."builderId"
      LEFT JOIN "Staff" s ON s."id" = i."createdById"
      ${whereClause}
      ORDER BY ${orderClause}
      LIMIT $${idx} OFFSET $${idx + 1}
    `, ...params, limit, offset)

    // Get total count
    const countResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS total
      FROM "Invoice" i
      LEFT JOIN "Builder" b ON b."id" = i."builderId"
      ${whereClause}
    `, ...params)
    const total = countResult[0]?.total || 0

    // Get invoice items for each invoice
    const invoiceIds = invoices.map(inv => inv.id)
    let itemsMap: Record<string, any[]> = {}
    let paymentsMap: Record<string, any[]> = {}

    if (invoiceIds.length > 0) {
      const placeholders = invoiceIds.map((_, i) => `$${i + 1}`).join(', ')

      const items: any[] = await prisma.$queryRawUnsafe(`
        SELECT "id", "invoiceId", "description", "quantity", "unitPrice", "lineTotal"
        FROM "InvoiceItem"
        WHERE "invoiceId" IN (${placeholders})
      `, ...invoiceIds)

      for (const item of items) {
        if (!itemsMap[item.invoiceId]) itemsMap[item.invoiceId] = []
        itemsMap[item.invoiceId].push(item)
      }

      const payments: any[] = await prisma.$queryRawUnsafe(`
        SELECT "id", "invoiceId", "amount", "method"::text AS "method", "reference", "receivedAt", "notes"
        FROM "Payment"
        WHERE "invoiceId" IN (${placeholders})
      `, ...invoiceIds)

      for (const pay of payments) {
        if (!paymentsMap[pay.invoiceId]) paymentsMap[pay.invoiceId] = []
        paymentsMap[pay.invoiceId].push(pay)
      }
    }

    // Enrich invoices
    const enrichedInvoices = invoices.map(inv => ({
      ...inv,
      builderName: inv.builderName || 'Unknown Builder',
      items: itemsMap[inv.id] || [],
      payments: paymentsMap[inv.id] || [],
      builder: inv.builderName ? { id: inv.builderId, companyName: inv.builderName } : null,
      createdBy: inv.createdByFirstName ? {
        id: inv.createdById,
        firstName: inv.createdByFirstName,
        lastName: inv.createdByLastName,
      } : null,
    }))

    // Calculate AR aging summary
    const agingRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT "dueDate", "total", "amountPaid"
      FROM "Invoice"
      WHERE "status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
    `)

    const now = new Date()
    const agingSummary = { current: 0, days_1_30: 0, days_31_60: 0, days_60_plus: 0 }

    for (const inv of agingRows) {
      const daysOverdue = inv.dueDate
        ? Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24))
        : 0
      const balanceDue = Number(inv.total) - Number(inv.amountPaid || 0)
      if (balanceDue <= 0) continue

      if (daysOverdue <= 0) agingSummary.current += balanceDue
      else if (daysOverdue <= 30) agingSummary.days_1_30 += balanceDue
      else if (daysOverdue <= 60) agingSummary.days_31_60 += balanceDue
      else agingSummary.days_60_plus += balanceDue
    }

    return NextResponse.json({
      data: enrichedInvoices,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      arAgingSummary: agingSummary,
    })
  } catch (error) {
    console.error('GET /api/ops/invoices error:', error)
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { builderId, paymentTerm, items, orderId, jobId, notes, createdById } = body

    if (!builderId || !paymentTerm || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields: builderId, paymentTerm, items (non-empty array)' },
        { status: 400 }
      )
    }

    // Generate invoice number
    const year = new Date().getFullYear()
    const maxRow: any[] = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(MAX(CAST(SUBSTRING("invoiceNumber" FROM '[0-9]+$') AS INT)), 0) AS max_num
      FROM "Invoice"
      WHERE "invoiceNumber" LIKE $1
    `, `INV-${year}-%`)
    const nextNumber = Number(maxRow[0]?.max_num || 0) + 1
    const invoiceNumber = `INV-${year}-${String(nextNumber).padStart(4, '0')}`

    // Calculate totals
    const subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unitPrice), 0)
    const taxAmount = 0
    const total = subtotal + taxAmount

    const invId = `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

    await prisma.$executeRawUnsafe(`
      INSERT INTO "Invoice" (
        "id", "invoiceNumber", "builderId", "orderId", "jobId", "createdById",
        "subtotal", "taxAmount", "total", "amountPaid", "balanceDue",
        "status", "paymentTerm", "notes",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, 0, $9,
        'DRAFT'::"InvoiceStatus", $10::"PaymentTerm", $11,
        NOW(), NOW()
      )
    `,
      invId, invoiceNumber, builderId, orderId || null, jobId || null, createdById || null,
      subtotal, taxAmount, total, paymentTerm, notes || null
    )

    // Create invoice items
    for (const item of items) {
      const itemId = `invitem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const lineTotal = item.quantity * item.unitPrice
      await prisma.$executeRawUnsafe(`
        INSERT INTO "InvoiceItem" ("id", "invoiceId", "description", "quantity", "unitPrice", "lineTotal")
        VALUES ($1, $2, $3, $4, $5, $6)
      `, itemId, invId, item.description, item.quantity, item.unitPrice, lineTotal)
    }

    // Fetch the created invoice
    const created: any[] = await prisma.$queryRawUnsafe(`
      SELECT i.*, b."companyName" AS "builderName"
      FROM "Invoice" i
      LEFT JOIN "Builder" b ON b."id" = i."builderId"
      WHERE i."id" = $1
    `, invId)

    const invItems: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM "InvoiceItem" WHERE "invoiceId" = $1
    `, invId)

    await audit(request, 'CREATE', 'Invoice', invId, { invoiceNumber, builderId, total })

    return NextResponse.json({
      ...created[0],
      builderName: created[0]?.builderName || 'Unknown Builder',
      items: invItems,
      payments: [],
    }, { status: 201 })
  } catch (error) {
    console.error('POST /api/ops/invoices error:', error)
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 })
  }
}
