export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { checkStaffAuth } from '@/lib/api-auth';

interface RouteParams {
  params: { id: string };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    const { id } = params;

    // Fetch PO with vendor info
    const poResult = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        po."id",
        po."poNumber",
        po."vendorId",
        po."status",
        po."subtotal",
        po."shippingCost",
        po."total",
        po."orderedAt",
        po."expectedDate",
        po."receivedAt",
        po."notes",
        po."createdAt",
        json_build_object(
          'id', v."id",
          'name', v."name",
          'code', v."code",
          'contactName', v."contactName",
          'email', v."email",
          'phone', v."phone"
        ) as "vendor"
      FROM "PurchaseOrder" po
      LEFT JOIN "Vendor" v ON po."vendorId" = v."id"
      WHERE po."id" = $1
    `, id);

    if (!poResult || poResult.length === 0) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 });
    }

    const po = poResult[0];

    // Fetch items with receiving progress (includes cross-dock metadata).
    const items = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        poi."id",
        poi."productId",
        poi."vendorSku",
        poi."description",
        poi."quantity",
        poi."unitCost",
        poi."lineTotal",
        poi."receivedQty",
        poi."damagedQty",
        (poi."quantity" - poi."receivedQty") as "remaining",
        COALESCE(poi."crossDockFlag", false) as "crossDockFlag",
        poi."crossDockJobIds",
        poi."crossDockCheckedAt",
        CASE
          WHEN poi."receivedQty" >= poi."quantity" THEN 'COMPLETE'
          WHEN poi."receivedQty" > 0 THEN 'PARTIAL'
          ELSE 'PENDING'
        END as "receiveStatus"
      FROM "PurchaseOrderItem" poi
      WHERE poi."purchaseOrderId" = $1
      ORDER BY poi."description"
    `, id);

    // Hydrate cross-dock jobs (single query across the whole PO).
    const crossDockJobIdSet = new Set<string>();
    for (const it of items) {
      if (Array.isArray(it.crossDockJobIds)) {
        for (const jid of it.crossDockJobIds) crossDockJobIdSet.add(jid);
      }
    }
    const jobMap = new Map<string, { id: string; jobNumber: string; builderName: string | null; scheduledDate: string | null }>();
    if (crossDockJobIdSet.size > 0) {
      const jobs = await prisma.$queryRawUnsafe<any[]>(
        `SELECT "id", "jobNumber", "builderName", "scheduledDate"
         FROM "Job"
         WHERE "id" = ANY($1::text[])`,
        Array.from(crossDockJobIdSet),
      );
      for (const j of jobs) {
        jobMap.set(j.id, {
          id: j.id,
          jobNumber: j.jobNumber,
          builderName: j.builderName,
          scheduledDate: j.scheduledDate ? new Date(j.scheduledDate).toISOString() : null,
        });
      }
    }
    for (const it of items) {
      it.crossDockJobs = Array.isArray(it.crossDockJobIds)
        ? it.crossDockJobIds.map((jid: string) => jobMap.get(jid)).filter(Boolean)
        : [];
    }

    const totalItems = items.length;
    const itemsReceived = items.filter((i: any) => i.receiveStatus === 'COMPLETE').length;
    const totalOrdered = items.reduce((sum: number, i: any) => sum + i.quantity, 0);
    const totalReceivedQty = items.reduce((sum: number, i: any) => sum + i.receivedQty, 0);
    const totalDamagedQty = items.reduce((sum: number, i: any) => sum + (i.damagedQty || 0), 0);
    const fullyReceived = itemsReceived === totalItems;

    return NextResponse.json({
      ...po,
      items,
      progress: {
        totalItems,
        itemsReceived,
        totalOrdered,
        totalReceivedQty,
        totalDamagedQty,
        fullyReceived,
        completionPercent: totalItems > 0 ? Math.round((itemsReceived / totalItems) * 100) : 0
      }
    });
  } catch (error: any) {
    console.error('GET /api/ops/receiving/[id] error:', error);
    return NextResponse.json({ error: 'Failed to fetch PO details' }, { status: 500 });
  }
}
