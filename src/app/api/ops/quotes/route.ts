export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { sendQuoteReadyEmail } from '@/lib/email'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { recordQuoteActivity } from '@/lib/events/activity'
import { requireValidTransition, transitionErrorResponse } from '@/lib/status-guard'

// GET /api/ops/quotes — List all quotes (ops-side, no builder auth required)
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Ensure missing columns exist (schema drift from incomplete migrations)
    const schemaMigrations = [
      `ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "notes" TEXT`,
      `ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "termAdjustment" DOUBLE PRECISION DEFAULT 0`,
      `ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "version" INT DEFAULT 1`,
      `ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "location" TEXT`,
      `ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "sortOrder" INT DEFAULT 0`,
      // Allow custom line items that aren't tied to a catalog product
      `ALTER TABLE "QuoteItem" ALTER COLUMN "productId" DROP NOT NULL`,
      // Clean up any PLACEHOLDER products — reassign their quote items to NULL first
      `UPDATE "QuoteItem" SET "productId" = NULL WHERE "productId" IN (SELECT id FROM "Product" WHERE sku = 'PLACEHOLDER')`,
      `DELETE FROM "Product" WHERE sku = 'PLACEHOLDER'`,
    ]
    for (const sql of schemaMigrations) {
      try { await prisma.$executeRawUnsafe(sql) }
      catch (e: any) { console.warn('[Quotes] Schema migration failed:', sql.slice(0, 60), e?.message) }
    }

    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)))
    const status = searchParams.get('status')
    const search = searchParams.get('search')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const sortBy = searchParams.get('sortBy') || 'createdAt'
    const sortDir = searchParams.get('sortDir') || 'desc'
    const skip = (page - 1) * limit

    // Build WHERE clause with parameterized queries
    const whereConditions: string[] = []
    const params: any[] = []
    let idx = 1

    if (status) {
      const validStatuses = ['DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED', 'ORDERED']
      if (validStatuses.includes(status)) {
        whereConditions.push(`q."status" = $${idx}::"QuoteStatus"`)
        params.push(status)
        idx++
      }
    }
    if (search) {
      whereConditions.push(
        `(q."quoteNumber" ILIKE $${idx} OR p."name" ILIKE $${idx} OR b."companyName" ILIKE $${idx})`
      )
      params.push(`%${search}%`)
      idx++
    }
    if (dateFrom) {
      whereConditions.push(`q."createdAt" >= $${idx}::timestamptz`)
      params.push(new Date(dateFrom).toISOString())
      idx++
    }
    if (dateTo) {
      whereConditions.push(`q."createdAt" <= $${idx}::timestamptz`)
      params.push(new Date(dateTo + 'T23:59:59.999Z').toISOString())
      idx++
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : ''

    // Build ORDER BY clause (whitelist approach — no user input in SQL)
    const dir = sortDir.toLowerCase() === 'asc' ? 'ASC' : 'DESC'
    const sortMap: Record<string, string> = {
      quoteNumber: `q."quoteNumber" ${dir}`,
      status: `q."status" ${dir}`,
      total: `q."total" ${dir}`,
      createdAt: `q."createdAt" ${dir}`,
      builder: `b."companyName" ${dir}`,
      project: `p."name" ${dir}`,
    }
    const orderByClause = sortMap[sortBy] || `q."createdAt" ${dir}`

    // Count total records
    const countQuery = `
      SELECT COUNT(*)::int as count
      FROM "Quote" q
      JOIN "Project" p ON q."projectId" = p."id"
      JOIN "Builder" b ON p."builderId" = b."id"
      ${whereClause}
    `
    const countResult = await prisma.$queryRawUnsafe<{ count: number }[]>(countQuery, ...params)
    const total = countResult[0]?.count || 0

    // Fetch quotes with joins
    const quotesQuery = `
      SELECT
        q."id",
        q."quoteNumber",
        q."projectId",
        q."takeoffId",
        q."subtotal",
        q."taxRate",
        q."taxAmount",
        q."termAdjustment",
        q."total",
        q."status",
        q."validUntil",
        q."version",
        q."notes",
        q."createdAt",
        q."updatedAt",
        p."id" as project_id,
        p."name" as project_name,
        p."planName" as project_planName,
        b."id" as builder_id,
        b."companyName" as builder_companyName,
        b."contactName" as builder_contactName
      FROM "Quote" q
      JOIN "Project" p ON q."projectId" = p."id"
      JOIN "Builder" b ON p."builderId" = b."id"
      ${whereClause}
      ORDER BY ${orderByClause}
      LIMIT $${idx} OFFSET $${idx + 1}
    `
    const quotes = await prisma.$queryRawUnsafe<any[]>(quotesQuery, ...params, limit, skip)

    // Fetch items for all quotes in one batch
    const quoteIds = quotes.map(q => q.id)
    let items: any[] = []
    if (quoteIds.length > 0) {
      const itemsQuery = `
        SELECT
          qi."id",
          qi."quoteId",
          qi."productId",
          qi."description",
          qi."quantity",
          qi."unitPrice",
          qi."lineTotal",
          qi."location",
          qi."sortOrder",
          pr."name" as product_name,
          pr."sku" as product_sku
        FROM "QuoteItem" qi
        LEFT JOIN "Product" pr ON qi."productId" = pr."id"
        WHERE qi."quoteId" = ANY($1::text[])
        ORDER BY qi."sortOrder" ASC
      `
      items = await prisma.$queryRawUnsafe<any[]>(itemsQuery, quoteIds)
    }

    // Format response
    const formattedQuotes = quotes.map(q => ({
      id: q.id,
      quoteNumber: q.quoteNumber,
      projectId: q.projectId,
      takeoffId: q.takeoffId,
      subtotal: q.subtotal,
      taxRate: q.taxRate,
      taxAmount: q.taxAmount,
      termAdjustment: q.termAdjustment,
      total: q.total,
      status: q.status,
      validUntil: q.validUntil,
      version: q.version,
      notes: q.notes,
      createdAt: q.createdAt,
      updatedAt: q.updatedAt,
      items: items
        .filter(it => it.quoteId === q.id)
        .map(it => ({
          id: it.id,
          quoteId: it.quoteId,
          productId: it.productId,
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          lineTotal: it.lineTotal,
          location: it.location,
          sortOrder: it.sortOrder,
          product: {
            name: it.product_name,
            sku: it.product_sku,
          },
        })),
      project: {
        id: q.project_id,
        name: q.project_name,
        planName: q.project_planName,
        builder: {
          id: q.builder_id,
          companyName: q.builder_companyName,
          contactName: q.builder_contactName,
        },
      },
    }))

    return NextResponse.json({
      data: formattedQuotes,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (error: any) {
    console.error('GET /api/ops/quotes error:', error)
    return NextResponse.json({ error: 'Internal server error', details: error?.message || String(error) }, { status: 500 })
  }
}

// POST /api/ops/quotes — Create a quote from the ops side (for a builder)
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { builderId, projectId, takeoffId, items, validDays = 30, notes } = body

    if (!builderId || !items || items.length === 0) {
      return NextResponse.json(
        { error: 'builderId and items are required' },
        { status: 400 }
      )
    }

    // takeoffId is NOT NULL in the Quote table — require it up front with a clean 400
    if (!takeoffId || typeof takeoffId !== 'string') {
      return NextResponse.json(
        { error: 'takeoffId is required (the takeoff this quote is based on)' },
        { status: 400 }
      )
    }

    // Generate quote number using COUNT
    const countQuery = `SELECT COUNT(*)::int as count FROM "Quote"`
    const countResult = await prisma.$queryRawUnsafe<{ count: number }[]>(countQuery)
    const quoteCount = countResult[0]?.count || 0
    const num = String(quoteCount + 1).padStart(4, '0')
    const quoteNumber = `QTE-${new Date().getFullYear()}-${num}`

    // Calculate totals
    let subtotal = 0
    const quoteItems = items.map((item: any, idx: number) => {
      const lineTotal = (item.unitPrice || 0) * (item.quantity || 1)
      subtotal += lineTotal
      return {
        productId: item.productId || null,
        description: item.description || 'Line item',
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        lineTotal,
        location: item.location || null,
        sortOrder: idx,
      }
    })

    // Get builder payment term for adjustment
    const builderQuery = `SELECT "paymentTerm" FROM "Builder" WHERE "id" = $1 LIMIT 1`
    const builderResult = await prisma.$queryRawUnsafe<{ paymentTerm: string }[]>(builderQuery, builderId)
    const builderPaymentTerm = builderResult[0]?.paymentTerm || 'NET_15'

    const TERM_MULTIPLIERS: Record<string, number> = {
      PAY_AT_ORDER: 0.97,
      PAY_ON_DELIVERY: 0.98,
      DUE_ON_RECEIPT: 1.0,
      NET_15: 1.0,
      NET_30: 1.02,
    }
    const mult = TERM_MULTIPLIERS[builderPaymentTerm] || 1.0
    const termAdjustment = subtotal * (mult - 1)
    const total = subtotal + termAdjustment

    // Create quote
    const quoteId = `qte_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const validUntil = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000).toISOString()
    const now = new Date().toISOString()
    const projectIdValue = projectId || 'NULL'

    const createQuoteQuery = `
      INSERT INTO "Quote" (
        "id", "quoteNumber", "projectId", "takeoffId", "subtotal", "termAdjustment", "total",
        "status", "validUntil", "notes", "version", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::"QuoteStatus", $9::timestamptz, $10, 1, $11::timestamptz, $12::timestamptz)
      RETURNING "id", "quoteNumber", "projectId", "takeoffId", "subtotal", "taxRate", "taxAmount",
                "termAdjustment", "total", "status", "validUntil", "version", "notes",
                "createdAt", "updatedAt"
    `
    const quoteResult = await prisma.$queryRawUnsafe<any[]>(
      createQuoteQuery, quoteId, quoteNumber, projectId || null, takeoffId, subtotal, termAdjustment, total, 'DRAFT', validUntil, notes || null, now, now
    )
    const createdQuote = quoteResult[0]

    // Create quote items — productId is nullable for custom line items
    for (const item of quoteItems) {
      const itemId = `qi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      await prisma.$executeRawUnsafe(
        `INSERT INTO "QuoteItem" ("id", "quoteId", "productId", "description", "quantity", "unitPrice", "lineTotal", "location", "sortOrder", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz)`,
        itemId, quoteId, item.productId || null, item.description || 'Line item', item.quantity || 1, item.unitPrice || 0, item.lineTotal, item.location || null, item.sortOrder, now, now
      )
    }

    // Fetch created quote with items
    const fetchedQuote = await prisma.$queryRawUnsafe<any[]>(
      `SELECT q."id", q."quoteNumber", q."projectId", q."takeoffId", q."subtotal", q."taxRate", q."taxAmount",
              q."termAdjustment", q."total", q."status", q."validUntil", q."version", q."notes", q."createdAt", q."updatedAt"
       FROM "Quote" q WHERE q."id" = $1`, quoteId
    )

    const fetchedItems = await prisma.$queryRawUnsafe<any[]>(
      `SELECT qi."id", qi."quoteId", qi."productId", qi."description", qi."quantity", qi."unitPrice",
              qi."lineTotal", qi."location", qi."sortOrder"
       FROM "QuoteItem" qi WHERE qi."quoteId" = $1 ORDER BY qi."sortOrder" ASC`, quoteId
    )

    const response = {
      ...fetchedQuote[0],
      items: fetchedItems,
    }

    await audit(request, 'CREATE', 'Quote', quoteId, { quoteNumber })

    return NextResponse.json(response, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/ops/quotes error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/ops/quotes — Update quote status, notes, validUntil, and items
export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { id, status, notes, validUntil, items } = body

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    // Fetch existing quote with builder info
    const quoteQuery = `
      SELECT q."id", q."quoteNumber", q."projectId", q."takeoffId", q."subtotal", q."taxRate",
             q."taxAmount", q."termAdjustment", q."total", q."status", q."validUntil", q."version",
             q."notes", q."createdAt", q."updatedAt",
             p."name" as project_name, b."id" as builder_id, b."companyName" as builder_companyName,
             b."contactName" as builder_contactName, b."email" as builder_email, b."paymentTerm" as builder_paymentTerm
      FROM "Quote" q
      LEFT JOIN "Project" p ON q."projectId" = p."id"
      LEFT JOIN "Builder" b ON p."builderId" = b."id"
      WHERE q."id" = $1
    `
    const quoteResult = await prisma.$queryRawUnsafe<any[]>(quoteQuery, id)
    const quote = quoteResult[0]

    if (!quote) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }

    let subtotal = quote.subtotal
    let termAdjustment = quote.termAdjustment
    let total = quote.total

    // Handle items update
    if (items && Array.isArray(items)) {
      // Delete all existing items for this quote
      await prisma.$executeRawUnsafe(`DELETE FROM "QuoteItem" WHERE "quoteId" = $1`, id)

      // Calculate new totals from items
      subtotal = 0
      const quoteItems = items.map((item: any, idx: number) => {
        const lineTotal = (item.unitPrice || 0) * (item.quantity || 1)
        subtotal += lineTotal
        return {
          productId: item.productId || null,
          description: item.description || 'Line item',
          quantity: item.quantity || 1,
          unitPrice: item.unitPrice || 0,
          lineTotal,
          location: item.location || null,
          sortOrder: idx,
        }
      })

      // Get builder payment term for adjustment
      const TERM_MULTIPLIERS: Record<string, number> = {
        PAY_AT_ORDER: 0.97,
        PAY_ON_DELIVERY: 0.98,
        DUE_ON_RECEIPT: 1.0,
        NET_15: 1.0,
        NET_30: 1.02,
      }
      const mult = TERM_MULTIPLIERS[quote.builder_paymentTerm || 'NET_15'] || 1.0
      termAdjustment = subtotal * (mult - 1)
      total = subtotal + termAdjustment

      // Insert new items — productId is nullable for custom line items
      const now = new Date().toISOString()
      for (const item of quoteItems) {
        const itemId = `qi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
        await prisma.$executeRawUnsafe(
          `INSERT INTO "QuoteItem" ("id", "quoteId", "productId", "description", "quantity", "unitPrice", "lineTotal", "location", "sortOrder", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz)`,
          itemId, id, item.productId || null, item.description || 'Line item', item.quantity || 1, item.unitPrice || 0, item.lineTotal, item.location || null, item.sortOrder, now, now
        )
      }
    }

    // Guard: enforce QuoteStatus state machine before building UPDATE.
    if (status) {
      const validStatuses = ['DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED', 'ORDERED']
      if (validStatuses.includes(status)) {
        try {
          requireValidTransition('quote', quote.status, status)
        } catch (e) {
          const res = transitionErrorResponse(e)
          if (res) return res
          throw e
        }
      }
    }

    // Build UPDATE query with parameterized values
    const updateParts: string[] = []
    const updateParams: any[] = []
    let uidx = 1

    if (status) {
      const validStatuses = ['DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED', 'ORDERED']
      if (validStatuses.includes(status)) {
        updateParts.push(`"status" = $${uidx}::"QuoteStatus"`)
        updateParams.push(status)
        uidx++
      }
    }
    if (notes !== undefined) {
      updateParts.push(`"notes" = $${uidx}`)
      updateParams.push(notes || null)
      uidx++
    }
    if (validUntil) {
      updateParts.push(`"validUntil" = $${uidx}::timestamptz`)
      updateParams.push(new Date(validUntil).toISOString())
      uidx++
    }
    if (items && Array.isArray(items)) {
      updateParts.push(`"subtotal" = $${uidx}`)
      updateParams.push(subtotal)
      uidx++
      updateParts.push(`"termAdjustment" = $${uidx}`)
      updateParams.push(termAdjustment)
      uidx++
      updateParts.push(`"total" = $${uidx}`)
      updateParams.push(total)
      uidx++
    }

    if (updateParts.length > 0) {
      const nowStr = new Date().toISOString()
      updateParts.push(`"updatedAt" = $${uidx}::timestamptz`)
      updateParams.push(nowStr)
      uidx++
      await prisma.$executeRawUnsafe(
        `UPDATE "Quote" SET ${updateParts.join(', ')} WHERE "id" = $${uidx}`,
        ...updateParams, id
      )
    }

    // Fetch updated quote with items
    const updatedQuoteResult = await prisma.$queryRawUnsafe<any[]>(
      `SELECT q."id", q."quoteNumber", q."projectId", q."takeoffId", q."subtotal", q."taxRate",
              q."taxAmount", q."termAdjustment", q."total", q."status", q."validUntil", q."version",
              q."notes", q."createdAt", q."updatedAt",
              p."name" as project_name, b."id" as builder_id, b."companyName" as builder_companyName,
              b."contactName" as builder_contactName, b."email" as builder_email
       FROM "Quote" q LEFT JOIN "Project" p ON q."projectId" = p."id"
       LEFT JOIN "Builder" b ON p."builderId" = b."id" WHERE q."id" = $1`, id
    )
    const updatedQuote = updatedQuoteResult[0]

    const fetchedItems = await prisma.$queryRawUnsafe<any[]>(
      `SELECT qi."id", qi."quoteId", qi."productId", qi."description", qi."quantity", qi."unitPrice",
              qi."lineTotal", qi."location", qi."sortOrder"
       FROM "QuoteItem" qi WHERE qi."quoteId" = $1 ORDER BY qi."sortOrder" ASC`, id
    )

    // Send email to builder when quote status changes to SENT
    if (status === 'SENT' && updatedQuote.builder_email) {
      try {
        await sendQuoteReadyEmail({
          to: updatedQuote.builder_email,
          builderName: updatedQuote.builder_companyName || updatedQuote.builder_contactName || 'Builder',
          projectName: updatedQuote.project_name || 'Your Project',
          quoteNumber: updatedQuote.quoteNumber,
          total: Number(updatedQuote.total),
          validUntil: updatedQuote.validUntil?.toISOString() || new Date(Date.now() + 30 * 86400000).toISOString(),
          quoteUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/projects/${updatedQuote.projectId}`,
        })

        // Create in-app notification for builder
        try {
          const notifId = `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
          await prisma.$executeRawUnsafe(
            `INSERT INTO "BuilderNotification" ("id", "builderId", "type", "title", "message", "link", "read", "createdAt")
             VALUES ($1, $2, 'QUOTE_READY', $3, $4, $5, false, NOW())`,
            notifId,
            updatedQuote.builder_id,
            `Quote ${updatedQuote.quoteNumber} Ready`,
            `Your quote for ${updatedQuote.project_name || 'your project'} is ready for review`,
            `/projects/${updatedQuote.projectId}`
          )
        } catch (notifError: any) {
          console.warn('Failed to create builder notification:', notifError)
          // Continue without failing the request
        }

        // Log activity record — use the idempotent event helper.
        // (The prior inline INSERT referenced non-existent columns and would crash.)
        recordQuoteActivity({
          quoteId: id,
          builderId: updatedQuote.builder_id,
          staffId: request.headers.get('x-staff-id'),
          quoteNumber: updatedQuote.quoteNumber,
          total: Number(updatedQuote.total),
        }).catch(() => {})
      } catch (emailError: any) {
        console.warn('Failed to send quote ready email:', emailError)
        // Continue without failing the request
      }
    }

    const response = {
      ...updatedQuote,
      items: fetchedItems,
      project: {
        name: updatedQuote.project_name,
        builder: {
          id: updatedQuote.builder_id,
          companyName: updatedQuote.builder_companyName,
          contactName: updatedQuote.builder_contactName,
        },
      },
    }

    await audit(request, 'UPDATE', 'Quote', id, { status, notes })

    return NextResponse.json(response)
  } catch (error: any) {
    console.error('PATCH /api/ops/quotes error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/ops/quotes — Delete or archive a quote
export async function DELETE(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { id } = body

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    // Fetch existing quote
    const quoteResult = await prisma.$queryRawUnsafe<{ status: string }[]>(
      `SELECT "status" FROM "Quote" WHERE "id" = $1 LIMIT 1`, id
    )
    const quote = quoteResult[0]

    if (!quote) {
      return NextResponse.json(
        { error: 'Quote not found' },
        { status: 404 }
      )
    }

    if (quote.status === 'ORDERED') {
      return NextResponse.json(
        { error: 'Cannot delete an ordered quote' },
        { status: 400 }
      )
    }

    if (quote.status === 'DRAFT' || quote.status === 'SENT') {
      // Delete quote items first, then the quote
      await prisma.$executeRawUnsafe(`DELETE FROM "QuoteItem" WHERE "quoteId" = $1`, id)
      await prisma.$executeRawUnsafe(`DELETE FROM "Quote" WHERE "id" = $1`, id)
    } else {
      // For approved or other statuses, soft-delete by setting status to EXPIRED.
      // Only SENT → EXPIRED is valid per QUOTE_TRANSITIONS; skip the write if
      // the quote is already in a terminal state (APPROVED, REJECTED, ORDERED).
      try {
        requireValidTransition('quote', quote.status, 'EXPIRED')
        await prisma.$executeRawUnsafe(
          `UPDATE "Quote" SET "status" = 'EXPIRED'::"QuoteStatus", "updatedAt" = $1::timestamptz WHERE "id" = $2`,
          new Date().toISOString(), id
        )
      } catch (e) {
        const res = transitionErrorResponse(e)
        if (res) return res
        throw e
      }
    }

    await audit(request, 'DELETE', 'Quote', id, {})

    return NextResponse.json({
      message: 'Quote deleted/archived',
      id,
    })
  } catch (error: any) {
    console.error('DELETE /api/ops/quotes error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
