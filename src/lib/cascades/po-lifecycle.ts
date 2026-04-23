/**
 * Purchase Order Lifecycle Cascades
 *
 * Centralized side-effects for PO status transitions. Also owns the vendor
 * email notification on SENT_TO_VENDOR (best-effort — Resend failure doesn't
 * block the PO transition).
 *
 * Triggered from:
 *  - POST  /api/ops/purchasing                (onPOSent via inventory onOrder bump — centralised here)
 *  - PATCH /api/ops/purchasing                (on status → SENT_TO_VENDOR / RECEIVED)
 *  - PATCH /api/ops/purchasing/[id]           (same)
 *  - POST  /api/ops/receiving                 (partial / full receive)
 */
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { sendEmail } from '@/lib/email'

type CascadeResult = { ok: boolean; action: string; detail?: string }

/**
 * onPOSent — PO transitioned to SENT_TO_VENDOR.
 * Ensures InventoryItem.onOrder is bumped for each line (idempotent — we
 * guard with a marker in PurchaseOrder.notes) and emails the vendor.
 */
export async function onPOSent(poId: string): Promise<CascadeResult> {
  try {
    const poRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT po."id", po."poNumber", po."status"::text AS status,
              po."total", po."expectedDate", po."notes",
              v."name" AS "vendorName", v."email" AS "vendorEmail", v."contactName" AS "vendorContactName"
       FROM "PurchaseOrder" po
       LEFT JOIN "Vendor" v ON v."id" = po."vendorId"
       WHERE po."id" = $1`,
      poId
    )
    if (poRows.length === 0) return { ok: false, action: 'onPOSent', detail: 'po_not_found' }
    const po = poRows[0]

    // Guard: only emails and onOrder-bumps once. Use a notes sentinel.
    const MARKER = '[CASCADE:PO_SENT_NOTIFIED]'
    const alreadySent = typeof po.notes === 'string' && po.notes.includes(MARKER)

    // Bump onOrder if it wasn't already counted (the POST /api/ops/purchasing
    // route currently bumps on DRAFT create; this guard keeps us from
    // double-counting). We treat MARKER as our idempotency flag.
    if (!alreadySent) {
      const items: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id", "productId", "quantity", "receivedQty" FROM "PurchaseOrderItem" WHERE "purchaseOrderId" = $1`,
        poId
      )
      for (const item of items) {
        if (!item.productId) continue
        const remaining = Math.max(0, Number(item.quantity || 0) - Number(item.receivedQty || 0))
        if (remaining <= 0) continue
        const invRows: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "InventoryItem" WHERE "productId" = $1 LIMIT 1`, item.productId
        )
        if (invRows.length === 0) {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "InventoryItem" ("id", "productId", "onHand", "committed", "onOrder", "available", "updatedAt")
             VALUES (gen_random_uuid()::text, $1, 0, 0, $2, 0, NOW())
             ON CONFLICT DO NOTHING`,
            item.productId, remaining
          )
        }
        // We intentionally do NOT double-bump onOrder here — the POST route
        // already added it at PO creation. The MARKER enforces that.
      }
    }

    // Email vendor — best effort
    if (!alreadySent && po.vendorEmail) {
      const subject = `Purchase Order ${po.poNumber}`
      const body = `
        <p>Hi ${po.vendorContactName || 'Team'},</p>
        <p>Please find Abel Lumber PO <strong>${po.poNumber}</strong> attached / available on our portal.</p>
        <p>Expected delivery: ${po.expectedDate ? new Date(po.expectedDate).toLocaleDateString() : 'TBD'}</p>
        <p>Total: $${Number(po.total || 0).toFixed(2)}</p>
        <p>Thanks, <br/> Abel Lumber Purchasing</p>
      `
      try {
        await sendEmail({ to: po.vendorEmail, subject, html: body })
      } catch (err) {
        logger.warn('po_vendor_email_failed', { poId, err })
      }
    }

    // Stamp the marker so we don't re-send / re-bump.
    if (!alreadySent) {
      const newNotes = [po.notes, MARKER].filter(Boolean).join('\n')
      await prisma.$executeRawUnsafe(
        `UPDATE "PurchaseOrder" SET "notes" = $1, "orderedAt" = COALESCE("orderedAt", NOW()), "updatedAt" = NOW() WHERE "id" = $2`,
        newNotes, poId
      )
    }

    return { ok: true, action: 'onPOSent', detail: alreadySent ? 'already_sent' : 'sent' }
  } catch (e: any) {
    logger.error('cascade_onPOSent_failed', e, { poId })
    return { ok: false, action: 'onPOSent', detail: e?.message }
  }
}

/**
 * onPOPartialReceive — some but not all qty arrived. For any line where
 * receivedQty < quantity we create a BackorderItem (one per line) for the
 * remaining qty so accounting/ops can chase it.
 */
export async function onPOPartialReceive(poId: string): Promise<CascadeResult> {
  try {
    const items: any[] = await prisma.$queryRawUnsafe(
      `SELECT poi."id", poi."productId", poi."vendorSku", poi."description",
              poi."quantity", poi."receivedQty",
              p."sku", p."name" AS "productName"
       FROM "PurchaseOrderItem" poi
       LEFT JOIN "Product" p ON p."id" = poi."productId"
       WHERE poi."purchaseOrderId" = $1`,
      poId
    )

    let created = 0
    for (const item of items) {
      const ordered = Number(item.quantity || 0)
      const received = Number(item.receivedQty || 0)
      const shortfall = ordered - received
      if (shortfall <= 0) continue

      // Idempotent: skip if a backorder already exists for this PO+product
      const existing: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "BackorderItem"
         WHERE "purchaseOrderId" = $1 AND "productId" = $2 AND "status" != 'CANCELLED'
         LIMIT 1`,
        poId, item.productId || ''
      )
      if (existing.length > 0) continue

      const id = `bo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "BackorderItem" (
            "id", "orderId", "productId",
            "sku", "productName", "qtyOrdered", "qtyShipped", "qtyBackordered",
            "status", "purchaseOrderId",
            "createdAt", "updatedAt"
          ) VALUES (
            $1, '', $2,
            $3, $4, $5, $6, $7,
            'BACKORDERED', $8,
            NOW(), NOW()
          )`,
          id, item.productId || null,
          item.sku || item.vendorSku || 'UNKNOWN',
          item.productName || item.description || 'Unknown',
          ordered, received, shortfall,
          poId
        )
        created++
      } catch (err) {
        // BackorderItem.orderId is required in schema; some callers may not have
        // a linked customer order for a PO-only shortfall. If this fails, fall
        // back to creating an InboxItem instead.
        await safeInboxInsert({
          type: 'BACKORDER',
          source: 'po-lifecycle',
          title: `Backorder on PO ${poId.slice(-6)} — ${item.sku || 'unknown'} short ${shortfall}`,
          description: `${item.productName || item.description || 'Item'} on PO: ordered ${ordered}, received ${received}, shortfall ${shortfall}.`,
          priority: 'MEDIUM',
          entityType: 'PurchaseOrder',
          entityId: poId,
        })
      }
    }

    return { ok: true, action: 'onPOPartialReceive', detail: `backorders=${created}` }
  } catch (e: any) {
    logger.error('cascade_onPOPartialReceive_failed', e, { poId })
    return { ok: false, action: 'onPOPartialReceive', detail: e?.message }
  }
}

/**
 * onPOReceived — all ordered qty received. Flips any Order that was sitting
 * in AWAITING_MATERIAL → READY_TO_SHIP if the PO was the blocker.
 *
 * Heuristic: we treat an Order as "waiting on this PO" when it has any
 * OrderItem for a product that this PO supplied AND the order is in
 * AWAITING_MATERIAL. The check lives here so all callers share it.
 */
export async function onPOReceived(poId: string): Promise<CascadeResult> {
  try {
    const productIds: any[] = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT "productId" FROM "PurchaseOrderItem"
       WHERE "purchaseOrderId" = $1 AND "productId" IS NOT NULL`,
      poId
    )
    if (productIds.length === 0) return { ok: true, action: 'onPOReceived', detail: 'no_linked_products' }

    const ids = productIds.map((r: any) => r.productId)
    const flipped: any[] = await prisma.$queryRawUnsafe(
      `UPDATE "Order"
       SET "status" = 'READY_TO_SHIP'::"OrderStatus",
           "updatedAt" = NOW()
       WHERE "id" IN (
         SELECT DISTINCT oi."orderId"
         FROM "OrderItem" oi
         JOIN "Order" o ON o."id" = oi."orderId"
         WHERE oi."productId" = ANY($1::text[])
           AND o."status"::text = 'AWAITING_MATERIAL'
       )
       RETURNING "id"`,
      ids
    )

    return { ok: true, action: 'onPOReceived', detail: `orders_flipped=${(flipped as any[]).length}` }
  } catch (e: any) {
    logger.error('cascade_onPOReceived_failed', e, { poId })
    return { ok: false, action: 'onPOReceived', detail: e?.message }
  }
}

/** Hub dispatcher — pick the right cascade(s) for a PO status transition. */
export async function runPOStatusCascades(poId: string, newStatus: string | null | undefined): Promise<void> {
  if (!newStatus) return
  const s = newStatus.toUpperCase()
  try {
    if (s === 'SENT_TO_VENDOR') await onPOSent(poId)
    if (s === 'PARTIALLY_RECEIVED') await onPOPartialReceive(poId)
    if (s === 'RECEIVED') await onPOReceived(poId)
  } catch (e: any) {
    logger.error('runPOStatusCascades_failed', e, { poId, newStatus })
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

async function safeInboxInsert(item: {
  type: string
  source: string
  title: string
  description?: string
  priority?: string
  entityType?: string
  entityId?: string
}): Promise<void> {
  try {
    const id = `inb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    await prisma.$executeRawUnsafe(
      `INSERT INTO "InboxItem" (
        "id", "type", "source", "title", "description",
        "priority", "status", "entityType", "entityId",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, 'PENDING', $7, $8,
        NOW(), NOW()
      )`,
      id, item.type, item.source, item.title, item.description || null,
      item.priority || 'MEDIUM', item.entityType || null, item.entityId || null,
    )
  } catch { /* best-effort */ }
}
