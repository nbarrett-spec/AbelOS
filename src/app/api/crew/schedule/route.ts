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

    // Get all schedule entries for this crew on this date
    const scheduleEntries = await prisma.$queryRawUnsafe<Array<{
      id: string;
      jobId: string;
      title: string;
      jobNumber: string;
      builderName: string;
      jobAddress: string | null;
      community: string | null;
      lotBlock: string | null;
      builderContact: string;
      scheduledTime: string | null;
      status: string;
      entryType: string;
    }>>(
      `SELECT se.id, se."jobId", se.title, se.status, se."entryType", se."scheduledTime",
              j.id as "jobNumber_id", j."jobNumber", j."builderName", j."jobAddress", j.community, j."lotBlock", j."builderContact"
       FROM "ScheduleEntry" se
       JOIN "Job" j ON se."jobId" = j.id
       WHERE se."crewId" = $1 AND se."scheduledDate" >= $2 AND se."scheduledDate" <= $3
       ORDER BY se."scheduledTime" ASC`,
      crewId,
      startDate,
      endDate
    );

    // Format response
    const items = scheduleEntries.map((entry) => ({
      id: entry.id,
      jobId: entry.jobId,
      title: entry.title,
      jobNumber: entry.jobNumber,
      builderName: entry.builderName,
      address: entry.jobAddress || 'Address TBD',
      scheduledTime: entry.scheduledTime || 'Time TBD',
      status: entry.status,
      type: entry.entryType,
      community: entry.community,
      lotBlock: entry.lotBlock,
    }));

    return NextResponse.json(items);
  } catch (error) {
    console.error('Failed to get schedule:', error);
    return NextResponse.json(
      { error: 'Failed to get schedule' },
      { status: 500 }
    );
  }
}
