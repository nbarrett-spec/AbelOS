export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

interface TemplateResponse {
  id: string
  name: string
  description: string | null
  itemCount: number
  estimatedTotal: number
  sourceOrderId: string | null
  createdAt: string
}

interface CreateTemplateBody {
  name: string
  description?: string
  sourceOrderId?: string
  items?: Array<{ productId: string; quantity: number; notes?: string }>
}

// GET /api/builder/templates — List all templates for the builder
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const templates: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        ot.id,
        ot.name,
        ot.description,
        ot."sourceOrderId",
        ot."createdAt",
        COUNT(oti.id)::int as "itemCount",
        COALESCE(SUM(p."basePrice" * oti.quantity)::numeric, 0) as "estimatedTotal"
      FROM "OrderTemplate" ot
      LEFT JOIN "OrderTemplateItem" oti ON oti."templateId" = ot.id
      LEFT JOIN "Product" p ON p.id = oti."productId"
      WHERE ot."builderId" = $1
      GROUP BY ot.id, ot.name, ot.description, ot."sourceOrderId", ot."createdAt"
      ORDER BY ot."createdAt" DESC
    `, session.builderId)

    const formattedTemplates: TemplateResponse[] = templates.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      itemCount: t.itemCount || 0,
      estimatedTotal: Number(t.estimatedTotal || 0),
      sourceOrderId: t.sourceOrderId,
      createdAt: t.createdAt.toISOString(),
    }))

    return NextResponse.json({ templates: formattedTemplates })
  } catch (error: any) {
    console.error('GET /api/builder/templates error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch templates' },
      { status: 500 }
    )
  }
}

// POST /api/builder/templates — Create a new template
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const body: CreateTemplateBody = await request.json()
    const { name, description, sourceOrderId, items } = body

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: 'Template name is required' },
        { status: 400 }
      )
    }

    let templateItems: Array<{ productId: string; quantity: number; notes?: string }> = []

    // If sourceOrderId is provided, copy items from that order
    if (sourceOrderId) {
      // Verify order belongs to this builder
      const order: any[] = await prisma.$queryRawUnsafe(
        `SELECT o.id FROM "Order" WHERE id = $1 AND "builderId" = $2 LIMIT 1`,
        sourceOrderId,
        session.builderId
      )

      if (order.length === 0) {
        return NextResponse.json(
          { error: 'Order not found or you do not have access' },
          { status: 404 }
        )
      }

      // Fetch items from the order
      const orderItems: any[] = await prisma.$queryRawUnsafe(
        `SELECT "productId", quantity FROM "OrderItem" WHERE "orderId" = $1`,
        sourceOrderId
      )

      templateItems = orderItems.map(item => ({
        productId: item.productId,
        quantity: Number(item.quantity),
      }))
    } else if (items && Array.isArray(items) && items.length > 0) {
      templateItems = items
    }

    // Create the template
    const templateId = `tpl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

    await prisma.$executeRawUnsafe(
      `INSERT INTO "OrderTemplate" (id, "builderId", name, description, "sourceOrderId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      templateId,
      session.builderId,
      name.trim(),
      description?.trim() || null,
      sourceOrderId || null
    )

    // Insert template items
    for (const item of templateItems) {
      const itemId = `itm${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

      // Verify product exists
      const product: any[] = await prisma.$queryRawUnsafe(
        `SELECT id FROM "Product" WHERE id = $1 LIMIT 1`,
        item.productId
      )

      if (product.length === 0) {
        // Skip invalid products
        continue
      }

      await prisma.$executeRawUnsafe(
        `INSERT INTO "OrderTemplateItem" (id, "templateId", "productId", quantity, notes, "createdAt")
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        itemId,
        templateId,
        item.productId,
        item.quantity || 1,
        item.notes || null
      )
    }

    return NextResponse.json(
      {
        id: templateId,
        name: name.trim(),
        description: description?.trim() || null,
        itemCount: templateItems.length,
        message: 'Template created successfully',
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error('POST /api/builder/templates error:', error)
    return NextResponse.json(
      { error: 'Failed to create template' },
      { status: 500 }
    )
  }
}
