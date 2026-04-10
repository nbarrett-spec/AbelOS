export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { mapCategory } from '@/lib/product-categories'

/**
 * GET /api/catalog/[id]
 *
 * Full product detail with:
 *  - Builder-specific pricing (custom > tier > base)
 *  - Good/Better/Best alternatives in the same category
 *  - Inventory level
 *  - Related products
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // ── Identify builder ──────────────────────────────────────────
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

    // ── Fetch product ──────────────────────────────────────────
    const products: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        p.id, p.sku, p.name, p."displayName", p.description, p.category, p.subcategory,
        p."basePrice", p.cost, p."doorSize", p.handing, p."coreType", p."panelStyle",
        p."jambSize", p.material, p."fireRating", p."hardwareFinish",
        p."imageUrl", p."thumbnailUrl", p."imageAlt", p.active
       FROM "Product" p
       WHERE p.id = $1`,
      params.id
    )

    if (products.length === 0) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const product = products[0]
    const mapped = mapCategory(product.category)

    // ── Builder pricing ──────────────────────────────────────────
    let builderPrice = Number(product.basePrice) || 0
    let priceSource = 'BASE'

    if (builderId) {
      // Check custom price
      const customRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "customPrice" FROM "BuilderPricing" WHERE "productId" = $1 AND "builderId" = $2`,
        params.id,
        builderId
      )
      if (customRows[0]?.customPrice) {
        builderPrice = Number(customRows[0].customPrice)
        priceSource = 'CUSTOM'
      } else if (builderTier) {
        // Check tier pricing
        const tierRows: any[] = await prisma.$queryRawUnsafe(
          `SELECT "marginPercent" FROM "PricingTierRule"
           WHERE "tierName" = $1 AND category = $2 AND active = true`,
          builderTier,
          product.category
        )
        if (tierRows[0]?.marginPercent && product.cost > 0) {
          builderPrice = Math.round(
            (product.cost / (1.0 - Number(tierRows[0].marginPercent))) * 100
          ) / 100
          priceSource = 'TIER'
        }
      }
    }

    // ── Inventory ──────────────────────────────────────────
    const invRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM("onHand"), 0)::int AS stock FROM "InventoryItem" WHERE "productId" = $1`,
      params.id
    )
    const stock = invRows[0]?.stock || 0
    const stockStatus = stock > 20 ? 'IN_STOCK' : stock > 0 ? 'LOW_STOCK' : 'OUT_OF_STOCK'

    // ── Good / Better / Best alternatives ────────────────────
    // Find products in the same subcategory with different price tiers
    const alternativeRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT p.id, p.sku, p.name, p."displayName", p."basePrice", p.category,
              p."coreType", p."panelStyle", p.material, p."fireRating",
              COALESCE(SUM(i."onHand"), 0)::int AS stock
       FROM "Product" p
       LEFT JOIN "InventoryItem" i ON i."productId" = p.id
       WHERE p.active = true
         AND p.category = $1
         AND p.id != $2
         AND p."doorSize" = $3
       GROUP BY p.id
       ORDER BY p."basePrice" ASC
       LIMIT 10`,
      product.category,
      params.id,
      product.doorSize || ''
    )

    // Classify into tiers based on price relative to this product
    const basePrice = Number(product.basePrice)
    const good: any[] = []
    const better: any[] = []
    const best: any[] = []

    for (const alt of alternativeRows) {
      const altPrice = Number(alt.basePrice)
      const altMapped = {
        id: alt.id,
        sku: alt.sku,
        name: alt.displayName || alt.name,
        basePrice: altPrice,
        coreType: alt.coreType,
        panelStyle: alt.panelStyle,
        material: alt.material,
        stock: alt.stock,
        stockStatus: alt.stock > 20 ? 'IN_STOCK' : alt.stock > 0 ? 'LOW_STOCK' : 'OUT_OF_STOCK',
      }
      if (altPrice < basePrice * 0.85) {
        good.push(altMapped)
      } else if (altPrice > basePrice * 1.15) {
        best.push(altMapped)
      } else {
        better.push(altMapped)
      }
    }

    // ── Related products (same category, different size/type) ────
    const relatedRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT p.id, p.sku, p.name, p."displayName", p."basePrice", p."doorSize",
              COALESCE(SUM(i."onHand"), 0)::int AS stock
       FROM "Product" p
       LEFT JOIN "InventoryItem" i ON i."productId" = p.id
       WHERE p.active = true
         AND p.category = $1
         AND p.id != $2
         AND (p."doorSize" IS NULL OR p."doorSize" != $3)
       GROUP BY p.id
       ORDER BY p."basePrice" ASC
       LIMIT 6`,
      product.category,
      params.id,
      product.doorSize || ''
    )

    return NextResponse.json({
      product: {
        id: product.id,
        sku: product.sku,
        name: product.displayName || product.name,
        rawName: product.name,
        description: product.description,
        category: mapped.category,
        subcategory: mapped.subcategory,
        rawCategory: product.category,
        basePrice: Number(product.basePrice),
        builderPrice,
        priceSource,
        doorSize: product.doorSize,
        handing: product.handing,
        coreType: product.coreType,
        panelStyle: product.panelStyle,
        jambSize: product.jambSize,
        material: product.material,
        fireRating: product.fireRating,
        hardwareFinish: product.hardwareFinish,
        imageUrl: product.imageUrl,
        thumbnailUrl: product.thumbnailUrl,
        imageAlt: product.imageAlt,
        stock,
        stockStatus,
      },
      alternatives: { good, better, best },
      related: relatedRows.map((r) => ({
        id: r.id,
        sku: r.sku,
        name: r.displayName || r.name,
        basePrice: Number(r.basePrice),
        doorSize: r.doorSize,
        stock: r.stock,
      })),
    })
  } catch (error: any) {
    console.error('GET /api/catalog/[id] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
