/**
 * AI Takeoff Tool — Abel Lumber
 *
 * Door / trim extraction from a residential blueprint PDF (or image). This is
 * the scaffold version — one-shot vision call, placeholder matcher, no retry
 * queue. Designed to hand off to a human reviewer, not to replace one.
 *
 * Flow:
 *   1. Estimator uploads PDF via /api/ops/takeoffs/upload → Blueprint + draft Takeoff.
 *   2. /api/ops/takeoffs/[id]/extract runs Claude vision, stores result in
 *      Takeoff.aiExtractionResult + fans out to TakeoffItem rows.
 *   3. UI lets the human edit rows, auto-match products, then generate a Quote.
 */

// ── Types ────────────────────────────────────────────────────────────────
export type TakeoffItemType =
  | 'exterior_door'
  | 'interior_door'
  | 'window'
  | 'trim'
  | 'hardware'
  | 'misc'

export type TrimKind = 'base' | 'casing' | 'crown' | 'chair_rail' | 'other'

export interface RawTakeoffRow {
  type: TakeoffItemType
  kind?: TrimKind // only present for trim rows
  width_in?: number
  height_in?: number
  count?: number
  linear_feet?: number
  location?: string
  hardware?: string
  notes?: string
}

export interface TakeoffExtractionResult {
  items: RawTakeoffRow[]
  confidence?: number // 0-1 overall
  modelNotes?: string[]
}

export interface TakeoffExtractionError {
  error: 'unreadable' | 'ai_not_configured' | 'api_error' | 'parse_error'
  reason: string
}

// ── Prompt ──────────────────────────────────────────────────────────────
export const EXTRACTION_SYSTEM_PROMPT = `You are analyzing an architectural blueprint for a residential door and trim supplier. Your output feeds directly into an estimating tool — precision matters more than completeness.

Extract every door and window opening plus their specifications. Also identify trim linear-footage estimates (base, casing, crown).

Return ONLY a JSON object of the form:
{
  "items": [
    {"type": "exterior_door", "width_in": 36, "height_in": 80, "count": 1, "location": "front_entry", "hardware": "handleset", "notes": "15-lite glass"},
    {"type": "interior_door", "width_in": 32, "height_in": 80, "count": 4, "location": "bedrooms", "hardware": "passage", "notes": "6-panel"},
    {"type": "trim", "kind": "base", "linear_feet": 420, "notes": ""}
  ],
  "confidence": 0.8,
  "modelNotes": ["Assumed 7' ceilings on first floor"]
}

Rules:
- "type" must be one of: exterior_door, interior_door, window, trim, hardware, misc.
- For doors/windows: set count + width_in + height_in. For trim: set kind + linear_feet.
- Widths are in inches, not feet. A 2'8" door is 32 in.
- Lower confidence (toward 0) when drawings are unclear or scale is missing.

If you cannot read the blueprint clearly, respond with ONLY:
{"error": "unreadable", "reason": "short description"}`

// ── Parse ───────────────────────────────────────────────────────────────
/**
 * Parse Claude's text response into either a structured TakeoffExtractionResult
 * or a TakeoffExtractionError. Tolerates models that wrap JSON in a code fence.
 */
export function parseExtractionResponse(
  text: string,
): TakeoffExtractionResult | TakeoffExtractionError {
  if (!text) {
    return { error: 'parse_error', reason: 'empty response from model' }
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return { error: 'parse_error', reason: 'no JSON in model response' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch (e) {
    return { error: 'parse_error', reason: `JSON parse failed: ${(e as Error).message}` }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { error: 'parse_error', reason: 'parsed result not an object' }
  }

  const obj = parsed as Record<string, unknown>

  // Error shape passthrough
  if (typeof obj.error === 'string') {
    return {
      error: 'unreadable',
      reason: typeof obj.reason === 'string' ? obj.reason : 'model returned error',
    }
  }

  if (!Array.isArray(obj.items)) {
    return { error: 'parse_error', reason: 'missing items array' }
  }

  const items: RawTakeoffRow[] = []
  for (const raw of obj.items) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const type = typeof row.type === 'string' ? row.type : 'misc'
    const allowedTypes: TakeoffItemType[] = [
      'exterior_door',
      'interior_door',
      'window',
      'trim',
      'hardware',
      'misc',
    ]
    const normalizedType: TakeoffItemType = (allowedTypes.includes(type as TakeoffItemType)
      ? type
      : 'misc') as TakeoffItemType

    items.push({
      type: normalizedType,
      kind: typeof row.kind === 'string' ? (row.kind as TrimKind) : undefined,
      width_in: toNumber(row.width_in),
      height_in: toNumber(row.height_in),
      count: toNumber(row.count),
      linear_feet: toNumber(row.linear_feet),
      location: typeof row.location === 'string' ? row.location : undefined,
      hardware: typeof row.hardware === 'string' ? row.hardware : undefined,
      notes: typeof row.notes === 'string' ? row.notes : undefined,
    })
  }

  return {
    items,
    confidence: toNumber(obj.confidence),
    modelNotes: Array.isArray(obj.modelNotes)
      ? (obj.modelNotes as unknown[]).filter((n): n is string => typeof n === 'string')
      : undefined,
  }
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
  return undefined
}

// ── Row → TakeoffItem field mapping ─────────────────────────────────────
/**
 * Shape a raw AI row into fields we can insert into the TakeoffItem table.
 * Keeps the category/description used elsewhere in the app (existing
 * TakeoffItem rows have category + description) while also setting the new
 * structured columns (itemType, widthInches, etc).
 */
export function rowToTakeoffItem(row: RawTakeoffRow): {
  category: string
  description: string
  location: string | null
  quantity: number
  itemType: string
  widthInches: number | null
  heightInches: number | null
  linearFeet: number | null
  hardware: string | null
  notes: string | null
} {
  const category = categoryForType(row.type)
  const description = describeRow(row)
  const quantity = row.type === 'trim'
    ? Math.max(1, Math.round(row.linear_feet || 0))
    : Math.max(1, Math.round(row.count || 1))

  return {
    category,
    description,
    location: row.location?.trim() || null,
    quantity,
    itemType: row.type,
    widthInches: row.width_in ?? null,
    heightInches: row.height_in ?? null,
    linearFeet: row.linear_feet ?? null,
    hardware: row.hardware?.trim() || null,
    notes: row.notes?.trim() || null,
  }
}

function categoryForType(t: TakeoffItemType): string {
  switch (t) {
    case 'exterior_door':
      return 'Exterior Door'
    case 'interior_door':
      return 'Interior Door'
    case 'window':
      return 'Window'
    case 'trim':
      return 'Trim'
    case 'hardware':
      return 'Hardware'
    default:
      return 'Miscellaneous'
  }
}

function describeRow(row: RawTakeoffRow): string {
  if (row.type === 'trim') {
    const kind = row.kind ? row.kind.replace('_', ' ') : 'trim'
    const lf = row.linear_feet ? `${row.linear_feet} LF` : 'LF unknown'
    return `${kind} — ${lf}${row.notes ? ` (${row.notes})` : ''}`
  }

  const dims = row.width_in && row.height_in ? `${row.width_in}×${row.height_in}` : 'size unknown'
  const label = row.type.replace('_', ' ')
  const hardware = row.hardware ? ` [${row.hardware}]` : ''
  const notes = row.notes ? ` — ${row.notes}` : ''
  return `${label} ${dims}${hardware}${notes}`
}

// ── SHA-256 fingerprint (for dedupe) ────────────────────────────────────
export function sha256Base64(base64: string): string {
  // Node-only — safe because this lib is imported from API routes.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto') as typeof import('crypto')
  return crypto.createHash('sha256').update(base64, 'base64').digest('hex')
}

// ── Cost guardrails ─────────────────────────────────────────────────────
/** Vision calls on Sonnet cost roughly this much for a short PDF. */
export const ESTIMATED_EXTRACTION_COST_USD = 0.05

/** Soft cap per staff per hour. Can be overridden per-route. */
export const EXTRACTION_RATE_LIMIT_PER_HOUR = 20
