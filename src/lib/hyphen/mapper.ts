// ──────────────────────────────────────────────────────────────────────────
// Hyphen SPConnect → Abel normalized shape
//
// Pure function. Takes the raw envelope Hyphen POSTs to /api/hyphen/orders
// (per SPConnect v13 §2) and produces a normalized intermediate shape that
// the processor can turn into Abel Order + OrderItem rows.
//
// This file never touches the database — it only validates and reshapes.
// Resolution of Hyphen builder GUIDs → Abel builderId and Hyphen supplier
// SKUs → Abel productId happens in processor.ts.
//
// References:
//   Hyphen SPConnect API Specifications v13 §2 (Orders), pages 5-10
//   docs/HYPHEN_SPCONNECT_SETUP.md
// ──────────────────────────────────────────────────────────────────────────

import type { DoorSpecParse, NormalizedItem } from './types'
export type { NormalizedItem } from './types'

export interface NormalizedAddress {
  name: string | null
  street: string | null
  streetSupplement: string | null
  city: string | null
  stateCode: string | null
  postalCode: string | null
}

export interface NormalizedContact {
  name: string | null
  phone: string | null
  email: string | null
}

export interface NormalizedBuilder {
  hyphenBuilderId: string | null // header.builder.id (GUID)
  accountCode: string | null // header.accountCode
  accountNumber: string | null // header.accountNumber
  address: NormalizedAddress
  primaryContact: NormalizedContact
}

export interface NormalizedShipping {
  address: NormalizedAddress
  primaryContact: NormalizedContact
}

export interface NormalizedBilling {
  address: NormalizedAddress
  primaryContact: NormalizedContact
}

export interface NormalizedJob {
  jobNum: string | null
  name: string | null
  street: string | null
  streetSupplement: string | null
  city: string | null
  stateCode: string | null
  postalCode: string | null
  subdivision: string | null
  phase: string | null
  lot: string | null
  block: string | null
  plan: string | null
  elevation: string | null
  swing: string | null
  permitNumber: string | null
  startDate: string | null
  endDate: string | null
  communityCode: string | null
}

// NormalizedItem now lives in ./types — re-exported above for back-compat.

export interface NormalizedSummary {
  numberOfLines: number | null
  taxAmount: number
  orderSubTotal: number
  orderTotal: number
}

export interface NormalizedOrder {
  // Idempotency key: Hyphen's system ID for this PO
  hyphenOrderId: string // stringified header.id
  supplierOrderNumber: string | null
  issueDate: string | null
  purpose: string // Original / Change / Cancellation / Confirmation / Other / Pending / Unspecified
  orderType: string // PurchaseOrder / WorkOrder / etc.
  orderCurrency: string | null
  orderHeaderNote: string | null
  additionalReferenceNumber: string | null
  supplierReferenceNumber: string | null
  deliveryType: string | null
  startDate: string | null
  endDate: string | null

  builderOrderNumber: string | null // header.builderOrderNumber — becomes Abel Order.poNumber

  builder: NormalizedBuilder
  shipping: NormalizedShipping
  billing: NormalizedBilling
  job: NormalizedJob | null

  taskNum: string | null
  taskName: string | null

  items: NormalizedItem[]
  summary: NormalizedSummary
}

export type MapperWarning = {
  code: string
  message: string
  path?: string
}

export type MapperError = {
  code: string
  message: string
  path?: string
}

export interface MapperResult {
  ok: boolean
  order?: NormalizedOrder
  warnings: MapperWarning[]
  errors: MapperError[]
}

// ──────────────────────────────────────────────────────────────────────────
// Public entry point
// ──────────────────────────────────────────────────────────────────────────

export function mapSpConnectOrderPayload(payload: any): MapperResult {
  const warnings: MapperWarning[] = []
  const errors: MapperError[] = []

  if (!payload || typeof payload !== 'object') {
    errors.push({ code: 'MISSING_PAYLOAD', message: 'Payload is empty or not an object' })
    return { ok: false, warnings, errors }
  }

  const header = payload.header
  if (!header || typeof header !== 'object') {
    errors.push({ code: 'MISSING_HEADER', message: 'header is required', path: 'header' })
    return { ok: false, warnings, errors }
  }

  // header.id is the Hyphen-side system identifier and the only true
  // idempotency key. Required — we can't safely process without it.
  const rawHyphenId = header.id
  if (rawHyphenId === null || rawHyphenId === undefined || rawHyphenId === '') {
    errors.push({ code: 'MISSING_HEADER_ID', message: 'header.id is required', path: 'header.id' })
  }
  const hyphenOrderId = String(rawHyphenId ?? '').trim()

  // builderOrderNumber becomes our poNumber. Warn (not error) if missing —
  // some Hyphen tenants leave it blank on resends.
  const builderOrderNumber = trimOrNull(header.builderOrderNumber)
  if (!builderOrderNumber) {
    warnings.push({
      code: 'MISSING_BUILDER_ORDER_NUMBER',
      message: 'header.builderOrderNumber is missing — Abel poNumber will be blank',
      path: 'header.builderOrderNumber',
    })
  }

  // Purpose controls whether this is new / change / cancellation.
  const purpose = normalizePurpose(header.purpose)
  if (!purpose) {
    warnings.push({
      code: 'UNKNOWN_PURPOSE',
      message: `Unknown header.purpose value "${header.purpose}" — defaulting to Original`,
      path: 'header.purpose',
    })
  }

  const orderType = normalizeOrderType(header.orderType, warnings)

  // Items are the heart of the order — error if absent.
  const rawItems: any[] = Array.isArray(payload.items) ? payload.items : []
  if (rawItems.length === 0) {
    errors.push({ code: 'NO_ITEMS', message: 'items[] is empty or missing', path: 'items' })
  }

  const items = rawItems.map((it, idx) => mapItem(it, idx, warnings, errors))

  const summary = mapSummary(payload.summary, items, warnings)

  if (errors.length > 0) {
    return { ok: false, warnings, errors }
  }

  const order: NormalizedOrder = {
    hyphenOrderId,
    supplierOrderNumber: trimOrNull(header.supplierOrderNumber),
    issueDate: trimOrNull(header.issueDate),
    purpose: purpose || 'Original',
    orderType,
    orderCurrency: trimOrNull(header.orderCurrency),
    orderHeaderNote: trimOrNull(header.orderHeaderNote),
    additionalReferenceNumber: trimOrNull(header.additionalReferenceNumber),
    supplierReferenceNumber: trimOrNull(header.supplierReferenceNumber),
    deliveryType: trimOrNull(header.deliveryType),
    startDate: trimOrNull(header.startDate),
    endDate: trimOrNull(header.endDate),
    builderOrderNumber,
    builder: mapBuilder(header),
    shipping: mapShipping(header.shippingInformation),
    billing: mapBilling(header.billingInformation),
    job: mapJob(header.job),
    taskNum: trimOrNull(header?.task?.taskNum),
    taskName: trimOrNull(header?.task?.name),
    items,
    summary,
  }

  return { ok: true, order, warnings, errors }
}

// ──────────────────────────────────────────────────────────────────────────
// Section mappers
// ──────────────────────────────────────────────────────────────────────────

function mapBuilder(header: any): NormalizedBuilder {
  return {
    hyphenBuilderId: trimOrNull(header?.builder?.id),
    accountCode: trimOrNull(header?.accountCode),
    accountNumber: trimOrNull(header?.accountNumber),
    address: mapAddress(header?.builder?.address),
    primaryContact: mapContact(header?.builder?.primaryContacts),
  }
}

function mapShipping(shipping: any): NormalizedShipping {
  return {
    address: mapAddress(shipping?.address),
    primaryContact: mapContact(shipping?.primaryContacts),
  }
}

function mapBilling(billing: any): NormalizedBilling {
  return {
    address: mapAddress(billing?.address),
    primaryContact: mapContact(billing?.primaryContacts),
  }
}

function mapJob(job: any): NormalizedJob | null {
  if (!job || typeof job !== 'object') return null
  return {
    jobNum: trimOrNull(job.jobNum),
    name: trimOrNull(job.name),
    street: trimOrNull(job.street),
    streetSupplement: trimOrNull(job.streetSupplement),
    city: trimOrNull(job.city),
    stateCode: trimOrNull(job.stateCode),
    postalCode: trimOrNull(job.postalCode),
    subdivision: trimOrNull(job.subdivision),
    phase: trimOrNull(job.phase),
    lot: trimOrNull(job.lot),
    block: trimOrNull(job.block),
    plan: trimOrNull(job.plan),
    elevation: trimOrNull(job.elevation),
    swing: trimOrNull(job.swing),
    permitNumber: trimOrNull(job.permitNumber),
    startDate: trimOrNull(job.startDate),
    endDate: trimOrNull(job.endDate),
    communityCode: trimOrNull(job.communityCode),
  }
}

function mapAddress(addr: any): NormalizedAddress {
  if (!addr || typeof addr !== 'object') {
    return {
      name: null,
      street: null,
      streetSupplement: null,
      city: null,
      stateCode: null,
      postalCode: null,
    }
  }
  return {
    name: trimOrNull(addr.name),
    street: trimOrNull(addr.street),
    streetSupplement: trimOrNull(addr.streetSupplement),
    city: trimOrNull(addr.city),
    stateCode: trimOrNull(addr.stateCode),
    postalCode: trimOrNull(addr.postalCode),
  }
}

function mapContact(contact: any): NormalizedContact {
  // SPConnect sometimes sends primaryContacts as an object, sometimes as an
  // array of one. Handle both.
  const c = Array.isArray(contact) ? contact[0] : contact
  if (!c || typeof c !== 'object') {
    return { name: null, phone: null, email: null }
  }
  return {
    name: trimOrNull(c.name),
    phone: trimOrNull(c.phone),
    email: trimOrNull(c.email),
  }
}

function mapItem(
  item: any,
  idx: number,
  warnings: MapperWarning[],
  errors: MapperError[]
): NormalizedItem {
  const path = `items[${idx}]`

  const qtyOrdered = coerceNumber(item?.builderTotalQuantity?.quantityOrdered)
  if (qtyOrdered === null || qtyOrdered <= 0) {
    errors.push({
      code: 'INVALID_QUANTITY',
      message: `Line ${idx + 1} has no valid quantityOrdered`,
      path: `${path}.builderTotalQuantity.quantityOrdered`,
    })
  }

  const builderSupplierSKU = trimOrNull(item?.builderSupplierSKU)
  const builderAltItemID = trimOrNull(item?.builderAltItemID)
  if (!builderSupplierSKU && !builderAltItemID) {
    warnings.push({
      code: 'NO_SKU',
      message: `Line ${idx + 1} has no builderSupplierSKU or builderAltItemID — alias lookup will fail`,
      path: `${path}.builderSupplierSKU`,
    })
  }

  const requestedUnitPrice = coerceNumber(item?.requestedUnitPrice)
  const supplierUnitPrice = coerceNumber(item?.supplierPrice?.unitPrice)
  const lineTotal = coerceNumber(item?.total)

  // v13: builderLineItemNum is `bigint` per the spec. Hyphen sometimes
  // sends it as a JS number, sometimes as a numeric string. Convert via
  // BigInt(Math.trunc(n)) so partial-float drift can't break the call.
  const rawLineNum = item?.builderLineItemNum
  let builderLineItemNum: bigint | null = null
  if (typeof rawLineNum === 'number' && Number.isFinite(rawLineNum)) {
    builderLineItemNum = BigInt(Math.trunc(rawLineNum))
  } else if (typeof rawLineNum === 'string' && rawLineNum.trim() !== '') {
    // Strip any decimal — the spec is bigint, but real-world POs occasionally
    // send "43179622.0".
    const cleaned = rawLineNum.trim().split('.')[0]
    if (/^-?\d+$/.test(cleaned)) {
      try {
        builderLineItemNum = BigInt(cleaned)
      } catch {
        builderLineItemNum = null
      }
    }
  } else if (typeof rawLineNum === 'bigint') {
    builderLineItemNum = rawLineNum
  }

  const doorSpecs = parseDoorSpecs(item)

  return {
    builderLineItemNum,
    builderSupplierSKU,
    builderAltItemID,
    supplierSKU: trimOrNull(item?.supplierSKU),
    itemDescription: trimOrNull(item?.itemDescription),

    quantityOrdered: qtyOrdered ?? 0,
    unitOfMeasurement: trimOrNull(item?.builderTotalQuantity?.unitOfMeasurement),
    supplierQuantity: coerceNumber(item?.supplierConvertedQuantity?.quantity),
    supplierUnitOfMeasurement: trimOrNull(
      item?.supplierConvertedQuantity?.unitOfMeasurement
    ),

    requestedUnitPrice,
    supplierUnitPrice,
    lineTotal,

    optionColor1: trimOrNull(item?.optionColor1),
    optionColor2: trimOrNull(item?.optionColor2),
    optionColor3: trimOrNull(item?.optionColor3),
    extText1: trimOrNull(item?.extText1),
    extText2: trimOrNull(item?.extText2),
    extText3: trimOrNull(item?.extText3),
    extText4: trimOrNull(item?.extText4),
    extText5: trimOrNull(item?.extText5),
    extText6: trimOrNull(item?.extText6),
    selectionDesc: trimOrNull(item?.selectionDesc),
    isPackageItem: coerceBool(item?.isPackageItem),
    homeSelectionInd: coerceBool(item?.homeSelectionInd),

    doorSwing: doorSpecs.doorSwing,
    doorHand: doorSpecs.doorHand,
    jambDepth: doorSpecs.jambDepth,
    throatDepth: doorSpecs.throatDepth,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Door-spec parsing
//
// Brookfield (and most production builders) ship door spec data in two
// places:
//   1. items.itemOptions.locations[].preferences[]  — { name, value } pairs
//      with names like "Hand", "Swing", "Jamb Depth", "Throat".
//   2. items.extText1..6                            — free-form codes,
//      typically "LH 4-9/16 Inswing" or "RH 6-9/16 Outswing".
//
// We try preferences first (structured), fall back to regex on extText.
// Returns null for any field the parser can't confidently nail down — a
// blank column is better than wrong door data going to the shop floor.
// ──────────────────────────────────────────────────────────────────────────

export function parseDoorSpecs(item: any): DoorSpecParse {
  const prefs = collectPreferences(item)
  const extTexts: string[] = [
    item?.extText1,
    item?.extText2,
    item?.extText3,
    item?.extText4,
    item?.extText5,
    item?.extText6,
  ]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0)

  return {
    doorSwing: parseDoorSwing(prefs, extTexts),
    doorHand: parseDoorHand(prefs, extTexts),
    jambDepth: parseDepth(prefs, extTexts, /jamb/i),
    throatDepth: parseDepth(prefs, extTexts, /throat/i),
  }
}

interface Pref { name: string; value: string }

function collectPreferences(item: any): Pref[] {
  // itemOptions can be null, an object, or an array. locations is similar.
  const out: Pref[] = []
  const opts = item?.itemOptions
  if (!opts) return out
  const optsArr = Array.isArray(opts) ? opts : [opts]
  for (const opt of optsArr) {
    const locations = opt?.locations
    if (!locations) continue
    const locArr = Array.isArray(locations) ? locations : [locations]
    for (const loc of locArr) {
      const prefs = loc?.preferences
      if (!prefs) continue
      const prefArr = Array.isArray(prefs) ? prefs : [prefs]
      for (const p of prefArr) {
        const name = typeof p?.name === 'string' ? p.name.trim() : ''
        const value = p?.value === null || p?.value === undefined ? '' : String(p.value).trim()
        if (name && value) out.push({ name, value })
      }
    }
  }
  return out
}

function parseDoorSwing(prefs: Pref[], extTexts: string[]): string | null {
  // 1. Preferences with name matching /swing|hand/i
  //    (Hyphen tenants split between calling it "Swing" vs "Hand")
  for (const p of prefs) {
    if (/swing|hand/i.test(p.name)) {
      const norm = canonicalizeSwing(p.value)
      if (norm) return norm
    }
  }
  // 2. Regex on extText fields — leading LH/RH/Left/Right/Active/Inactive
  for (const t of extTexts) {
    const m = t.match(/^(LH|RH|Left|Right|Active|Inactive)\b/i)
    if (m) {
      const norm = canonicalizeSwing(m[1])
      if (norm) return norm
    }
  }
  return null
}

function canonicalizeSwing(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  if (!s) return null
  if (s === 'lh' || s === 'left' || s === 'left hand' || s === 'lefthand') return 'LH'
  if (s === 'rh' || s === 'right' || s === 'right hand' || s === 'righthand') return 'RH'
  if (s === 'active') return 'Active'
  if (s === 'inactive') return 'Inactive'
  // "L" / "R" — common shorthand from job.swing
  if (s === 'l') return 'LH'
  if (s === 'r') return 'RH'
  return null
}

function parseDoorHand(prefs: Pref[], extTexts: string[]): string | null {
  // 1. Preferences with name matching inswing/outswing/opening
  for (const p of prefs) {
    if (/inswing|outswing|opening/i.test(p.name)) {
      const norm = canonicalizeHand(p.value)
      if (norm) return norm
    }
    // Some tenants put it in the value directly under a generic name
    if (/^(in|out)swing\b/i.test(p.value)) {
      return canonicalizeHand(p.value)
    }
  }
  // 2. Regex — "Inswing"/"Outswing" or "opens in"/"opens out"
  for (const t of extTexts) {
    const m1 = t.match(/\b(in|out)swing\b/i)
    if (m1) return m1[1].toLowerCase() === 'in' ? 'Inswing' : 'Outswing'
    const m2 = t.match(/opens?\s+(in|out)\b/i)
    if (m2) return m2[1].toLowerCase() === 'in' ? 'Inswing' : 'Outswing'
  }
  return null
}

function canonicalizeHand(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  if (s.startsWith('inswing') || s === 'in') return 'Inswing'
  if (s.startsWith('outswing') || s === 'out') return 'Outswing'
  return null
}

/**
 * Parse a depth-style field (jambDepth, throatDepth). Returns the raw
 * string "4-9/16" or "6 9/16" untouched — door shops want fractions
 * preserved exactly, not coerced to floats.
 */
function parseDepth(prefs: Pref[], extTexts: string[], nameRe: RegExp): string | null {
  // 1. Direct preference hit by name
  for (const p of prefs) {
    if (nameRe.test(p.name)) {
      const cleaned = p.value.trim().replace(/^["'\s]+|["'\s]+$/g, '')
      if (cleaned) return cleaned
    }
  }
  // 2. Regex on extText: capture a number-with-fraction immediately
  //    preceding the keyword, e.g. "4-9/16 jamb" or "6 9/16\" Jamb".
  //    Pattern: digits, optional dash/space + fraction, optional inch-mark,
  //    whitespace, then "jamb" / "throat".
  const re = new RegExp(
    String(nameRe.source).replace(/^\^|\$$/g, ''),
    'i'
  )
  // Helper regex — matches "4-9/16" / "6 9/16" / "5.5" / "4 1/2"
  const depthCore = /(\d+(?:\s*[-\s]\s*\d+\/\d+|\.\d+)?)(?:\s*(?:["']|in\b|inch\b))?/i
  for (const t of extTexts) {
    if (!re.test(t)) continue
    // Try to find a depth value adjacent to the keyword.
    const before = new RegExp(
      depthCore.source + '\\s*' + re.source,
      'i'
    )
    const m1 = t.match(before)
    if (m1 && m1[1]) {
      return normalizeDepthString(m1[1])
    }
    const after = new RegExp(
      re.source + '\\s*[:=-]?\\s*' + depthCore.source,
      'i'
    )
    const m2 = t.match(after)
    if (m2 && m2[1]) {
      return normalizeDepthString(m2[1])
    }
  }
  return null
}

function normalizeDepthString(raw: string): string {
  // Collapse interior whitespace, normalize "4 9/16" -> "4-9/16" (the
  // door industry's most common written form).
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^(\d+)\s+(\d+\/\d+)$/, '$1-$2')
}

function mapSummary(
  summary: any,
  items: NormalizedItem[],
  warnings: MapperWarning[]
): NormalizedSummary {
  const taxAmount = coerceNumber(summary?.taxAmount) ?? 0
  const subTotal = coerceNumber(summary?.orderSubTotal)
  const orderTotal = coerceNumber(summary?.orderTotal)

  // Compute a fallback subtotal from items if Hyphen didn't send one.
  const computedSubTotal = items.reduce((acc, it) => {
    const line = it.lineTotal ?? (it.requestedUnitPrice ?? 0) * it.quantityOrdered
    return acc + (line || 0)
  }, 0)

  const finalSubTotal = subTotal ?? computedSubTotal
  const finalTotal = orderTotal ?? finalSubTotal + taxAmount

  if (subTotal === null) {
    warnings.push({
      code: 'COMPUTED_SUBTOTAL',
      message: `summary.orderSubTotal missing — computed from line items: ${finalSubTotal.toFixed(2)}`,
      path: 'summary.orderSubTotal',
    })
  }
  if (orderTotal === null) {
    warnings.push({
      code: 'COMPUTED_TOTAL',
      message: `summary.orderTotal missing — computed as subtotal + tax: ${finalTotal.toFixed(2)}`,
      path: 'summary.orderTotal',
    })
  }

  return {
    numberOfLines: coerceNumber(summary?.numberOfLines),
    taxAmount,
    orderSubTotal: finalSubTotal,
    orderTotal: finalTotal,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Coercion helpers
// ──────────────────────────────────────────────────────────────────────────

function trimOrNull(v: any): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s.length > 0 ? s : null
}

function stringifyOrNull(v: any): string | null {
  if (v === null || v === undefined) return null
  const s = String(v)
  return s.length > 0 ? s : null
}

function coerceNumber(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

function coerceBool(v: any): boolean {
  if (v === true || v === 1 || v === '1' || v === 'true' || v === 'Y' || v === 'y') return true
  return false
}

function normalizePurpose(raw: any): string | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  const valid = new Set([
    'Unspecified',
    'Cancellation',
    'Change',
    'Original',
    'Confirmation',
    'Other',
    'Pending',
  ])
  // Case-insensitive match — Hyphen sometimes capitalizes differently.
  for (const v of valid) {
    if (v.toLowerCase() === s.toLowerCase()) return v
  }
  return null
}

// SPConnect v13 §2 enum for header.orderType. Validate inbound values so
// downstream code (PO routing, accounting) doesn't get surprised by a new
// type Hyphen rolls out without warning.
const VALID_ORDER_TYPES = [
  'PurchaseOrder',
  'WorkOrder',
  'Memo',
  'MeasurementPO',
  'ExtraPO',
  'FixedContractPO',
  'NotToExceedEPO',
  'NotToExceedPO',
] as const

function normalizeOrderType(raw: any, warnings: MapperWarning[]): string {
  const s = trimOrNull(raw)
  if (!s) return 'PurchaseOrder'
  // Case-insensitive match — Hyphen has shipped lower-case variants in
  // sandbox payloads at least once.
  for (const v of VALID_ORDER_TYPES) {
    if (v.toLowerCase() === s.toLowerCase()) return v
  }
  warnings.push({
    code: 'UNKNOWN_ORDER_TYPE',
    message: `Unknown header.orderType "${s}" — defaulting to PurchaseOrder`,
    path: 'header.orderType',
  })
  return 'PurchaseOrder'
}
