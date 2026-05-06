export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { checkStaffAuth } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString().split('T')[0];

    const sevenDaysFromNow = new Date(today);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    const sevenDaysISO = sevenDaysFromNow.toISOString().split('T')[0];

    const threeDaysFromNow = new Date(today);
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    const threeDaysISO = threeDaysFromNow.toISOString().split('T')[0];

    // PM Portal: Open jobs and pending notes
    const openJobs = await prisma.$queryRawUnsafe<[{ count: number }]>(
      `SELECT COUNT(*)::int AS count FROM "Job" WHERE "status" IN ('CREATED'::text, 'READINESS_CHECK'::text, 'MATERIALS_LOCKED'::text, 'IN_PRODUCTION'::text, 'STAGED'::text, 'LOADED'::text, 'IN_TRANSIT'::text)`
    ).then(result => result[0]?.count ?? 0).catch(() => 0);

    const pendingNotes = await prisma.$queryRawUnsafe<[{ count: number }]>(
      `SELECT COUNT(*)::int AS count FROM "DecisionNote" WHERE "status" = 'PENDING'`
    ).then(result => result[0]?.count ?? 0).catch(() => 0);

    const upcomingDeliveries = await prisma.$queryRawUnsafe<[{ count: number }]>(
      `SELECT COUNT(*)::int AS count FROM "ScheduleEntry" WHERE "entryType" = 'DELIVERY' AND "scheduledDate" >= $1::date AND "scheduledDate" < $2::date`,
      todayISO,
      sevenDaysISO
    ).then(result => result[0]?.count ?? 0).catch(() => 0);

    // Purchasing Portal: POs needing approval and low stock
    const posPendingApproval = await prisma.$queryRawUnsafe<[{ count: number }]>(
      `SELECT COUNT(*)::int AS count FROM "PurchaseOrder" WHERE "status" = 'PENDING_APPROVAL'`
    ).then(result => result[0]?.count ?? 0).catch(() => 0);

    const lowStockItems = await prisma.$queryRawUnsafe<[{ count: number }]>(
      `SELECT COUNT(*)::int AS count FROM "InventoryItem" WHERE "onHand" < "reorderPoint"`
    ).then(result => result[0]?.count ?? 0).catch(() => 0);

    // Warehouse/Manufacturing Portal: Today's picks and production queue
    let todayPickLists = 0;
    try {
      const pickListResult = await prisma.$queryRawUnsafe<[{ count: number }]>(
        `SELECT COUNT(*)::int AS count FROM "PickList" WHERE "date" >= $1::date AND "date" < $1::date + INTERVAL '1 day'`,
        todayISO
      );
      todayPickLists = pickListResult[0]?.count ?? 0;
    } catch {
      todayPickLists = 0;
    }

    const productionQueue = await prisma.$queryRawUnsafe<[{ count: number }]>(
      `SELECT COUNT(*)::int AS count FROM "Job" WHERE "status" = 'IN_PRODUCTION'`
    ).then(result => result[0]?.count ?? 0).catch(() => 0);

    let qcChecksNeeded = 0;
    try {
      const qcResult = await prisma.$queryRawUnsafe<[{ count: number }]>(
        `SELECT COUNT(*)::int AS count FROM "QcCheck" WHERE "status" = 'PENDING'`
      );
      qcChecksNeeded = qcResult[0]?.count ?? 0;
    } catch {
      qcChecksNeeded = 0;
    }

    // Delivery & Logistics Portal: Today's deliveries
    const todayDeliveries = await prisma.$queryRawUnsafe<[{ count: number }]>(
      `SELECT COUNT(*)::int AS count FROM "ScheduleEntry" WHERE "entryType" = 'DELIVERY' AND "scheduledDate" >= $1::date AND "scheduledDate" < $1::date + INTERVAL '1 day'`,
      todayISO
    ).then(result => result[0]?.count ?? 0).catch(() => 0);

    const upcomingDeliveriesThreeDays = await prisma.$queryRawUnsafe<[{ count: number }]>(
      `SELECT COUNT(*)::int AS count FROM "ScheduleEntry" WHERE "entryType" = 'DELIVERY' AND "scheduledDate" >= $1::date AND "scheduledDate" < $2::date`,
      todayISO,
      threeDaysISO
    ).then(result => result[0]?.count ?? 0).catch(() => 0);

    // Accounting Portal: Outstanding invoices and overdue amounts
    const outstandingInvoices = await prisma.$queryRawUnsafe<[{ count: number }]>(
      `SELECT COUNT(*)::int AS count FROM "Invoice" WHERE "status" = 'UNPAID'`
    ).then(result => result[0]?.count ?? 0).catch(() => 0);

    const overdueInvoices = await prisma.$queryRawUnsafe<[{ count: number }]>(
      `SELECT COUNT(*)::int AS count FROM "Invoice" WHERE "status" = 'UNPAID' AND "dueDate" < $1::date`,
      todayISO
    ).then(result => result[0]?.count ?? 0).catch(() => 0);

    // Count pending POs for AP
    const pendingPOs = await prisma.$queryRawUnsafe<[{ count: number }]>(
      `SELECT COUNT(*)::int AS count FROM "PurchaseOrder" WHERE "status" IN ('APPROVED'::text, 'PARTIAL_RECEIPT'::text)`
    ).then(result => result[0]?.count ?? 0).catch(() => 0);

    return NextResponse.json({
      pm: {
        openJobs,
        pendingNotes,
        upcomingDeliveries,
      },
      purchasing: {
        posPendingApproval,
        lowStockItems,
      },
      warehouse: {
        todayPickLists,
        productionQueue,
        qcChecksNeeded,
      },
      delivery: {
        todayDeliveries,
        upcomingDeliveriesThreeDays,
      },
      accounting: {
        outstandingInvoices,
        overdueInvoices,
        pendingPOs,
      },
    });
  } catch (error) {
    console.error('Failed to fetch portal summary:', error);
    return NextResponse.json(
      { error: 'Failed to fetch portal summary' },
      { status: 500 }
    );
  }
}
