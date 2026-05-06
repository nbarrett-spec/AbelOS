// B-FEAT-6 / A-API-14 — shared bulk import helpers
//
// Used by /api/ops/import/preview and /api/ops/import/run. Centralises:
//   - file parsing (CSV + XLSX via the `xlsx` lib already in deps)
//   - import-type catalog (target fields, required cols)
//
// Note: papaparse is NOT in package.json. The `xlsx` lib (SheetJS) handles
// both CSV and XLSX through a single API, so we lean on it for both. This
// also means we get .xlsx support "free" for v1 instead of CSV-only.

import * as XLSX from 'xlsx'

export type ImportType = 'INVENTORY_COUNT' | 'PRICE_LIST' | 'BUILDER_LIST'

export interface ImportFieldDef {
  /** Internal field name the importer writes to. */
  key: string
  /** Human label in the UI. */
  label: string
  /** Required for the import to succeed for this row. */
  required: boolean
  /** One-line hint shown in the column-mapper. */
  hint?: string
}

export interface ImportTypeDef {
  type: ImportType
  label: string
  description: string
  /** Target Prisma model. Informational — not used to dispatch. */
  targetModel: string
  fields: ImportFieldDef[]
}

export const IMPORT_TYPES: ImportTypeDef[] = [
  {
    type: 'INVENTORY_COUNT',
    label: 'Inventory Count',
    description: 'Update on-hand quantities by SKU. Match by SKU; product must exist.',
    targetModel: 'InventoryItem',
    fields: [
      { key: 'sku', label: 'SKU', required: true, hint: 'Matches Product.sku' },
      { key: 'onHand', label: 'On-Hand Qty', required: true, hint: 'Integer count' },
      { key: 'warehouseZone', label: 'Warehouse Zone', required: false },
      { key: 'binLocation', label: 'Bin Location', required: false },
    ],
  },
  {
    type: 'PRICE_LIST',
    label: 'Price List',
    description: 'Update product base price and/or cost by SKU. Product must exist.',
    targetModel: 'Product',
    fields: [
      { key: 'sku', label: 'SKU', required: true, hint: 'Matches Product.sku' },
      { key: 'basePrice', label: 'Base Price', required: false, hint: 'At least one of basePrice or cost is required' },
      { key: 'cost', label: 'Cost', required: false, hint: 'Abel\'s cost' },
    ],
  },
  {
    type: 'BUILDER_LIST',
    label: 'Builder List',
    description: 'Create or update builder accounts by company name. Creates Builder if missing.',
    targetModel: 'Builder',
    fields: [
      { key: 'companyName', label: 'Company Name', required: true, hint: 'Match key (case-insensitive)' },
      { key: 'contactName', label: 'Contact Name', required: false },
      { key: 'email', label: 'Email', required: false, hint: 'Required for new builders (auto-generated if missing)' },
      { key: 'phone', label: 'Phone', required: false },
      { key: 'address', label: 'Address', required: false },
      { key: 'city', label: 'City', required: false },
      { key: 'state', label: 'State', required: false },
      { key: 'zip', label: 'Zip', required: false },
    ],
  },
]

export function getImportTypeDef(type: string): ImportTypeDef | null {
  return IMPORT_TYPES.find(t => t.type === type) || null
}

/**
 * Parse an uploaded file (CSV or XLSX) into headers + row objects.
 * Uses xlsx for both formats — papaparse is not in deps, and xlsx handles
 * CSV cleanly including BOM and quoted multi-line fields.
 *
 * Returns up to `maxRows` rows. Pass Infinity to read everything.
 */
export function parseUpload(
  buffer: ArrayBuffer | Buffer,
  fileName: string,
  maxRows: number = Infinity,
): { headers: string[]; rows: Record<string, string>[] } {
  const buf: Buffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(new Uint8Array(buffer))
  // ext is intentionally inspected only for diagnostic comments; xlsx
  // auto-detects format. Keep the variable for future format gating.
  void fileName.toLowerCase().split('.').pop()

  // xlsx auto-detects format from buffer content. Force `type: 'buffer'`.
  const wb = XLSX.read(buf, { type: 'buffer', raw: false, cellDates: false, cellNF: false })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return { headers: [], rows: [] }
  const sheet = wb.Sheets[sheetName]

  // Read as array-of-arrays first so we can grab headers without xlsx's
  // header-coercion (which renames duplicates and strips empties).
  const rowsAA: string[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  }) as string[][]

  if (rowsAA.length === 0) return { headers: [], rows: [] }

  const headers = (rowsAA[0] || []).map(h => String(h ?? '').trim())
  const dataRows = rowsAA.slice(1)
  const out: Record<string, string>[] = []

  const limit = Math.min(dataRows.length, Number.isFinite(maxRows) ? maxRows : dataRows.length)
  for (let i = 0; i < limit; i++) {
    const row = dataRows[i] || []
    const obj: Record<string, string> = {}
    let hasAny = false
    for (let j = 0; j < headers.length; j++) {
      const v = row[j]
      const s = v == null ? '' : String(v).trim()
      obj[headers[j]] = s
      if (s) hasAny = true
    }
    if (hasAny) out.push(obj)
  }

  return { headers, rows: out }
}

/**
 * Coerce a string value to a number, returning null on empty / NaN.
 */
export function toNum(v: string | undefined | null): number | null {
  if (v == null) return null
  const s = String(v).replace(/[$,\s]/g, '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Coerce a string value to an integer, returning null on empty / NaN.
 */
export function toInt(v: string | undefined | null): number | null {
  const n = toNum(v)
  if (n == null) return null
  return Math.round(n)
}

/**
 * Build an email slug from a company name when none is provided. Mirrors
 * the convention used in src/app/api/ops/import-inflow/route.ts so the
 * two importers don't collide on synthetic emails.
 */
export function generateBuilderEmail(companyName: string): string {
  return (
    companyName.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') +
    '@builder.abellumber.com'
  )
}
