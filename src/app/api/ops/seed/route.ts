export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireDevAdmin } from '@/lib/api-auth'

// GET /api/ops/seed — Check current data counts (dev only, ADMIN only)
export async function GET(request: NextRequest) {
  try {
    const guard = requireDevAdmin(request)
    if (guard) return guard

    const counts: Record<string, number> = {}
    // Table names are hardcoded (not user input) so this is safe.
    // Using individual tagged template queries for each known table.
    const tableQueries: Record<string, () => Promise<any[]>> = {
      BuilderOrganization: () => prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "BuilderOrganization"` as Promise<any[]>,
      Community: () => prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "Community"` as Promise<any[]>,
      Contract: () => prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "Contract"` as Promise<any[]>,
      ContractPricingTier: () => prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "ContractPricingTier"` as Promise<any[]>,
      Builder: () => prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "Builder"` as Promise<any[]>,
      Job: () => prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "Job"` as Promise<any[]>,
      CommunicationLog: () => prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "CommunicationLog"` as Promise<any[]>,
      TakeoffInquiry: () => prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "TakeoffInquiry"` as Promise<any[]>,
      IntegrationConfig: () => prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "IntegrationConfig"` as Promise<any[]>,
      SyncLog: () => prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "SyncLog"` as Promise<any[]>,
    }
    for (const [table, queryFn] of Object.entries(tableQueries)) {
      try {
        const result = await queryFn()
        counts[table] = result[0]?.count || 0
      } catch {
        counts[table] = -1
      }
    }
    return NextResponse.json({ counts })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/ops/seed — Execute raw SQL for data import (DEV ONLY)
// Accepts { sql: "single statement" } or { statements: ["stmt1", "stmt2", ...] }
// NOTE: This endpoint intentionally uses $queryRawUnsafe for ad-hoc SQL execution.
// It is guarded behind staff auth middleware and should be disabled in production.
export async function PATCH(request: NextRequest) {
  try {
    // Block in production
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Raw SQL execution is disabled in production' }, { status: 403 })
    }

    const body = await request.json()

    // Batch mode: array of statements
    if (body.statements && Array.isArray(body.statements)) {
      let ok = 0, fail = 0
      const errors: string[] = []
      for (const stmt of body.statements) {
        try {
          await prisma.$queryRawUnsafe(stmt)
          ok++
        } catch (e: any) {
          fail++
          errors.push(e.message?.substring(0, 120) || 'unknown')
        }
      }
      return NextResponse.json({ success: fail === 0, ok, fail, errors: errors.slice(0, 5) })
    }

    // Single statement mode
    const { sql } = body
    if (!sql) {
      return NextResponse.json({ error: 'sql or statements is required' }, { status: 400 })
    }
    const result = await prisma.$queryRawUnsafe(sql)
    return NextResponse.json({ success: true, result })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/ops/seed — Seeds staff, vendors, crews, and sample jobs
// Safe to run multiple times (upserts by email/code)

export async function POST(request: NextRequest) {
  try {
    const guard = requireDevAdmin(request)
    if (guard) return guard

    // ─── 1. SEED STAFF ────────────────────────────────────────
    const staffData = [
      { firstName: 'Nate', lastName: 'Barrett', email: 'n.barrett@abellumber.com', role: 'ADMIN' as const, department: 'EXECUTIVE' as const, title: 'CEO' },
      { firstName: 'Mike', lastName: 'Torres', email: 'mike.t@abellumber.com', role: 'PROJECT_MANAGER' as const, department: 'OPERATIONS' as const, title: 'Senior Project Manager' },
      { firstName: 'Sarah', lastName: 'Chen', email: 'sarah.c@abellumber.com', role: 'PROJECT_MANAGER' as const, department: 'OPERATIONS' as const, title: 'Project Manager' },
      { firstName: 'James', lastName: 'Wilson', email: 'james.w@abellumber.com', role: 'ESTIMATOR' as const, department: 'ESTIMATING' as const, title: 'Lead Estimator' },
      { firstName: 'Carlos', lastName: 'Rivera', email: 'carlos.r@abellumber.com', role: 'WAREHOUSE_LEAD' as const, department: 'MANUFACTURING' as const, title: 'Manufacturing Lead' },
      { firstName: 'Tony', lastName: 'Baker', email: 'tony.b@abellumber.com', role: 'DRIVER' as const, department: 'DELIVERY' as const, title: 'Delivery Driver' },
      { firstName: 'Sean', lastName: 'Murphy', email: 'sean.m@abellumber.com', role: 'INSTALLER' as const, department: 'INSTALLATION' as const, title: 'Install Crew Lead' },
      { firstName: 'Linda', lastName: 'Park', email: 'linda.p@abellumber.com', role: 'ACCOUNTING' as const, department: 'ACCOUNTING' as const, title: 'AR/AP Specialist' },
      { firstName: 'Derek', lastName: 'Jones', email: 'derek.j@abellumber.com', role: 'PURCHASING' as const, department: 'PURCHASING' as const, title: 'Purchasing Agent' },
      { firstName: 'Maria', lastName: 'Garcia', email: 'maria.g@abellumber.com', role: 'SALES_REP' as const, department: 'SALES' as const, title: 'Sales Representative' },
      { firstName: 'Kevin', lastName: 'Nguyen', email: 'kevin.n@abellumber.com', role: 'QC_INSPECTOR' as const, department: 'MANUFACTURING' as const, title: 'Quality Inspector' },
      { firstName: 'Dave', lastName: 'Thompson', email: 'dave.t@abellumber.com', role: 'WAREHOUSE_TECH' as const, department: 'WAREHOUSE' as const, title: 'Door Hanger' },
    ]

    const staff: any[] = []
    for (const s of staffData) {
      const result = await prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO "Staff" (
          "firstName", "lastName", "email", "role", "department", "title", "passwordHash", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, $4::"StaffRole", $5::"Department", $6, $7, NOW(), NOW()
        )
        ON CONFLICT ("email") DO UPDATE SET
          "firstName" = EXCLUDED."firstName",
          "lastName" = EXCLUDED."lastName",
          "role" = EXCLUDED."role",
          "department" = EXCLUDED."department",
          "title" = EXCLUDED."title",
          "updatedAt" = NOW()
        RETURNING *`,
        s.firstName,
        s.lastName,
        s.email,
        s.role,
        s.department,
        s.title,
        '$2b$10$placeholder_hash_changeme123'
      )
      staff.push(result[0])
    }

    // ─── 2. SEED VENDORS ──────────────────────────────────────
    const vendorData = [
      { name: 'DW Distribution', code: 'DW', contactName: 'Matt Reynolds', email: 'orders@dwdist.com', phone: '(555) 100-2000', avgLeadDays: 5, website: 'https://dwdist.com' },
      { name: 'Boise Cascade', code: 'BC', contactName: 'Jennifer Walsh', email: 'orders@bc.com', phone: '(555) 200-3000', avgLeadDays: 7, website: 'https://bc.com' },
      { name: 'Masonite', code: 'MASO', contactName: 'Robert Kim', email: 'sales@masonite.com', phone: '(555) 300-4000', avgLeadDays: 10, website: 'https://masonite.com' },
      { name: 'ThermaTrue', code: 'TT', contactName: 'Lisa Adams', email: 'builder@thermatru.com', phone: '(555) 400-5000', avgLeadDays: 14, website: 'https://thermatru.com' },
      { name: 'Emtek Hardware', code: 'EMTK', contactName: 'Steve Park', email: 'pro@emtek.com', phone: '(555) 500-6000', avgLeadDays: 3, website: 'https://emtek.com' },
    ]

    const vendors: any[] = []
    for (const v of vendorData) {
      const result = await prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO "Vendor" (
          "name", "code", "contactName", "email", "phone", "avgLeadDays", "website", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()
        )
        ON CONFLICT ("code") DO UPDATE SET
          "name" = EXCLUDED."name",
          "contactName" = EXCLUDED."contactName",
          "email" = EXCLUDED."email",
          "phone" = EXCLUDED."phone",
          "avgLeadDays" = EXCLUDED."avgLeadDays",
          "updatedAt" = NOW()
        RETURNING *`,
        v.name,
        v.code,
        v.contactName,
        v.email,
        v.phone,
        v.avgLeadDays,
        v.website
      )
      vendors.push(result[0])
    }

    // ─── 3. SEED CREWS ────────────────────────────────────────
    const existingCrewsResult = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "Crew"`
    )
    let crews = existingCrewsResult

    if (existingCrewsResult.length === 0) {
      const crewData = [
        { name: 'Delivery Team A — Tony', crewType: 'DELIVERY' as const, vehiclePlate: 'ABL-101' },
        { name: 'Delivery Team B', crewType: 'DELIVERY' as const, vehiclePlate: 'ABL-102' },
        { name: 'Install Crew — Sean', crewType: 'INSTALLATION' as const },
        { name: 'Install Crew — B Team', crewType: 'DELIVERY_AND_INSTALL' as const },
      ]
      const created = []
      for (const c of crewData) {
        const result = await prisma.$queryRawUnsafe<any[]>(
          `INSERT INTO "Crew" (
            "name", "crewType", "vehiclePlate", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2::"CrewType", $3, NOW(), NOW()
          )
          RETURNING *`,
          c.name,
          c.crewType,
          c.vehiclePlate || null
        )
        created.push(result[0])
      }
      crews = created
    }

    // ─── 4. SEED SAMPLE JOBS ──────────────────────────────────
    // Pull some real builders for job creation with projects
    const builders = await prisma.$queryRawUnsafe<any[]>(
      `SELECT b.*,
        (SELECT json_agg(json_build_object('id', p.id, 'jobAddress', p.jobAddress))
         FROM "Project" p WHERE p."builderId" = b.id LIMIT 1) as projects
       FROM "Builder" b
       WHERE b."status" = 'ACTIVE'
       LIMIT 15`
    )

    const pmMike = staff.find((s: any) => s.email === 'mike.t@abellumber.com')
    const pmSarah = staff.find((s: any) => s.email === 'sarah.c@abellumber.com')

    // Check if jobs already seeded
    const jobCountResult = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS count FROM "Job"`
    )
    const existingJobs = jobCountResult[0]?.count || 0
    let jobsCreated = 0

    if (existingJobs === 0 && builders.length > 0) {
      const communities = ['Canyon Ridge', 'Sunset Hills', 'Oakmont Estates', 'Heritage Springs', 'Riverwalk', 'Meadow Creek', 'Summit Pointe']
      const scopeTypes = ['DOORS_ONLY', 'DOORS_AND_TRIM', 'FULL_PACKAGE', 'TRIM_ONLY', 'HARDWARE_ONLY'] as const
      const statuses = ['CREATED', 'READINESS_CHECK', 'MATERIALS_LOCKED', 'IN_PRODUCTION', 'STAGED', 'LOADED', 'IN_TRANSIT', 'DELIVERED', 'INSTALLING', 'PUNCH_LIST', 'COMPLETE', 'INVOICED'] as const
      const dropPlans = ['Single Drop', 'Staged', 'Multi-Drop']

      const jobsToCreate = Math.min(builders.length, 12)
      for (let i = 0; i < jobsToCreate; i++) {
        const builder = builders[i]
        const status = statuses[i % statuses.length]
        const community = communities[i % communities.length]
        const pm = i % 2 === 0 ? pmMike : pmSarah
        const scopeType = scopeTypes[i % scopeTypes.length]
        const lotNum = Math.floor(Math.random() * 30) + 1
        const blockNum = Math.floor(Math.random() * 5) + 1

        const jobNum = `JOB-2026-${String(i + 1).padStart(4, '0')}`

        // Calculate scheduled date (spread across next 2 weeks)
        const schedDate = new Date()
        schedDate.setDate(schedDate.getDate() + Math.floor(Math.random() * 14) - 3)

        const readinessCheck = ['READINESS_CHECK', 'MATERIALS_LOCKED', 'IN_PRODUCTION', 'STAGED', 'LOADED', 'IN_TRANSIT', 'DELIVERED', 'INSTALLING', 'PUNCH_LIST', 'COMPLETE', 'INVOICED'].includes(status)
        const materialsLocked = ['MATERIALS_LOCKED', 'IN_PRODUCTION', 'STAGED', 'LOADED', 'IN_TRANSIT', 'DELIVERED', 'INSTALLING', 'PUNCH_LIST', 'COMPLETE', 'INVOICED'].includes(status)
        const loadConfirmed = ['LOADED', 'IN_TRANSIT', 'DELIVERED', 'INSTALLING', 'PUNCH_LIST', 'COMPLETE', 'INVOICED'].includes(status)
        const completedAt = ['COMPLETE', 'INVOICED'].includes(status) ? new Date() : null
        const jobAddress = (builder.projects && builder.projects[0]?.jobAddress) || `${1000 + i * 100} ${community} Dr`

        await prisma.$executeRawUnsafe(
          `INSERT INTO "Job" (
            "jobNumber", "builderName", "builderContact", "jobAddress", "lotBlock", "community", "scopeType", "status", "dropPlan", "assignedPMId", "scheduledDate", "readinessCheck", "materialsLocked", "loadConfirmed", "completedAt", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7::"JobScopeType", $8::"JobStatus", $9, $10, $11, $12, $13, $14, $15, NOW(), NOW()
          )`,
          jobNum,
          builder.companyName,
          builder.contactName,
          jobAddress,
          `Lot ${lotNum} Block ${blockNum}`,
          community,
          scopeType,
          status,
          dropPlans[i % 3],
          pm?.id || null,
          schedDate,
          readinessCheck,
          materialsLocked,
          loadConfirmed,
          completedAt
        )
        jobsCreated++
      }
    }

    // ─── 5. SEED SCHEDULE ENTRIES FOR JOBS ────────────────────
    const jobsResult = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "Job" LIMIT 12`
    )
    let schedulesCreated = 0
    const scheduleCountResult = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS count FROM "ScheduleEntry"`
    )
    const existingSchedules = scheduleCountResult[0]?.count || 0

    if (existingSchedules === 0 && jobsResult.length > 0) {
      for (const job of jobsResult) {
        const schedDate = job.scheduledDate || new Date()
        const times = ['7:00 AM', '8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM', '1:00 PM', '2:00 PM']
        const selectedTime = times[Math.floor(Math.random() * times.length)]

        let entryStatus = 'TENTATIVE'
        if (job.status === 'DELIVERED' || job.status === 'COMPLETE') {
          entryStatus = 'COMPLETED'
        } else if (job.status === 'IN_TRANSIT') {
          entryStatus = 'IN_PROGRESS'
        }

        await prisma.$executeRawUnsafe(
          `INSERT INTO "ScheduleEntry" (
            "jobId", "entryType", "title", "scheduledDate", "scheduledTime", "crewId", "status", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2::"ScheduleEntryType", $3, $4, $5, $6, $7::"ScheduleEntryStatus", NOW(), NOW()
          )`,
          job.id,
          'DELIVERY',
          `Deliver to ${job.builderName} — ${job.community || 'TBD'}`,
          schedDate,
          selectedTime,
          crews[0]?.id || null,
          entryStatus
        )
        schedulesCreated++
      }
    }

    return NextResponse.json({
      message: 'Ops seed complete',
      staff: staff.length,
      vendors: vendors.length,
      crews: crews.length,
      jobsCreated,
      schedulesCreated,
      note: existingJobs > 0 ? 'Jobs already existed — skipped job/schedule seeding' : undefined,
    })
  } catch (error: any) {
    console.error('Seed error:', error)
    return NextResponse.json(
      { error: 'Seed failed' },
      { status: 500 }
    )
  }
}
