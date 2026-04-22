import { audit } from '@/lib/audit'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  const results: string[] = []

  try {
    audit(request, 'RUN_MIGRATE_BUILDER_PRICING_TIERS', 'Database', undefined, { migration: 'RUN_MIGRATE_BUILDER_PRICING_TIERS' }, 'CRITICAL').catch(() => {})
    // 1. Add pricingTier column to Builder
    try {
      await prisma.$queryRawUnsafe(`
        ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "pricingTier" TEXT DEFAULT 'STANDARD'
      `)
      results.push('✅ Added pricingTier column to Builder')
    } catch (e: any) {
      results.push(`⚠️ pricingTier column: ${e.message}`)
    }

    // 2. Create PricingTier table — defines available tiers
    try {
      await prisma.$queryRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "PricingTier" (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          name TEXT NOT NULL UNIQUE,
          "displayName" TEXT NOT NULL,
          description TEXT,
          "isDefault" BOOLEAN DEFAULT false,
          "sortOrder" INT DEFAULT 0,
          active BOOLEAN DEFAULT true,
          "createdAt" TIMESTAMPTZ DEFAULT NOW(),
          "updatedAt" TIMESTAMPTZ DEFAULT NOW()
        )
      `)
      results.push('✅ Created PricingTier table')
    } catch (e: any) {
      results.push(`⚠️ PricingTier table: ${e.message}`)
    }

    // 3. Create PricingTierRule table — maps tier + category → margin/multiplier
    try {
      await prisma.$queryRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "PricingTierRule" (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          "tierName" TEXT NOT NULL,
          category TEXT NOT NULL,
          "marginPercent" FLOAT NOT NULL,
          "flatAdjustment" FLOAT DEFAULT 0,
          "minMargin" FLOAT DEFAULT 0.10,
          active BOOLEAN DEFAULT true,
          "createdAt" TIMESTAMPTZ DEFAULT NOW(),
          "updatedAt" TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE("tierName", category)
        )
      `)
      results.push('✅ Created PricingTierRule table')
    } catch (e: any) {
      results.push(`⚠️ PricingTierRule table: ${e.message}`)
    }

    // 4. Create indexes
    try {
      await prisma.$queryRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_builder_pricing_tier ON "Builder"("pricingTier")`)
      await prisma.$queryRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pricing_tier_rule_tier ON "PricingTierRule"("tierName")`)
      await prisma.$queryRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pricing_tier_rule_cat ON "PricingTierRule"(category)`)
      results.push('✅ Created indexes')
    } catch (e: any) {
      results.push(`⚠️ Indexes: ${e.message}`)
    }

    // 5. Seed default pricing tiers
    try {
      await prisma.$queryRawUnsafe(`
        INSERT INTO "PricingTier" (id, name, "displayName", description, "isDefault", "sortOrder")
        VALUES
          (gen_random_uuid()::text, 'PREFERRED', 'Preferred Builder', 'High-volume builders with best pricing. Typically 20-25% margin.', false, 1),
          (gen_random_uuid()::text, 'STANDARD', 'Standard Builder', 'Regular builders with standard pricing. Typically 28-32% margin.', true, 2),
          (gen_random_uuid()::text, 'NEW_ACCOUNT', 'New Account', 'New builders, standard catalog pricing until relationship established. Typically 30-35% margin.', false, 3),
          (gen_random_uuid()::text, 'PREMIUM', 'Premium/Low Volume', 'Low volume or one-off builders. Higher margins applied. Typically 35-40% margin.', false, 4)
        ON CONFLICT (name) DO NOTHING
      `)
      results.push('✅ Seeded default pricing tiers')
    } catch (e: any) {
      results.push(`⚠️ Seed tiers: ${e.message}`)
    }

    // 6. Seed default tier rules for common categories
    try {
      // Get distinct categories from products
      const categories: any[] = await prisma.$queryRawUnsafe(
        `SELECT DISTINCT category FROM "Product" WHERE active = true ORDER BY category`
      )

      const tierRules: { tier: string; margin: number; minMargin: number }[] = [
        { tier: 'PREFERRED', margin: 0.22, minMargin: 0.15 },
        { tier: 'STANDARD', margin: 0.30, minMargin: 0.20 },
        { tier: 'NEW_ACCOUNT', margin: 0.33, minMargin: 0.25 },
        { tier: 'PREMIUM', margin: 0.38, minMargin: 0.28 },
      ]

      let ruleCount = 0
      for (const cat of categories) {
        for (const rule of tierRules) {
          await prisma.$queryRawUnsafe(`
            INSERT INTO "PricingTierRule" (id, "tierName", category, "marginPercent", "minMargin")
            VALUES (gen_random_uuid()::text, $1, $2, $3, $4)
            ON CONFLICT ("tierName", category) DO NOTHING
          `, rule.tier, cat.category, rule.margin, rule.minMargin)
          ruleCount++
        }
      }
      results.push(`✅ Seeded ${ruleCount} tier rules for ${categories.length} categories`)
    } catch (e: any) {
      results.push(`⚠️ Seed tier rules: ${e.message}`)
    }

    return NextResponse.json({ success: true, results })
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal server error', results }, { status: 500 })
  }
}
