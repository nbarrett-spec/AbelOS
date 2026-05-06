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
  // v13: also persist Hyphen pass-through fields (optionColor1-3, extText1-6)
  // and mapper-parsed door specs (doorSwing, doorHand, jambDepth, throatDepth)
  // + the bigint builderLineItemNum so the ops UI can query/filter on them
  // without re-parsing the description string.
  for (const { item, productId, lineNum } of resolvedItems) {
    const itemId = 'oi_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex')
    const unitPrice = item.requestedUnitPrice ?? item.supplierUnitPrice ?? 0
    const lineTotal = item.lineTotal ?? unitPrice * item.quantityOrdered
    const description = buildItemDescription(item, lineNum)
    const qty = Math.max(1, Math.round(item.quantityOrdered)) // OrderItem.quantity is Int
    await prisma.$executeRawUnsafe(
      `INSERT INTO "OrderItem" (
         "id", "orderId", "productId", "description", "quantity", "unitPrice", "lineTotal",
         "optionColor1", "optionColor2", "optionColor3",
         "extText1", "extText2", "extText3", "extText4", "extText5", "extText6",
         "doorSwing", "doorHand", "jambDepth", "throatDepth",
         "builderLineItemNum"
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10,
         $11, $12, $13, $14, $15, $16,
         $17, $18, $19, $20,
         $21
       )`,
      itemId,
      orderId,
      productId,
      description,
      qty,
      unitPrice,
      lineTotal,
      item.optionColor1,
      item.optionColor2,
      item.optionColor3,
      item.extText1,
      item.extText2,
      item.extText3,
      item.extText4,
      item.extText5,
      item.extText6,
      item.doorSwing,
      item.doorHand,
      item.jambDepth,
      item.throatDepth,
      item.builderLineItemNum
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
