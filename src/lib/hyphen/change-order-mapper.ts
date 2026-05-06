// ──────────────────────────────────────────────────────────────────────────
// Hyphen SPConnect Change Order helpers
//
// Pure functions used by processor.ts → processHyphenChangeOrderEvent.
// Mirrors the SPConnect v13 §3 envelope:
//
//   header.id                       Int     // Hyphen system order id
//   header.changeOrderNumber        String  // builder change-order id
//   header.changeOrderSequence      String  // sequence within an order
//   header.changeOrderIssueDate     String  // ISO datetime
//   header.changeType               String  // Reschedule | ChangeInDetail
//                                          // | ChangeInHeadingSection
//                                          // | NotesOnly
//   header.changeOrderHeaderNote    String  // free-text note
//   items[*].changeCode             String  // "ReplaceAllValues" today
//   items[*].originalLineNum        bigint  // line number on parent order
//   items[*].originalItemDetailWith
//                  Changes          object  // full updated line item
//
// This file never touches the DB — only validates + reshapes.
// ──────────────────────────────────────────────────────────────────────────

export type ChangeType =
  | 'Reschedule'
  | 'ChangeInDetail'
  | 'ChangeInHeadingSection'
  | 'NotesOnly'

export type ChangeCode = 'ReplaceAllValues'

export interface ParsedChangeOrderHeader {
  hyphenOrderId: string
  changeOrderNumber: string | null
  changeOrderSequence: string | null
  changeOrderIssueDate: string | null
  changeType: ChangeType | null
  changeTypeRaw: string | null
  builderOrderNumber: string | null
  supplierOrderNumber: string | null
  accountNumber: string | null
  accountCode: string | null
  changeOrderHeaderNote: string | null
  startDate: string | null
  endDate: string | null
  orderHeaderNote: string | null
  deliveryType: string | null
}

export interface ParsedChangeOrderItem {
  changeCode: string | null
  originalLineNum: number | null
  detail: any // raw originalItemDetailWithChanges object
}

// ──────────────────────────────────────────────────────────────────────────
// Header parser
// ──────────────────────────────────────────────────────────────────────────

export function parseChangeOrderHeader(payload: any): ParsedChangeOrderHeader | null {
  if (!payload || typeof payload !== 'object') return null
  const h = payload.header
  if (!h || typeof h !== 'object') return null

  const rawId = h.id
  if (rawId === null || rawId === undefined || rawId === '') return null

  return {
    hyphenOrderId: String(rawId).trim(),
    changeOrderNumber: trimOrNull(h.changeOrderNumber),
    changeOrderSequence: trimOrNull(h.changeOrderSequence),
    changeOrderIssueDate: trimOrNull(h.changeOrderIssueDate),
    changeType: normalizeChangeType(h.changeType),
    changeTypeRaw: trimOrNull(h.changeType),
    builderOrderNumber: trimOrNull(h.builderOrderNumber),
    supplierOrderNumber: trimOrNull(h.supplierOrderNumber),
    accountNumber: trimOrNull(h.accountNumber),
    accountCode: trimOrNull(h.accountCode),
    changeOrderHeaderNote: trimOrNull(h.changeOrderHeaderNote),
    startDate: trimOrNull(h.startDate),
    endDate: trimOrNull(h.endDate),
    orderHeaderNote: trimOrNull(h.orderHeaderNote),
    deliveryType: trimOrNull(h.deliveryType),
  }
}

export function parseChangeOrderItems(payload: any): ParsedChangeOrderItem[] {
  if (!payload || typeof payload !== 'object') return []
  const raw = Array.isArray(payload.items) ? payload.items : []
  return raw.map((it: any) => ({
    changeCode: trimOrNull(it?.changeCode),
    originalLineNum: coerceNumber(it?.originalLineNum),
    detail: it?.originalItemDetailWithChanges ?? null,
  }))
}

// Match `originalLineNum` (number from JSON) to OrderItem.builderLineItemNum
// (BigInt in DB). Spec: bigint. Use Math.trunc to be defensive against floats.
export function toLineNumBigInt(n: number | null): bigint | null {
  if (n === null || n === undefined) return null
  if (!Number.isFinite(n)) return null
  return BigInt(Math.trunc(n))
}

// Case-insensitive change-type match. Returns null on unknown values so the
// caller can warn / reject.
export function normalizeChangeType(raw: any): ChangeType | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim().toLowerCase()
  switch (s) {
    case 'reschedule':
      return 'Reschedule'
    case 'changeindetail':
      return 'ChangeInDetail'
    case 'changeinheadingsection':
      return 'ChangeInHeadingSection'
    case 'notesonly':
      return 'NotesOnly'
    default:
      return null
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Replacement field extractor — used by ChangeInDetail / ReplaceAllValues.
// Mirrors the field set Agent 2 maps from items[*] in /api/hyphen/orders. We
// only return fields that are actually written to OrderItem; description is
// rebuilt by the processor so we expose the raw inputs it needs.
// ──────────────────────────────────────────────────────────────────────────

export interface ItemReplacementFields {
  itemDescription: string | null
  builderSupplierSKU: string | null
  builderAltItemID: string | null
  supplierSKU: string | null
  optionColor1: string | null
  optionColor2: string | null
  optionColor3: string | null
  extText1: string | null
  extText2: string | null
  extText3: string | null
  extText4: string | null
  extText5: string | null
  extText6: string | null
  doorSwing: string | null
  doorHand: string | null
  jambDepth: string | null
  throatDepth: string | null
  requestedUnitPrice: number | null
  total: number | null
  quantityOrdered: number | null
  unitOfMeasurement: string | null
}

export function extractReplacementFields(detail: any): ItemReplacementFields {
  if (!detail || typeof detail !== 'object') {
    return {
      itemDescription: null,
      builderSupplierSKU: null,
      builderAltItemID: null,
      supplierSKU: null,
      optionColor1: null,
      optionColor2: null,
      optionColor3: null,
      extText1: null,
      extText2: null,
      extText3: null,
      extText4: null,
      extText5: null,
      extText6: null,
      doorSwing: null,
      doorHand: null,
      jambDepth: null,
      throatDepth: null,
      requestedUnitPrice: null,
      total: null,
      quantityOrdered: null,
      unitOfMeasurement: null,
    }
  }
  return {
    itemDescription: trimOrNull(detail.itemDescription),
    builderSupplierSKU: trimOrNull(detail.builderSupplierSKU),
    builderAltItemID: trimOrNull(detail.builderAltItemID),
    supplierSKU: trimOrNull(detail.supplierSKU),
    optionColor1: trimOrNull(detail.optionColor1),
    optionColor2: trimOrNull(detail.optionColor2),
    optionColor3: trimOrNull(detail.optionColor3),
    extText1: trimOrNull(detail.extText1),
    extText2: trimOrNull(detail.extText2),
    extText3: trimOrNull(detail.extText3),
    extText4: trimOrNull(detail.extText4),
    extText5: trimOrNull(detail.extText5),
    extText6: trimOrNull(detail.extText6),
    doorSwing: trimOrNull(detail.doorSwing),
    doorHand: trimOrNull(detail.doorHand),
    jambDepth: trimOrNull(detail.jambDepth),
    throatDepth: trimOrNull(detail.throatDepth),
    requestedUnitPrice: coerceNumber(detail.requestedUnitPrice),
    total: coerceNumber(detail.total),
    quantityOrdered: coerceNumber(detail?.builderTotalQuantity?.quantityOrdered),
    unitOfMeasurement: trimOrNull(detail?.builderTotalQuantity?.unitOfMeasurement),
  }
}

// Build a description string consistent with the parent-order item style
// (mirrors processor.buildItemDescription in spirit). Used so the replaced
// OrderItem.description still surfaces colors / extended text.
export function buildReplacementDescription(
  fields: ItemReplacementFields,
  fallbackLineNum: number | null
): string {
  const base =
    fields.itemDescription ||
    fields.builderSupplierSKU ||
    fields.builderAltItemID ||
    (fallbackLineNum !== null ? `Line ${fallbackLineNum}` : 'Line item')
  const colors = [fields.optionColor1, fields.optionColor2, fields.optionColor3]
    .filter(Boolean)
    .join(' / ')
  const ext = [
    fields.extText1,
    fields.extText2,
    fields.extText3,
    fields.extText4,
    fields.extText5,
    fields.extText6,
  ]
    .filter(Boolean)
    .join(' · ')
  const tail = [colors, ext].filter(Boolean).join(' — ')
  return tail ? `${base} (${tail})` : base
}

// ──────────────────────────────────────────────────────────────────────────
// Coercion helpers (kept local to avoid a cross-import w/ mapper.ts which
// Agents 2/4 are editing)
// ──────────────────────────────────────────────────────────────────────────

function trimOrNull(v: any): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s.length > 0 ? s : null
}

function coerceNumber(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}
