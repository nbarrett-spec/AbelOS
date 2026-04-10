export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const crewId = searchParams.get('crewId');
    const date = searchParams.get('date');

    if (!crewId || !date) {
      return NextResponse.json(
        { error: 'crewId and date are required' },
        { status: 400 }
      );
    }

    // Parse the date
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    // Get all deliveries for this crew on this date with their schedule entries
    const deliveriesResult = await prisma.$queryRawUnsafe<Array<{
      id: string;
      jobId: string;
      deliveryNumber: string;
      address: string;
      routeOrder: number;
      status: string;
      jobNumber: string;
      builderName: string;
      scheduleEntryCount: number;
      itemCount: number;
    }>>(
      `SELECT d.id, d."jobId", d."deliveryNumber", d.address, d."routeOrder", d.status,
              j."jobNumber", j."builderName",
              (SELECT COUNT(*)::int FROM "ScheduleEntry" WHERE "jobId" = d."jobId" AND "crewId" = $1 AND "scheduledDate" >= $2 AND "scheduledDate" <= $3 AND "entryType" = 'DELIVERY') as "scheduleEntryCount",
              (SELECT COUNT(*)::int FROM "MaterialPick" WHERE "jobId" = d."jobId") as "itemCount"
       FROM "Delivery" d
       JOIN "Job" j ON d."jobId" = j.id
       WHERE d."crewId" = $1
       ORDER BY d."routeOrder" ASC`,
      crewId,
      startDate,
      endDate
    );

    // Filter only deliveries with matching schedule entries for today
    const filteredDeliveries = deliveriesResult.filter(d => d.scheduleEntryCount > 0);

    // Format response
    const items = filteredDeliveries.map((delivery) => ({
      id: delivery.id,
      jobId: delivery.jobId,
      deliveryNumber: delivery.deliveryNumber,
      jobNumber: delivery.jobNumber,
      builder: delivery.builderName,
      address: delivery.address,
      itemCount: delivery.itemCount,
      routeOrder: delivery.routeOrder,
      status: delivery.status,
    }));

    return NextResponse.json(items);
  } catch (error) {
    console.error('Failed to get route:', error);
    return NextResponse.json(
      { error: 'Failed to get route' },
      { status: 500 }
    );
  }
}
