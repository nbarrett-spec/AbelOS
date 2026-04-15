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

export interface NormalizedItem {
  // Hyphen-side identifiers — used for alias lookup
  builderLineItemNum: string | null
  builderSupplierSKU: string | null // primary alias key
  builderAltItemID: string | null
  supplierSKU: string | null // Abel's own SKU if Hyphen already knows it
  itemDescription: string | null

  // Quantities (keep both sides — builder qty is what we're being asked
  // to deliver; supplier qty is the converted amount in our UOM)
  quantityOrdered: number
  unitOfMeasurement: string | null
  supplierQuantity: number | null
  supplierUnitOfMeasurement: string | null

  // Pricing
  requestedUnitPrice: number | null // what builder expects to pay
  supplierUnitPrice: number | null // what we charge (may differ)
  lineTotal: number | null

  // Options / extended fields (carry through for operational context)
  optionColor1: string | null
  optionColor2: string | null
  optionColor3: string | null
  extText1: string | null
  extText2: string | null
  extText3: string | null
  extText4: string | null
  extText5: string | null
  extText6: string | null
  selectionDesc: string | null
  isPackageItem: boolean
  homeSelectionInd: boolean
}

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

  const orderType = trimOrNull(header.orderType) || 'PurchaseOrder'

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

  return {
    builderLineItemNum: stringifyOrNull(item?.builderLineItemNum),
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
  }
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
