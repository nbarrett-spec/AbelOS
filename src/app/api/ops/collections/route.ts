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
    const limit = parseInt(searchParams.get('limit') || '20', 10)
    const bucket = searchParams.get('bucket') // 1-30, 31-60, 60plus
    const builderId = searchParams.get('builderId')

    const offset = (page - 1) * limit

    // Build WHERE conditions for overdue invoices
    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    // Only overdue or sent invoices
    conditions.push(`i."status" IN ('OVERDUE'::"InvoiceStatus", 'SENT'::"InvoiceStatus")`)

    if (builderId) {
      conditions.push(`i."builderId" = $${idx}`)
      params.push(builderId)
      idx++
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Fetch all overdue invoices with builder info
    const invoices: any[] = await prisma.$queryRawUnsafe(`
      SELECT i."id", i."invoiceNumber", i."builderId", i."total", i."balanceDue",
             i."status"::text AS "status", i."dueDate", i."createdAt",
             b."companyName" AS "builderName", b."contactName" AS "builderContact"
      FROM "Invoice" i
      LEFT JOIN "Builder" b ON b."id" = i."builderId"
      ${whereClause}
      ORDER BY i."dueDate" ASC
    `, ...params)

    const now = new Date()

    // Calculate days overdue and categorize
    const invoicesWithAging = invoices.map((inv) => {
      const daysOverdue = inv.dueDate
        ? Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24))
        : 0
      let agingBucket = '60plus'
      if (daysOverdue <= 30) agingBucket = '1-30'
      else if (daysOverdue <= 60) agingBucket = '31-60'

      return {
        ...inv,
        daysOverdue,
        agingBucket,
        balanceDue: Number(inv.balanceDue),
        total: Number(inv.total),
      }
    })

    // Filter by bucket if specified
    let filtered = invoicesWithAging
    if (bucket) {
      filtered = invoicesWithAging.filter((inv) => inv.agingBucket === bucket)
    }

    // Get last collection action for each invoice
    const invoiceIds = invoices.map((inv) => inv.id)
    let lastActionMap: Record<string, any> = {}

    if (invoiceIds.length > 0) {
      const placeholders = invoiceIds.map((_, i) => `$${i + 1}`).join(', ')
      const lastActions: any[] = await prisma.$queryRawUnsafe(`
        SELECT DISTINCT ON ("invoiceId") "invoiceId", "actionType", "channel", "sentAt", "notes"
        FROM "CollectionAction"
        WHERE "invoiceId" IN (${placeholders})
        ORDER BY "invoiceId", "sentAt" DESC
      `, ...invoiceIds)

      for (const action of lastActions) {
        lastActionMap[action.invoiceId] = action
      }
    }

    const enrichedInvoices = filtered
      .map((inv) => ({
        ...inv,
        lastAction: lastActionMap[inv.id] || null,
      }))
      .sort((a, b) => b.daysOverdue - a.daysOverdue)

    // Calculate summary stats
    const totalOverdueAmount = invoicesWithAging.reduce(
      (sum, inv) => sum + Number(inv.balanceDue),
      0
    )
    const countByBucket = {
      '1-30': invoicesWithAging.filter((inv) => inv.agingBucket === '1-30').length,
      '31-60': invoicesWithAging.filter((inv) => inv.agingBucket === '31-60').length,
      '60plus': invoicesWithAging.filter((inv) => inv.agingBucket === '60plus').length,
    }

    // Count actions this month
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const actionsThisMonth: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count
      FROM "CollectionAction"
      WHERE "sentAt" >= $1
    `, monthStart)
    const actionsCount = actionsThisMonth[0]?.count || 0

    // Paginate enriched results
    const paginatedInvoices = enrichedInvoices.slice(offset, offset + limit)

    return NextResponse.json({
      summary: {
        totalOverdueAmount,
        countByBucket,
        totalOverdueInvoices: invoicesWithAging.length,
        actionsThisMonth: actionsCount,
      },
      data: paginatedInvoices,
      pagination: {
        page,
        limit,
        total: filtered.length,
        pages: Math.ceil(filtered.length / limit),
      },
    })
  } catch (error) {
    console.error('GET /api/ops/collections error:', error)
    return NextResponse.json({ error: 'Failed to fetch collections data' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { invoiceId, actionType, channel, notes, sentBy } = body

    if (!invoiceId || !actionType || !channel) {
      return NextResponse.json(
        { error: 'Missing required fields: invoiceId, actionType, channel' },
        { status: 400 }
      )
    }

    // Validate actionType
    const validActionTypes = ['REMINDER', 'PAST_DUE', 'FINAL_NOTICE', 'ACCOUNT_HOLD', 'PHONE_CALL', 'PAYMENT_PLAN']
    if (!validActionTypes.includes(actionType)) {
      return NextResponse.json(
        { error: `Invalid actionType. Must be one of: ${validActionTypes.join(', ')}` },
        { status: 400 }
      )
    }

    // Fetch invoice and builder
    const invoice: any[] = await prisma.$queryRawUnsafe(`
      SELECT i."id", i."invoiceNumber", i."builderId", i."total", i."balanceDue", i."status"::text AS "status"
      FROM "Invoice" i
      WHERE i."id" = $1
    `, invoiceId)

    if (!invoice || invoice.length === 0) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const inv = invoice[0]

    // Create collection action
    const actionId = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    await prisma.$executeRawUnsafe(`
      INSERT INTO "CollectionAction" (
        "id", "invoiceId", "actionType", "channel", "sentBy", "notes", "sentAt", "createdAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, NOW(), NOW()
      )
    `, actionId, invoiceId, actionType, channel, sentBy || null, notes || null)

    // If ACCOUNT_HOLD, try to suspend the builder
    if (actionType === 'ACCOUNT_HOLD') {
      await prisma.$executeRawUnsafe(`
        UPDATE "Builder"
        SET "status" = 'SUSPENDED'::"AccountStatus", "updatedAt" = NOW()
        WHERE "id" = $1
      `, inv.builderId)
    }

    await audit(request, 'CREATE', 'CollectionAction', actionId, {
      invoiceId,
      actionType,
      channel,
    })

    // Fetch and return the created action
    const created: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM "CollectionAction" WHERE "id" = $1
    `, actionId)

    return NextResponse.json(created[0], { status: 201 })
  } catch (error) {
    console.error('POST /api/ops/collections error:', error)
    return NextResponse.json({ error: 'Failed to record collection action' }, { status: 500 })
  }
}
