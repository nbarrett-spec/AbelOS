export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { generateQuoteNumber } from '@/lib/utils'
import { PAYMENT_TERM_MULTIPLIERS } from '@/lib/constants'
import { sendQuoteReadyEmail } from '@/lib/email'
import { audit } from '@/lib/audit'

// Fallback pricing if no product match found in DB
const FALLBACK_PRICING: Record<string, number> = {
  'Interior Door': 185,
  'Exterior Door': 450,
  'Hardware': 35,
  'Trim': 1.85,
}

// Helper to create quote from cart items
async function createQuoteFromCart(
  session: any,
  body: {
    items: Array<{ productId: string; quantity: number; unitPrice: number; description: string; sku: string }>
    projectName: string
    deliveryNotes?: string
  }
) {
  const { items: cartItems, projectName, deliveryNotes } = body

  if (!cartItems || cartItems.length === 0) {
    return NextResponse.json(
      { error: 'Cart items are required' },
      { status: 400 }
    )
  }

  if (!projectName) {
    return NextResponse.json(
      { error: 'projectName is required' },
      { status: 400 }
    )
  }

  try {
    // Get or create project
    const projectRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "Project" WHERE "builderId" = $1 AND name = $2 LIMIT 1`,
      session.builderId,
      projectName
    )

    let projectId = ''
    if (projectRows.length > 0) {
      projectId = projectRows[0].id
      // Update existing project status
      await prisma.$executeRawUnsafe(
        `UPDATE "Project" SET status = 'QUOTE_GENERATED', "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1`,
        projectId
      )
    } else {
      // Create new project
      projectId = crypto.randomUUID()
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Project" (id, "builderId", name, status, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'QUOTE_GENERATED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        projectId,
        session.builderId,
        projectName
      )
    }

    // Get builder info
    const builderRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "paymentTerm", email, "contactName" FROM "Builder" WHERE id = $1`,
      session.builderId
    )

    if (builderRows.length === 0) {
      return NextResponse.json(
        { error: 'Builder not found' },
        { status: 404 }
      )
    }

    const builder = builderRows[0]

    // Get quote count for number generation
    const countRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "Quote"`
    )
    const quoteNumber = generateQuoteNumber((countRows[0]?.count || 0) + 1)

    // Build quote items from cart
    let subtotal = 0
    const quoteItemsToInsert: any[] = []

    for (let idx = 0; idx < cartItems.length; idx++) {
      const item = cartItems[idx]
      const lineTotal = item.unitPrice * item.quantity
      subtotal += lineTotal

      quoteItemsToInsert.push({
        id: crypto.randomUUID(),
        productId: item.productId,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal,
        sortOrder: idx,
      })
    }

    // Apply payment term adjustment
    const termMultiplier = PAYMENT_TERM_MULTIPLIERS[builder.paymentTerm as keyof typeof PAYMENT_TERM_MULTIPLIERS] || 1
    const termAdjustment = subtotal * (termMultiplier - 1)
    const total = subtotal + termAdjustment

    // Create quote
    const quoteId = crypto.randomUUID()
    const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

    await prisma.$executeRawUnsafe(
      `INSERT INTO "Quote" (id, "projectId", "quoteNumber", subtotal, "termAdjustment", total, status, "validUntil", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, 'DRAFT'::"QuoteStatus", $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      quoteId,
      projectId,
      quoteNumber,
      subtotal,
      termAdjustment,
      total,
      validUntil
    )

    // Insert quote items
    for (const item of quoteItemsToInsert) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "QuoteItem" (id, "quoteId", "productId", description, quantity, "unitPrice", "lineTotal", "sortOrder")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        item.id,
        quoteId,
        item.productId,
        item.description,
        item.quantity,
        item.unitPrice,
        item.lineTotal,
        item.sortOrder
      )
    }

    // Send quote ready email (non-blocking)
    sendQuoteReadyEmail({
      to: builder.email,
      builderName: builder.contactName,
      projectName,
      quoteNumber,
      total,
      validUntil: validUntil.toISOString(),
      quoteUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/dashboard/quotes/${quoteId}`,
    }).catch(err => console.error('Quote email failed:', err))

    return NextResponse.json({
      quote: {
        id: quoteId,
        projectId,
        quoteNumber,
        subtotal,
        termAdjustment,
        total,
        status: 'DRAFT',
        validUntil,
        items: quoteItemsToInsert,
      },
      paymentTerm: builder.paymentTerm,
      termAdjustment,
    })
  } catch (error) {
    console.error('Cart quote creation error:', error)
    throw error
  }
}

// POST - generate a quote from a takeoff or cart items
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    audit(request, 'CREATE', 'Quote').catch(() => {});

    const body = await request.json()
    const { takeoffId, projectId, items: cartItems, projectName, deliveryNotes } = body

    // Handle cart items flow (no takeoff)
    if (cartItems && Array.isArray(cartItems)) {
      return await createQuoteFromCart(session, body)
    }

    // Original takeoff flow
    const { takeoffId: tId, projectId: pId } = body

    // Get takeoff with items
    const takeoffRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT t.id, t."projectId", p."builderId"
       FROM "Takeoff" t
       JOIN "Project" p ON p.id = t."projectId"
       WHERE t.id = $1 AND t."projectId" = $2 AND p."builderId" = $3
       LIMIT 1`,
      tId,
      pId,
      session.builderId
    )

    if (takeoffRows.length === 0) {
      return NextResponse.json(
        { error: 'Takeoff not found' },
        { status: 404 }
      )
    }

    // Get takeoff items
    const takeoffItemRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "productId", description, location, quantity, category FROM "TakeoffItem" WHERE "takeoffId" = $1`,
      tId
    )

    // Get builder's payment term
    const builderRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "paymentTerm", email, "contactName" FROM "Builder" WHERE id = $1`,
      session.builderId
    )

    if (builderRows.length === 0) {
      return NextResponse.json(
        { error: 'Builder not found' },
        { status: 404 }
      )
    }

    const builder = builderRows[0]

    // Get custom pricing for builder
    const customPricingRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "productId", "customPrice" FROM "CustomPricing" WHERE "builderId" = $1`,
      session.builderId
    )
    const builderPriceMap = new Map(customPricingRows.map((p: any) => [p.productId, p.customPrice]))

    // Generate quote number
    const countRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "Quote"`
    )
    const quoteNumber = generateQuoteNumber((countRows[0]?.count || 0) + 1)

    let subtotal = 0
    const quoteItemsToInsert: any[] = []

    for (let idx = 0; idx < takeoffItemRows.length; idx++) {
      const item = takeoffItemRows[idx]
      let unitPrice: number
      let productId: string | null = item.productId

      if (productId) {
        const customPrice = builderPriceMap.get(productId)
        if (customPrice) {
          unitPrice = customPrice
        } else {
          const productRows: any[] = await prisma.$queryRawUnsafe(
            `SELECT "basePrice" FROM "Product" WHERE id = $1`,
            productId
          )
          unitPrice = productRows[0]?.basePrice || FALLBACK_PRICING[item.category] || 50
        }
      } else {
        unitPrice = FALLBACK_PRICING[item.category] || 50
      }

      const lineTotal = unitPrice * item.quantity
      subtotal += lineTotal

      quoteItemsToInsert.push({
        id: crypto.randomUUID(),
        productId,
        description: `${item.description} — ${item.location || 'General'}`,
        quantity: item.quantity,
        unitPrice,
        lineTotal,
        location: item.location,
        sortOrder: idx,
      })
    }

    const termMultiplier =
      PAYMENT_TERM_MULTIPLIERS[builder.paymentTerm as keyof typeof PAYMENT_TERM_MULTIPLIERS] || 1
    const termAdjustment = subtotal * (termMultiplier - 1)
    const total = subtotal + termAdjustment

    // Find or create placeholder product
    const placeholderRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "Product" WHERE sku = 'PLACEHOLDER' LIMIT 1`
    )

    let defaultProductId = ''
    if (placeholderRows.length > 0) {
      defaultProductId = placeholderRows[0].id
    } else {
      defaultProductId = crypto.randomUUID()
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Product" (id, sku, name, category, cost, "basePrice", active, "createdAt", "updatedAt")
         VALUES ($1, 'PLACEHOLDER', 'Placeholder Product', 'General', 0, 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        defaultProductId
      )
    }

    // Create quote
    const quoteId = crypto.randomUUID()
    const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

    await prisma.$executeRawUnsafe(
      `INSERT INTO "Quote" (id, "projectId", "takeoffId", "quoteNumber", subtotal, "termAdjustment", total, status, "validUntil", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT'::"QuoteStatus", $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      quoteId,
      pId,
      tId,
      quoteNumber,
      subtotal,
      termAdjustment,
      total,
      validUntil
    )

    // Insert quote items
    for (const item of quoteItemsToInsert) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "QuoteItem" (id, "quoteId", "productId", description, quantity, "unitPrice", "lineTotal", "sortOrder")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        item.id,
        quoteId,
        item.productId || defaultProductId,
        item.description,
        item.quantity,
        item.unitPrice,
        item.lineTotal,
        item.sortOrder
      )
    }

    // Update project status
    await prisma.$executeRawUnsafe(
      `UPDATE "Project" SET status = 'QUOTE_GENERATED', "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1`,
      pId
    )

    // Get project name
    const projectRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT name FROM "Project" WHERE id = $1`,
      pId
    )

    if (projectRows.length > 0) {
      sendQuoteReadyEmail({
        to: builder.email,
        builderName: builder.contactName,
        projectName: projectRows[0].name,
        quoteNumber,
        total,
        validUntil: validUntil.toISOString(),
        quoteUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/projects/${pId}`,
      }).catch(err => console.error('Quote email failed:', err))
    }

    return NextResponse.json({
      quote: {
        id: quoteId,
        projectId: pId,
        takeoffId: tId,
        quoteNumber,
        subtotal,
        termAdjustment,
        total,
        status: 'DRAFT',
        validUntil,
        items: quoteItemsToInsert,
      },
      paymentTerm: builder.paymentTerm,
      termAdjustment,
    })
  } catch (error) {
    console.error('Quote generation error:', error)
    return NextResponse.json(
      { error: 'Failed to generate quote' },
      { status: 500 }
    )
  }
}

// GET - get quotes for a project
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')

    let quotesQuery = ''
    const params: any[] = [session.builderId]

    if (projectId) {
      quotesQuery = `
        SELECT q.id, q."projectId", q."quoteNumber", q.subtotal, q."termAdjustment",
               q.total, q.status, q."validUntil", q."createdAt", q."updatedAt",
               p.name as "projectName", p."planName"
        FROM "Quote" q
        JOIN "Project" p ON p.id = q."projectId"
        WHERE p."builderId" = $1 AND q."projectId" = $2
        ORDER BY q."createdAt" DESC
      `
      params.push(projectId)
    } else {
      quotesQuery = `
        SELECT q.id, q."projectId", q."quoteNumber", q.subtotal, q."termAdjustment",
               q.total, q.status, q."validUntil", q."createdAt", q."updatedAt",
               p.name as "projectName", p."planName"
        FROM "Quote" q
        JOIN "Project" p ON p.id = q."projectId"
        WHERE p."builderId" = $1
        ORDER BY q."createdAt" DESC
      `
    }

    const quoteRows: any[] = await prisma.$queryRawUnsafe(quotesQuery, ...params)

    // Get items for each quote
    const quotes = await Promise.all(
      quoteRows.map(async (q: any) => {
        const itemRows: any[] = await prisma.$queryRawUnsafe(
          `SELECT id, "quoteId", "productId", description, quantity, "unitPrice", "lineTotal", "sortOrder"
           FROM "QuoteItem" WHERE "quoteId" = $1 ORDER BY "sortOrder" ASC`,
          q.id
        )
        return {
          ...q,
          items: itemRows,
          project: {
            name: q.projectName,
            planName: q.planName,
          },
        }
      })
    )

    return NextResponse.json({ quotes })
  } catch (error) {
    console.error('Get quotes error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
