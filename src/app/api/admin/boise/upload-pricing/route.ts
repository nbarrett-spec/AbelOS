export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { requireStaffAuth } from '@/lib/api-auth'
import { ingestPriceSheet } from '@/lib/integrations/boise-pricing-watcher'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/admin/boise/upload-pricing
//
// Multipart form-data upload of a Boise Cascade price sheet (.xlsx).
// Parses → persists snapshot → diffs vs previous snapshot → emits top-50
// movers (>1%) to Brain as `boise_price_change` events on source: 'commodity'.
//
// Auth: ADMIN or PURCHASING role.
// Optional form fields:
//   - file (required, .xlsx)
//   - effectiveDate (ISO string, optional — defaults to upload time)
//   - emit (string "false" disables Brain emission; useful for backfills)
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request, {
    allowedRoles: ['ADMIN', 'PURCHASING'] as any,
  })
  if (auth.error) return auth.error

  let form: FormData
  try {
    form = await request.formData()
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Expected multipart/form-data', detail: e?.message },
      { status: 400 }
    )
  }

  const file = form.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Missing "file" field' }, { status: 400 })
  }

  const blob = file as File
  const filename = blob.name || 'boise-price-sheet.xlsx'
  const lcName = filename.toLowerCase()
  if (!lcName.endsWith('.xlsx') && !lcName.endsWith('.xlsm') && !lcName.endsWith('.xls')) {
    return NextResponse.json(
      { error: 'Unsupported file type — upload .xlsx' },
      { status: 400 }
    )
  }
  if (blob.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large (>50MB)' }, { status: 413 })
  }

  const buffer = Buffer.from(await blob.arrayBuffer())

  const effRaw = form.get('effectiveDate')
  const effectiveDate =
    typeof effRaw === 'string' && effRaw ? new Date(effRaw) : null
  if (effectiveDate && Number.isNaN(effectiveDate.getTime())) {
    return NextResponse.json({ error: 'Invalid effectiveDate' }, { status: 400 })
  }

  const emitRaw = form.get('emit')
  const emit = !(typeof emitRaw === 'string' && emitRaw.toLowerCase() === 'false')

  try {
    const result = await ingestPriceSheet({
      buffer,
      source: 'UPLOAD',
      filename,
      effectiveDate,
      uploadedBy: auth.session?.staffId ?? null,
      emit,
    })

    return NextResponse.json({
      success: true,
      snapshotId: result.snapshotId,
      totalSkus: result.totalSkus,
      newSkus: result.newSkus,
      removedSkus: result.removedSkus,
      changedSkus: result.changedSkus,
      topMovers: result.topMovers,
      brain: result.brain,
    })
  } catch (e: any) {
    console.error('boise upload-pricing error:', e)
    return NextResponse.json(
      { error: e?.message || String(e) },
      { status: 500 }
    )
  }
}
