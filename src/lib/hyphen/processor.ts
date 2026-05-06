// ──────────────────────────────────────────────────────────────────────────
// Hyphen SPConnect → Abel Order processor
//
// Takes a HyphenOrderEvent row (id) and attempts to create an Abel Order
// from its rawPayload. Splits cleanly into:
//
//   1. load event + parse payload
//   2. mapSpConnectOrderPayload()        → normalized shape (pure)
//   3. resolveBuilder(normalized)         → Abel builderId (via alias)
//   4. resolveItems(normalized.items)     → Abel productIds (via alias)
//   5. create Abel Order + OrderItems     → raw SQL, transactional
//   6. update HyphenOrderEvent status     → PROCESSED + mappedOrderId
//
// Unresolved builder → FAILED with code NO_BUILDER_ALIAS.
// Unresolved product → FAILED with code NO_PRODUCT_ALIAS and the list of
// SKUs that need aliases. The event stays in place and can be retried
// once the operator creates the aliases via /admin/hyphen.
//
// Auto-creates two alias tables: HyphenBuilderAlias and HyphenProductAlias.
// ──────────────────────────────────────────────────────────────────────────

import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { mapSpConnectOrderPayload, NormalizedOrder, NormalizedItem } from './mapper'
import {
  parseChangeOrderHeader,
  parseChangeOrderItems,
  toLineNumBigInt,
  extractReplacementFields,
  buildReplacementDescription,
  ItemReplacementFields,
  ParsedChangeOrderHeader,
} from './change-order-mapper'

let aliasTablesEnsured = false

async function ensureAliasTables() {
  if (aliasTablesEnsured) return
  try {
    // Maps a Hyphen builder GUID or accountCode to an Abel Builder.id.
    // Keyed by aliasType + aliasValue so one Abel builder can have multiple
    // aliases (e.g. Hyphen GUID + human-readable account code).
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "HyphenBuilderAlias" (
        "id" TEXT PRIMARY KEY,
        "aliasType" TEXT NOT NULL,
        "aliasValue" TEXT NOT NULL,
        "builderId" TEXT NOT NULL,
        "note" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE ("aliasType", "aliasValue")
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_hyphenbalias_builder" ON "HyphenBuilderAlias" ("builderId")
    `)

    // Maps a Hyphen builderSupplierSKU or builderAltItemID to an Abel
    // Product.id. Same alias pattern as builders — one Abel product can be
    // reachable via multiple Hyphen identifiers.
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "HyphenProductAlias" (
        "id" TEXT PRIMARY KEY,
        "aliasType" TEXT NOT NULL,
        "aliasValue" TEXT NOT NULL,
        "productId" TEXT NOT NULL,
        "note" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE ("aliasType", "aliasValue")
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_hyphenpalias_product" ON "HyphenProductAlias" ("productId")
    `)

    aliasTablesEnsured = true
  } catch (e) {
    aliasTablesEnsured = true
    logger.error('hyphen_alias_table_ensure_failed', e)
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────────

export type ProcessResult =
  | {
      ok: true
      eventId: string
      orderId: string
      orderNumber: string
      warnings: string[]
    }
  | {
      ok: false
      eventId: string
      errorCode: string
      errorMessage: string
      unresolvedBuilder?: { hyphenBuilderId: string | null; accountCode: string | null }
      unresolvedSkus?: Array<{ lineNum: number | null; sku: string | null; altId: string | null; description: string | null }>
      warnings: string[]
    }

// ──────────────────────────────────────────────────────────────────────────
// Alias resolvers (and management helpers used by admin API)
// ──────────────────────────────────────────────────────────────────────────

export async function resolveBuilderAlias(
  hyphenBuilderId: string | null,
  accountCode: string | null
): Promise<string | null> {
  await ensureAliasTables()
  // Try GUID first (most specific), then accountCode.
  const candidates: Array<{ type: string; value: string }> = []
  if (hyphenBuilderId) candidates.push({ type: 'hyphenBuilderId', value: hyphenBuilderId })
  if (accountCode) candidates.push({ type: 'accountCode', value: accountCode })
  for (const c of candidates) {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "builderId" FROM "HyphenBuilderAlias" WHERE "aliasType" = $1 AND "aliasValue" = $2 LIMIT 1`,
      c.type,
      c.value
    )
    if (rows.length > 0) return rows[0].builderId
  }
  return null
}

export async function resolveProductAlias(
  builderSupplierSKU: string | null,
  builderAltItemID: string | null,
  supplierSKU: string | null
): Promise<string | null> {
  await ensureAliasTables()

  // 1. Abel's own supplierSKU is the best signal — match directly against Product.sku
  if (supplierSKU) {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Product" WHERE "sku" = $1 LIMIT 1`,
      supplierSKU
    )
    if (rows.length > 0) return rows[0].id
  }

  // 2. builderSupplierSKU via alias table
  if (builderSupplierSKU) {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "productId" FROM "HyphenProductAlias" WHERE "aliasType" = $1 AND "aliasValue" = $2 LIMIT 1`,
      'builderSupplierSKU',
      builderSupplierSKU
    )
    if (rows.length > 0) return rows[0].productId
    // Also try matching builderSupplierSKU directly against Product.sku as a last resort
    const direct: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Product" WHERE "sku" = $1 LIMIT 1`,
      builderSupplierSKU
    )
    if (direct.length > 0) return direct[0].id
  }

  // 3. builderAltItemID via alias table
  if (builderAltItemID) {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "productId" FROM "HyphenProductAlias" WHERE "aliasType" = $1 AND "aliasValue" = $2 LIMIT 1`,
      'builderAltItemID',
      builderAltItemID
    )
    if (rows.length > 0) return rows[0].productId
  }

  return null
}

export interface HyphenBuilderAliasInput {
  aliasType: 'hyphenBuilderId' | 'accountCode'
  aliasValue: string
  builderId: string
  note?: string
}

export async function upsertBuilderAlias(input: HyphenBuilderAliasInput): Promise<{ id: string }> {
  await ensureAliasTables()
  const id = 'hba_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex')
  await prisma.$executeRawUnsafe(
    `INSERT INTO "HyphenBuilderAlias" ("id", "aliasType", "aliasValue", "builderId", "note", "createdAt")
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT ("aliasType", "aliasValue") DO UPDATE
       SET "builderId" = EXCLUDED."builderId", "note" = EXCLUDED."note"`,
    id,
    input.aliasType,
    input.aliasValue,
    input.builderId,
    input.note || null
  )
  return { id }
}

export interface HyphenProductAliasInput {
  aliasType: 'builderSupplierSKU' | 'builderAltItemID'
  aliasValue: string
  productId: string
  note?: string
}

export async function upsertProductAlias(input: HyphenProductAliasInput): Promise<{ id: string }> {
  await ensureAliasTables()
  const id = 'hpa_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex')
  await prisma.$executeRawUnsafe(
    `INSERT INTO "HyphenProductAlias" ("id", "aliasType", "aliasValue", "productId", "note", "createdAt")
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT ("aliasType", "aliasValue") DO UPDATE
       SET "productId" = EXCLUDED."productId", "note" = EXCLUDED."note"`,
    id,
    input.aliasType,
    input.aliasValue,
    input.productId,
    input.note || null
  )
  return { id }
}

export async function listBuilderAliases(): Promise<any[]> {
  await ensureAliasTables()
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT a."id", a."aliasType", a."aliasValue", a."builderId", a."note", a."createdAt",
            b."companyName" as "builderCompanyName"
     FROM "HyphenBuilderAlias" a
     LEFT JOIN "Builder" b ON b."id" = a."builderId"
     ORDER BY a."createdAt" DESC`
  )
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt?.toISOString?.() || r.createdAt,
  }))
}

export async function listProductAliases(): Promise<any[]> {
  await ensureAliasTables()
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT a."id", a."aliasType", a."aliasValue", a."productId", a."note", a."createdAt",
            p."sku" as "productSku", p."name" as "productName"
     FROM "HyphenProductAlias" a
     LEFT JOIN "Product" p ON p."id" = a."productId"
     ORDER BY a."createdAt" DESC`
  )
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt?.toISOString?.() || r.createdAt,
  }))
}

// ──────────────────────────────────────────────────────────────────────────
// Event loader + processor
// ──────────────────────────────────────────────────────────────────────────

async function loadEvent(eventId: string): Promise<{
  id: string
  kind: string
  externalId: string | null
  builderOrderNumber: string | null
  status: string
  rawPayload: any
  mappedOrderId: string | null
} | null> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id", "kind", "externalId", "builderOrderNumber", "status", "rawPayload", "mappedOrderId"
     FROM "HyphenOrderEvent" WHERE "id" = $1 LIMIT 1`,
    eventId
  )
  if (rows.length === 0) return null
  return rows[0]
}

async function markEventProcessed(eventId: string, orderId: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "HyphenOrderEvent"
       SET "status" = 'PROCESSED',
           "mappedOrderId" = $1,
           "error" = NULL,
           "processedAt" = NOW()
     WHERE "id" = $2`,
    orderId,
    eventId
  )
}

async function markEventFailed(eventId: string, error: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "HyphenOrderEvent"
       SET "status" = 'FAILED',
           "error" = $1,
           "processedAt" = NOW()
     WHERE "id" = $2`,
    error,
    eventId
  )
}

/**
 * Check for an existing Abel Order that was already mapped from a previous
 * delivery of the same Hyphen order (same external id). Lets us no-op on
 * retries instead of double-creating.
 */
async function findExistingMappedOrder(externalId: string, excludeEventId: string): Promise<string | null> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "mappedOrderId" FROM "HyphenOrderEvent"
     WHERE "externalId" = $1 AND "mappedOrderId" IS NOT NULL AND "id" <> $2
     ORDER BY "processedAt" DESC LIMIT 1`,
    externalId,
    excludeEventId
  )
  if (rows.length > 0 && rows[0].mappedOrderId) return rows[0].mappedOrderId
  return null
}

/**
 * Main entry point. Call this after recordHyphenEvent() to drive the
 * envelope through the mapper and into Abel's Order table.
 */
export async function processHyphenOrderEvent(eventId: string): Promise<ProcessResult> {
  const event = await loadEvent(eventId)
  if (!event) {
    return {
      ok: false,
      eventId,
      errorCode: 'EVENT_NOT_FOUND',
      errorMessage: `HyphenOrderEvent ${eventId} not found`,
      warnings: [],
    }
  }

  // Only process orders. changeOrder processing is Phase 2.5.
  if (event.kind !== 'order') {
    await markEventFailed(eventId, `Kind "${event.kind}" is not handled by order processor`)
    return {
      ok: false,
      eventId,
      errorCode: 'WRONG_KIND',
      errorMessage: `Processor only handles kind=order, got ${event.kind}`,
      warnings: [],
    }
  }

  // Idempotency: if this external id was already mapped to an Abel order,
  // reuse that id instead of creating a duplicate.
  if (event.externalId) {
    const existing = await findExistingMappedOrder(event.externalId, eventId)
    if (existing) {
      await markEventProcessed(eventId, existing)
      return {
        ok: true,
        eventId,
        orderId: existing,
        orderNumber: '(existing)',
        warnings: [`Idempotent replay — reusing existing Abel order ${existing}`],
      }
    }
  }

  // 1. Map
  const mapped = mapSpConnectOrderPayload(event.rawPayload)
  if (!mapped.ok || !mapped.order) {
    const errMsg = mapped.errors.map((e) => `[${e.code}] ${e.message}`).join('; ')
    await markEventFailed(eventId, errMsg || 'Mapper rejected payload')
    return {
      ok: false,
      eventId,
      errorCode: 'MAPPER_REJECTED',
      errorMessage: errMsg,
      warnings: mapped.warnings.map((w) => `[${w.code}] ${w.message}`),
    }
  }

  const normalized = mapped.order
  const warnings = mapped.warnings.map((w) => `[${w.code}] ${w.message}`)

  // 2. Resolve builder
  const builderId = await resolveBuilderAlias(
    normalized.builder.hyphenBuilderId,
    normalized.builder.accountCode
  )
  if (!builderId) {
    const errMsg =
      `No HyphenBuilderAlias for hyphenBuilderId=${normalized.builder.hyphenBuilderId || 'n/a'}, ` +
      `accountCode=${normalized.builder.accountCode || 'n/a'}`
    await markEventFailed(eventId, errMsg)
    return {
      ok: false,
      eventId,
      errorCode: 'NO_BUILDER_ALIAS',
      errorMessage: errMsg,
      unresolvedBuilder: {
        hyphenBuilderId: normalized.builder.hyphenBuilderId,
        accountCode: normalized.builder.accountCode,
      },
      warnings,
    }
  }

  // 3. Resolve all products up-front. Fail the whole order if any miss —
  //    partial creation would leave a bad state and the user can't
  //    meaningfully edit an Abel order with missing lines.
  const resolvedItems: Array<{ item: NormalizedItem; productId: string; lineNum: number }> = []
  const unresolved: Array<{ lineNum: number | null; sku: string | null; altId: string | null; description: string | null }> = []

  for (let i = 0; i < normalized.items.length; i++) {
    const item = normalized.items[i]
    const productId = await resolveProductAlias(
      item.builderSupplierSKU,
      item.builderAltItemID,
      item.supplierSKU
    )
    if (!productId) {
      unresolved.push({
        lineNum: item.builderLineItemNum ? Number(item.builderLineItemNum) : i + 1,
        sku: item.builderSupplierSKU,
        altId: item.builderAltItemID,
        description: item.itemDescription,
      })
    } else {
      resolvedItems.push({ item, productId, lineNum: i + 1 })
    }
  }

  if (unresolved.length > 0) {
    const errMsg =
      `${unresolved.length} line item(s) have no HyphenProductAlias: ` +
      unresolved
        .map((u) => `#${u.lineNum} ${u.sku || u.altId || '(no sku)'}`)
        .join(', ')
    await markEventFailed(eventId, errMsg)
    return {
      ok: false,
      eventId,
      errorCode: 'NO_PRODUCT_ALIAS',
      errorMessage: errMsg,
      unresolvedSkus: unresolved,
      warnings,
    }
  }

  // 4. Create the Abel Order + OrderItems (raw SQL to match /api/ops/orders pattern)
  try {
    const created = await createAbelOrderFromNormalized(normalized, builderId, resolvedItems)
    await markEventProcessed(eventId, created.orderId)
    return {
      ok: true,
      eventId,
      orderId: created.orderId,
      orderNumber: created.orderNumber,
      warnings,
    }
  } catch (e: any) {
    const errMsg = e?.message || 'Failed to create Abel Order'
    logger.error('hyphen_order_create_failed', e, { eventId })
    await markEventFailed(eventId, errMsg)
    return {
      ok: false,
      eventId,
      errorCode: 'ORDER_CREATE_FAILED',
      errorMessage: errMsg,
      warnings,
    }
  }
}

/**
 * Reprocess a previously-failed (or processed) event. Wipes the existing
 * mappedOrderId / error on the event row, then runs processHyphenOrderEvent.
 * Does NOT delete any previously-created Abel order — the idempotency path
 * will reuse it if the external id already has a mapping.
 */
export async function reprocessHyphenOrderEvent(eventId: string): Promise<ProcessResult> {
  await prisma.$executeRawUnsafe(
    `UPDATE "HyphenOrderEvent" SET "status" = 'RECEIVED', "error" = NULL WHERE "id" = $1`,
    eventId
  )
  return processHyphenOrderEvent(eventId)
}

/**
 * Fetch the raw payload for an event — used by the admin "View Payload"
 * modal. Returns null if the event doesn't exist.
 */
export async function getHyphenEventPayload(
  eventId: string
): Promise<{ id: string; rawPayload: any; kind: string; status: string; error: string | null } | null> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id", "kind", "status", "error", "rawPayload" FROM "HyphenOrderEvent" WHERE "id" = $1 LIMIT 1`,
    eventId
  )
  if (rows.length === 0) return null
  return rows[0]
}

// ──────────────────────────────────────────────────────────────────────────
// Change Order processor (SPConnect v13 §3)
//
// Different shape from processHyphenOrderEvent on purpose — change orders
// modify an existing Abel Order rather than creating one, so the result
// communicates partial-line-failures via unresolvedSkus + warnings without
// needing the full builder/mapper handshake.
// ──────────────────────────────────────────────────────────────────────────

export interface ChangeOrderProcessResult {
  success: boolean
  mappedOrderId: string | null
  errorCode?: string
  errorMessage?: string
  warnings: string[]
  unresolvedSkus: Array<{
    lineNum: number | null
    sku: string | null
    description: string | null
  }>
  changeType?: string | null
}

/**
 * Process an inbound Hyphen Change Order envelope.
 *
 * Flow:
 *   1. Load HyphenOrderEvent + assert kind=changeOrder.
 *   2. Parse header / items via change-order-mapper.
 *   3. Resolve the parent Abel Order via three-stage fallback:
 *      a. Order.inflowOrderId === header.builderOrderNumber
 *      b. Order.poNumber === header.builderOrderNumber
 *      c. prior HyphenOrderEvent (kind=order, builderOrderNumber match) →
 *         follow mappedOrderId
 *   4. Branch on header.changeType (case-insensitive):
 *        Reschedule              → update Order.deliveryDate from end/startDate
 *        ChangeInDetail          → walk items[], match OrderItem.builderLineItemNum
 *                                  to originalLineNum (BigInt), apply changeCode
 *                                  (default ReplaceAllValues — replace all fields
 *                                  from originalItemDetailWithChanges)
 *        ChangeInHeadingSection  → update Order header-level fields (notes,
 *                                  delivery dates, account info)
 *        NotesOnly               → append changeOrderHeaderNote to Order.deliveryNotes
 *        Unknown                 → return errorCode UNKNOWN_CHANGE_TYPE
 *   5. Wrap DB writes in a transaction.
 *   6. Update HyphenOrderEvent.status (MAPPED on success, FAILED on error).
 */
export async function processHyphenChangeOrderEvent(
  eventId: string
): Promise<ChangeOrderProcessResult> {
  const warnings: string[] = []
  const unresolvedSkus: ChangeOrderProcessResult['unresolvedSkus'] = []

  // 1. Load event + verify kind
  const event = await loadEvent(eventId)
  if (!event) {
    return {
      success: false,
      mappedOrderId: null,
      errorCode: 'EVENT_NOT_FOUND',
      errorMessage: `HyphenOrderEvent ${eventId} not found`,
      warnings,
      unresolvedSkus,
    }
  }

  if (event.kind !== 'changeOrder') {
    await markChangeOrderFailed(eventId, `Kind "${event.kind}" is not a changeOrder`)
    return {
      success: false,
      mappedOrderId: null,
      errorCode: 'WRONG_KIND',
      errorMessage: `processHyphenChangeOrderEvent only handles kind=changeOrder, got ${event.kind}`,
      warnings,
      unresolvedSkus,
    }
  }

  // 2. Parse header
  const header = parseChangeOrderHeader(event.rawPayload)
  if (!header) {
    await markChangeOrderFailed(eventId, 'Missing or malformed change-order header')
    return {
      success: false,
      mappedOrderId: null,
      errorCode: 'MISSING_HEADER',
      errorMessage: 'Change order payload has no header.id',
      warnings,
      unresolvedSkus,
    }
  }

  // 3. Resolve parent order
  const parentOrderId = await findParentOrderId(header)
  if (!parentOrderId) {
    const msg = `No parent Abel Order found for builderOrderNumber=${header.builderOrderNumber || 'n/a'}, supplierOrderNumber=${header.supplierOrderNumber || 'n/a'}, hyphenOrderId=${header.hyphenOrderId}`
    await markChangeOrderFailed(eventId, msg)
    return {
      success: false,
      mappedOrderId: null,
      errorCode: 'PARENT_ORDER_NOT_FOUND',
      errorMessage: msg,
      warnings,
      unresolvedSkus,
      changeType: header.changeTypeRaw,
    }
  }

  // 4. Branch on changeType
  if (header.changeType === null) {
    const msg = `Unknown changeType "${header.changeTypeRaw || 'null'}"`
    await markChangeOrderFailed(eventId, msg)
    return {
      success: false,
      mappedOrderId: parentOrderId,
      errorCode: 'UNKNOWN_CHANGE_TYPE',
      errorMessage: msg,
      warnings,
      unresolvedSkus,
      changeType: header.changeTypeRaw,
    }
  }

  // 5. Apply the change inside a transaction
  try {
    await prisma.$transaction(async (tx) => {
      switch (header.changeType) {
        case 'Reschedule': {
          await applyReschedule(tx, parentOrderId, header, warnings)
          break
        }
        case 'ChangeInDetail': {
          const items = parseChangeOrderItems(event.rawPayload)
          await applyChangeInDetail(tx, parentOrderId, items, warnings, unresolvedSkus)
          break
        }
        case 'ChangeInHeadingSection': {
          await applyChangeInHeading(tx, parentOrderId, header, warnings)
          break
        }
        case 'NotesOnly': {
          await applyNotesOnly(tx, parentOrderId, header, warnings)
          break
        }
      }
    })
  } catch (e: any) {
    const msg = e?.message || 'Change order transaction failed'
    logger.error('hyphen_change_order_apply_failed', e, { eventId, parentOrderId })
    await markChangeOrderFailed(eventId, msg)
    return {
      success: false,
      mappedOrderId: parentOrderId,
      errorCode: 'TRANSACTION_FAILED',
      errorMessage: msg,
      warnings,
      unresolvedSkus,
      changeType: header.changeTypeRaw,
    }
  }

  await markChangeOrderProcessed(eventId, parentOrderId)
  return {
    success: true,
    mappedOrderId: parentOrderId,
    warnings,
    unresolvedSkus,
    changeType: header.changeTypeRaw,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Change-order helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Look up the parent Abel Order id for a change order. Tries three sources
 * in order: Order.inflowOrderId, Order.poNumber, then the previously-mapped
 * order from a prior HyphenOrderEvent (kind=order) with the same
 * builderOrderNumber.
 */
async function findParentOrderId(
  header: ParsedChangeOrderHeader
): Promise<string | null> {
  const bon = header.builderOrderNumber
  const son = header.supplierOrderNumber

  // (a) inflowOrderId match — supplierOrderNumber is the most direct way
  // back to an Abel order that already round-tripped through InFlow.
  if (son) {
    const r1: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Order" WHERE "inflowOrderId" = $1 LIMIT 1`,
      son
    )
    if (r1.length > 0) return r1[0].id
  }
  if (bon) {
    const r1b: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Order" WHERE "inflowOrderId" = $1 LIMIT 1`,
      bon
    )
    if (r1b.length > 0) return r1b[0].id
  }

  // (b) poNumber — the natural "builderOrderNumber" home in our schema.
  if (bon) {
    const r2: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Order" WHERE "poNumber" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      bon
    )
    if (r2.length > 0) return r2[0].id
  }

  // (c) Earlier HyphenOrderEvent (kind=order) → mappedOrderId.
  if (bon) {
    const r3: any[] = await prisma.$queryRawUnsafe(
      `SELECT "mappedOrderId" FROM "HyphenOrderEvent"
       WHERE "kind" = 'order' AND "builderOrderNumber" = $1
         AND "mappedOrderId" IS NOT NULL
       ORDER BY "receivedAt" DESC LIMIT 1`,
      bon
    )
    if (r3.length > 0 && r3[0].mappedOrderId) return r3[0].mappedOrderId
  }

  // Last resort: prior event with the same Hyphen header.id (externalId)
  if (header.hyphenOrderId) {
    const r4: any[] = await prisma.$queryRawUnsafe(
      `SELECT "mappedOrderId" FROM "HyphenOrderEvent"
       WHERE "kind" = 'order' AND "externalId" = $1
         AND "mappedOrderId" IS NOT NULL
       ORDER BY "receivedAt" DESC LIMIT 1`,
      header.hyphenOrderId
    )
    if (r4.length > 0 && r4[0].mappedOrderId) return r4[0].mappedOrderId
  }

  return null
}

async function applyReschedule(
  tx: any,
  orderId: string,
  header: ParsedChangeOrderHeader,
  warnings: string[]
): Promise<void> {
  // Prefer endDate (delivery date), fall back to startDate.
  const target = header.endDate || header.startDate
  const iso = target ? safeDateIso(target) : null
  if (!iso) {
    warnings.push('[RESCHEDULE_NO_DATE] header.startDate / endDate missing or unparseable — deliveryDate left unchanged')
    return
  }
  await tx.$executeRawUnsafe(
    `UPDATE "Order" SET "deliveryDate" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
    iso,
    orderId
  )
}

async function applyChangeInDetail(
  tx: any,
  orderId: string,
  items: ReturnType<typeof parseChangeOrderItems>,
  warnings: string[],
  unresolvedSkus: ChangeOrderProcessResult['unresolvedSkus']
): Promise<void> {
  if (items.length === 0) {
    warnings.push('[NO_ITEMS] ChangeInDetail envelope had no items[] — nothing applied')
    return
  }

  for (const it of items) {
    const lineNumBig = toLineNumBigInt(it.originalLineNum)
    if (lineNumBig === null) {
      warnings.push(`[INVALID_LINE_NUM] originalLineNum missing or not numeric — skipping`)
      continue
    }

    const code = (it.changeCode || '').trim()
    const codeLc = code.toLowerCase()
    if (code && codeLc !== 'replaceallvalues') {
      // Unknown changeCode — fall back to ReplaceAllValues but flag it so the
      // operator can audit. Spec only documents ReplaceAllValues today.
      warnings.push(
        `[UNKNOWN_CHANGE_CODE] changeCode "${code}" not recognized — falling back to ReplaceAllValues for line ${it.originalLineNum}`
      )
    }

    const fields = extractReplacementFields(it.detail)

    // Find the matching OrderItem by parent + builderLineItemNum (BigInt).
    const rows: any[] = await tx.$queryRawUnsafe(
      `SELECT "id" FROM "OrderItem"
       WHERE "orderId" = $1 AND "builderLineItemNum" = $2::bigint
       LIMIT 1`,
      orderId,
      lineNumBig.toString()
    )
    if (rows.length === 0) {
      warnings.push(`[NO_MATCHING_LINE] No OrderItem with builderLineItemNum=${it.originalLineNum} on parent order`)
      unresolvedSkus.push({
        lineNum: it.originalLineNum,
        sku: fields.builderSupplierSKU || fields.builderAltItemID || fields.supplierSKU,
        description: fields.itemDescription,
      })
      continue
    }

    const orderItemId = rows[0].id
    await replaceOrderItemFromChange(tx, orderItemId, fields, it.originalLineNum)
  }
}

async function replaceOrderItemFromChange(
  tx: any,
  orderItemId: string,
  fields: ItemReplacementFields,
  lineNum: number | null
): Promise<void> {
  const description = buildReplacementDescription(fields, lineNum)
  const unitPrice = fields.requestedUnitPrice ?? 0
  const qty = fields.quantityOrdered !== null
    ? Math.max(1, Math.round(fields.quantityOrdered))
    : null
  const lineTotal =
    fields.total ?? (fields.quantityOrdered !== null ? unitPrice * fields.quantityOrdered : null)

  // Update the writable OrderItem fields. quantity is required (NOT NULL) in
  // schema, so only update it when we have a value.
  if (qty !== null) {
    await tx.$executeRawUnsafe(
      `UPDATE "OrderItem"
         SET "description" = $1,
             "unitPrice"   = $2,
             "lineTotal"   = COALESCE($3, "lineTotal"),
             "quantity"    = $4
       WHERE "id" = $5`,
      description,
      unitPrice,
      lineTotal,
      qty,
      orderItemId
    )
  } else {
    await tx.$executeRawUnsafe(
      `UPDATE "OrderItem"
         SET "description" = $1,
             "unitPrice"   = $2,
             "lineTotal"   = COALESCE($3, "lineTotal")
       WHERE "id" = $4`,
      description,
      unitPrice,
      lineTotal,
      orderItemId
    )
  }
}

async function applyChangeInHeading(
  tx: any,
  orderId: string,
  header: ParsedChangeOrderHeader,
  warnings: string[]
): Promise<void> {
  // Header-level fields the change envelope can affect on the parent Order:
  //   poNumber             ← header.builderOrderNumber (rare but possible)
  //   deliveryDate         ← header.endDate
  //   deliveryNotes        ← appended with new orderHeaderNote / changeOrderHeaderNote
  const setClauses: string[] = []
  const params: any[] = []
  let p = 1

  if (header.builderOrderNumber) {
    setClauses.push(`"poNumber" = $${p++}`)
    params.push(header.builderOrderNumber)
  }
  if (header.endDate) {
    const iso = safeDateIso(header.endDate)
    if (iso) {
      setClauses.push(`"deliveryDate" = $${p++}`)
      params.push(iso)
    }
  }

  // Append narrative notes if present.
  const noteFragments: string[] = []
  if (header.orderHeaderNote) noteFragments.push(`Order note: ${header.orderHeaderNote}`)
  if (header.changeOrderHeaderNote) noteFragments.push(`Change note: ${header.changeOrderHeaderNote}`)
  if (header.changeOrderNumber) noteFragments.push(`Change order: ${header.changeOrderNumber}`)
  if (noteFragments.length > 0) {
    setClauses.push(
      `"deliveryNotes" = COALESCE("deliveryNotes" || E'\\n', '') || $${p++}`
    )
    params.push(noteFragments.join('\n'))
  }

  if (setClauses.length === 0) {
    warnings.push('[HEADING_NO_FIELDS] ChangeInHeadingSection had no recognized fields to apply')
    return
  }

  setClauses.push(`"updatedAt" = NOW()`)
  params.push(orderId)
  const sql = `UPDATE "Order" SET ${setClauses.join(', ')} WHERE "id" = $${p}`
  await tx.$executeRawUnsafe(sql, ...params)
}

async function applyNotesOnly(
  tx: any,
  orderId: string,
  header: ParsedChangeOrderHeader,
  warnings: string[]
): Promise<void> {
  const note = header.changeOrderHeaderNote || header.orderHeaderNote
  if (!note) {
    warnings.push('[NOTES_ONLY_EMPTY] NotesOnly change order had no note text — nothing appended')
    return
  }
  const tag = header.changeOrderNumber ? `[CO ${header.changeOrderNumber}] ` : '[CO] '
  await tx.$executeRawUnsafe(
    `UPDATE "Order"
       SET "deliveryNotes" = COALESCE("deliveryNotes" || E'\\n', '') || $1,
           "updatedAt" = NOW()
     WHERE "id" = $2`,
    tag + note,
    orderId
  )
}

async function markChangeOrderProcessed(
  eventId: string,
  parentOrderId: string
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "HyphenOrderEvent"
       SET "status" = 'MAPPED',
           "mappedOrderId" = $1,
           "error" = NULL,
           "processedAt" = NOW()
     WHERE "id" = $2`,
    parentOrderId,
    eventId
  )
}

async function markChangeOrderFailed(eventId: string, error: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "HyphenOrderEvent"
       SET "status" = 'FAILED',
           "error" = $1,
           "processedAt" = NOW()
     WHERE "id" = $2`,
    error,
    eventId
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Abel Order creation (raw SQL, mirrors src/app/api/ops/orders pattern)
// ──────────────────────────────────────────────────────────────────────────

async function createAbelOrderFromNormalized(
  order: NormalizedOrder,
  builderId: string,
  resolvedItems: Array<{ item: NormalizedItem; productId: string; lineNum: number }>
): Promise<{ orderId: string; orderNumber: string }> {
  // Generate orderNumber: ORD-YYYY-NNNN (matches /api/ops/orders style)
  const year = new Date().getFullYear()
  const lastOrderResult: any[] = await prisma.$queryRawUnsafe(
    `SELECT "orderNumber" FROM "Order" WHERE "orderNumber" LIKE $1 ORDER BY "orderNumber" DESC LIMIT 1`,
    `ORD-${year}-%`
  )
  let nextNumber = 1
  if (lastOrderResult.length > 0) {
    const last = lastOrderResult[0].orderNumber as string
    const parts = last.split('-')
    const parsed = parseInt(parts[2] || '0', 10)
    if (Number.isFinite(parsed)) nextNumber = parsed + 1
  }
  const orderNumber = `ORD-${year}-${String(nextNumber).padStart(4, '0')}`

  // Look up payment term from Builder
  const builderRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "paymentTerm" FROM "Builder" WHERE "id" = $1 LIMIT 1`,
    builderId
  )
  const paymentTerm = builderRows[0]?.paymentTerm || 'NET_15'

  const orderId = 'ord_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex')

  // Build deliveryNotes from all the narrative fields Hyphen sent. This
  // preserves operational context that doesn't fit the Order schema.
  const deliveryNotes = buildDeliveryNotes(order)
  const deliveryDate = order.endDate ? safeDateIso(order.endDate) : null

  await prisma.$executeRawUnsafe(
    `INSERT INTO "Order" (
       "id", "orderNumber", "builderId", "subtotal", "taxAmount", "shippingCost", "total",
       "paymentTerm", "paymentStatus", "status", "poNumber",
       "deliveryDate", "deliveryNotes", "createdAt", "updatedAt"
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::"PaymentTerm", $9::"PaymentStatus", $10::"OrderStatus", $11, $12, $13, NOW(), NOW())`,
    orderId,
    orderNumber,
    builderId,
    order.summary.orderSubTotal,
    order.summary.taxAmount,
    0,
    order.summary.orderTotal,
    paymentTerm,
    'PENDING',
    'RECEIVED',
    order.builderOrderNumber || null,
    deliveryDate,
    deliveryNotes
  )

  // Insert order items
  for (const { item, productId, lineNum } of resolvedItems) {
    const itemId = 'oi_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex')
    const unitPrice = item.requestedUnitPrice ?? item.supplierUnitPrice ?? 0
    const lineTotal = item.lineTotal ?? unitPrice * item.quantityOrdered
    const description = buildItemDescription(item, lineNum)
    const qty = Math.max(1, Math.round(item.quantityOrdered)) // OrderItem.quantity is Int
    await prisma.$executeRawUnsafe(
      `INSERT INTO "OrderItem" ("id", "orderId", "productId", "description", "quantity", "unitPrice", "lineTotal")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      itemId,
      orderId,
      productId,
      description,
      qty,
      unitPrice,
      lineTotal
    )
  }

  // ── Create or enrich Job record with address from Hyphen job data ──
  if (order.job) {
    const job = order.job
    const jobAddr = [job.street, job.city, job.stateCode, job.postalCode]
      .filter(Boolean)
      .join(', ')
    const shippingAddr = order.shipping?.address
      ? [order.shipping.address.street, order.shipping.address.city,
         order.shipping.address.stateCode, order.shipping.address.postalCode]
        .filter(Boolean)
        .join(', ')
      : null
    const address = jobAddr || shippingAddr || null
    const community = job.subdivision || job.communityCode || null
    const lotBlock = [job.lot, job.block].filter(Boolean).join('/')

    if (address || community) {
      try {
        // Try to find existing job by community+lot or order
        const existingJob: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "Job"
           WHERE "orderId" = $1
              OR ("community" ILIKE $2 AND "lotBlock" = $3 AND $2 IS NOT NULL AND $3 != '')
           LIMIT 1`,
          orderId,
          community ? `%${community}%` : null,
          lotBlock || ''
        )

        if (existingJob.length > 0) {
          // Enrich existing job with Hyphen address data
          await prisma.$executeRawUnsafe(
            `UPDATE "Job" SET
              "jobAddress" = COALESCE(NULLIF($1, ''), "jobAddress"),
              "community" = COALESCE(NULLIF($2, ''), "community"),
              "lotBlock" = COALESCE(NULLIF($3, ''), "lotBlock"),
              "hyphenJobId" = COALESCE($4, "hyphenJobId"),
              "updatedAt" = NOW()
            WHERE "id" = $5`,
            address,
            community,
            lotBlock || null,
            order.hyphenOrderId,
            existingJob[0].id
          )
        } else if (address) {
          // Create a new Job linked to this Hyphen order
          const jobId = 'job_hyp_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex')
          const jobNumber = `JOB-HYP-${(job.jobNum || order.hyphenOrderId || '').toString().slice(-6).toUpperCase()}`
          await prisma.$executeRawUnsafe(
            `INSERT INTO "Job" (
              "id", "jobNumber", "orderId", "hyphenJobId",
              "builderName", "jobAddress", "community", "lotBlock",
              "scopeType", "status",
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, $4,
              (SELECT "companyName" FROM "Builder" WHERE "id" = $5 LIMIT 1),
              $6, $7, $8,
              'FULL_PACKAGE'::"ScopeType", 'CREATED'::"JobStatus",
              NOW(), NOW()
            )`,
            jobId, jobNumber, orderId, order.hyphenOrderId,
            builderId,
            address, community, lotBlock || null
          )
        }
      } catch (jobErr: any) {
        // Non-fatal — log but don't fail the order
        logger.error('hyphen_job_enrich_failed', jobErr, { orderId })
      }
    }
  }

  return { orderId, orderNumber }
}

function buildDeliveryNotes(order: NormalizedOrder): string {
  const parts: string[] = []
  parts.push(`Hyphen ID: ${order.hyphenOrderId}`)
  if (order.purpose && order.purpose !== 'Original') parts.push(`Purpose: ${order.purpose}`)
  if (order.orderType && order.orderType !== 'PurchaseOrder') parts.push(`Type: ${order.orderType}`)
  if (order.taskNum) parts.push(`Task: ${order.taskNum}${order.taskName ? ` — ${order.taskName}` : ''}`)
  if (order.job) {
    if (order.job.jobNum) parts.push(`Job: ${order.job.jobNum}${order.job.name ? ` (${order.job.name})` : ''}`)
    if (order.job.lot || order.job.block) {
      parts.push(`Lot/Block: ${order.job.lot || '-'}/${order.job.block || '-'}`)
    }
    if (order.job.plan) parts.push(`Plan: ${order.job.plan}${order.job.elevation ? ` ${order.job.elevation}` : ''}`)
    if (order.job.subdivision) parts.push(`Subdivision: ${order.job.subdivision}`)
    if (order.job.permitNumber) parts.push(`Permit: ${order.job.permitNumber}`)
    const addr = [order.job.street, order.job.city, order.job.stateCode, order.job.postalCode]
      .filter(Boolean)
      .join(', ')
    if (addr) parts.push(`Address: ${addr}`)
  }
  if (order.deliveryType && order.deliveryType.toLowerCase() !== 'null') parts.push(`Delivery: ${order.deliveryType}`)
  if (order.orderHeaderNote) parts.push(`Note: ${order.orderHeaderNote}`)
  return parts.join('\n')
}

function buildItemDescription(item: NormalizedItem, lineNum: number): string {
  const base = item.itemDescription || item.builderSupplierSKU || item.builderAltItemID || `Line ${lineNum}`
  const colors = [item.optionColor1, item.optionColor2, item.optionColor3].filter(Boolean).join(' / ')
  const ext = [item.extText1, item.extText2, item.extText3, item.extText4, item.extText5, item.extText6]
    .filter(Boolean)
    .join(' · ')
  const tail = [colors, ext].filter(Boolean).join(' — ')
  return tail ? `${base} (${tail})` : base
}

function safeDateIso(input: string): string | null {
  try {
    const d = new Date(input)
    if (Number.isNaN(d.getTime())) return null
    return d.toISOString()
  } catch {
    return null
  }
}
