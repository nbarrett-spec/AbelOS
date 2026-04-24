export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { checkStaffAuth } from '@/lib/api-auth'
import { fireAutomationEvent } from '@/lib/automation-executor'
import { audit } from '@/lib/audit'
import { allocateForJob } from '@/lib/allocation'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams;

    // Pagination
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

    // Filters
    const status = searchParams.get('status');
    const assignedPMId = searchParams.get('assignedPMId');
    const builderName = searchParams.get('builderName');
    const community = searchParams.get('community');
    const scheduledDateFrom = searchParams.get('scheduledDateFrom');
    const scheduledDateTo = searchParams.get('scheduledDateTo');
    const search = searchParams.get('search');

    // Build WHERE clause conditions
    const whereConditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (status) {
      // Support comma-separated status values (e.g., "CREATED,IN_PRODUCTION,STAGED")
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean)
      if (statuses.length === 1) {
        whereConditions.push(`j."status"::text = $${paramIndex}`)
        params.push(statuses[0])
        paramIndex++
      } else if (statuses.length > 1) {
        const placeholders = statuses.map((_, i) => `$${paramIndex + i}`).join(', ')
        whereConditions.push(`j."status"::text IN (${placeholders})`)
        params.push(...statuses)
        paramIndex += statuses.length
      }
    }

    if (assignedPMId) {
      whereConditions.push(`j."assignedPMId" = $${paramIndex}`);
      params.push(assignedPMId);
      paramIndex++;
    }

    if (builderName) {
      whereConditions.push(`j."builderName" ILIKE $${paramIndex}`);
      params.push(`%${builderName}%`);
      paramIndex++;
    }

    if (community) {
      whereConditions.push(`j."community" ILIKE $${paramIndex}`);
      params.push(`%${community}%`);
      paramIndex++;
    }

    if (scheduledDateFrom) {
      whereConditions.push(`j."scheduledDate" >= $${paramIndex}`);
      params.push(scheduledDateFrom);
      paramIndex++;
    }

    if (scheduledDateTo) {
      whereConditions.push(`j."scheduledDate" <= $${paramIndex}`);
      params.push(scheduledDateTo);
      paramIndex++;
    }

    if (search) {
      const searchPattern = `%${search}%`;
      whereConditions.push(`(j."jobNumber" ILIKE $${paramIndex} OR j."builderName" ILIKE $${paramIndex + 1} OR j."community" ILIKE $${paramIndex + 2} OR j."jobAddress" ILIKE $${paramIndex + 3})`);
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
      paramIndex += 4;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get total count
    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM "Job" j
      ${whereClause}
    `;
    const countResult: any = await prisma.$queryRawUnsafe(countQuery, ...params);
    const total = countResult[0]?.total || 0;

    // Get jobs with related data
    const jobsQuery = `
      SELECT
        j."id",
        j."jobNumber",
        j."orderId",
        j."builderName",
        j."builderContact",
        j."jobAddress",
        j."lotBlock",
        j."community",
        j."scopeType",
        j."jobType",
        j."dropPlan",
        j."assignedPMId",
        j."status",
        j."readinessCheck",
        j."materialsLocked",
        j."loadConfirmed",
        j."scheduledDate",
        j."actualDate",
        j."completedAt",
        j."latitude",
        j."longitude",
        j."boltJobId",
        j."inflowJobId",
        j."createdAt",
        j."updatedAt"
      FROM "Job" j
      ${whereClause}
      ORDER BY j."createdAt" DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const jobs: any = await prisma.$queryRawUnsafe(jobsQuery, ...params, limit, skip);

    // Get related data for each job
    const jobsWithRelations = await Promise.all(
      jobs.map(async (job: any) => {
        // Get order and builder data
        let orderData = null;
        if (job.orderId) {
          const orderQuery = `
            SELECT
              o."id",
              o."orderNumber",
              o."builderId",
              o."total",
              o."status"
            FROM "Order" o
            WHERE o."id" = $1
          `;
          const orders: any = await prisma.$queryRawUnsafe(orderQuery, job.orderId).catch(() => []);
          if (orders.length > 0) {
            const order = orders[0];
            if (order.builderId) {
              const builderQuery = `
                SELECT
                  b."id",
                  b."companyName",
                  b."contactName",
                  b."email",
                  b."phone"
                FROM "Builder" b
                WHERE b."id" = $1
              `;
              const builders: any = await prisma.$queryRawUnsafe(builderQuery, order.builderId).catch(() => []);
              order.builder = builders.length > 0 ? builders[0] : null;
            }
            orderData = order;
          }
        }

        // Get assigned PM data
        let assignedPM = null;
        if (job.assignedPMId) {
          const staffQuery = `
            SELECT
              s."id",
              s."firstName",
              s."lastName",
              s."email",
              s."phone"
            FROM "Staff" s
            WHERE s."id" = $1
          `;
          const staff: any = await prisma.$queryRawUnsafe(staffQuery, job.assignedPMId).catch(() => []);
          assignedPM = staff.length > 0 ? staff[0] : null;
        }

        // Get counts for related records
        const countDecisionNotesQuery = `SELECT COUNT(*)::int AS count FROM "DecisionNote" WHERE "jobId" = $1`;
        const countTasksQuery = `SELECT COUNT(*)::int AS count FROM "Task" WHERE "jobId" = $1`;
        const countDeliveriesQuery = `SELECT COUNT(*)::int AS count FROM "Delivery" WHERE "jobId" = $1`;
        const countInstallationsQuery = `SELECT COUNT(*)::int AS count FROM "Installation" WHERE "jobId" = $1`;

        const [decisionNotesCount, tasksCount, deliveriesCount, installationsCount] = await Promise.all([
          prisma.$queryRawUnsafe(countDecisionNotesQuery, job.id).then((r: any) => r[0]?.count || 0).catch(() => 0),
          prisma.$queryRawUnsafe(countTasksQuery, job.id).then((r: any) => r[0]?.count || 0).catch(() => 0),
          prisma.$queryRawUnsafe(countDeliveriesQuery, job.id).then((r: any) => r[0]?.count || 0).catch(() => 0),
          prisma.$queryRawUnsafe(countInstallationsQuery, job.id).then((r: any) => r[0]?.count || 0).catch(() => 0),
        ]);

        return {
          ...job,
          order: orderData,
          assignedPM,
          _count: {
            decisionNotes: decisionNotesCount,
            tasks: tasksCount,
            deliveries: deliveriesCount,
            installations: installationsCount,
          },
        };
      })
    );

    // Get job counts by status for pipeline view
    const statusCountsQuery = `
      SELECT
        j."status",
        COUNT(*)::int AS count
      FROM "Job" j
      WHERE j."status" != 'CLOSED'
      GROUP BY j."status"
    `;
    const statusCountsResult: any = await prisma.$queryRawUnsafe(statusCountsQuery).catch(() => []);
    const statusCountsMap = statusCountsResult.reduce(
      (acc: Record<string, number>, item: any) => {
        acc[item.status] = item.count;
        return acc;
      },
      {} as Record<string, number>
    );

    return NextResponse.json(
      {
        data: jobsWithRelations,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
        statusCounts: statusCountsMap,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Job', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json();

    const {
      builderName,
      scopeType,
      jobType,
      orderId,
      lotBlock,
      community,
      builderContact,
      jobAddress,
      assignedPMId,
      scheduledDate,
      dropPlan,
    } = body;

    // Validate required fields
    if (!builderName || !scopeType) {
      return NextResponse.json(
        { error: 'builderName and scopeType are required' },
        { status: 400 }
      );
    }

    // Job type code map for new numbering format: "<address> <code>"
    const JOB_TYPE_CODES: Record<string, string> = {
      TRIM_1: 'T1', TRIM_1_INSTALL: 'T1I', TRIM_2: 'T2', TRIM_2_INSTALL: 'T2I',
      DOORS: 'DR', DOOR_INSTALL: 'DRI', HARDWARE: 'HW', HARDWARE_INSTALL: 'HWI',
      FINAL_FRONT: 'FF', FINAL_FRONT_INSTALL: 'FFI', QC_WALK: 'QC', PUNCH: 'PL',
      WARRANTY: 'WR', CUSTOM: 'CU',
    }

    // Generate jobNumber:
    //   New format (when jobAddress + jobType provided): "10567 Boxthorn T1"
    //   Legacy fallback: "JOB-YYYY-NNNN"
    let jobNumber: string
    if (jobAddress && jobType && JOB_TYPE_CODES[jobType]) {
      jobNumber = `${jobAddress} ${JOB_TYPE_CODES[jobType]}`
    } else {
      const year = new Date().getFullYear();
      const jobNumberPrefix = `JOB-${year}-`;
      const maxNumQuery = `
        SELECT COALESCE(MAX(CAST(SUBSTRING("jobNumber" FROM '[0-9]+$') AS INT)), 0) AS max_num
        FROM "Job"
        WHERE "jobNumber" LIKE $1
      `;
      const maxNumResult: any = await prisma.$queryRawUnsafe(maxNumQuery, `${jobNumberPrefix}%`);
      const nextNumber = (maxNumResult[0]?.max_num || 0) + 1;
      jobNumber = `${jobNumberPrefix}${String(nextNumber).padStart(4, '0')}`;
    }

    // Generate UUID for the new job
    const uuidQuery = `SELECT gen_random_uuid() AS id`;
    const uuidResult: any = await prisma.$queryRawUnsafe(uuidQuery);
    const jobId = uuidResult[0]?.id;

    // Create job with raw SQL
    const createJobQuery = `
      INSERT INTO "Job" (
        "id",
        "jobNumber",
        "builderName",
        "scopeType",
        "jobType",
        "orderId",
        "lotBlock",
        "community",
        "builderContact",
        "jobAddress",
        "assignedPMId",
        "scheduledDate",
        "dropPlan",
        "status",
        "createdAt",
        "updatedAt"
      ) VALUES (
        $1,
        $2,
        $3,
        $4::"ScopeType",
        $5::"JobType",
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14::"JobStatus",
        $15,
        $16
      )
    `;

    const now = new Date();
    await prisma.$executeRawUnsafe(
      createJobQuery,
      jobId,
      jobNumber,
      builderName,
      scopeType,
      jobType || null,
      orderId || null,
      lotBlock || null,
      community || null,
      builderContact || null,
      jobAddress || null,
      assignedPMId || null,
      scheduledDate ? new Date(scheduledDate) : null,
      dropPlan || null,
      'CREATED',
      now,
      now
    );

    // Fetch the created job with all related data
    const jobQuery = `
      SELECT
        j."id",
        j."jobNumber",
        j."orderId",
        j."builderName",
        j."builderContact",
        j."jobAddress",
        j."lotBlock",
        j."community",
        j."scopeType",
        j."dropPlan",
        j."assignedPMId",
        j."status",
        j."readinessCheck",
        j."materialsLocked",
        j."loadConfirmed",
        j."scheduledDate",
        j."actualDate",
        j."completedAt",
        j."createdAt",
        j."updatedAt"
      FROM "Job" j
      WHERE j."id" = $1
    `;

    const createdJobs: any = await prisma.$queryRawUnsafe(jobQuery, jobId);
    const job = createdJobs[0];

    // Get order and builder data
    let orderData = null;
    if (job.orderId) {
      const orderQuery = `
        SELECT
          o."id",
          o."orderNumber",
          o."builderId",
          o."total",
          o."status"
        FROM "Order" o
        WHERE o."id" = $1
      `;
      const orders: any = await prisma.$queryRawUnsafe(orderQuery, job.orderId).catch(() => []);
      if (orders.length > 0) {
        const order = orders[0];
        if (order.builderId) {
          const builderQuery = `
            SELECT
              b."id",
              b."companyName",
              b."contactName",
              b."email",
              b."phone"
            FROM "Builder" b
            WHERE b."id" = $1
          `;
          const builders: any = await prisma.$queryRawUnsafe(builderQuery, order.builderId).catch(() => []);
          order.builder = builders.length > 0 ? builders[0] : null;
        }
        orderData = order;
      }
    }

    // Get assigned PM data
    let assignedPM = null;
    if (job.assignedPMId) {
      const staffQuery = `
        SELECT
          s."id",
          s."firstName",
          s."lastName",
          s."email",
          s."phone"
        FROM "Staff" s
        WHERE s."id" = $1
      `;
      const staff: any = await prisma.$queryRawUnsafe(staffQuery, job.assignedPMId).catch(() => []);
      assignedPM = staff.length > 0 ? staff[0] : null;
    }

    // Get counts for related records
    const countDecisionNotesQuery = `SELECT COUNT(*)::int AS count FROM "DecisionNote" WHERE "jobId" = $1`;
    const countTasksQuery = `SELECT COUNT(*)::int AS count FROM "Task" WHERE "jobId" = $1`;
    const countDeliveriesQuery = `SELECT COUNT(*)::int AS count FROM "Delivery" WHERE "jobId" = $1`;
    const countInstallationsQuery = `SELECT COUNT(*)::int AS count FROM "Installation" WHERE "jobId" = $1`;

    const [decisionNotesCount, tasksCount, deliveriesCount, installationsCount] = await Promise.all([
      prisma.$queryRawUnsafe(countDecisionNotesQuery, jobId).then((r: any) => r[0]?.count || 0).catch(() => 0),
      prisma.$queryRawUnsafe(countTasksQuery, jobId).then((r: any) => r[0]?.count || 0).catch(() => 0),
      prisma.$queryRawUnsafe(countDeliveriesQuery, jobId).then((r: any) => r[0]?.count || 0).catch(() => 0),
      prisma.$queryRawUnsafe(countInstallationsQuery, jobId).then((r: any) => r[0]?.count || 0).catch(() => 0),
    ]);

    const responseJob = {
      ...job,
      order: orderData,
      assignedPM,
      _count: {
        decisionNotes: decisionNotesCount,
        tasks: tasksCount,
        deliveries: deliveriesCount,
        installations: installationsCount,
      },
    };

    // Fire automation event (non-blocking)
    fireAutomationEvent('JOB_STATUS_CHANGED', jobId).catch(e => console.warn('[Automation] event fire failed:', e))

    // Allocation ledger: write rows at creation time when the Job has an
    // Order attached, so material is immediately reserved and not double-
    // promised to a later job. Fire-and-forget — don't block job creation
    // on a ledger error.
    if (orderId) {
      allocateForJob(jobId).catch((e: any) => {
        console.warn('[Job POST] allocateForJob failed:', e?.message)
      })
    }

    return NextResponse.json(responseJob, { status: 201 });
  } catch (error) {
    console.error('Error creating job:', error);
    return NextResponse.json(
      { error: 'Failed to create job' },
      { status: 500 }
    );
  }
}
