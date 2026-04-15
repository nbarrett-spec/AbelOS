export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { apiLimiter, checkRateLimit } from '@/lib/rate-limit'

interface BundleItem {
  id: string
  sku: string
  name: string
  displayName: string | null
  category: string
  basePrice: number
  builderPrice: number
  priceSource: string
  imageUrl: string | null
  thumbnailUrl: string | null
  stock: number
  stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
}

interface Bundle {
  id: string
  name: string
  description: string
  items: BundleItem[]
  individualTotal: number
  bundlePrice: number
  savings: number
  savingsPercent: number
}

// Bundle configurations
const BUNDLE_CONFIGS = [
  {
    id: 'bundle-interior-door',
    name: 'Interior Door Package',
    description: 'Complete interior door installation with hardware',
    discount: 0.10,
    categories: {
      door: ['Interior Door', 'Interior Doors'],
      frame: ['Door Frame', 'Door Frames', 'Frame'],
      hardware: ['Hinge', 'Hinges', 'Door Hinges', 'Hinge Set'],
      handle: ['Door Handle', 'Handle', 'Knob', 'Door Knob', 'Handle Set'],
    },
    itemCounts: { door: 1, frame: 1, hardware: 3, handle: 1 },
  },
  {
    id: 'bundle-closet-system',
    name: 'Closet System Complete',
    description: 'Professional closet organization with shelving and hardware',
    discount: 0.08,
    categories: {
      door: ['Closet Door', 'Sliding Door', 'Bi-fold Door'],
      shelving: ['Shelf', 'Shelving', 'Shelves', 'Closet Shelving'],
      hardware: ['Track', 'Hardware', 'Hardware Kit', 'Bracket', 'Brackets'],
    },
    itemCounts: { door: 1, shelving: 2, hardware: 1 },
  },
  {
    id: 'bundle-entry-door-premium',
    name: 'Entry Door Premium',
    description: 'Secure exterior door with full hardware and weather protection',
    discount: 0.12,
    categories: {
      door: ['Exterior Door', 'Exterior Doors', 'Entry Door'],
      frame: ['Door Frame', 'Frame', 'Exterior Frame'],
      deadbolt: ['Deadbolt', 'Lock', 'Deadbolt Lock'],
      handle: ['Door Handle', 'Handle', 'Knob', 'Entry Handle'],
      weatherstrip: ['Weatherstrip', 'Weather Stripping', 'Seal', 'Gasket'],
    },
    itemCounts: { door: 1, frame: 1, deadbolt: 1, handle: 1, weatherstrip: 1 },
  },
]

export async function GET(request: NextRequest) {
  const limited = await checkRateLimit(request, apiLimiter, 60, 'catalog-bundles')
  if (limited) return limited

  try {
    // Check auth
    let builderId: string | null = null
    let builderTier: string | null = null
    const sessionCookie = request.cookies.get('abel_session')
    if (sessionCookie) {
      const session = await verifyToken(sessionCookie.value)
      if (session?.builderId) {
        builderId = session.builderId
        const builderRows: any[] = await prisma.$queryRawUnsafe(
          `SELECT "pricingTier" FROM "Builder" WHERE id = $1`,
          builderId
        )
        builderTier = builderRows[0]?.pricingTier || 'STANDARD'
      }
    }

    if (!builderId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get all active products grouped by category for bundle assembly
    const allProducts: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        p.id, p.sku, p.name, p.description, p.category, p.subcategory,
        p."basePrice", p.cost,
        p."displayName", p."imageUrl", p."thumbnailUrl", p."imageAlt",
        bp."customPrice",
        tr."marginPercent" AS "tierMargin",
        CASE
          WHEN bp."customPrice" IS NOT NULL THEN bp."customPrice"
          WHEN tr."marginPercent" IS NOT NULL AND p.cost > 0
            THEN ROUND((p.cost / (1.0 - tr."marginPercent"))::numeric, 2)
          ELSE p."basePrice"
        END AS "builderPrice",
        CASE
          WHEN bp."customPrice" IS NOT NULL THEN 'CUSTOM'
          WHEN tr."marginPercent" IS NOT NULL THEN 'TIER'
          ELSE 'BASE'
        END AS "priceSource"
      FROM "Product" p
      LEFT JOIN "BuilderPricing" bp ON bp."productId" = p.id AND bp."builderId" = $1
      LEFT JOIN "PricingTierRule" tr ON tr."tierName" = $2 AND tr.category = p.category AND tr.active = true
      WHERE p.active = true
      ORDER BY p.category ASC, p.name ASC
    `, builderId, builderTier)

    // Get inventory for all products
    const productIds = allProducts.map((p: any) => p.id)
    let inventoryMap: Record<string, number> = {}
    if (productIds.length > 0) {
      const inventoryRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "productId", COALESCE(SUM("onHand"), 0)::int as stock
         FROM "InventoryItem"
         WHERE "productId" = ANY($1::text[])
         GROUP BY "productId"`,
        productIds
      )
      inventoryMap = Object.fromEntries(inventoryRows.map((r: any) => [r.productId, r.stock]))
    }

    // Map products with pricing and stock
    const productsWithPricing = allProducts.map((p: any) => {
      const stock = inventoryMap[p.id] || 0
      let stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
      if (stock > 20) {
        stockStatus = 'IN_STOCK'
      } else if (stock > 0) {
        stockStatus = 'LOW_STOCK'
      } else {
        stockStatus = 'OUT_OF_STOCK'
      }

      return {
        ...p,
        basePrice: Number(p.basePrice) || 0,
        builderPrice: Number(p.builderPrice) || 0,
        stock,
        stockStatus,
      }
    })

    // Assemble bundles
    const bundles: Bundle[] = BUNDLE_CONFIGS.map((config) => {
      const bundleItems: BundleItem[] = []
      let currentCount: Record<string, number> = {}

      // Reset counts for this bundle
      Object.keys(config.itemCounts).forEach((k) => {
        currentCount[k] = 0
      })

      // Iterate through products and fill bundle
      for (const product of productsWithPricing) {
        const catLower = (product.category || '').toLowerCase()
        const nameLower = (product.name || '').toLowerCase()

        // Check each category in the bundle config
        for (const [categoryKey, categoryPatterns] of Object.entries(config.categories)) {
          const needed = config.itemCounts[categoryKey as keyof typeof config.itemCounts]
          if (!needed) continue

          const currentCount_ = currentCount[categoryKey] || 0
          if (currentCount_ >= needed) continue

          // Check if product matches any pattern in this category
          const matches = (categoryPatterns as string[]).some((pattern) => {
            const patternLower = pattern.toLowerCase()
            return nameLower.includes(patternLower) || catLower.includes(patternLower)
          })

          if (matches && product.stock > 0) {
            bundleItems.push({
              id: product.id,
              sku: product.sku,
              name: product.name,
              displayName: product.displayName,
              category: product.category,
              basePrice: product.basePrice,
              builderPrice: product.builderPrice,
              priceSource: product.priceSource,
              imageUrl: product.imageUrl,
              thumbnailUrl: product.thumbnailUrl,
              stock: product.stock,
              stockStatus: product.stockStatus,
            })

            currentCount[categoryKey] = currentCount_ + 1
            break
          }
        }

        // Stop if we have all items
        const allSatisfied = Object.entries(config.itemCounts).every(
          ([k, v]) => (currentCount[k] || 0) >= v
        )
        if (allSatisfied) break
      }

      // Only return bundles that have all required items
      if (Object.entries(config.itemCounts).every(([k, v]) => (currentCount[k] || 0) >= v)) {
        const individualTotal = bundleItems.reduce(
          (sum, item) => sum + (item.builderPrice || item.basePrice),
          0
        )
        const bundlePrice = individualTotal * (1 - config.discount)

        return {
          id: config.id,
          name: config.name,
          description: config.description,
          items: bundleItems,
          individualTotal: Math.round(individualTotal * 100) / 100,
          bundlePrice: Math.round(bundlePrice * 100) / 100,
          savings: Math.round((individualTotal - bundlePrice) * 100) / 100,
          savingsPercent: Math.round(config.discount * 100),
        }
      }

      return null
    }).filter((b): b is Bundle => b !== null)

    return NextResponse.json({ bundles })
  } catch (error: any) {
    console.error('Bundles API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch bundles', details: error.message },
      { status: 500 }
    )
  }
}
