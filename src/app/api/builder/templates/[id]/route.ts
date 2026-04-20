export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { auditBuilder } from '@/lib/audit'

interface TemplateItem {
  id: string
  productId: string
  productName: string
  sku: string
  quantity: number
  notes: string | null
  unitPrice: number
  estimatedLineTotal: number
}

interface TemplateDetail {
  id: string
  name: string
  description: string | null
  sourceOrderId: string | null
  createdAt: string
  itemCount: number
  items: TemplateItem[]
  estimatedTotal: number
}

// GET /api/builder/templates/[id] — Get template details with all items
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    // Fetch template with verification it belongs to this builder
    const templates: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, name, description, "sourceOrderId", "createdAt"
       FROM "OrderTemplate"
       WHERE id = $1 AND "builderId" = $2
       LIMIT 1`,
      params.id,
      session.builderId
    )

    if (templates.length === 0) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }

    const template = templates[0]

    // Fetch template items with product details
    const items: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        oti.id,
        oti."productId",
        oti.quantity,
        oti.notes,
        p.name as "productName",
        p.sku,
        p."basePrice" as "unitPrice"
       FROM "OrderTemplateItem" oti
       LEFT JOIN "Product" p ON p.id = oti."productId"
       WHERE oti."templateId" = $1
       ORDER BY p.name ASC`,
      params.id
    )

    const formattedItems: TemplateItem[] = items.map(item => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName || 'Unknown Product',
      sku: item.sku || 'N/A',
      quantity: Number(item.quantity) || 0,
      notes: item.notes,
      unitPrice: Number(item.unitPrice) || 0,
      estimatedLineTotal: (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0),
    }))

    const estimatedTotal = formattedItems.reduce((sum, item) => sum + item.estimatedLineTotal, 0)

    const response: TemplateDetail = {
      id: template.id,
      name: template.name,
      description: template.description,
      sourceOrderId: template.sourceOrderId,
      createdAt: template.createdAt.toISOString(),
      itemCount: items.length,
      items: formattedItems,
      estimatedTotal,
    }

    return NextResponse.json(response)
  } catch (error: any) {
    console.error('GET /api/builder/templates/[id] error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch template' },
      { status: 500 }
    )
  }
}

// DELETE /api/builder/templates/[id] — Delete a template
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    auditBuilder(session.builderId, session.companyName || 'Unknown', 'DELETE', 'Template').catch(() => {});

    // Verify template belongs to this builder
    const templates: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "OrderTemplate"
       WHERE id = $1 AND "builderId" = $2
       LIMIT 1`,
      params.id,
      session.builderId
    )

    if (templates.length === 0) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }

    // Delete template (cascade deletes template items)
    await prisma.$executeRawUnsafe(
      `DELETE FROM "OrderTemplate" WHERE id = $1`,
      params.id
    )

    return NextResponse.json({ message: 'Template deleted successfully' })
  } catch (error: any) {
    console.error('DELETE /api/builder/templates/[id] error:', error)
    return NextResponse.json(
      { error: 'Failed to delete template' },
      { status: 500 }
    )
  }
}
