export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { checkStaffAuth } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const crewId = searchParams.get('crewId');
    const status = searchParams.get('status');
    const entryType = searchParams.get('entryType');

    const skip = (page - 1) * limit;

    // Build WHERE clause conditions dynamically using parameterized queries
    const conditions: string[] = [];
    const params: any[] = [];

    if (startDate) {
      conditions.push(`se."scheduledDate" >= $${params.length + 1}::timestamptz`);
      params.push(startDate);
    }

    if (endDate) {
      conditions.push(`se."scheduledDate" <= $${params.length + 1}::timestamptz`);
      params.push(endDate);
    }

    if (crewId) {
      conditions.push(`se."crewId" = $${params.length + 1}`);
      params.push(crewId);
    }

    if (status) {
      conditions.push(`se."status" = $${params.length + 1}`);
      params.push(status);
    }

    if (entryType) {
      conditions.push(`se."entryType" = $${params.length + 1}`);
      params.push(entryType);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Fetch total count
    const countQuery = `
      SELECT COUNT(*)::int as count
      FROM "ScheduleEntry" se
      ${whereClause}
    `;

    const countResult = await prisma.$queryRawUnsafe(countQuery, ...params);
    const total = (countResult as any[])[0]?.count || 0;

    // Fetch entries with JOINs
    const entriesQuery = `
      SELECT
        se."id",
        se."jobId",
        se."crewId",
        se."entryType",
        se."title",
        se."scheduledDate",
        se."scheduledTime",
        se."status",
        se."notes",
        se."createdAt",
        se."updatedAt",
        j."id" as "job.id",
        j."jobNumber" as "job.jobNumber",
        j."builderName" as "job.builderName",
        j."jobAddress" as "job.jobAddress",
        j."community" as "job.community",
        j."lotBlock" as "job.lotBlock",
        j."status" as "job.status",
        j."scopeType" as "job.scopeType",
        c."id" as "crew.id",
        c."name" as "crew.name",
        c."active" as "crew.active"
      FROM "ScheduleEntry" se
      LEFT JOIN "Job" j ON se."jobId" = j."id"
      LEFT JOIN "Crew" c ON se."crewId" = c."id"
      ${whereClause}
      ORDER BY se."scheduledDate" ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const entriesResult = await prisma.$queryRawUnsafe(entriesQuery, ...params, limit, skip);

    // Transform flat result into nested structure
    const entries = (entriesResult as any[]).map((row) => {
      const entry: any = {
        id: row.id,
        jobId: row.jobId,
        crewId: row.crewId,
        entryType: row.entryType,
        title: row.title,
        scheduledDate: row.scheduledDate,
        scheduledTime: row.scheduledTime,
        status: row.status,
        notes: row.notes,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };

      // Map job fields
      if (row['job.id']) {
        entry.job = {
          id: row['job.id'],
          jobNumber: row['job.jobNumber'],
          builderName: row['job.builderName'],
          jobAddress: row['job.jobAddress'],
          community: row['job.community'],
          lotBlock: row['job.lotBlock'],
          status: row['job.status'],
          scopeType: row['job.scopeType'],
        };
      } else {
        entry.job = null;
      }

      // Map crew fields
      if (row['crew.id']) {
        entry.crew = {
          id: row['crew.id'],
          name: row['crew.name'],
          active: row['crew.active'],
        };
      } else {
        entry.crew = null;
      }

      // Add enriched fields
      entry.builderName = entry.job?.builderName || null;
      entry.jobAddress = entry.job?.jobAddress || null;

      return entry;
    });

    // ── Also fetch Jobs with scheduledDate that DON'T have a ScheduleEntry ──
    // This ensures PMs see all scheduled jobs on the calendar, not just manually-created entries
    // Wrapped in try-catch so auto-gen failures don't break the main schedule
    let jobEntries: any[] = []
    if (startDate && endDate) {
      try {
        const jobQuery = `
          SELECT
            j."id", j."jobNumber", j."builderName", j."jobAddress",
            j."community", j."lotBlock", j."status", j."scopeType",
            j."scheduledDate", j."orderId"
          FROM "Job" j
          WHERE j."scheduledDate" IS NOT NULL
            AND j."scheduledDate" >= $1::timestamptz
            AND j."scheduledDate" <= $2::timestamptz
            AND j."status" NOT IN ('COMPLETE', 'INVOICED', 'CLOSED')
            AND NOT EXISTS (
              SELECT 1 FROM "ScheduleEntry" se WHERE se."jobId" = j."id"
            )
          ORDER BY j."scheduledDate" ASC
          LIMIT 200
        `
        const jobRows: any[] = await prisma.$queryRawUnsafe(jobQuery, startDate, endDate)

        jobEntries = jobRows.map((j: any) => ({
          id: `job-${j.id}`,
          jobId: j.id,
          crewId: null,
          entryType: 'DELIVERY',
          title: `${j.jobNumber} — ${j.builderName || 'Unknown'}`,
          scheduledDate: j.scheduledDate,
          scheduledTime: '07:00',
          status: j.status === 'IN_TRANSIT' ? 'IN_PROGRESS'
            : j.status === 'STAGED' || j.status === 'LOADED' ? 'FIRM'
            : 'TENTATIVE',
          notes: null,
          createdAt: j.scheduledDate,
          updatedAt: j.scheduledDate,
          isAutoGenerated: true,
          job: {
            id: j.id,
            jobNumber: j.jobNumber,
            builderName: j.builderName,
            jobAddress: j.jobAddress,
            community: j.community,
            lotBlock: j.lotBlock,
            status: j.status,
            scopeType: j.scopeType,
          },
          crew: null,
          builderName: j.builderName,
          jobAddress: j.jobAddress,
        }))
      } catch (jobErr) {
        console.error('Auto-gen job entries failed (non-fatal):', jobErr)
        // Continue with just the manual ScheduleEntry records
      }
    }

    const allEntries = [...entries, ...jobEntries]

    return NextResponse.json(
      {
        data: allEntries,
        pagination: {
          page,
          limit,
          total: total + jobEntries.length,
          pages: Math.ceil((total + jobEntries.length) / limit),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('GET /api/ops/schedule error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch schedule entries' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json();

    const { jobId, entryType, title, scheduledDate, scheduledTime, crewId, notes, status } = body;

    if (!jobId || !entryType || !title || !scheduledDate) {
      return NextResponse.json(
        { error: 'Missing required fields: jobId, entryType, title, scheduledDate' },
        { status: 400 }
      );
    }

    // Generate ID: se_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}
    const entryId = `se_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    // Prepare values for INSERT using parameterized query
    const scheduledDateIso = new Date(scheduledDate).toISOString();
    const createdNow = new Date().toISOString();
    const entryStatus = status || 'TENTATIVE';

    const insertParams = [
      entryId,
      jobId,
      crewId || null,
      entryType,
      title,
      scheduledDateIso,
      scheduledTime || null,
      entryStatus,
      notes || null,
      createdNow,
      createdNow
    ];

    // Insert the ScheduleEntry
    const insertQuery = `
      INSERT INTO "ScheduleEntry"
        ("id", "jobId", "crewId", "entryType", "title", "scheduledDate", "scheduledTime", "status", "notes", "createdAt", "updatedAt")
      VALUES
        ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9, $10::timestamptz, $11::timestamptz)
    `;

    await prisma.$executeRawUnsafe(insertQuery, ...insertParams);

    // Auto-create Delivery record if entryType is DELIVERY
    if (entryType === 'DELIVERY') {
      const jobQuery = `
        SELECT "jobAddress" FROM "Job" WHERE "id" = $1
      `;
      const jobResult = await prisma.$queryRawUnsafe(jobQuery, jobId);
      const jobRow = (jobResult as any[])[0];

      if (jobRow && jobRow.jobAddress) {
        // Generate delivery number: DEL-YYYY-NNNN
        const year = new Date().getFullYear();
        const maxDeliveryQuery = `
          SELECT COALESCE(MAX(CAST(SUBSTRING("deliveryNumber" FROM '[0-9]+$') AS INT)), 0) as max_num
          FROM "Delivery"
          WHERE "deliveryNumber" LIKE 'DEL-${year}-%'
        `;
        const maxResult = await prisma.$queryRawUnsafe(maxDeliveryQuery);
        const nextNumber = ((maxResult as any[])[0]?.max_num || 0) + 1;
        const deliveryNumber = `DEL-${year}-${String(nextNumber).padStart(4, '0')}`;

        // Generate delivery ID
        const deliveryId = `del_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

        // Insert Delivery record using parameterized query
        const deliveryInsertQuery = `
          INSERT INTO "Delivery"
            ("id", "jobId", "crewId", "deliveryNumber", "address", "status", "createdAt", "updatedAt")
          VALUES
            ($1, $2, $3, $4, $5, 'SCHEDULED', $6::timestamptz, $7::timestamptz)
        `;

        await prisma.$executeRawUnsafe(deliveryInsertQuery, deliveryId, jobId, crewId || null, deliveryNumber, jobRow.jobAddress, createdNow, createdNow);
      }
    }

    // Fetch the created entry with enriched data
    const fetchQuery = `
      SELECT
        se."id",
        se."jobId",
        se."crewId",
        se."entryType",
        se."title",
        se."scheduledDate",
        se."scheduledTime",
        se."status",
        se."notes",
        se."createdAt",
        se."updatedAt",
        j."id" as "job.id",
        j."jobNumber" as "job.jobNumber",
        j."builderName" as "job.builderName",
        j."jobAddress" as "job.jobAddress",
        j."community" as "job.community",
        j."lotBlock" as "job.lotBlock",
        j."status" as "job.status",
        j."scopeType" as "job.scopeType",
        c."id" as "crew.id",
        c."name" as "crew.name",
        c."active" as "crew.active"
      FROM "ScheduleEntry" se
      LEFT JOIN "Job" j ON se."jobId" = j."id"
      LEFT JOIN "Crew" c ON se."crewId" = c."id"
      WHERE se."id" = $1
    `;

    const fetchResult = await prisma.$queryRawUnsafe(fetchQuery, entryId);
    const row = (fetchResult as any[])[0];

    if (!row) {
      return NextResponse.json(
        { error: 'Failed to retrieve created schedule entry' },
        { status: 500 }
      );
    }

    // Transform result
    const entry: any = {
      id: row.id,
      jobId: row.jobId,
      crewId: row.crewId,
      entryType: row.entryType,
      title: row.title,
      scheduledDate: row.scheduledDate,
      scheduledTime: row.scheduledTime,
      status: row.status,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    // Map job fields
    if (row['job.id']) {
      entry.job = {
        id: row['job.id'],
        jobNumber: row['job.jobNumber'],
        builderName: row['job.builderName'],
        jobAddress: row['job.jobAddress'],
        community: row['job.community'],
        lotBlock: row['job.lotBlock'],
        status: row['job.status'],
        scopeType: row['job.scopeType'],
      };
    } else {
      entry.job = null;
    }

    // Map crew fields
    if (row['crew.id']) {
      entry.crew = {
        id: row['crew.id'],
        name: row['crew.name'],
        active: row['crew.active'],
      };
    } else {
      entry.crew = null;
    }

    // Add enriched fields
    entry.builderName = entry.job?.builderName || null;
    entry.jobAddress = entry.job?.jobAddress || null;

    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    console.error('POST /api/ops/schedule error:', error);
    return NextResponse.json(
      { error: 'Failed to create schedule entry' },
      { status: 500 }
    );
  }
}
