// ──────────────────────────────────────────────────────────────────────────
// Hyphen SPConnect → Abel normalized shape (shared types)
//
// Pure type definitions for the SPConnect v13 envelope after mapper
// normalization. The mapper produces these; the processor consumes them.
//
// `NormalizedItem` lives in mapper.ts because item-level shaping is owned
// by a separate concern (item alias resolution + line-by-line processing).
// We type-only-import it here so the type lives in one place without
// creating a runtime dependency cycle.
//
// References:
//   Hyphen SPConnect API Specifications v13 §2 (Orders), pages 5-13
//   docs/HYPHEN_SPCONNECT_SETUP.md
// ──────────────────────────────────────────────────────────────────────────

import type { NormalizedItem } from './mapper'

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
