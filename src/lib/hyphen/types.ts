// ──────────────────────────────────────────────────────────────────────────
// Hyphen SPConnect → Abel normalized shape (shared types)
//
// Pure type definitions for the SPConnect v13 envelope after mapper
// normalization. The mapper produces these; the processor consumes them.
//
// Item-level types (NormalizedItem + DoorSpecParse) and header-level types
// (NormalizedOrder/Builder/Contact/Job/etc.) all live here so there's exactly
// one source of truth and no risk of import cycles.
//
// References:
//   Hyphen SPConnect API Specifications v13 §2 (Orders), pages 5-13
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

  // Role-based addresses from header.builder.primaryContacts (v13).
  // These are organization-wide inboxes, distinct from individual people.
  // Any may be null in a given envelope — preserve null, never coerce.
  purchasingEmail: string | null
  accountingEmail: string | null
  warrantyEmail: string | null
  eDestinationEmail: string | null
  bidConnectEmail: string | null
  purchasingCcEmail: string | null
}

export interface NormalizedShipping {
  // header.shippingInformation.participantType — e.g. "Job", "Office", "Other".
  // Optional in real envelopes (older SPConnect tenants don't send it).
  participantType: string | null
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

  // v13 additions — preserve null when missing.
  communityCode2: string | null
  communityCode3: string | null
  communityId: string | null
  colorPackage: string | null
  jioId: string | null
  primaryFirstName: string | null
  primaryLastName: string | null
  primaryPhoneNumber: string | null
  primaryFaxNumber: string | null
  primaryEmailAddress: string | null
}

export interface NormalizedTask {
  taskNum: string | null
  name: string | null
  // v13 ships description on the task object — Hyphen uses it for human-
  // readable scope summaries that don't fit on the order header note.
  description: string | null
}

export interface NormalizedHeaderOptionValue {
  name: string | null
  description: string | null
}

export interface NormalizedHeaderOption {
  id: string | null
  name: string | null
  type: string | null
  note: string | null
  values: NormalizedHeaderOptionValue[]
}

export interface NormalizedSummary {
  numberOfLines: number | null
  taxAmount: number
  orderSubTotal: number
  orderTotal: number
}

/**
 * Door-spec fields parsed out of preferences[] / extText[] for door, frame,
 * and trim line items. Each field is null when no confident parse is
 * possible — the goal is column-level queryability for the operations
 * portal, not a perfect parse.
 *
 * - doorSwing  — "LH" | "RH" | "Active" | "Inactive" (left/right or pair leaf)
 * - doorHand   — "Inswing" | "Outswing"
 * - jambDepth  — e.g. "4-9/16", "6-9/16" (string, not numeric — odd
 *                fractions are common and lossy if coerced)
 * - throatDepth — same shape as jambDepth
 */
export interface DoorSpecParse {
  doorSwing: string | null
  doorHand: string | null
  jambDepth: string | null
  throatDepth: string | null
}

/**
 * One line item from a Hyphen SPConnect Order or Change Order envelope,
 * normalized to the shape the processor writes into Abel OrderItem rows.
 *
 * v13 adds the optionColor1-3 / extText1-6 passthrough columns and four
 * mapper-derived door-spec fields (parsed by parseDoorSpecs).
 *
 * builderLineItemNum is bigint to match the Hyphen spec (`bigint`) and the
 * Abel schema column type. The mapper coerces JS numbers → BigInt via
 * BigInt(Math.trunc(n)) so tiny float drift doesn't break the conversion.
 */
export interface NormalizedItem {
  // Hyphen-side identifiers — used for alias lookup
  /** Hyphen line item number, kept as bigint so it round-trips into the
   *  OrderItem.builderLineItemNum BigInt? column without precision loss.
   *  Null when Hyphen omits or the value isn't a number. */
  builderLineItemNum: bigint | null
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
  // v13: these are now first-class columns on OrderItem instead of being
  // folded into the description string only.
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

  // Door-spec fields parsed from preferences[] + extText regexes. Null when
  // unparseable — see parseDoorSpecs() in mapper.ts. Door, frame, and trim
  // line items will populate these; non-door items leave them null.
  doorSwing: string | null
  doorHand: string | null
  jambDepth: string | null
  throatDepth: string | null
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

  // v13 additions — extra account codes (some builders use them as cost
  // centers / sub-account routing keys). Preserve null when missing.
  accountCode2: string | null
  accountCode3: string | null

  builder: NormalizedBuilder
  shipping: NormalizedShipping
  billing: NormalizedBilling
  job: NormalizedJob | null
  task: NormalizedTask | null

  // Header-level options array (per spec §2 header.options[]). May be empty.
  options: NormalizedHeaderOption[]

  // Legacy flat fields — kept for callers that haven't migrated to
  // `task.taskNum` / `task.name`. Mirror task.taskNum and task.name.
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
