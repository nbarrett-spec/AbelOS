export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/import-bpw — Import scraped BPW Pulte data into Abel OS
// ──────────────────────────────────────────────────────────────────────────
// Accepts JSON body with any combination of:
//   jobs[], communities[], invoices[], checks[], fpos[], schedules[]
//
// Each array can be sent independently (chunked imports).
// All upserts use source IDs to avoid duplicates.
// ──────────────────────────────────────────────────────────────────────────

const genId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/** Safe date parser that handles BPW formats: "mm/dd/yyyy", "m/d/yyyy h:mm:ss AM", ISO strings */
function safeParseDate(s: string | null | undefined): string | null {
  if (!s) return null
  try {
    // If already ISO-ish
    if (s.includes('T') || s.match(/^\d{4}-\d{2}-\d{2}/)) {
      const d = new Date(s)
      return isNaN(d.getTime()) ? null : d.toISOString()
    }
    // BPW format: "3/27/2026 12:00:00 AM" or "03/27/2026"
    const parts = s.split(' ')[0].split('/')
    if (parts.length === 3) {
      const [m, d, y] = parts
      const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00Z`
      const date = new Date(iso)
      return isNaN(date.getTime()) ? null : date.toISOString()
    }
    // Fallback
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : d.toISOString()
  } catch { return null }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const startTime = Date.now()

  try {
    const body = await request.json()
    const {
      jobs = [],
      communities = [],
      invoices = [],
      checks = [],
      fpos = [],
      schedules = [],
    } = body
    audit(request, 'IMPORT_BPW', 'BpwImport', undefined, {
      jobs: jobs.length, communities: communities.length, invoices: invoices.length,
      checks: checks.length, fpos: fpos.length, schedules: schedules.length,
    }, 'WARN').catch(() => {})

    const results: any = {
      communities: { created: 0, updated: 0, skipped: 0, errors: [] as string[] },
      jobs: { created: 0, updated: 0, skipped: 0, errors: [] as string[] },
      invoices: { created: 0, updated: 0, skipped: 0, errors: [] as string[] },
      checks: { created: 0, updated: 0, skipped: 0, errors: [] as string[] },
      fpos: { created: 0, updated: 0, skipped: 0, errors: [] as string[] },
      schedules: { created: 0, updated: 0, skipped: 0, errors: [] as string[] },
    }

    // ── Ensure BPW-specific tables exist ──
    await ensureBpwTables()

    // ── 1. Import Communities ──
    // Uses the existing BoltCommunity table pattern — add bpwId column if needed
    for (const comm of communities) {
      if (!comm.pulteId || !comm.name) { results.communities.skipped++; continue }
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "BpwCommunity" ("id", "bpwId", "name", "createdAt")
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT ("bpwId") DO UPDATE SET "name" = $3
        `, genId('bpwc'), comm.pulteId, comm.name)
        results.communities.created++
      } catch (e: any) {
        results.communities.errors.push(`${comm.name}: ${e.message?.slice(0, 100)}`)
      }
    }

    // ── 2. Import Jobs ──
    // BPW jobs map to the main Job table. Use jobNumber as the unique key.
    // Also ensure "Pulte" builder exists.
    let pulteBuilderId: string | null = null
    if (jobs.length > 0) {
      const existing: any[] = await prisma.$queryRawUnsafe(
        `SELECT id FROM "Builder" WHERE "companyName" ILIKE '%pulte%' LIMIT 1`
      )
      if (existing.length > 0) {
        pulteBuilderId = existing[0].id
      }
    }

    for (const job of jobs) {
      if (!job.jobNumber) { results.jobs.skipped++; continue }
      try {
        // Check if job already exists by jobNumber
        const existingJob: any[] = await prisma.$queryRawUnsafe(
          `SELECT id FROM "Job" WHERE "jobNumber" = $1 LIMIT 1`,
          job.jobNumber
        )

        // Parse SCAR dates — supports "mm/dd/yyyy", "yyyy-mm-dd", ISO "2026-01-29T00:00:00"
        const parseDateFlexible = (s: string) => {
          if (!s) return null
          const trimmed = s.trim()
          // ISO or yyyy-mm-dd format
          if (trimmed.match(/^\d{4}-\d{2}-\d{2}/)) {
            const d = new Date(trimmed.includes('T') ? trimmed : trimmed + 'T00:00:00Z')
            return isNaN(d.getTime()) ? null : d.toISOString()
          }
          // mm/dd/yyyy format
          const parts = trimmed.split(' ')[0].split('/')
          if (parts.length === 3) {
            const [m, d, y] = parts
            const date = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00Z`)
            return isNaN(date.getTime()) ? null : date.toISOString()
          }
          return null
        }

        const scheduledDate = parseDateFlexible(job.scarStart)
        const scarEndDate = parseDateFlexible(job.scarEnd)

        // Determine job status based on SCAR dates
        const now = new Date()
        let jobStatus: string = 'CREATED'
        if (scheduledDate) {
          const start = new Date(scheduledDate)
          const end = scarEndDate ? new Date(scarEndDate) : null
          if (end && now > end) {
            jobStatus = 'COMPLETE' // Past SCAR end date
          } else if (now >= start) {
            jobStatus = 'IN_PRODUCTION' // Between start and end
          } else {
            jobStatus = 'READINESS_CHECK' // Future start date — ready for prep
          }
        }

        // Extract community name from jobNumber prefix if we have community mapping
        const communityName = job.community || null

        if (existingJob.length > 0) {
          // UPDATE existing job with BPW data
          await prisma.$executeRawUnsafe(`
            UPDATE "Job" SET
              "jobAddress" = COALESCE($2, "jobAddress"),
              "community" = COALESCE($3, "community"),
              "scheduledDate" = COALESCE($4::timestamptz, "scheduledDate"),
              "status" = $5::"JobStatus",
              "updatedAt" = NOW()
            WHERE "id" = $1
          `,
            existingJob[0].id,
            job.address || null,
            communityName,
            scheduledDate,
            jobStatus
          )
          // Parse field manager name and phone from combined string like "Joshua Glory 8179294501"
          const fmRaw = job.fieldManager || ''
          const fmMatch = fmRaw.match(/^(.+?)\s+(\d{10,})$/)
          const fmName = fmMatch ? fmMatch[1].trim() : fmRaw || null
          const fmPhone = fmMatch ? fmMatch[2] : (job.phone || null)

          // Store BPW-specific data in the cross-ref table
          await prisma.$executeRawUnsafe(`
            INSERT INTO "BpwJobDetail" ("id", "jobId", "bpwPulteId", "plan", "elevation", "npc",
              "fieldManager", "fieldManagerPhone", "permit", "scarStart", "scarEnd", "updatedAt")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, NOW())
            ON CONFLICT ("bpwPulteId") DO UPDATE SET
              "plan" = $4, "elevation" = $5, "npc" = $6,
              "fieldManager" = $7, "fieldManagerPhone" = $8, "permit" = $9,
              "scarStart" = $10::timestamptz, "scarEnd" = $11::timestamptz, "updatedAt" = NOW()
          `, genId('bpwj'), existingJob[0].id, job.pulteId,
            job.plan || null, job.elevation || null, job.npc || null,
            fmName, fmPhone, job.permit || null,
            scheduledDate, scarEndDate)
          results.jobs.updated++
        } else {
          // CREATE new job
          const jobId = genId('job')
          const builderName = 'Pulte'
          await prisma.$executeRawUnsafe(`
            INSERT INTO "Job" (
              "id", "jobNumber", "builderName", "jobAddress", "community",
              "scopeType", "status", "scheduledDate",
              "readinessCheck", "materialsLocked", "loadConfirmed",
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, $4, $5,
              'DOORS_AND_TRIM'::"ScopeType", $6::"JobStatus", $7::timestamptz,
              false, false, false,
              NOW(), NOW()
            )
          `, jobId, job.jobNumber, builderName, job.address || null, communityName, jobStatus, scheduledDate)

          // Parse field manager name and phone from combined string
          const fmRaw2 = job.fieldManager || ''
          const fmMatch2 = fmRaw2.match(/^(.+?)\s+(\d{10,})$/)
          const fmName2 = fmMatch2 ? fmMatch2[1].trim() : fmRaw2 || null
          const fmPhone2 = fmMatch2 ? fmMatch2[2] : (job.phone || null)

          // Store BPW detail
          await prisma.$executeRawUnsafe(`
            INSERT INTO "BpwJobDetail" ("id", "jobId", "bpwPulteId", "plan", "elevation", "npc",
              "fieldManager", "fieldManagerPhone", "permit", "scarStart", "scarEnd", "updatedAt")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, NOW())
            ON CONFLICT ("bpwPulteId") DO NOTHING
          `, genId('bpwj'), jobId, job.pulteId,
            job.plan || null, job.elevation || null, job.npc || null,
            fmName2, fmPhone2, job.permit || null,
            scheduledDate, scarEndDate)
          results.jobs.created++
        }
      } catch (e: any) {
        results.jobs.errors.push(`${job.jobNumber}: ${e.message?.slice(0, 120)}`)
      }
    }

    // ── 3. Import Checks (Payments) ──
    for (const check of checks) {
      if (!check.checkId) { results.checks.skipped++; continue }
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "BpwCheck" ("id", "bpwCheckId", "checkNumber", "checkDate", "total",
            "ach", "vendor", "createdAt")
          VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7, NOW())
          ON CONFLICT ("bpwCheckId") DO UPDATE SET
            "total" = $5, "checkDate" = $4::timestamptz
        `, genId('bpwck'), String(check.checkId), check.number,
          safeParseDate(check.date),
          check.total || 0, check.ach || 'No', check.vendor || null)
        results.checks.created++
      } catch (e: any) {
        results.checks.errors.push(`Check ${check.number}: ${e.message?.slice(0, 100)}`)
      }
    }

    // ── 4. Import Invoices ──
    for (const inv of invoices) {
      if (!inv.invoiceId) { results.invoices.skipped++; continue }
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "BpwInvoice" ("id", "bpwInvoiceId", "invoiceNumber", "invoiceDate",
            "description", "amount", "checkNumber", "bpwCheckId", "checkDate", "createdAt")
          VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9::timestamptz, NOW())
          ON CONFLICT ("bpwInvoiceId") DO UPDATE SET
            "amount" = $6, "checkNumber" = $7, "checkDate" = $9::timestamptz
        `, genId('bpwi'), String(inv.invoiceId), inv.number || null,
          safeParseDate(inv.date),
          inv.description || null, inv.amount || 0,
          inv.checkNumber || null, inv.checkId ? String(inv.checkId) : null,
          safeParseDate(inv.checkDate))
        results.invoices.created++
      } catch (e: any) {
        results.invoices.errors.push(`Invoice ${inv.number}: ${e.message?.slice(0, 100)}`)
      }
    }

    // ── 5. Import Field Purchase Orders ──
    for (const fpo of fpos) {
      if (!fpo.poNumber) { results.fpos.skipped++; continue }
      try {
        // Parse amount like "$95.15" or "($100.00)" for negative
        let amount = 0
        if (fpo.amount) {
          const isNeg = fpo.amount.includes('(')
          amount = parseFloat(fpo.amount.replace(/[$,()]/g, '')) * (isNeg ? -1 : 1)
          if (isNaN(amount)) amount = 0
        }

        await prisma.$executeRawUnsafe(`
          INSERT INTO "BpwFieldPO" ("id", "poNumber", "effectiveDate", "type", "issuer",
            "community", "lot", "description", "amount", "status", "invoiceInfo", "createdAt")
          VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
          ON CONFLICT ("poNumber") DO UPDATE SET
            "status" = $10, "amount" = $9, "invoiceInfo" = $11
        `, genId('bpwf'), fpo.poNumber,
          safeParseDate(fpo.effectiveDate),
          fpo.type || null, fpo.issuer || null,
          fpo.community || null, fpo.lot || null,
          fpo.description || null, amount, fpo.status || null,
          fpo.invoiceInfo || null)
        results.fpos.created++
      } catch (e: any) {
        results.fpos.errors.push(`PO ${fpo.poNumber}: ${e.message?.slice(0, 100)}`)
      }
    }

    // ── 6. Import Schedule Tasks ──
    for (const sched of schedules) {
      if (!sched.jobNumber || !sched.taskDescription) { results.schedules.skipped++; continue }
      try {
        // Find the job by jobNumber
        const jobRow: any[] = await prisma.$queryRawUnsafe(
          `SELECT id FROM "Job" WHERE "jobNumber" = $1 LIMIT 1`,
          sched.jobNumber
        )
        if (jobRow.length === 0) {
          results.schedules.skipped++
          continue
        }

        const parseMmDdYyyy = (s: string) => {
          if (!s) return null
          const parts = s.split('/')
          if (parts.length !== 3) return null
          return new Date(`${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}T00:00:00Z`).toISOString()
        }

        const scheduledDate = parseMmDdYyyy(sched.scheduledStart) || new Date().toISOString()

        // Check for existing schedule entry for this job + task
        const existingEntry: any[] = await prisma.$queryRawUnsafe(
          `SELECT id FROM "ScheduleEntry" WHERE "jobId" = $1 AND "title" = $2 LIMIT 1`,
          jobRow[0].id, sched.taskDescription
        )

        if (existingEntry.length > 0) {
          await prisma.$executeRawUnsafe(`
            UPDATE "ScheduleEntry" SET
              "scheduledDate" = $2::timestamptz,
              "updatedAt" = NOW()
            WHERE "id" = $1
          `, existingEntry[0].id, scheduledDate)
          results.schedules.updated++
        } else {
          await prisma.$executeRawUnsafe(`
            INSERT INTO "ScheduleEntry" (
              "id", "jobId", "entryType", "title", "scheduledDate",
              "scheduledTime", "status", "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, 'DELIVERY'::"ScheduleType", $3, $4::timestamptz,
              '07:00', 'TENTATIVE'::"ScheduleStatus", NOW(), NOW()
            )
          `, genId('se'), jobRow[0].id, sched.taskDescription, scheduledDate)
          results.schedules.created++
        }
      } catch (e: any) {
        results.schedules.errors.push(`${sched.jobNumber} - ${sched.taskDescription}: ${e.message?.slice(0, 100)}`)
      }
    }

    // ── Log the sync ──
    const durationMs = Date.now() - startTime
    const totalProcessed =
      results.communities.created + results.communities.updated +
      results.jobs.created + results.jobs.updated +
      results.invoices.created + results.checks.created +
      results.fpos.created + results.schedules.created + results.schedules.updated

    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "SyncLog" (
          "id", "provider", "syncType", "direction", "status",
          "recordsProcessed", "recordsCreated", "recordsUpdated",
          "recordsSkipped", "recordsFailed",
          "startedAt", "completedAt", "durationMs", "createdAt"
        ) VALUES (
          $1, 'BPW_PULTE', 'import', 'PULL', $2,
          $3, $4, $5, $6, $7,
          $8::timestamptz, NOW(), $9, NOW()
        )
      `, genId('sync'),
        results.jobs.errors.length + results.invoices.errors.length > 0 ? 'PARTIAL' : 'SUCCESS',
        totalProcessed,
        results.communities.created + results.jobs.created + results.invoices.created + results.checks.created + results.fpos.created + results.schedules.created,
        results.communities.updated + results.jobs.updated + results.schedules.updated,
        results.communities.skipped + results.jobs.skipped + results.invoices.skipped + results.checks.skipped + results.fpos.skipped + results.schedules.skipped,
        results.communities.errors.length + results.jobs.errors.length + results.invoices.errors.length + results.checks.errors.length + results.fpos.errors.length + results.schedules.errors.length,
        new Date(startTime).toISOString(),
        durationMs
      )
    } catch (logErr) {
      console.error('SyncLog write failed:', logErr)
    }

    return NextResponse.json({
      success: true,
      durationMs,
      results,
    }, { status: 200 })

  } catch (error: any) {
    console.error('POST /api/ops/import-bpw error:', error)
    return NextResponse.json(
      { error: 'BPW import failed', details: error.message },
      { status: 500 }
    )
  }
}

// ── Ensure BPW-specific tables exist ──
async function ensureBpwTables() {
  // BpwCommunity — Pulte community reference
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BpwCommunity" (
      "id" TEXT PRIMARY KEY,
      "bpwId" TEXT UNIQUE NOT NULL,
      "name" TEXT NOT NULL,
      "createdAt" TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // BpwJobDetail — Extended BPW-specific fields linked to Job
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BpwJobDetail" (
      "id" TEXT PRIMARY KEY,
      "jobId" TEXT NOT NULL,
      "bpwPulteId" TEXT UNIQUE NOT NULL,
      "plan" TEXT,
      "elevation" TEXT,
      "npc" TEXT,
      "fieldManager" TEXT,
      "fieldManagerPhone" TEXT,
      "permit" TEXT,
      "scarStart" TIMESTAMPTZ,
      "scarEnd" TIMESTAMPTZ,
      "updatedAt" TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // BpwCheck — Pulte payment checks
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BpwCheck" (
      "id" TEXT PRIMARY KEY,
      "bpwCheckId" TEXT UNIQUE NOT NULL,
      "checkNumber" TEXT,
      "checkDate" TIMESTAMPTZ,
      "total" FLOAT DEFAULT 0,
      "ach" TEXT DEFAULT 'No',
      "vendor" TEXT,
      "createdAt" TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // BpwInvoice — Pulte invoice line items
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BpwInvoice" (
      "id" TEXT PRIMARY KEY,
      "bpwInvoiceId" TEXT UNIQUE NOT NULL,
      "invoiceNumber" TEXT,
      "invoiceDate" TIMESTAMPTZ,
      "description" TEXT,
      "amount" FLOAT DEFAULT 0,
      "checkNumber" TEXT,
      "bpwCheckId" TEXT,
      "checkDate" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // BpwFieldPO — Field Purchase Orders
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BpwFieldPO" (
      "id" TEXT PRIMARY KEY,
      "poNumber" TEXT UNIQUE NOT NULL,
      "effectiveDate" TIMESTAMPTZ,
      "type" TEXT,
      "issuer" TEXT,
      "community" TEXT,
      "lot" TEXT,
      "description" TEXT,
      "amount" FLOAT DEFAULT 0,
      "status" TEXT,
      "invoiceInfo" TEXT,
      "createdAt" TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  // Create indexes
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_bpw_job_detail_jobId" ON "BpwJobDetail" ("jobId")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_bpw_invoice_checkNumber" ON "BpwInvoice" ("checkNumber")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_bpw_invoice_date" ON "BpwInvoice" ("invoiceDate")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_bpw_check_date" ON "BpwCheck" ("checkDate")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_bpw_fpo_community" ON "BpwFieldPO" ("community")`)
}

// ── GET endpoint for checking import status / data counts ──
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const counts: any = {}

    const tables = ['BpwCommunity', 'BpwJobDetail', 'BpwCheck', 'BpwInvoice', 'BpwFieldPO']
    for (const table of tables) {
      try {
        const result: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "${table}"`)
        counts[table] = result[0]?.count || 0
      } catch {
        counts[table] = 'table not found'
      }
    }

    // Also get Job count with Pulte as builder
    const pulteJobs: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "Job" WHERE "builderName" = 'Pulte'`
    )
    counts.pulteJobs = pulteJobs[0]?.count || 0

    // Latest sync log
    const lastSync: any[] = await prisma.$queryRawUnsafe(`
      SELECT "syncType", "status", "recordsProcessed", "recordsCreated", "recordsUpdated",
        "recordsFailed", "durationMs", "completedAt"
      FROM "SyncLog"
      WHERE "provider" = 'BPW_PULTE'
      ORDER BY "completedAt" DESC
      LIMIT 1
    `)

    return NextResponse.json({
      counts,
      lastSync: lastSync[0] || null,
    }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
