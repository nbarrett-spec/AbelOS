export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { hasPermission, parseRoles } from '@/lib/permissions'

/**
 * POST /api/ops/takeoffs/[id]/match-products
 *
 * Simple heuristic matcher — walks every TakeoffItem without a productId and
 * tries to find a Product in the catalog that matches by category + size. The
 * match is suggestion-only; the reviewer confirms via PATCH /api/ops/takeoffs/[id].
 *
 * The logic is intentionally conservative:
 *   - door items (exterior/interior): match category + doorSize (widthInches × heightInches)
 *   - trim items: match category "Trim"
 *   - otherwise: skip
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
  const roles = parseRoles(
    request.headers.get('x-staff-roles') || request.headers.get('x-staff-role'),
  )
  if (!hasPermission(roles, 'takeoff:edit')) {
    return NextResponse.json(
      { error: 'Forbidden — missing takeoff:edit' },
      { status: 403 },
    )
  }

  const items = await prisma.$queryRawUnsafe<
    {
      id: string
      category: string
      itemType: string | null
      widthInches: number | null
      heightInches: number | null
      productId: string | null
    }[]
  >(
    `SELECT "id","category","itemType","widthInches","heightInches","productId"
     FROM "TakeoffItem"
     WHERE "takeoffId" = $1`,
    params.id,
  )

  if (!items || items.length === 0) {
    return NextResponse.json({ matched: 0, total: 0, matches: [] })
  }

  const matches: Array<{ itemId: string; productId: string; sku: string; reason: string }> = []
  let matched = 0

  for (const item of items) {
    if (item.productId) continue // skip rows the human has already confirmed

    const product = await findProductFor(item)
    if (product) {
      await prisma.$executeRawUnsafe(
        `UPDATE "TakeoffItem" SET "productId" = $1 WHERE "id" = $2`,
        product.id,
        item.id,
      )
      matches.push({
        itemId: item.id,
        productId: product.id,
        sku: product.sku,
        reason: product.reason,
      })
      matched++
    }
  }

  await audit(request, 'UPDATE', 'Takeoff', params.id, {
    action: 'match_products',
    matched,
    total: items.length,
  })

  return NextResponse.json({ matched, total: items.length, matches })
  } catch (error: any) {
    console.error('[Match Products] Error:', error)
    return NextResponse.json({ error: 'Failed to match products' }, { status: 500 })
  }
}

interface Candidate {
  id: string
  sku: string
  reason: string
}

async function findProductFor(item: {
  category: string
  itemType: string | null
  widthInches: number | null
  heightInches: number | null
}): Promise<Candidate | null> {
  const doorTypes = new Set(['exterior_door', 'interior_door'])

  if (item.itemType && doorTypes.has(item.itemType) && item.widthInches && item.heightInches) {
    // Build the doorSize signature Abel uses (e.g. 2868 for 2'8" × 6'8"). We
    // also try a plain width match as a fallback.
    const size = feetInchesCode(item.widthInches, item.heightInches)
    const categoryMatch = item.itemType === 'exterior_door' ? 'Exterior%' : 'Interior%'
    const rows = await prisma.$queryRawUnsafe<{ id: string; sku: string }[]>(
      `SELECT "id","sku" FROM "Product"
        WHERE "active" = true
          AND "category" ILIKE $1
          AND ("doorSize" = $2 OR "doorSize" = $3)
        ORDER BY "basePrice" ASC
        LIMIT 1`,
      categoryMatch,
      size,
      `${Math.round(item.widthInches)}`,
    )
    if (rows.length > 0) {
      return { id: rows[0].id, sku: rows[0].sku, reason: `size ${size}` }
    }
  }

  if (item.category.toLowerCase().startsWith('trim')) {
    const rows = await prisma.$queryRawUnsafe<{ id: string; sku: string }[]>(
      `SELECT "id","sku" FROM "Product"
        WHERE "active" = true AND "category" ILIKE 'Trim%'
        ORDER BY "basePrice" ASC
        LIMIT 1`,
    )
    if (rows.length > 0) {
      return { id: rows[0].id, sku: rows[0].sku, reason: 'trim fallback' }
    }
  }

  return null
}

function feetInchesCode(widthIn: number, heightIn: number): string {
  // 32 × 80 → 2868   (2ft 8in × 6ft 8in)
  const wFt = Math.floor(widthIn / 12)
  const wIn = Math.round(widthIn - wFt * 12)
  const hFt = Math.floor(heightIn / 12)
  const hIn = Math.round(heightIn - hFt * 12)
  return `${wFt}${wIn}${hFt}${hIn}`
}
