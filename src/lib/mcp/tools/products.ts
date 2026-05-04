/**
 * MCP tools — Products / Inventory domain.
 *
 * Phase 1 (read): search_products, check_inventory
 * Phase 2: get_product, adjust_inventory, forecast_inventory
 *
 * Schema notes (these tripped up the first pass — keep in mind):
 *  • Product has NO direct Prisma relation to InventoryItem. Join via productId.
 *  • Product has NO `unit` field and NO `vendor` relation. Has `supplierId`
 *    string but no relation pointer. Vendor data must be fetched separately.
 *  • InventoryItem stores stock as `onHand` / `committed` / `available`
 *    (NOT quantityOnHand / reservedQuantity). `available` is denormalized.
 *  • InventoryItem also denormalizes `productName`, `sku`, `category` so
 *    the UI can render rows without a join.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withMcpAudit } from '../wrap'

export function registerProductTools(server: McpServer) {
  server.registerTool(
    'search_products',
    {
      description:
        'Search the product catalog. Returns SKU, name, category, base price, and current on-hand inventory when available.',
      inputSchema: {
        search: z.string().optional(),
        category: z.string().optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('search_products', 'READ', async ({ search, category, page = 1, limit = 20 }: any) => {
      const where: any = {}
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ]
      }
      if (category) where.category = category

      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          select: {
            id: true,
            sku: true,
            name: true,
            displayName: true,
            category: true,
            subcategory: true,
            basePrice: true,
            cost: true,
            active: true,
            inStock: true,
            doorSize: true,
            handing: true,
            material: true,
          },
          orderBy: { name: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.product.count({ where }),
      ])

      const productIds = products.map((p) => p.id)
      const inventoryRows =
        productIds.length > 0
          ? await prisma.inventoryItem.findMany({
              where: { productId: { in: productIds } },
              select: { productId: true, onHand: true, committed: true, available: true, reorderPoint: true },
            })
          : []
      const invByProduct = new Map(inventoryRows.map((i) => [i.productId, i]))

      const enriched = products.map((p) => {
        const inv = invByProduct.get(p.id)
        return {
          ...p,
          onHand: inv?.onHand ?? null,
          available: inv?.available ?? null,
          reorderPoint: inv?.reorderPoint ?? null,
        }
      })

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ products: enriched, total, page, pageSize: limit }, null, 2) }],
      }
    }),
  )

  server.registerTool(
    'check_inventory',
    {
      description:
        'Quick stock-level check for one or more products. Returns onHand/committed/available + reorder-point status. Pass either explicit productIds OR a search string.',
      inputSchema: {
        productIds: z.array(z.string()).optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('check_inventory', 'READ', async ({ productIds, search, limit = 20 }: any) => {
      const where: any = {}
      if (productIds && productIds.length > 0) {
        where.productId = { in: productIds }
      } else if (search) {
        where.OR = [
          { sku: { contains: search, mode: 'insensitive' } },
          { productName: { contains: search, mode: 'insensitive' } },
          { category: { contains: search, mode: 'insensitive' } },
        ]
      } else {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Provide productIds or search' }) }],
          isError: true,
        }
      }
      const items = await prisma.inventoryItem.findMany({
        where,
        select: {
          productId: true,
          sku: true,
          productName: true,
          category: true,
          onHand: true,
          committed: true,
          available: true,
          reorderPoint: true,
          safetyStock: true,
          location: true,
          warehouseZone: true,
          binLocation: true,
          status: true,
          avgDailyUsage: true,
        },
        take: limit,
      })
      const enriched = items.map((i) => {
        const available = i.available ?? Math.max(0, (i.onHand ?? 0) - (i.committed ?? 0))
        let computedStatus: 'out' | 'critical' | 'low' | 'healthy' | 'overstocked' = 'healthy'
        const reorder = i.reorderPoint ?? 0
        if (available <= 0) computedStatus = 'out'
        else if (i.safetyStock != null && available < i.safetyStock) computedStatus = 'critical'
        else if (reorder > 0 && available < reorder) computedStatus = 'low'
        else if (reorder > 0 && available > reorder * 3) computedStatus = 'overstocked'
        return {
          productId: i.productId,
          sku: i.sku,
          name: i.productName,
          category: i.category,
          location: i.location,
          warehouseZone: i.warehouseZone,
          binLocation: i.binLocation,
          onHand: i.onHand,
          committed: i.committed,
          available,
          reorderPoint: i.reorderPoint,
          safetyStock: i.safetyStock,
          avgDailyUsage: i.avgDailyUsage,
          rawStatus: i.status,
          computedStatus,
        }
      })
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ items: enriched, count: enriched.length }, null, 2) }],
      }
    }),
  )

  // ──────────────────────────────────────────────────────────────────
  // get_product (read)
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_product',
    {
      description:
        'Get full product detail with attributes, pricing, current inventory, and recent purchase order activity.',
      inputSchema: { productId: z.string() },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('get_product', 'READ', async ({ productId }: any) => {
      const product = await prisma.product.findUnique({ where: { id: productId } })
      if (!product) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Product not found', productId }) }],
          isError: true,
        }
      }
      const [inventory, recentPOItems] = await Promise.all([
        prisma.inventoryItem.findFirst({
          where: { productId },
          select: {
            onHand: true,
            committed: true,
            available: true,
            reorderPoint: true,
            safetyStock: true,
            avgDailyUsage: true,
            daysOfSupply: true,
            unitCost: true,
            location: true,
            warehouseZone: true,
            binLocation: true,
            status: true,
            lastReceivedAt: true,
          },
        }),
        prisma.purchaseOrderItem.findMany({
          where: { productId },
          select: {
            quantity: true,
            unitCost: true,
            purchaseOrder: {
              select: { poNumber: true, status: true, orderedAt: true, receivedAt: true, vendor: { select: { name: true } } },
            },
          },
          orderBy: { id: 'desc' },
          take: 10,
        }),
      ])
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ product, inventory, recentPOItems }, null, 2) }],
      }
    }),
  )

  // ──────────────────────────────────────────────────────────────────
  // adjust_inventory (write)
  //
  // Records an inventory adjustment by mutating onHand directly. Note:
  // there's no separate InventoryAdjustment audit table in the schema —
  // the audit log captures the action (entityId=productId, kind=WRITE,
  // tool=adjust_inventory) so the trail still exists.
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'adjust_inventory',
    {
      description:
        'Record an inventory adjustment (recount, shrink, damaged). Adds the signed quantityAdjustment to onHand and recomputes available. Reason is required for the audit trail.',
      inputSchema: {
        productId: z.string(),
        quantityAdjustment: z.number().int().describe('Positive to add, negative to remove'),
        reason: z.string().min(2).describe('Why — RECOUNT / SHRINK / DAMAGE / RETURN / etc.'),
      },
      annotations: { destructiveHint: true },
    },
    withMcpAudit('adjust_inventory', 'WRITE', async ({ productId, quantityAdjustment, reason }: any) => {
      const inv = await prisma.inventoryItem.findFirst({ where: { productId } })
      if (!inv) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Inventory row not found for productId', productId }) }],
          isError: true,
        }
      }
      const oldOnHand = inv.onHand
      const newOnHand = oldOnHand + quantityAdjustment
      if (newOnHand < 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: `Adjustment would set onHand to ${newOnHand} (negative). Use a smaller magnitude or split across multiple adjustments.`,
              }),
            },
          ],
          isError: true,
        }
      }
      await prisma.inventoryItem.update({
        where: { id: inv.id },
        data: {
          onHand: newOnHand,
          available: Math.max(0, newOnHand - inv.committed),
        },
      })
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ok: true,
                productId,
                oldOnHand,
                newOnHand,
                delta: quantityAdjustment,
                reason,
              },
              null,
              2,
            ),
          },
        ],
      }
    }),
  )

  // ──────────────────────────────────────────────────────────────────
  // forecast_inventory (read)
  //
  // Simple velocity-based projection — uses InventoryItem.avgDailyUsage
  // (already maintained by another job) and onHand/onOrder to compute
  // days until stockout. Doesn't predict — just projects current trends.
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'forecast_inventory',
    {
      description:
        'Forecast stock depletion based on average daily usage. Returns days until stockout, recommended reorder qty, and a simple projection.',
      inputSchema: {
        productId: z.string(),
        days: z.number().int().min(1).max(180).default(30).describe('Forecast horizon (days)'),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('forecast_inventory', 'READ', async ({ productId, days = 30 }: any) => {
      const inv = await prisma.inventoryItem.findFirst({
        where: { productId },
        select: {
          onHand: true,
          committed: true,
          available: true,
          onOrder: true,
          avgDailyUsage: true,
          reorderPoint: true,
          reorderQty: true,
          safetyStock: true,
          maxStock: true,
        },
      })
      if (!inv) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Inventory row not found', productId }) }],
          isError: true,
        }
      }
      const velocity = inv.avgDailyUsage ?? 0
      const projectedAvailable = Math.max(0, inv.available + inv.onOrder - velocity * days)
      const daysUntilStockout =
        velocity > 0 ? Math.floor((inv.available + inv.onOrder) / velocity) : null
      const shouldReorder =
        inv.reorderPoint > 0 && inv.available + inv.onOrder <= inv.reorderPoint
      const recommendedReorderQty = shouldReorder
        ? Math.max(inv.reorderQty || 0, Math.ceil(velocity * days) - (inv.available + inv.onOrder))
        : 0
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                productId,
                horizonDays: days,
                current: {
                  onHand: inv.onHand,
                  committed: inv.committed,
                  available: inv.available,
                  onOrder: inv.onOrder,
                },
                velocity,
                daysUntilStockout,
                projectedAvailableAtHorizon: projectedAvailable,
                shouldReorder,
                recommendedReorderQty,
                policy: {
                  reorderPoint: inv.reorderPoint,
                  reorderQty: inv.reorderQty,
                  safetyStock: inv.safetyStock,
                  maxStock: inv.maxStock,
                },
              },
              null,
              2,
            ),
          },
        ],
      }
    }),
  )
}
