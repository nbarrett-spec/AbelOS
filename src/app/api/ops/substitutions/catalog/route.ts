export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { logger } from '@/lib/logger'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/substitutions/catalog
//
// Catalog-style browse view of substitutable products. For each Product that
// has at least one active ProductSubstitution row, returns:
//   - the product's SKU/name/category/cost
//   - inventory: onHand, available, committed, reorderPoint, status
//   - substitutes: ranked list (best-first) of available alternates with
//     their own onHand/available + compatibility/priceDelta/conditions
//
// Query params:
//   q=<search>              optional — matches Product.sku or Product.name
//                          (ILIKE %q%)
//   filter=ALL|LOW|OUT       default ALL
//                          LOW = available <= reorderPoint
//                          OUT = onHand <= 0
//   limit=<n>               default 50, max 200
//
// Read-only. Apply still goes through
//   POST /api/ops/products/[productId]/substitutes/apply
// which is the canonical entry point that branches on CONDITIONAL.
// ──────────────────────────────────────────────────────────────────────────

interface CatalogProduct {
  id: string
  sku: string
  name: string
  category: string | null
  cost: number | null
  basePrice: number | null
  onHand: number
  available: number
  committed: number
  reorderPoint: number
  reorderQty: number
  inventoryStatus: string | null
  substituteCount: number
  substitutes: CatalogSubstitute[]
}

interface CatalogSubstitute {
  id: string
  substituteProductId: string
  sku: string | null
  name: string | null
  onHand: number
  available: number
  priceDelta: number | null
  substitutionType: string
  compatibility: string | null
  conditions: string | null
  source: string | null
  score: number
}

function scoreSub(r: {
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
    s += 0.5 / (1 + Math.abs(Number(r.priceDelta)) / 100)
  }
  if (r.source === 'VE_PROPOSAL') s += 1
  return Number(s.toFixed(3))
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') || '').trim()
  const rawFilter = (searchParams.get('filter') || 'ALL').toUpperCase()
  const filter = ['ALL', 'LOW', 'OUT'].includes(rawFilter) ? rawFilter : 'ALL'
  const rawLimit = parseInt(searchParams.get('limit') || '50', 10)
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(200, rawLimit))
    : 50

  try {
    // Step 1: find primary products that have at least one active substitution
    // joined with their inventory snapshot.
    const whereParts: string[] = [
      `p.active = true`,
      `EXISTS (
         SELECT 1 FROM "ProductSubstitution" ps
         WHERE ps."primaryProductId" = p.id AND ps.active = true
       )`,
    ]
    const params: any[] = []

    if (q) {
      whereParts.push(`(p.sku ILIKE $${params.length + 1} OR p.name ILIKE $${params.length + 1})`)
      params.push(`%${q}%`)
    }

    if (filter === 'LOW') {
      whereParts.push(`COALESCE(ii.available, 0) <= COALESCE(ii."reorderPoint", 0)`)
    } else if (filter === 'OUT') {
      whereParts.push(`COALESCE(ii."onHand", 0) <= 0`)
    }

    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''

    const productRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         p.id,
         p.sku,
         p.name,
         p.category,
         p.cost,
         p."basePrice",
         COALESCE(ii."onHand", 0)::int        AS "onHand",
         COALESCE(ii.available, 0)::int       AS available,
         COALESCE(ii.committed, 0)::int       AS committed,
         COALESCE(ii."reorderPoint", 0)::int  AS "reorderPoint",
         COALESCE(ii."reorderQty", 0)::int    AS "reorderQty",
         ii."status"                          AS "inventoryStatus"
       FROM "Product" p
       LEFT JOIN "InventoryItem" ii ON ii."productId" = p.id
       ${where}
       ORDER BY
         CASE
           WHEN COALESCE(ii.available, 0) <= 0 THEN 0
           WHEN COALESCE(ii.available, 0) <= COALESCE(ii."reorderPoint", 0) THEN 1
           ELSE 2
         END ASC,
         p.category ASC NULLS LAST,
         p.name ASC
       LIMIT ${limit}`,
      ...params
    )

    if (productRows.length === 0) {
      return NextResponse.json({ count: 0, filter, q, products: [] })
    }

    const productIds = productRows.map((r) => r.id)

    // Step 2: fetch substitutes for every product in one go.
    const subRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         ps.id,
         ps."primaryProductId",
         ps."substituteProductId",
         ps."substitutionType",
         ps."priceDelta",
         ps."compatibility",
         ps."conditions",
         ps."source",
         sp.sku                              AS "subSku",
         sp.name                             AS "subName",
         COALESCE(sii."onHand", 0)::int      AS "subOnHand",
         COALESCE(sii.available, 0)::int     AS "subAvailable"
       FROM "ProductSubstitution" ps
       JOIN "Product" sp ON sp.id = ps."substituteProductId"
       LEFT JOIN "InventoryItem" sii ON sii."productId" = ps."substituteProductId"
       WHERE ps."primaryProductId" = ANY($1::text[])
         AND ps.active = true
         AND sp.active = true`,
      productIds
    )

    const subsByPrimary = new Map<string, CatalogSubstitute[]>()
    for (const r of subRows) {
      const priceDelta = r.priceDelta == null ? null : Number(r.priceDelta)
      const sub: CatalogSubstitute = {
        id: r.id,
        substituteProductId: r.substituteProductId,
        sku: r.subSku,
        name: r.subName,
        onHand: r.subOnHand,
        available: r.subAvailable,
        priceDelta,
        substitutionType: r.substitutionType,
        compatibility: r.compatibility,
        conditions: r.conditions,
        source: r.source,
        score: scoreSub({
          substitutionType: r.substitutionType,
          compatibility: r.compatibility,
          priceDelta,
          source: r.source,
          onHand: r.subOnHand,
          available: r.subAvailable,
        }),
      }
      const list = subsByPrimary.get(r.primaryProductId) ?? []
      list.push(sub)
      subsByPrimary.set(r.primaryProductId, list)
    }

    // Sort each substitutes list (best-first) and shape products
    const products: CatalogProduct[] = productRows.map((p) => {
      const subs = subsByPrimary.get(p.id) ?? []
      subs.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        if (b.available !== a.available) return b.available - a.available
        const da = a.priceDelta == null ? Number.POSITIVE_INFINITY : Math.abs(a.priceDelta)
        const db = b.priceDelta == null ? Number.POSITIVE_INFINITY : Math.abs(b.priceDelta)
        return da - db
      })
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        cost: p.cost == null ? null : Number(p.cost),
        basePrice: p.basePrice == null ? null : Number(p.basePrice),
        onHand: p.onHand,
        available: p.available,
        committed: p.committed,
        reorderPoint: p.reorderPoint,
        reorderQty: p.reorderQty,
        inventoryStatus: p.inventoryStatus,
        substituteCount: subs.length,
        substitutes: subs,
      }
    })

    return NextResponse.json({
      count: products.length,
      filter,
      q,
      products,
    })
  } catch (err: any) {
    logger.error('[api/ops/substitutions/catalog GET] failed', err, {
      filter,
      q,
    })
    return NextResponse.json(
      { error: 'Failed to load substitution catalog', details: err?.message },
      { status: 500 }
    )
  }
}
