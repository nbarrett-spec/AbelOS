export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import {
  upsertBuilderAlias,
  upsertProductAlias,
  listBuilderAliases,
  listProductAliases,
} from '@/lib/hyphen/processor'

// ──────────────────────────────────────────────────────────────────────────
// GET    /api/admin/hyphen/aliases           → list both types (for admin UI)
// POST   /api/admin/hyphen/aliases           → upsert a builder or product alias
// DELETE /api/admin/hyphen/aliases?id=…&kind=builder|product  → remove an alias
//
// POST body shape:
//   { kind: 'builder',
//     aliasType: 'hyphenBuilderId' | 'accountCode',
//     aliasValue: '…',
//     builderId: '…',
//     note?: '…' }
//
//   { kind: 'product',
//     aliasType: 'builderSupplierSKU' | 'builderAltItemID',
//     aliasValue: '…',
//     productId: '…',
//     note?: '…' }
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const [builderAliases, productAliases] = await Promise.all([
      listBuilderAliases(),
      listProductAliases(),
    ])
    return NextResponse.json({ builderAliases, productAliases })
  } catch (e: any) {
    console.error('[admin/hyphen/aliases GET] error:', e)
    return NextResponse.json({ error: e?.message || 'Failed to load aliases' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const kind = body?.kind
  const aliasType = body?.aliasType
  const aliasValue = (body?.aliasValue || '').toString().trim()
  const note = body?.note ? String(body.note).trim() : undefined

  if (!aliasValue) {
    return NextResponse.json({ error: 'aliasValue is required' }, { status: 400 })
  }

  try {
    if (kind === 'builder') {
      if (aliasType !== 'hyphenBuilderId' && aliasType !== 'accountCode') {
        return NextResponse.json(
          { error: 'aliasType must be hyphenBuilderId or accountCode for builder aliases' },
          { status: 400 }
        )
      }
      const builderId = String(body?.builderId || '').trim()
      if (!builderId) {
        return NextResponse.json({ error: 'builderId is required' }, { status: 400 })
      }
      const result = await upsertBuilderAlias({ aliasType, aliasValue, builderId, note })
      return NextResponse.json({ ok: true, id: result.id, kind: 'builder' })
    }

    if (kind === 'product') {
      if (aliasType !== 'builderSupplierSKU' && aliasType !== 'builderAltItemID') {
        return NextResponse.json(
          { error: 'aliasType must be builderSupplierSKU or builderAltItemID for product aliases' },
          { status: 400 }
        )
      }
      const productId = String(body?.productId || '').trim()
      if (!productId) {
        return NextResponse.json({ error: 'productId is required' }, { status: 400 })
      }
      const result = await upsertProductAlias({ aliasType, aliasValue, productId, note })
      return NextResponse.json({ ok: true, id: result.id, kind: 'product' })
    }

    return NextResponse.json({ error: 'kind must be "builder" or "product"' }, { status: 400 })
  } catch (e: any) {
    console.error('[admin/hyphen/aliases POST] error:', e)
    return NextResponse.json({ error: e?.message || 'Failed to save alias' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const kind = searchParams.get('kind')
  if (!id || (kind !== 'builder' && kind !== 'product')) {
    return NextResponse.json(
      { error: 'id and kind=builder|product query params are required' },
      { status: 400 }
    )
  }

  const table = kind === 'builder' ? 'HyphenBuilderAlias' : 'HyphenProductAlias'
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "id" = $1`, id)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('[admin/hyphen/aliases DELETE] error:', e)
    return NextResponse.json({ error: e?.message || 'Failed to delete alias' }, { status: 500 })
  }
}
