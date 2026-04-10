export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * POST /api/agent-hub/pricing/calculate
 * Given a builder + products, calculate optimized pricing with all applicable rules.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { builderId, items } = body // items: [{ productId, quantity }]

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'Missing items array' }, { status: 400 })
    }

    // Get builder intelligence
    let intel: any = null
    if (builderId) {
      const profiles: any[] = await prisma.$queryRawUnsafe(`
        SELECT * FROM "BuilderIntelligence" WHERE "builderId" = $1
      `, builderId)
      intel = profiles[0] || null
    }

    // Get active pricing rules
    const rules: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM "PricingRule"
      WHERE "isActive" = true
        AND ("effectiveDate" IS NULL OR "effectiveDate" <= NOW())
        AND ("expiryDate" IS NULL OR "expiryDate" > NOW())
      ORDER BY "priority" ASC
    `)

    // Get product details
    const productIds = items.map((i: any) => i.productId)
    const placeholders = productIds.map((_: any, i: number) => `$${i + 1}`).join(', ')
    const products: any[] = productIds.length > 0
      ? await prisma.$queryRawUnsafe(`
          SELECT p."id", p."name", p."sku", p."category", p."cost", p."basePrice", p."minMargin",
                 COALESCE(i."onHand", 0) AS "stockQuantity", COALESCE(i."reorderPoint", 0) AS "reorderPoint"
          FROM "Product" p
          LEFT JOIN "InventoryItem" i ON i."productId" = p."id"
          WHERE p."id" IN (${placeholders})
        `, ...productIds)
      : []

    const productMap: Record<string, any> = {}
    for (const p of products) productMap[p.id] = p

    // Calculate categories in order (for bundle detection)
    const categories = new Set(products.map(p => p.category))
    const totalQuantity = items.reduce((s: number, i: any) => s + (i.quantity || 1), 0)

    // Apply rules to each item
    const pricedItems = items.map((item: any) => {
      const product = productMap[item.productId]
      if (!product) return { ...item, error: 'Product not found' }

      const basePrice = Number(product.basePrice)
      const cost = Number(product.cost)
      const minMargin = Number(product.minMargin) || 0.25
      const quantity = item.quantity || 1
      const appliedRules: any[] = []
      let adjustedPrice = basePrice

      for (const rule of rules) {
        const conditions = rule.conditions || {}
        const adjustment = rule.adjustment || {}
        let applies = false

        switch (rule.ruleType) {
          case 'VOLUME_BREAK':
            applies = totalQuantity >= (conditions.minQuantity || Infinity)
            break
          case 'LOYALTY_DISCOUNT':
            if (intel) {
              applies = Number(intel.totalLifetimeValue) >= (conditions.minLTV || Infinity)
            }
            break
          case 'EARLY_PAYMENT':
            if (intel) {
              applies = Number(intel.avgDaysToPayment) <= (conditions.maxAvgDaysToPayment || 0)
            }
            break
          case 'INVENTORY_CLEARANCE':
            const stockRatio = Number(product.reorderPoint) > 0
              ? Number(product.stockQuantity) / Number(product.reorderPoint)
              : 1
            applies = stockRatio >= (conditions.stockRatio || Infinity)
            break
          case 'BUNDLE':
            if (conditions.requiredCategories) {
              applies = conditions.requiredCategories.every((c: string) => categories.has(c))
            }
            break
        }

        if (applies) {
          let discount = 0
          if (adjustment.type === 'PERCENTAGE') {
            discount = adjustedPrice * (Math.abs(adjustment.value) / 100)
            adjustedPrice = adjustedPrice * (1 + adjustment.value / 100)
          } else if (adjustment.type === 'FIXED') {
            discount = Math.abs(adjustment.value)
            adjustedPrice = adjustedPrice + adjustment.value
          }
          appliedRules.push({ name: rule.name, type: rule.ruleType, discount: Math.round(discount * 100) / 100 })
        }
      }

      // Floor check — never go below min margin
      const floorPrice = cost * (1 + minMargin)
      if (adjustedPrice < floorPrice) {
        adjustedPrice = floorPrice
        appliedRules.push({ name: 'Margin Floor Applied', type: 'FLOOR', discount: 0 })
      }

      const margin = adjustedPrice > 0 ? ((adjustedPrice - cost) / adjustedPrice) * 100 : 0
      const lineTotal = adjustedPrice * quantity
      const savings = (basePrice - adjustedPrice) * quantity

      return {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        quantity,
        basePrice: Math.round(basePrice * 100) / 100,
        adjustedPrice: Math.round(adjustedPrice * 100) / 100,
        cost: Math.round(cost * 100) / 100,
        margin: Math.round(margin * 10) / 10,
        lineTotal: Math.round(lineTotal * 100) / 100,
        savings: Math.round(savings * 100) / 100,
        rulesApplied: appliedRules,
      }
    })

    const orderTotal = pricedItems.reduce((s: number, i: any) => s + (i.lineTotal || 0), 0)
    const totalSavings = pricedItems.reduce((s: number, i: any) => s + (i.savings || 0), 0)
    const avgMargin = pricedItems.length > 0
      ? pricedItems.reduce((s: number, i: any) => s + (i.margin || 0), 0) / pricedItems.length
      : 0

    return NextResponse.json({
      builderId,
      builderTier: intel ? (Number(intel.totalLifetimeValue) >= 100000 ? 'PLATINUM' : Number(intel.totalLifetimeValue) >= 50000 ? 'GOLD' : 'STANDARD') : 'STANDARD',
      items: pricedItems,
      orderTotal: Math.round(orderTotal * 100) / 100,
      totalSavings: Math.round(totalSavings * 100) / 100,
      avgMargin: Math.round(avgMargin * 10) / 10,
      rulesEvaluated: rules.length,
    })
  } catch (error) {
    console.error('POST /api/agent-hub/pricing/calculate error:', error)
    return NextResponse.json({ error: 'Failed to calculate pricing' }, { status: 500 })
  }
}
