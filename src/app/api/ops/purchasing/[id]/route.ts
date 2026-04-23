export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { checkStaffAuth } from '@/lib/api-auth'
import { defaultExpectedDateForPO } from '@/lib/mrp'
import { audit } from '@/lib/audit'
import { requireValidTransition, transitionErrorResponse } from '@/lib/status-guard'

interface RouteParams {
  params: {
    id: string;
  };
}

// ─── Vendor A-F grade (composite of on-time rate & quality) ───────────────
function gradeVendor(onTimeRate: number, qualityIssues: number, totalPOs: number): string {
  if (totalPOs === 0) return 'N/A'
  // On-time weight 80 %, quality weight 20 % (issues/POs ratio, capped)
  const qualityScore = Math.max(0, 100 - Math.min(100, (qualityIssues / Math.max(1, totalPOs)) * 100))
  const composite = onTimeRate * 0.8 + qualityScore * 0.2
  if (composite >= 93) return 'A'
  if (composite >= 85) return 'B'
  if (composite >= 75) return 'C'
  if (composite >= 65) return 'D'
  return 'F'
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params;

    // Fetch PurchaseOrder with vendor, createdBy, approvedBy
    const purchaseOrderResult = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        po.id,
        po."poNumber",
        po."vendorId",
        po."createdById",
        po."approvedById",
        po.status,
        po.category,
        po.subtotal,
        po."shippingCost",
        po.total,
        po."orderedAt",
        po."expectedDate",
        po."receivedAt",
        po.notes,
        po."aiGenerated",
        po.source,
        po."createdAt",
        po."updatedAt",
        json_build_object(
          'id', v.id,
          'name', v.name,
          'code', v.code,
          'contactName', v."contactName",
          'email', v.email,
          'phone', v.phone,
          'address', v.address,
          'website', v.website,
          'accountNumber', v."accountNumber",
          'avgLeadDays', v."avgLeadDays",
          'onTimeRate', v."onTimeRate",
          'paymentTerms', v."paymentTerms"
        ) as vendor,
        json_build_object(
          'id', s.id,
          'firstName', s."firstName",
          'lastName', s."lastName",
          'email', s.email
        ) as "createdBy",
        CASE WHEN a.id IS NULL THEN NULL ELSE json_build_object(
          'id', a.id,
          'firstName', a."firstName",
          'lastName', a."lastName",
          'email', a.email
        ) END as "approvedBy"
      FROM "PurchaseOrder" po
      LEFT JOIN "Vendor" v ON po."vendorId" = v.id
      LEFT JOIN "Staff" s ON po."createdById" = s.id
      LEFT JOIN "Staff" a ON po."approvedById" = a.id
      WHERE po.id = $1
    `, id);

    if (!purchaseOrderResult || purchaseOrderResult.length === 0) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      );
    }

    const purchaseOrder = purchaseOrderResult[0];

    // Fetch PurchaseOrderItems (join to Product when possible for SKU/name)
    const items = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        poi.id,
        poi."purchaseOrderId",
        poi."productId",
        poi."vendorSku",
        poi.description,
        poi.quantity,
        poi."unitCost",
        poi."lineTotal",
        poi."receivedQty",
        poi."damagedQty",
        p.sku           as "productSku",
        p.name          as "productName",
        p.category      as "productCategory"
      FROM "PurchaseOrderItem" poi
      LEFT JOIN "Product" p ON poi."productId" = p.id
      WHERE poi."purchaseOrderId" = $1
      ORDER BY poi."createdAt" ASC
    `, id);

    purchaseOrder.items = items;

    // Vendor scorecard (on-time, lead days, spend YTD, quality, grade)
    let scorecard: any = null
    if (purchaseOrder.vendorId) {
      const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
      const scoreRows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT
          COUNT(DISTINCT po.id)::int           as "totalPOs",
          COALESCE(v."onTimeRate", 0)::float   as "onTimeRate",
          COALESCE(v."avgLeadDays", 0)::float  as "avgLeadDays",
          COALESCE(SUM(CASE WHEN po."createdAt" >= $2 THEN po."total" ELSE 0 END), 0)::float as "spendYTD",
          0::int                                as "qualityIssues"
        FROM "Vendor" v
        LEFT JOIN "PurchaseOrder" po ON po."vendorId" = v.id
        WHERE v.id = $1
        GROUP BY v.id, v."onTimeRate", v."avgLeadDays"
      `, purchaseOrder.vendorId, yearAgo)

      if (scoreRows && scoreRows.length > 0) {
        const r = scoreRows[0]
        const onTimePct = (r.onTimeRate || 0) * (r.onTimeRate > 1 ? 1 : 100) // stored 0-1, show 0-100
        scorecard = {
          totalPOs: Number(r.totalPOs || 0),
          onTimeRate: Math.round(onTimePct * 10) / 10,
          avgLeadDays: Math.round(r.avgLeadDays || 0),
          spendYTD: Number(r.spendYTD || 0),
          qualityIssues: Number(r.qualityIssues || 0),
          grade: gradeVendor(onTimePct, Number(r.qualityIssues || 0), Number(r.totalPOs || 0)),
        }
      }
    }
    purchaseOrder.scorecard = scorecard

    // Linked orders — via MaterialWatch (which builder orders this PO fills)
    const linkedOrders = await prisma.$queryRawUnsafe<any[]>(`
      SELECT DISTINCT
        o.id           as "orderId",
        o."orderNumber",
        o.status       as "orderStatus",
        o.total        as "orderTotal",
        b.id           as "builderId",
        b."companyName" as "builderName"
      FROM "MaterialWatch" mw
      LEFT JOIN "Order" o   ON mw."orderId" = o.id
      LEFT JOIN "Builder" b ON o."builderId" = b.id
      WHERE mw."purchaseOrderId" = $1
      ORDER BY o."createdAt" DESC
      LIMIT 25
    `, id).catch(() => [])

    purchaseOrder.linkedOrders = linkedOrders || []

    // Audit trail — last 10 entries for this PO
    const auditTrail = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        a.id,
        a.action,
        a."staffId",
        a.details,
        a."createdAt",
        a.severity,
        s."firstName" as "staffFirstName",
        s."lastName"  as "staffLastName"
      FROM "AuditLog" a
      LEFT JOIN "Staff" s ON a."staffId" = s.id
      WHERE a.entity = 'PurchaseOrder' AND a."entityId" = $1
      ORDER BY a."createdAt" DESC
      LIMIT 10
    `, id).catch(() => [])

    purchaseOrder.auditTrail = auditTrail || []

    // Status timeline — derived from PO timestamps + audit log for richer actor info
    const timelineEvents = [
      {
        key: 'DRAFT',
        label: 'Draft',
        at: purchaseOrder.createdAt,
        actor: purchaseOrder.createdBy
          ? `${purchaseOrder.createdBy.firstName ?? ''} ${purchaseOrder.createdBy.lastName ?? ''}`.trim()
          : null,
      },
      {
        key: 'SENT_TO_VENDOR',
        label: 'Sent',
        at: purchaseOrder.orderedAt,
        actor: purchaseOrder.approvedBy
          ? `${purchaseOrder.approvedBy.firstName ?? ''} ${purchaseOrder.approvedBy.lastName ?? ''}`.trim()
          : null,
      },
      {
        key: 'PARTIALLY_RECEIVED',
        label: 'Partial',
        at:
          purchaseOrder.status === 'PARTIALLY_RECEIVED'
            ? purchaseOrder.updatedAt
            : null,
        actor: null,
      },
      {
        key: 'RECEIVED',
        label: 'Received',
        at: purchaseOrder.receivedAt,
        actor: null,
      },
    ]
    purchaseOrder.timeline = timelineEvents

    // Days in current state
    const nowMs = Date.now()
    const stateStart = (() => {
      switch (purchaseOrder.status) {
        case 'RECEIVED':
          return purchaseOrder.receivedAt ?? purchaseOrder.updatedAt
        case 'SENT_TO_VENDOR':
          return purchaseOrder.orderedAt ?? purchaseOrder.updatedAt
        default:
          return purchaseOrder.updatedAt
      }
    })()
    purchaseOrder.daysInState = stateStart
      ? Math.max(0, Math.round((nowMs - new Date(stateStart).getTime()) / 86400000))
      : 0

    // Received %
    const totalQty = items.reduce((s, i) => s + Number(i.quantity || 0), 0)
    const totalRcv = items.reduce((s, i) => s + Number(i.receivedQty || 0), 0)
    purchaseOrder.receivedPct = totalQty > 0 ? Math.round((totalRcv / totalQty) * 100) : 0
    purchaseOrder.totalQty = totalQty
    purchaseOrder.totalReceived = totalRcv

    return NextResponse.json(purchaseOrder, { status: 200 });
  } catch (error) {
    console.error('GET /api/ops/purchasing/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch purchase order' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'UPDATE', 'PurchaseOrder', undefined, { method: 'PATCH' }).catch(() => {})

    const { id } = params;
    const body = await request.json();

    const { status, notes, expectedDate, category, receive, shortShipFlag } = body;

    // Get current PO to check status changes
    const currentPOResult = await prisma.$queryRawUnsafe<any[]>(`
      SELECT status FROM "PurchaseOrder" WHERE id = $1
    `, id);

    if (!currentPOResult || currentPOResult.length === 0) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      );
    }

    const currentStatus = currentPOResult[0].status;

    // Guard: enforce POStatus state machine before writing.
    if (status !== undefined) {
      try {
        requireValidTransition('po', currentStatus, status)
      } catch (e) {
        const res = transitionErrorResponse(e)
        if (res) return res
        throw e
      }
    }

    // Build dynamic SET clause
    const setClauses: string[] = [];
    const params_: any[] = [id];
    let paramIndex = 2;

    if (status !== undefined) {
      setClauses.push(`status = $${paramIndex}::"POStatus"`);
      params_.push(status);
      paramIndex++;

      if (status === 'SENT_TO_VENDOR') {
        setClauses.push(`"orderedAt" = NOW()`);
      }

      if (status === 'RECEIVED') {
        setClauses.push(`"receivedAt" = NOW()`);
      }
    }

    if (notes !== undefined) {
      setClauses.push(`notes = $${paramIndex}`);
      params_.push(notes);
      paramIndex++;
    }

    if (category !== undefined) {
      setClauses.push(`category = $${paramIndex}::"POCategory"`);
      params_.push(category);
      paramIndex++;
    }

    if (expectedDate !== undefined) {
      const dateValue = expectedDate ? new Date(expectedDate).toISOString() : null;
      setClauses.push(`"expectedDate" = $${paramIndex}::timestamp`);
      params_.push(dateValue);
      paramIndex++;
    }

    // Execute update
    if (setClauses.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "PurchaseOrder" SET ${setClauses.join(', ')}, "updatedAt" = NOW() WHERE id = $1`,
        ...params_
      );
    }

    // Receive-remaining inline handler — bumps receivedQty to quantity for each
    // item and optionally flags short-ship. Happens regardless of status field.
    if (receive && Array.isArray(receive) && receive.length > 0) {
      for (const r of receive) {
        if (!r?.itemId) continue
        const rcvQty = typeof r.receivedQty === 'number' ? r.receivedQty : null
        if (rcvQty === null) {
          // Fill remainder
          await prisma.$executeRawUnsafe(
            `UPDATE "PurchaseOrderItem" SET "receivedQty" = quantity, "updatedAt" = NOW() WHERE id = $1 AND "purchaseOrderId" = $2`,
            r.itemId,
            id,
          )
        } else {
          await prisma.$executeRawUnsafe(
            `UPDATE "PurchaseOrderItem" SET "receivedQty" = LEAST(quantity, GREATEST(0, $1::int)), "updatedAt" = NOW() WHERE id = $2 AND "purchaseOrderId" = $3`,
            rcvQty,
            r.itemId,
            id,
          )
        }
      }

      if (shortShipFlag) {
        await prisma.$executeRawUnsafe(
          `UPDATE "PurchaseOrder" SET notes = COALESCE(notes || E'\\n', '') || $1, "updatedAt" = NOW() WHERE id = $2`,
          `[${new Date().toISOString().slice(0, 10)}] Short ship flagged during receive.`,
          id,
        )
      }
    }

    // ── MRP: backfill expectedDate from vendor lead time when PO is sent ──
    if (status === 'SENT_TO_VENDOR' && expectedDate === undefined) {
      try {
        await defaultExpectedDateForPO(id)
      } catch (mrpErr: any) {
        console.warn('[purchasing PATCH] defaultExpectedDateForPO failed:', mrpErr?.message)
      }
    }

    // Fetch updated PurchaseOrderItems for inventory processing
    const itemsResult = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        id,
        "purchaseOrderId",
        "productId",
        quantity,
        "receivedQty"
      FROM "PurchaseOrderItem"
      WHERE "purchaseOrderId" = $1
    `, id);

    // Update inventory when PO status transitions to RECEIVED or PARTIALLY_RECEIVED
    if (
      (status === 'RECEIVED' || status === 'PARTIALLY_RECEIVED') &&
      currentStatus !== 'RECEIVED' &&
      currentStatus !== 'PARTIALLY_RECEIVED'
    ) {
      // Process each PurchaseOrderItem
      for (const item of itemsResult) {
        if (item.productId) {
          const receivedQty = item.receivedQty > 0 ? item.receivedQty : item.quantity;

          // Check if InventoryItem exists
          const existingInventoryResult = await prisma.$queryRawUnsafe<any[]>(`
            SELECT
              "onHand",
              committed,
              "onOrder"
            FROM "InventoryItem"
            WHERE "productId" = $1
          `, item.productId);

          if (existingInventoryResult && existingInventoryResult.length > 0) {
            // Update existing inventory
            const existing = existingInventoryResult[0];
            const newAvailable = (existing.onHand + receivedQty) - (existing.committed || 0);

            await prisma.$executeRawUnsafe(`
              UPDATE "InventoryItem"
              SET
                "onHand" = "onHand" + $1,
                "onOrder" = "onOrder" - $1,
                available = $2,
                "lastReceivedAt" = NOW(),
                "updatedAt" = NOW()
              WHERE "productId" = $3
            `, receivedQty, newAvailable, item.productId);
          } else {
            // Create new inventory item
            const onOrderValue = Math.max(0, item.quantity - receivedQty);

            await prisma.$executeRawUnsafe(`
              INSERT INTO "InventoryItem" (
                "productId",
                "onHand",
                committed,
                "onOrder",
                available,
                "lastReceivedAt",
                "createdAt",
                "updatedAt"
              ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
            `, item.productId, receivedQty, 0, onOrderValue, receivedQty);
          }
        }
      }
    }

    // Fetch updated PurchaseOrder with all relations
    const purchaseOrderResult = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        po.id,
        po."poNumber",
        po."vendorId",
        po."createdById",
        po."approvedById",
        po.status,
        po.category,
        po.subtotal,
        po."shippingCost",
        po.total,
        po."orderedAt",
        po."expectedDate",
        po."receivedAt",
        po.notes,
        po."createdAt",
        po."updatedAt",
        json_build_object(
          'id', v.id,
          'name', v.name,
          'code', v.code,
          'contactName', v."contactName",
          'email', v.email,
          'phone', v.phone,
          'address', v.address,
          'website', v.website,
          'accountNumber', v."accountNumber"
        ) as vendor,
        json_build_object(
          'id', s.id,
          'firstName', s."firstName",
          'lastName', s."lastName",
          'email', s.email
        ) as "createdBy"
      FROM "PurchaseOrder" po
      LEFT JOIN "Vendor" v ON po."vendorId" = v.id
      LEFT JOIN "Staff" s ON po."createdById" = s.id
      WHERE po.id = $1
    `, id);

    if (!purchaseOrderResult || purchaseOrderResult.length === 0) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      );
    }

    const purchaseOrder = purchaseOrderResult[0];

    // Fetch PurchaseOrderItems
    const items = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        id,
        "purchaseOrderId",
        "productId",
        "vendorSku",
        description,
        quantity,
        "unitCost",
        "lineTotal",
        "receivedQty",
        "damagedQty"
      FROM "PurchaseOrderItem"
      WHERE "purchaseOrderId" = $1
    `, id);

    purchaseOrder.items = items;

    return NextResponse.json(purchaseOrder, { status: 200 });
  } catch (error) {
    console.error('PATCH /api/ops/purchasing/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to update purchase order' },
      { status: 500 }
    );
  }
}
