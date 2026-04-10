export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

interface VolumeTier {
  tier: string
  minAmount: number
  maxAmount: number | null
  discountPercent: number
  icon: string
}

interface VolumeSavingsResponse {
  currentTier: string
  currentTierIcon: string
  currentDiscountPercent: number
  monthTotal: number
  quarterTotal: number
  yearTotal: number
  orderCount: number
  nextTier: string | null
  nextTierThreshold: number | null
  amountToNextTier: number | null
  nextTierDiscountPercent: number | null
  savingsAtCurrentTier: number
  estimatedSavingsAtEachTier: Array<{
    tier: string
    discountPercent: number
    estimatedSavings: number
  }>
}

const TIERS: VolumeTier[] = [
  { tier: 'Bronze', minAmount: 0, maxAmount: 25000, discountPercent: 0, icon: '🥉' },
  { tier: 'Silver', minAmount: 25000, maxAmount: 75000, discountPercent: 3, icon: '🥈' },
  { tier: 'Gold', minAmount: 75000, maxAmount: 200000, discountPercent: 5, icon: '🥇' },
  { tier: 'Platinum', minAmount: 200000, maxAmount: null, discountPercent: 8, icon: '💎' },
]

function getCurrentTier(yearTotal: number): VolumeTier {
  for (const tier of TIERS) {
    if (tier.maxAmount === null) {
      // Platinum tier (no max)
      if (yearTotal >= tier.minAmount) return tier
    } else {
      if (yearTotal >= tier.minAmount && yearTotal < tier.maxAmount) return tier
    }
  }
  return TIERS[0] // Bronze is default
}

function getNextTier(currentTier: VolumeTier): VolumeTier | null {
  const currentIndex = TIERS.findIndex(t => t.tier === currentTier.tier)
  if (currentIndex === -1 || currentIndex === TIERS.length - 1) return null
  return TIERS[currentIndex + 1]
}

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const results: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        SUM(CASE WHEN o."createdAt" >= date_trunc('month', NOW()) THEN o."total" ELSE 0 END)::float as "monthTotal",
        SUM(CASE WHEN o."createdAt" >= date_trunc('quarter', NOW()) THEN o."total" ELSE 0 END)::float as "quarterTotal",
        SUM(CASE WHEN o."createdAt" >= date_trunc('year', NOW()) THEN o."total" ELSE 0 END)::float as "yearTotal",
        COUNT(*)::int as "orderCount"
      FROM "Order" o
      WHERE o."builderId" = $1 AND o."status"::text NOT IN ('CANCELLED', 'DRAFT')
    `, session.builderId)

    const data = results[0] || {}
    const monthTotal = Number(data.monthTotal) || 0
    const quarterTotal = Number(data.quarterTotal) || 0
    const yearTotal = Number(data.yearTotal) || 0
    const orderCount = Number(data.orderCount) || 0

    const currentTier = getCurrentTier(yearTotal)
    const nextTier = getNextTier(currentTier)
    const amountToNextTier = nextTier
      ? Math.max(0, nextTier.minAmount - yearTotal)
      : null
    const nextTierThreshold = nextTier ? nextTier.minAmount : null
    const nextTierDiscountPercent = nextTier ? nextTier.discountPercent : null

    // Calculate savings at current tier
    const savingsAtCurrentTier = yearTotal * (currentTier.discountPercent / 100)

    // Calculate estimated savings at each tier
    const estimatedSavingsAtEachTier = TIERS.map(tier => ({
      tier: tier.tier,
      discountPercent: tier.discountPercent,
      estimatedSavings: yearTotal * (tier.discountPercent / 100),
    }))

    const response: VolumeSavingsResponse = {
      currentTier: currentTier.tier,
      currentTierIcon: currentTier.icon,
      currentDiscountPercent: currentTier.discountPercent,
      monthTotal,
      quarterTotal,
      yearTotal,
      orderCount,
      nextTier: nextTier?.tier || null,
      nextTierThreshold,
      amountToNextTier,
      nextTierDiscountPercent,
      savingsAtCurrentTier,
      estimatedSavingsAtEachTier,
    }

    return NextResponse.json(response)
  } catch (error: any) {
    console.error('GET /api/builder/volume-savings error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch volume savings data' },
      { status: 500 }
    )
  }
}
