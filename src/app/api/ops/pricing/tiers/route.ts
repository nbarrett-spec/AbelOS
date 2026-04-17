export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'

// GET: List all pricing tiers with their rules and builder counts
export async function GET(request: NextRequest) {
  try {
    // Get all tiers
    const tiers: any[] = await prisma.$queryRawUnsafe(`
      SELECT t.*,
        (SELECT COUNT(*)::int FROM "Builder" WHERE "pricingTier" = t.name AND status = 'ACTIVE') AS "builderCount"
      FROM "PricingTier" t
      WHERE t.active = true
      ORDER BY t."sortOrder" ASC
    `)

    // Get all rules grouped by tier
    const rules: any[] = await prisma.$queryRawUnsafe(`
      SELECT r.*,
        (SELECT COUNT(*)::int FROM "Product" WHERE category = r.category AND active = true) AS "productCount"
      FROM "PricingTierRule" r
      WHERE r.active = true
      ORDER BY r."tierName" ASC, r.category ASC
    `)

    // Get all categories
    const categories: any[] = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT category FROM "Product" WHERE active = true ORDER BY category`
    )

    // Group rules by tier
    const rulesByTier: Record<string, any[]> = {}
    for (const rule of rules) {
      if (!rulesByTier[rule.tierName]) rulesByTier[rule.tierName] = []
      rulesByTier[rule.tierName].push({
        ...rule,
        marginPercent: Number(rule.marginPercent),
        flatAdjustment: Number(rule.flatAdjustment || 0),
        minMargin: Number(rule.minMargin),
        productCount: Number(rule.productCount),
      })
    }

    const result = tiers.map(t => ({
      ...t,
      builderCount: Number(t.builderCount),
      rules: rulesByTier[t.name] || [],
    }))

    return NextResponse.json({
      tiers: result,
      categories: categories.map(c => c.category),
    })
  } catch (error: any) {
    console.error('Pricing tiers GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST: Create a new tier or update tier rules
export async function POST(request: NextRequest) {
  try {
    // Audit log
    audit(request, 'CREATE', 'Pricing', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { action } = body

    if (action === 'create_tier') {
      const { name, displayName, description, sortOrder } = body
      if (!name || !displayName) {
        return NextResponse.json({ error: 'name and displayName required' }, { status: 400 })
      }
      const tierName = name.toUpperCase().replace(/\s+/g, '_')
      await prisma.$queryRawUnsafe(`
        INSERT INTO "PricingTier" (id, name, "displayName", description, "sortOrder")
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4)
        ON CONFLICT (name) DO UPDATE SET "displayName" = $2, description = $3, "sortOrder" = $4, "updatedAt" = NOW()
      `, tierName, displayName, description || '', sortOrder || 0)

      return NextResponse.json({ success: true, tierName })
    }

    if (action === 'update_rules') {
      const { tierName, rules } = body
      if (!tierName || !Array.isArray(rules)) {
        return NextResponse.json({ error: 'tierName and rules[] required' }, { status: 400 })
      }

      let updated = 0
      for (const rule of rules) {
        if (!rule.category || rule.marginPercent == null) continue
        await prisma.$queryRawUnsafe(`
          INSERT INTO "PricingTierRule" (id, "tierName", category, "marginPercent", "flatAdjustment", "minMargin")
          VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)
          ON CONFLICT ("tierName", category)
          DO UPDATE SET "marginPercent" = $3, "flatAdjustment" = $4, "minMargin" = $5, "updatedAt" = NOW()
        `, tierName, rule.category, rule.marginPercent, rule.flatAdjustment || 0, rule.minMargin || 0.10)
        updated++
      }

      return NextResponse.json({ success: true, updated })
    }

    if (action === 'assign_builder') {
      const { builderId, tierName } = body
      if (!builderId || !tierName) {
        return NextResponse.json({ error: 'builderId and tierName required' }, { status: 400 })
      }
      await prisma.$queryRawUnsafe(
        `UPDATE "Builder" SET "pricingTier" = $1 WHERE id = $2`, tierName, builderId
      )
      return NextResponse.json({ success: true })
    }

    if (action === 'bulk_assign') {
      const { builderIds, tierName } = body
      if (!Array.isArray(builderIds) || !tierName) {
        return NextResponse.json({ error: 'builderIds[] and tierName required' }, { status: 400 })
      }
      // Build parameterized IN clause
      const placeholders = builderIds.map((_: any, i: number) => `$${i + 2}`).join(',')
      await prisma.$queryRawUnsafe(
        `UPDATE "Builder" SET "pricingTier" = $1 WHERE id IN (${placeholders})`,
        tierName, ...builderIds
      )
      return NextResponse.json({ success: true, count: builderIds.length })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: any) {
    console.error('Pricing tiers POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
