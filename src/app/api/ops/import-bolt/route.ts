export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/import-bolt — Import scraped Bolt Tech data into Abel platform
// ──────────────────────────────────────────────────────────────────────────
// Accepts JSON body with: customers, employees, crews, communities, jobs,
// floorplans, woTypes, workOrders
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      customers = [],
      employees = [],
      crews = [],
      communities = [],
      jobs = [],
      floorplans = [],
      woTypes = [],
      workOrders = [],
    } = body
    audit(request, 'IMPORT_BOLT', 'BoltImport', undefined, {
      customers: customers.length, employees: employees.length, crews: crews.length,
      communities: communities.length, jobs: jobs.length, floorplans: floorplans.length,
      woTypes: woTypes.length, workOrders: workOrders.length,
    }, 'WARN').catch(() => {})

    const results: any = {
      customers: { imported: 0, skipped: 0, errors: [] as string[] },
      employees: { imported: 0, skipped: 0, errors: [] as string[] },
      crews: { imported: 0, skipped: 0, errors: [] as string[] },
      communities: { imported: 0, skipped: 0, errors: [] as string[] },
      jobs: { imported: 0, skipped: 0, errors: [] as string[] },
      floorplans: { imported: 0, skipped: 0, errors: [] as string[] },
      woTypes: { imported: 0, skipped: 0, errors: [] as string[] },
      workOrders: { imported: 0, skipped: 0, errors: [] as string[] },
    }

    // ── 1. Auto-create tables if not existing ──
    await ensureTables()

    // ── 2. Import Customers → Builder table ──
    const passwordHash = await hashPassword('Abel2026!')
    const builderIdMap: Record<string, string> = {} // boltCustomerName → builderId

    for (const c of customers) {
      if (!c.name || c.name === 'Name') { results.customers.skipped++; continue }
      try {
        const existing: any[] = await prisma.$queryRawUnsafe(
          `SELECT id FROM "Builder" WHERE "companyName" = $1 LIMIT 1`,
          c.name
        )
        if (existing.length > 0) {
          builderIdMap[c.name] = existing[0].id
          results.customers.skipped++
          continue
        }

        const builderId = `bld_bolt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
        const email = c.email && c.email !== 'n.barrett@abellumber.com'
          ? c.email
          : `${c.name.toLowerCase().replace(/[^a-z0-9]/g, '')}@placeholder.bolt`
        const status = c.status === 'Active' ? 'ACTIVE' : c.status === 'Inactive' ? 'SUSPENDED' : 'PENDING'

        await prisma.$executeRawUnsafe(
          `INSERT INTO "Builder" (
            "id", "companyName", "contactName", "email", "passwordHash",
            "phone", "status", "paymentTerm", "accountBalance", "taxExempt",
            "emailVerified", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7::"AccountStatus", 'NET_15'::"PaymentTerm", 0, false,
            false, NOW(), NOW()
          )
          ON CONFLICT ("email") DO NOTHING`,
          builderId,
          c.name,
          c.name, // contactName = companyName for now
          email,
          passwordHash,
          c.phone || null,
          status
        )
        builderIdMap[c.name] = builderId
        results.customers.imported++
      } catch (e: any) {
        results.customers.errors.push(`${c.name}: ${e.message?.slice(0, 80)}`)
      }
    }

    // ── 3. Import Employees → Staff table ──
    const staffIdMap: Record<string, string> = {} // boltEmpId → staffId

    for (const emp of employees) {
      if (!emp.firstName || emp.firstName === 'Bolt') { results.employees.skipped++; continue }
      try {
        const existing: any[] = await prisma.$queryRawUnsafe(
          `SELECT id FROM "Staff" WHERE "email" = $1 LIMIT 1`,
          emp.email || `${emp.firstName.toLowerCase()}.${emp.lastName.toLowerCase()}@abellumber.com`
        )
        if (existing.length > 0) {
          staffIdMap[emp.boltId] = existing[0].id
          results.employees.skipped++
          continue
        }

        const staffId = `stf_bolt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
        const email = emp.email || `${emp.firstName.toLowerCase()}.${emp.lastName.toLowerCase()}@abellumber.com`

        // Map Bolt crew/type to Abel role and department
        const { role, department } = mapBoltEmployeeRole(emp)
        const hireDateVal = emp.hireDate ? parseMMDDDate(emp.hireDate) : null

        if (hireDateVal) {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "Staff" (
              "id", "firstName", "lastName", "email", "passwordHash",
              "phone", "role", "department", "title", "active",
              "hireDate", "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, $4, $5,
              $6, $7::"StaffRole", $8::"Department", $9, true,
              $10::timestamptz, NOW(), NOW()
            )
            ON CONFLICT ("email") DO NOTHING`,
            staffId,
            emp.firstName,
            emp.lastName,
            email,
            passwordHash,
            emp.phone || null,
            role,
            department,
            emp.crew || null,
            hireDateVal
          )
        } else {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "Staff" (
              "id", "firstName", "lastName", "email", "passwordHash",
              "phone", "role", "department", "title", "active",
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, $4, $5,
              $6, $7::"StaffRole", $8::"Department", $9, true,
              NOW(), NOW()
            )
            ON CONFLICT ("email") DO NOTHING`,
            staffId,
            emp.firstName,
            emp.lastName,
            email,
            passwordHash,
            emp.phone || null,
            role,
            department,
            emp.crew || null
          )
        }
        staffIdMap[emp.boltId] = staffId
        results.employees.imported++
      } catch (e: any) {
        results.employees.errors.push(`${emp.firstName} ${emp.lastName}: ${e.message?.slice(0, 80)}`)
      }
    }

    // ── 4. Import Crews → BoltCrew table ──
    for (const crew of crews) {
      if (!crew.name) { results.crews.skipped++; continue }
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "BoltCrew" ("id", "boltId", "name", "truck", "active", "phone", "crewType", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT ("boltId") DO UPDATE SET "name" = $3, "active" = $5, "phone" = $6`,
          `crew_${crew.boltId}`,
          crew.boltId,
          crew.name,
          crew.truck || null,
          crew.active === 'Active',
          crew.phone || null,
          crew.crewType || 'Other'
        )
        results.crews.imported++
      } catch (e: any) {
        results.crews.errors.push(`${crew.name}: ${e.message?.slice(0, 80)}`)
      }
    }

    // ── 5. Import Communities → BoltCommunity table ──
    for (const comm of communities) {
      if (!comm.name) { results.communities.skipped++; continue }
      try {
        // Extract city and state from "City, ST" format
        const [city, state] = (comm.city || '').split(',').map((s: string) => s.trim())

        await prisma.$executeRawUnsafe(
          `INSERT INTO "BoltCommunity" ("id", "boltId", "name", "city", "state", "customer", "supervisor", "active", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT ("boltId") DO UPDATE SET "name" = $3, "active" = $8`,
          `comm_${comm.boltId}`,
          comm.boltId,
          comm.name,
          city || null,
          state || null,
          comm.customer || null,
          comm.supervisor || null,
          comm.active === 'Active'
        )
        results.communities.imported++
      } catch (e: any) {
        results.communities.errors.push(`${comm.name}: ${e.message?.slice(0, 80)}`)
      }
    }

    // ── 6. Import Floorplans → BoltFloorplan table ──
    for (const fp of floorplans) {
      if (!fp.name) { results.floorplans.skipped++; continue }
      try {
        const activeDate = fp.activeDate ? parseMMDDDate(fp.activeDate) : null
        const [city, state] = (fp.city || '').split(',').map((s: string) => s.trim())

        const sqftVal = fp.sqft && !isNaN(parseInt(fp.sqft)) ? parseInt(fp.sqft) : null

        if (activeDate) {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "BoltFloorplan" ("id", "boltId", "name", "sqft", "community", "customer", "city", "state", "activeDate", "createdAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, NOW())
             ON CONFLICT ("boltId") DO UPDATE SET "name" = $3`,
            `fp_${fp.boltId}`,
            fp.boltId,
            fp.name,
            sqftVal,
            fp.community || null,
            fp.customer || null,
            city || null,
            state || null,
            activeDate
          )
        } else {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "BoltFloorplan" ("id", "boltId", "name", "sqft", "community", "customer", "city", "state", "createdAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
             ON CONFLICT ("boltId") DO UPDATE SET "name" = $3`,
            `fp_${fp.boltId}`,
            fp.boltId,
            fp.name,
            sqftVal,
            fp.community || null,
            fp.customer || null,
            city || null,
            state || null
          )
        }
        results.floorplans.imported++
      } catch (e: any) {
        results.floorplans.errors.push(`${fp.name?.slice(0, 40)}: ${e.message?.slice(0, 80)}`)
      }
    }

    // ── 7. Import Work Order Types → BoltWOType table ──
    for (const wot of woTypes) {
      if (!wot) { results.woTypes.skipped++; continue }
      const typeName = typeof wot === 'string' ? wot : wot.name || wot
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "BoltWOType" ("id", "name", "createdAt")
           VALUES ($1, $2, NOW())
           ON CONFLICT ("name") DO NOTHING`,
          `wot_${typeName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 40)}`,
          typeName
        )
        results.woTypes.imported++
      } catch (e: any) {
        results.woTypes.errors.push(`${typeName}: ${e.message?.slice(0, 80)}`)
      }
    }

    // ── 8. Import Jobs → Job table ──
    let jobCounter = 1
    for (const job of jobs) {
      if (!job.address && !job.boltId) { results.jobs.skipped++; continue }
      try {
        // Check if already imported by boltJobId
        const existing: any[] = await prisma.$queryRawUnsafe(
          `SELECT id FROM "Job" WHERE "boltJobId" = $1 LIMIT 1`,
          job.boltId || ''
        )
        if (existing.length > 0) {
          results.jobs.skipped++
          continue
        }

        const jobId = `job_bolt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
        const jobNumber = `JOB-BOLT-${String(jobCounter++).padStart(4, '0')}`

        // Extract city/state
        const [city, state] = (job.city || '').split(',').map((s: string) => s.trim())

        // Try to find the builder from community customer name
        const customerName = job.customer || ''
        const builderName = customerName || findBuilderFromFloorplan(job.floorplan || '', communities) || 'Unknown'

        await prisma.$executeRawUnsafe(
          `INSERT INTO "Job" (
            "id", "jobNumber", "boltJobId", "builderName",
            "jobAddress", "community", "scopeType",
            "status", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, 'DOORS_AND_TRIM'::"ScopeType",
            'CREATED'::"JobStatus", NOW(), NOW()
          )
          ON CONFLICT ("jobNumber") DO NOTHING`,
          jobId,
          jobNumber,
          job.boltId || null,
          builderName,
          job.address || null,
          job.community || null
        )
        results.jobs.imported++
      } catch (e: any) {
        results.jobs.errors.push(`${job.address?.slice(0, 30)}: ${e.message?.slice(0, 80)}`)
      }
    }

    // ── 9. Import Work Orders → BoltWorkOrder table ──
    for (const wo of workOrders) {
      if (!wo.boltId && !wo.b) { results.workOrders.skipped++; continue }
      try {
        // Support both pre-parsed (b/j/y/d/s/a/o) and raw (rowText) formats
        let jobAddress, woType, scheduledDate: string | null, stage, assignedTo, orderedBy
        const boltId = wo.boltId || wo.b

        if (wo.rowText) {
          const parsed = parseWorkOrderRow(wo.rowText)
          jobAddress = parsed.jobAddress
          woType = parsed.woType
          scheduledDate = parsed.scheduledDate
          stage = parsed.stage
          assignedTo = parsed.assignedTo
          orderedBy = parsed.orderedBy
        } else {
          jobAddress = wo.j || wo.jobAddress || ''
          woType = wo.y || wo.woType || ''
          scheduledDate = (wo.d || wo.scheduledDate) ? parseMMDDDate(wo.d || wo.scheduledDate) : null
          stage = wo.s || wo.stage || ''
          assignedTo = wo.a || wo.assignedTo || ''
          orderedBy = wo.o || wo.orderedBy || ''
        }

        if (scheduledDate) {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "BoltWorkOrder" (
              "id", "boltId", "jobAddress", "woType", "scheduledDate",
              "stage", "assignedTo", "orderedBy", "createdAt"
            ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8, NOW())
             ON CONFLICT ("boltId") DO UPDATE SET "stage" = $6, "scheduledDate" = $5::timestamptz`,
            `wo_${boltId}`,
            boltId,
            jobAddress || null,
            woType || null,
            scheduledDate,
            stage || null,
            assignedTo || null,
            orderedBy || null
          )
        } else {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "BoltWorkOrder" (
              "id", "boltId", "jobAddress", "woType",
              "stage", "assignedTo", "orderedBy", "createdAt"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT ("boltId") DO UPDATE SET "stage" = $5`,
            `wo_${boltId}`,
            boltId,
            jobAddress || null,
            woType || null,
            stage || null,
            assignedTo || null,
            orderedBy || null
          )
        }
        results.workOrders.imported++
      } catch (e: any) {
        results.workOrders.errors.push(`WO ${wo.boltId || wo.b}: ${e.message?.slice(0, 80)}`)
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Bolt Tech data import complete',
      results,
      totals: {
        imported: Object.values(results).reduce((sum: number, r: any) => sum + r.imported, 0),
        skipped: Object.values(results).reduce((sum: number, r: any) => sum + r.skipped, 0),
        errors: Object.values(results).reduce((sum: number, r: any) => sum + r.errors.length, 0),
      },
    })
  } catch (error: any) {
    console.error('Bolt import error:', error)
    return NextResponse.json(
      { error: 'Import failed'},
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: Ensure all Bolt-specific tables exist
// ──────────────────────────────────────────────────────────────────────────
async function ensureTables() {
  // BoltCrew — stores Bolt crew/team assignments
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BoltCrew" (
      "id" TEXT PRIMARY KEY,
      "boltId" TEXT UNIQUE NOT NULL,
      "name" TEXT NOT NULL,
      "truck" TEXT,
      "active" BOOLEAN DEFAULT true,
      "phone" TEXT,
      "crewType" TEXT DEFAULT 'Other',
      "createdAt" TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // BoltCommunity — stores Bolt subdivision/community data
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BoltCommunity" (
      "id" TEXT PRIMARY KEY,
      "boltId" TEXT UNIQUE NOT NULL,
      "name" TEXT NOT NULL,
      "city" TEXT,
      "state" TEXT,
      "customer" TEXT,
      "supervisor" TEXT,
      "active" BOOLEAN DEFAULT true,
      "createdAt" TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // BoltFloorplan — stores Bolt floorplan templates
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BoltFloorplan" (
      "id" TEXT PRIMARY KEY,
      "boltId" TEXT UNIQUE NOT NULL,
      "name" TEXT NOT NULL,
      "sqft" INT,
      "community" TEXT,
      "customer" TEXT,
      "city" TEXT,
      "state" TEXT,
      "activeDate" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // BoltWOType — work order type definitions
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BoltWOType" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT UNIQUE NOT NULL,
      "createdAt" TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // BoltWorkOrder — individual work order records
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BoltWorkOrder" (
      "id" TEXT PRIMARY KEY,
      "boltId" TEXT UNIQUE NOT NULL,
      "jobAddress" TEXT,
      "woType" TEXT,
      "scheduledDate" TIMESTAMPTZ,
      "stage" TEXT,
      "assignedTo" TEXT,
      "orderedBy" TEXT,
      "createdAt" TIMESTAMPTZ DEFAULT NOW()
    )
  `)
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: Map Bolt employee type/crew to Abel role and department
// ──────────────────────────────────────────────────────────────────────────
function mapBoltEmployeeRole(emp: any): { role: string; department: string } {
  const crew = (emp.crew || '').toLowerCase()
  const name = `${emp.firstName} ${emp.lastName}`.toLowerCase()

  // Match by crew assignment
  if (crew.includes('driver') || crew.includes('delivery')) {
    return { role: 'DRIVER', department: 'DELIVERY' }
  }
  if (crew.includes('install') || crew.includes('int /') || crew.includes('ext /')) {
    return { role: 'INSTALLER', department: 'INSTALLATION' }
  }
  if (crew.includes('billing') || crew.includes('qc')) {
    return { role: 'QC_INSPECTOR', department: 'OPERATIONS' }
  }
  if (crew.includes('warehouse') || crew.includes('manufacturing')) {
    return { role: 'WAREHOUSE_TECH', department: 'WAREHOUSE' }
  }

  // Match by known roles (Abel-specific knowledge)
  if (name.includes('nate barrett') || name.includes('josh barrett')) {
    return { role: 'ADMIN', department: 'EXECUTIVE' }
  }
  if (name.includes('karen johnson')) {
    return { role: 'PROJECT_MANAGER', department: 'OPERATIONS' }
  }
  if (name.includes('jessica rodriguez') || name.includes('darlene haag') || name.includes('ben wilson') || name.includes('thomas robinson') || name.includes('scott johnson') || name.includes('dalton whatley') || name.includes('jack nulty') || name.includes('brittney werner') || name.includes('james ash') || name.includes('chad zeh')) {
    return { role: 'PROJECT_MANAGER', department: 'OPERATIONS' }
  }
  if (name.includes('jordyn steider') || name.includes('jordan sena')) {
    return { role: 'SALES_REP', department: 'SALES' }
  }

  // Default: viewer in operations
  return { role: 'VIEWER', department: 'OPERATIONS' }
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: Parse MM/DD/YYYY date string to ISO date
// ──────────────────────────────────────────────────────────────────────────
function parseMMDDDate(dateStr: string): string | null {
  if (!dateStr) return null
  const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!match) return null
  const [, month, day, year] = match
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day)).toISOString()
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: Extract builder name from floorplan string
// ──────────────────────────────────────────────────────────────────────────
function findBuilderFromFloorplan(fpStr: string, communities: any[]): string {
  // Floorplan names often contain "NOT KNOWN - City - Customer - PM"
  const parts = fpStr.split(' - ')
  if (parts.length >= 3) return parts[2].trim()
  return ''
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: Parse work order row text into structured fields
// ──────────────────────────────────────────────────────────────────────────
function parseWorkOrderRow(rowText: string): {
  jobAddress: string
  woType: string
  scheduledDate: string | null
  stage: string
  assignedTo: string
  orderedBy: string
} {
  const result = {
    jobAddress: '',
    woType: '',
    scheduledDate: null as string | null,
    stage: '',
    assignedTo: '',
    orderedBy: '',
  }

  // Extract job address: "Job<address> |"
  const jobMatch = rowText.match(/Job(.+?)\s*\|/)
  if (jobMatch) result.jobAddress = jobMatch[1].trim()

  // Extract type: "Type<type> |"
  const typeMatch = rowText.match(/Type(.+?)\s*\|/)
  if (typeMatch) result.woType = typeMatch[1].trim()

  // Extract scheduled date
  const dateMatch = rowText.match(/(\d{2}\/\d{2}\/\d{4})/)
  if (dateMatch) result.scheduledDate = parseMMDDDate(dateMatch[1])

  // Extract stage: "Stage<stage> |"
  const stageMatch = rowText.match(/Stage(\w+)/)
  if (stageMatch) result.stage = stageMatch[1].trim()

  // Extract assigned to
  const assignMatch = rowText.match(/Assigned to\s*\n?\s*(.+?)(?:\s*\||\s*Ordered)/)
  if (assignMatch) result.assignedTo = assignMatch[1].trim().replace(/\s+/g, ' ').slice(0, 200)

  // Extract ordered by
  const orderedMatch = rowText.match(/Ordered by\s*\n?\s*(.+?)(?:\s*\||\s*Builder|\s*Actions)/)
  if (orderedMatch) result.orderedBy = orderedMatch[1].trim().replace(/\s+/g, ' ').slice(0, 200)

  return result
}
