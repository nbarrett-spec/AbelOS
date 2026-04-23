export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import {
  encodeProductTag,
  encodeBayTag,
  encodePalletTag,
  generatePalletId,
} from '@/lib/qr-tags'

// ────────────────────────────────────────────────────────────────────────────
// QR Tag Preview
// Returns tag metadata (no images — SVG/QR encoded client-side).
// Query params:
//   kind=product|bay|pallet   (required)
//   ids=<csv>                 (for product/bay)
//   bays=<csv>                (alias of ids for bays)
//   count=<n>                 (for pallet generation)
//   search=<string>           (for product filter)
// ────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const kind = searchParams.get('kind')

    if (kind === 'product') {
      const idsParam = searchParams.get('ids') || ''
      const search = searchParams.get('search') || ''
      const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean)

      if (ids.length) {
        // Fetch the selected products
        const products = await prisma.$queryRawUnsafe<any[]>(
          `SELECT id, sku, name, category
             FROM "Product"
             WHERE id = ANY($1::text[])
             ORDER BY "category", "name"`,
          ids
        )
        return NextResponse.json({
          kind: 'product',
          tags: products.map(p => ({
            id: p.id,
            sku: p.sku,
            name: p.name,
            category: p.category,
            uri: encodeProductTag(p.sku),
          })),
        })
      }

      // Search mode: pull a page of candidates
      const searchTerm = `%${search}%`
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, sku, name, category
           FROM "Product"
           WHERE active = true
             AND ($1 = '' OR name ILIKE $2 OR sku ILIKE $2)
           ORDER BY "category", "name"
           LIMIT 200`,
        search,
        searchTerm
      )
      return NextResponse.json({
        kind: 'product',
        candidates: rows.map(p => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
        })),
      })
    }

    if (kind === 'bay') {
      const raw = searchParams.get('bays') || searchParams.get('ids') || ''
      const bays = raw
        .split(/[,\n]/)
        .map(s => s.trim())
        .filter(Boolean)
      return NextResponse.json({
        kind: 'bay',
        tags: bays.map(code => ({
          id: code,
          code,
          uri: encodeBayTag(code),
        })),
      })
    }

    if (kind === 'pallet') {
      const count = Math.max(1, Math.min(500, parseInt(searchParams.get('count') || '10', 10)))
      const tags = Array.from({ length: count }).map(() => {
        const id = generatePalletId()
        return { id, uri: encodePalletTag(id) }
      })
      return NextResponse.json({ kind: 'pallet', tags })
    }

    return NextResponse.json({ error: 'Invalid kind. Use product|bay|pallet.' }, { status: 400 })
  } catch (error: any) {
    console.error('[qr-tags/preview] GET error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to load tags' },
      { status: 500 }
    )
  }
}
