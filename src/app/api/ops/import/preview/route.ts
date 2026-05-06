// B-FEAT-6 / A-API-14 — bulk import preview endpoint
//
// POST /api/ops/import/preview
//   multipart/form-data:
//     file       — CSV or XLSX
//     importType — INVENTORY_COUNT | PRICE_LIST | BUILDER_LIST
//
// Returns first 10 rows + detected columns + the target field catalog so the
// /ops/import wizard can show a column-mapper. No DB writes.

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import {
  parseUpload,
  getImportTypeDef,
  IMPORT_TYPES,
  type ImportType,
} from '@/lib/bulk-import'

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25 MB

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const form = await request.formData()
    const file = form.get('file')
    const importType = (form.get('importType') as string | null)?.trim() as ImportType | null

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max ${MAX_FILE_SIZE / 1024 / 1024}MB.` },
        { status: 413 },
      )
    }

    if (!importType) {
      return NextResponse.json({ error: 'importType is required' }, { status: 400 })
    }

    const def = getImportTypeDef(importType)
    if (!def) {
      return NextResponse.json(
        { error: `Unknown importType "${importType}". Allowed: ${IMPORT_TYPES.map(t => t.type).join(', ')}` },
        { status: 400 },
      )
    }

    const fileName = (file as File).name || 'upload.csv'
    const buf = Buffer.from(await file.arrayBuffer())

    let parsed: { headers: string[]; rows: Record<string, string>[] }
    try {
      // Read up to 11 rows so we can return 10 to the client and still know
      // whether more exist for the "rowsTotal" estimate. We re-parse on the
      // run endpoint, so cost here is only the preview slice.
      parsed = parseUpload(buf, fileName, 11)
    } catch (err: any) {
      return NextResponse.json({ error: `Failed to parse file: ${err.message}` }, { status: 400 })
    }

    const previewRows = parsed.rows.slice(0, 10)

    // Heuristic auto-mapping: match each target field key to the closest
    // detected header (case + non-alpha-insensitive). The UI can override.
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    const headerByNorm = new Map<string, string>()
    for (const h of parsed.headers) headerByNorm.set(norm(h), h)
    const suggestedMapping: Record<string, string | null> = {}
    for (const f of def.fields) {
      const key = norm(f.key)
      const labelKey = norm(f.label)
      suggestedMapping[f.key] = headerByNorm.get(key) ?? headerByNorm.get(labelKey) ?? null
    }

    return NextResponse.json({
      success: true,
      fileName,
      importType,
      typeDef: def,
      headers: parsed.headers,
      rowsPreviewed: previewRows.length,
      previewRows,
      suggestedMapping,
    })
  } catch (error: any) {
    console.error('[/api/ops/import/preview] error:', error)
    return NextResponse.json({ error: 'Preview failed' }, { status: 500 })
  }
}

// GET — return the import-type catalog for the wizard UI.
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  return NextResponse.json({ importTypes: IMPORT_TYPES })
}
