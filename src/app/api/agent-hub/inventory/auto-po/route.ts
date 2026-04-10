export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * POST /api/agent-hub/inventory/auto-po
 * Generate recommended Purchase Orders based on forecast vs current stock.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Find products below reorder point via InventoryItem
    const lowStock: any[] = await prisma.$queryRawUnsafe(`
      SELECT p."id", p."name", p."sku", p."category",
             i."onHand" AS "stockQuantity", i."available",
             i."reorderPoint", i."reorderQty",
             p."cost", p."basePrice"
      FROM "InventoryItem" i
      JOIN "Product" p ON p."id" = i."productId"
      WHERE p."active" = true
        AND i."available" <= i."reorderPoint"
        AND i."reorderQty" > 0
      ORDER BY (i."available"::float / NULLIF(i."reorderPoint", 0)) ASC
    `)

    if (lowStock.length === 0) {
      return NextResponse.json({
        message: 'No products below reorder point',
        posGenerated: 0,
        pos: [],
      })
    }

    // Group products by category (proxy for vendor since we don't have vendor on Product)
    const byCategory: Record<string, any[]> = {}
    for (const product of lowStock) {
      const cat = product.category || 'General'
      if (!byCategory[cat]) byCategory[cat] = []
      byCategory[cat].push(product)
    }

    const posGenerated: any[] = []

    for (const [category, products] of Object.entries(byCategory)) {
      const items = products.map(p => ({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        currentStock: Number(p.stockQuantity),
        reorderPoint: Number(p.reorderPoint),
        orderQuantity: Number(p.reorderQty),
        unitCost: Number(p.cost),
        lineTotal: Number(p.reorderQty) * Number(p.cost),
      }))

      const estimatedTotal = items.reduce((sum, item) => sum + item.lineTotal, 0)

      const poId = `apo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

      await prisma.$executeRawUnsafe(`
        INSERT INTO "AutoPurchaseOrder" (
          "id", "vendorName", "status", "items", "estimatedTotal", "reason",
          "createdAt", "updatedAt"
        ) VALUES ($1, $2, 'RECOMMENDED', $3::jsonb, $4, $5, NOW(), NOW())
      `,
        poId,
        `${category} Supplier`,
        JSON.stringify(items),
        estimatedTotal,
        `Auto-generated: ${items.length} products below reorder point in ${category}`
      )

      // Create approval task in Command Center
      const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "AgentTask" (
            "id", "agentRole", "taskType", "title", "description",
            "priority", "status", "payload", "requiresApproval",
            "createdBy", "createdAt", "updatedAt"
          ) VALUES (
            $1, 'OPS', 'AUTO_PO', $2, $3,
            $4, 'PENDING', $5::jsonb, true,
            'agent:OPS', NOW(), NOW()
          )
        `,
          taskId,
          `PO Recommendation — ${category} ($${estimatedTotal.toFixed(2)})`,
          `${items.length} products need reorder in ${category}. Estimated cost: $${estimatedTotal.toFixed(2)}`,
          estimatedTotal > 5000 ? 'HIGH' : 'NORMAL',
          JSON.stringify({ autoPoId: poId, category, items, estimatedTotal })
        )
      } catch (e) {
        console.error('Failed to create PO approval task:', e)
      }

      posGenerated.push({
        id: poId,
        vendorName: `${category} Supplier`,
        itemCount: items.length,
        estimatedTotal: Math.round(estimatedTotal * 100) / 100,
        items,
      })
    }

    return NextResponse.json({
      message: `Generated ${posGenerated.length} purchase order recommendations`,
      posGenerated: posGenerated.length,
      totalValue: posGenerated.reduce((s, po) => s + po.estimatedTotal, 0),
      pos: posGenerated,
    })
  } catch (error) {
    console.error('POST /api/agent-hub/inventory/auto-po error:', error)
    return NextResponse.json({ error: 'Failed to generate auto POs' }, { status: 500 })
  }
}

/**
 * GET /api/agent-hub/inventory/auto-po
 * List auto-generated PO recommendations with status filtering.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status') // RECOMMENDED, APPROVED, SENT

    let whereClause = ''
    const params: any[] = []

    if (status) {
      whereClause = `WHERE "status"::text = $1`
      params.push(status)
    }

    const pos: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "vendorName", "status", "items", "estimatedTotal",
             "reason", "approvedBy", "approvedAt", "sentAt", "createdAt"
      FROM "AutoPurchaseOrder"
      ${whereClause}
      ORDER BY "createdAt" DESC
      LIMIT 50
    `, ...params)

    return NextResponse.json({
      data: pos.map(po => ({
        ...po,
        estimatedTotal: Number(po.estimatedTotal),
        itemCount: Array.isArray(po.items) ? po.items.length : 0,
      })),
      total: pos.length,
    })
  } catch (error) {
    console.error('GET /api/agent-hub/inventory/auto-po error:', error)
    return NextResponse.json({ error: 'Failed to fetch auto POs' }, { status: 500 })
  }
}
