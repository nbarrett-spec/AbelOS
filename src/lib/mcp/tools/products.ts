/**
 * MCP tools — Products / Inventory domain.
 *
 * Phase 1 (read-only): search_products, check_inventory
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

export function registerProductTools(server: McpServer) {
  server.registerTool(
    'search_products',
    {
      description:
        'Search the product catalog. Returns SKU, name, category, base price, and current on-hand inventory when available. Use for "find 6/8 prehung doors", "Boise products", "what trim do we stock".',
      inputSchema: {
        search: z.string().optional().describe('Free-text — matches name, SKU, or description'),
        category: z.string().optional().describe('Exact category match'),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(20),
      },
    },
    async ({ search, category, page = 1, limit = 20 }) => {
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

      // Pull inventory for the page in one shot via productId IN (...)
      const productIds = products.map((p) => p.id)
      const inventoryRows =
        productIds.length > 0
          ? await prisma.inventoryItem.findMany({
              where: { productId: { in: productIds } },
              select: {
                productId: true,
                onHand: true,
                committed: true,
                available: true,
                reorderPoint: true,
              },
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
        content: [{ type: 'text', text: JSON.stringify({ products: enriched, total, page, pageSize: limit }, null, 2) }],
      }
    },
  )

  server.registerTool(
    'check_inventory',
    {
      description:
        'Quick stock-level check for one or more products. Returns onHand/committed/available + reorder-point status. Pass either explicit productIds OR a search string (matches the inventory row\'s denormalized SKU/name).',
      inputSchema: {
        productIds: z.array(z.string()).optional().describe('List of product IDs to check'),
        search: z.string().optional().describe('Search text — used if productIds not provided. Matches denormalized SKU/name/category on InventoryItem.'),
        limit: z.number().int().min(1).max(50).default(20),
      },
    },
    async ({ productIds, search, limit = 20 }) => {
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
          content: [
            { type: 'text', text: JSON.stringify({ error: 'Provide productIds or search' }) },
          ],
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
          rawStatus: i.status,
          computedStatus,
        }
      })

      return {
        content: [{ type: 'text', text: JSON.stringify({ items: enriched, count: enriched.length }, null, 2) }],
      }
    },
  )
}
