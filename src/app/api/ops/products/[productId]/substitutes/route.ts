export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/products/[productId]/substitutes
//
// Returns a ranked list of active ProductSubstitution entries for the given
// primary product. Payload is optimized for the Material Calendar drawer's
// "Find substitute" flow — it includes the substitute SKU/name, the current
// on-hand / available inventory, priceDelta, compatibility, conditions, and
// source.
//
// Ranking (numeric score, higher = better):
//   +4   substitutionType === 'DIRECT'
//   +3   substitutionType === 'UPGRADE'
//   +2   substitutionType === 'VE'
//   +1   substitutionType === 'DOWNGRADE'
//   +2   available > 0
//   +1   onHand > 0
//   -2   compatibility === 'CONDITIONAL'
//   -4   compatibility !== 'IDENTICAL' and available === 0
//   +0.5 |priceDelta| closer to 0 (smaller cost swing)
//   +1   source === 'VE_PROPOSAL' (Brookfield-approved)
//
// Allowed roles (via checkStaffAuth + /api/ops/products route prefix):
//   ADMIN, MANAGER, PROJECT_MANAGER, ESTIMATOR, SALES_REP, PURCHASING,
//   WAREHOUSE_LEAD.
// ──────────────────────────────────────────────────────────────────────────

interface SubstituteRow {
  id: string
  substituteProductId: string
  sku: string | null
  name: string | null
  category: string | null
  onHand: number
  available: number
  priceDelta: number | null
  substitutionType: string
  compatibility: string | null
  conditions: string | null
  source: string | null
  score: number
}

function scoreRow(r: {
  substitutionType: string
  compatibility: string | null
  priceDelta: number | null
  source: string | null
  onHand: number
  available: number
}): number {
  let s = 0
  switch (r.substitutionType) {
    case 'DIRECT': s += 4; break
    case 'UPGRADE': s += 3; break
    case 'VE': s += 2; break
    case 'DOWNGRADE': s += 1; break
    default: break
  }
  if (r.available > 0) s += 2
  if (r.onHand > 0) s += 1
  if (r.compatibility === 'CONDITIONAL') s -= 2
  if (r.compatibility !== 'IDENTICAL' && r.available <= 0) s -= 4
  if (r.priceDelta != null) {
    // Smaller absolute delta = better (smoother budget impact)
    s += 0.5 / (1 + Math.abs(Number(r.priceDelta)) / 100)
  }
  if (r.source === 'VE_PROPOSAL') s += 1
  return Number(s.toFixed(3))
}

export async function GET(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { productId } = params
  if (!productId) {
    return NextResponse.json({ error: 'productId required' }, { status: 400 })
  }

  try {
    // Verify the primary exists
    const primary: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, sku, name, category, cost, "basePrice" FROM "Product" WHERE id = $1 LIMIT 1`,
      productId
    )
    if (primary.length === 0) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    // Pull substitutes + join inventory
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         ps.id,
         ps."substituteProductId",
         ps."substitutionType",
         ps."priceDelta",
         ps."compatibility",
         ps."conditions",
         ps."source",
         p.sku,
         p.name,
         p.category,
         p."basePrice",
         COALESCE(ii."onHand", 0)::int    AS "onHand",
         COALESCE(ii."available", 0)::int AS "available",
         COALESCE(ii."committed", 0)::int AS "committed"
       FROM "ProductSubstitution" ps
       JOIN "Product"       p  ON p.id = ps."substituteProductId"
       LEFT JOIN "InventoryItem" ii ON ii."productId" = ps."substituteProductId"
       WHERE ps."primaryProductId" = $1
         AND ps.active = true
         AND p.active = true`,
      productId
    )

    const enriched: SubstituteRow[] = rows.map((r) => {
      const priceDelta =
        r.priceDelta == null ? null : Number(r.priceDelta)
      const row = {
        substitutionType: r.substitutionType as string,
        compatibility: r.compatibility as string | null,
        priceDelta,
        source: r.source as string | null,
        onHand: r.onHand as number,
        available: r.available as number,
      }
      return {
        id: r.id,
        substituteProductId: r.substituteProductId,
        sku: r.sku,
        name: r.name,
        category: r.category,
        onHand: r.onHand,
        available: r.available,
        priceDelta,
        substitutionType: r.substitutionType,
        compatibility: r.compatibility,
        conditions: r.conditions,
        source: r.source,
        score: scoreRow(row),
      }
    })

    // Sort: highest score first, DIRECT+available > 0 naturally rise to top.
    // Tiebreaker: positive available beats zero, then smaller price delta.
    enriched.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.available !== a.available) return b.available - a.available
      const da = a.priceDelta == null ? Number.POSITIVE_INFINITY : Math.abs(a.priceDelta)
      const db = b.priceDelta == null ? Number.POSITIVE_INFINITY : Math.abs(b.priceDelta)
      return da - db
    })

    return NextResponse.json({
      primary: {
        id: primary[0].id,
        sku: primary[0].sku,
        name: primary[0].name,
        category: primary[0].category,
        basePrice: primary[0].basePrice,
      },
      count: enriched.length,
      substitutes: enriched,
    })
  } catch (err: any) {
    console.error('[substitutes GET]', err)
    return NextResponse.json(
      { error: 'Failed to load substitutes', details: err?.message },
      { status: 500 }
    )
  }
}
