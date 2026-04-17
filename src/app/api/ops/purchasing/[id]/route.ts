export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { checkStaffAuth } from '@/lib/api-auth'
import { defaultExpectedDateForPO } from '@/lib/mrp'
import { audit } from '@/lib/audit'

interface RouteParams {
  params: {
    id: string;
  };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params;

    // Fetch PurchaseOrder with vendor and createdBy info
    const purchaseOrderResult = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        po.id,
        po."poNumber",
        po."vendorId",
        po."createdById",
        po."approvedById",
        po.status,
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
        "receivedQty"
      FROM "PurchaseOrderItem"
      WHERE "purchaseOrderId" = $1
    `, id);

    purchaseOrder.items = items;

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

    const { status, notes, expectedDate } = body;

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
        "receivedQty"
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
