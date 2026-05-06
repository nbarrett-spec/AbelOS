// ──────────────────────────────────────────────────────────────────────────
// Hyphen SPConnect → Abel normalized shape — shared types
//
// Pure type module. No runtime imports. Types here are produced by the
// mapper and consumed by the processor + change-order route.
//
// Item-level types (NormalizedItem and its parsed-spec subtype) live here.
// Header-level types (NormalizedOrder/Builder/Contact/Job/etc.) currently
// live alongside the mapper and may migrate here as scope grows.
// ──────────────────────────────────────────────────────────────────────────

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
