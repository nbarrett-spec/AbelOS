// ────────────────────────────────────────────────────────────────────────────
// QR Tag Format Helper
// ────────────────────────────────────────────────────────────────────────────
// Canonical Abel QR URI format:  abel://<kind>/<id>
// Kinds:  product | bay | pallet
//
// Scanners also accept raw SKU strings (back-compat with HID barcode input).
// ────────────────────────────────────────────────────────────────────────────

export type TagKind = 'product' | 'bay' | 'pallet' | 'raw'

export interface DecodedTag {
  kind: TagKind
  id: string
  raw: string
}

const PREFIX = 'abel://'

export function encodeProductTag(sku: string): string {
  const clean = String(sku ?? '').trim()
  if (!clean) throw new Error('encodeProductTag: sku required')
  return `${PREFIX}product/${clean}`
}

export function encodeBayTag(bayCode: string): string {
  const clean = String(bayCode ?? '').trim()
  if (!clean) throw new Error('encodeBayTag: bayCode required')
  return `${PREFIX}bay/${clean}`
}

export function encodePalletTag(palletId: string): string {
  const clean = String(palletId ?? '').trim()
  if (!clean) throw new Error('encodePalletTag: palletId required')
  return `${PREFIX}pallet/${clean}`
}

/**
 * Decode a scanned string.
 * - `abel://product/SKU-123`  →  { kind:'product', id:'SKU-123', raw:... }
 * - `abel://bay/B-04-03`      →  { kind:'bay',     id:'B-04-03', raw:... }
 * - `abel://pallet/<cuid>`    →  { kind:'pallet',  id:'<cuid>',  raw:... }
 * - Anything else             →  { kind:'raw',     id:<input>,   raw:... }
 */
export function decodeTag(scanned: string): DecodedTag {
  const raw = String(scanned ?? '').trim()
  if (!raw) return { kind: 'raw', id: '', raw }

  if (raw.toLowerCase().startsWith(PREFIX)) {
    const rest = raw.slice(PREFIX.length)
    const slash = rest.indexOf('/')
    if (slash > 0) {
      const kindStr = rest.slice(0, slash).toLowerCase()
      const id = rest.slice(slash + 1).trim()
      if (id && (kindStr === 'product' || kindStr === 'bay' || kindStr === 'pallet')) {
        return { kind: kindStr as TagKind, id, raw }
      }
    }
  }

  // Fallback: treat as raw SKU / HID-barcode output
  return { kind: 'raw', id: raw, raw }
}

/**
 * Generate a short pallet id.  Pallet tags are one-time-use so just needs
 * to be unique enough in-session. cuid-ish: 8 lowercase alphanumeric.
 */
export function generatePalletId(): string {
  const now = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `plt_${now}${rand}`
}
