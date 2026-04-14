export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { checkStaffAuth } from '@/lib/api-auth'
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

    const entries = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        se."id",
        se."jobId",
        se."crewId",
        se."entryType",
        se."title",
        se."scheduledDate",
        se."scheduledTime",
        se."status",
        se."notes",
        se."startedAt",
        se."completedAt",
        se."createdAt",
        se."updatedAt",
        j."id" as "job_id",
        j."jobNumber" as "job_jobNumber",
        j."builderName" as "job_builderName",
        j."jobAddress" as "job_jobAddress",
        j."community" as "job_community",
        j."lotBlock" as "job_lotBlock",
        j."status" as "job_status",
        j."scopeType" as "job_scopeType",
        c."id" as "crew_id",
        c."name" as "crew_name",
        c."active" as "crew_active"
      FROM "ScheduleEntry" se
      LEFT JOIN "Job" j ON se."jobId" = j."id"
      LEFT JOIN "Crew" c ON se."crewId" = c."id"
      WHERE se."id" = $1`,
      id
    );

    if (entries.length === 0) {
      return NextResponse.json(
        { error: 'Schedule entry not found' },
        { status: 404 }
      );
    }

    const row = entries[0];

    const entry = {
      id: row.id,
      jobId: row.jobId,
      crewId: row.crewId,
      entryType: row.entryType,
      title: row.title,
      scheduledDate: row.scheduledDate,
      scheduledTime: row.scheduledTime,
      status: row.status,
      notes: row.notes,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      job: row.job_id ? {
        id: row.job_id,
        jobNumber: row.job_jobNumber,
        builderName: row.job_builderName,
        jobAddress: row.job_jobAddress,
        community: row.job_community,
        lotBlock: row.job_lotBlock,
        status: row.job_status,
        scopeType: row.job_scopeType,
      } : null,
      crew: row.crew_id ? {
        id: row.crew_id,
        name: row.crew_name,
        active: row.crew_active,
      } : null,
    };

    const enrichedEntry = {
      ...entry,
      builderName: entry.job?.builderName,
      jobAddress: entry.job?.jobAddress,
    };

    return NextResponse.json(enrichedEntry, { status: 200 });
  } catch (error) {
    console.error('GET /api/ops/schedule/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch schedule entry' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params;
    const body = await request.json();

    const { status, scheduledDate, scheduledTime, crewId, notes, startedAt, completedAt } = body;

    // Build dynamic SET clauses
    const setClauses: string[] = [];
    const params_array: any[] = [id];
    let paramIndex = 2;

    if (status !== undefined) {
      setClauses.push(`"status" = $${paramIndex}`);
      params_array.push(status);
      paramIndex++;
    }
    if (scheduledDate !== undefined) {
      setClauses.push(`"scheduledDate" = $${paramIndex}::timestamptz`);
      params_array.push(scheduledDate);
      paramIndex++;
    }
    if (scheduledTime !== undefined) {
      setClauses.push(`"scheduledTime" = $${paramIndex}`);
      params_array.push(scheduledTime);
      paramIndex++;
    }
    if (crewId !== undefined) {
      setClauses.push(`"crewId" = $${paramIndex}`);
      params_array.push(crewId);
      paramIndex++;
    }
    if (notes !== undefined) {
      setClauses.push(`"notes" = $${paramIndex}`);
      params_array.push(notes);
      paramIndex++;
    }
    if (startedAt !== undefined) {
      setClauses.push(`"startedAt" = $${paramIndex}::timestamptz`);
      params_array.push(startedAt);
      paramIndex++;
    }
    if (completedAt !== undefined) {
      setClauses.push(`"completedAt" = $${paramIndex}::timestamptz`);
      params_array.push(completedAt);
      paramIndex++;
    }

    if (setClauses.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    // Execute UPDATE query
    await prisma.$executeRawUnsafe(
      `UPDATE "ScheduleEntry"
      SET ${setClauses.join(', ')}
      WHERE "id" = $1`,
      ...params_array
    );

    // Re-fetch and return enriched entry
    const entries = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        se."id",
        se."jobId",
        se."crewId",
        se."entryType",
        se."title",
        se."scheduledDate",
        se."scheduledTime",
        se."status",
        se."notes",
        se."startedAt",
        se."completedAt",
        se."createdAt",
        se."updatedAt",
        j."id" as "job_id",
        j."jobNumber" as "job_jobNumber",
        j."builderName" as "job_builderName",
        j."jobAddress" as "job_jobAddress",
        j."community" as "job_community",
        j."lotBlock" as "job_lotBlock",
        j."status" as "job_status",
        j."scopeType" as "job_scopeType",
        c."id" as "crew_id",
        c."name" as "crew_name",
        c."active" as "crew_active"
      FROM "ScheduleEntry" se
      LEFT JOIN "Job" j ON se."jobId" = j."id"
      LEFT JOIN "Crew" c ON se."crewId" = c."id"
      WHERE se."id" = $1`,
      id
    );

    if (entries.length === 0) {
      return NextResponse.json(
        { error: 'Schedule entry not found' },
        { status: 404 }
      );
    }

    const row = entries[0];

    const entry = {
      id: row.id,
      jobId: row.jobId,
      crewId: row.crewId,
      entryType: row.entryType,
      title: row.title,
      scheduledDate: row.scheduledDate,
      scheduledTime: row.scheduledTime,
      status: row.status,
      notes: row.notes,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      job: row.job_id ? {
        id: row.job_id,
        jobNumber: row.job_jobNumber,
        builderName: row.job_builderName,
        jobAddress: row.job_jobAddress,
        community: row.job_community,
        lotBlock: row.job_lotBlock,
        status: row.job_status,
        scopeType: row.job_scopeType,
      } : null,
      crew: row.crew_id ? {
        id: row.crew_id,
        name: row.crew_name,
        active: row.crew_active,
      } : null,
    };

    const enrichedEntry = {
      ...entry,
      builderName: entry.job?.builderName,
      jobAddress: entry.job?.jobAddress,
    };

    await audit(request, 'UPDATE', 'ScheduleEntry', id, { status, crewId })

    return NextResponse.json(enrichedEntry, { status: 200 });
  } catch (error) {
    console.error('PATCH /api/ops/schedule/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to update schedule entry' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params;

    await prisma.$executeRawUnsafe(
      `DELETE FROM "ScheduleEntry" WHERE "id" = $1`,
      id
    );

    await audit(request, 'DELETE', 'ScheduleEntry', id, {})

    return NextResponse.json(
      { message: 'Schedule entry deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('DELETE /api/ops/schedule/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to delete schedule entry' },
      { status: 500 }
    );
  }
}
