export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/import-bpw/process — Process staged BPW data into Abel OS
// ──────────────────────────────────────────────────────────────────────────
// Reads from BpwStagingData and upserts into the real tables.
// Body: { dataTypes?: string[] } — optionally limit which types to process
// ──────────────────────────────────────────────────────────────────────────

const genId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/** Safe date parser — handles BPW formats: "mm/dd/yyyy", "m/d/yyyy h:mm:ss AM", ISO strings */
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
    const body = await request.json().catch(() => ({}))
    const { dataTypes } = body
    audit(request, 'IMPORT_BPW_PROCESS', 'BpwStagingData', undefined, { dataTypes }, 'WARN').catch(() => {})

    // Ensure target tables exist
    await ensureBpwTables()

    const results: Record<string, { created: number; updated: number; skipped: number; errors: string[] }> = {}

    // ── Process Communities ──
    if (!dataTypes || dataTypes.includes('communities')) {
      results.communities = { created: 0, updated: 0, skipped: 0, errors: [] }
      const chunks: any[] = await prisma.$queryRawUnsafe(
        `SELECT "data" FROM "BpwStagingData" WHERE "dataType" = 'communities' ORDER BY "chunk"`
      )
      for (const chunk of chunks) {
        const items = typeof chunk.data === 'string' ? JSON.parse(chunk.data) : chunk.data
        for (const comm of items) {
          if (!comm.communityNumber || !comm.communityName) { results.communities.skipped++; continue }
          try {
            await prisma.$executeRawUnsafe(`
              INSERT INTO "BpwCommunity" ("id", "bpwId", "name", "createdAt")
              VALUES ($1, $2, $3, NOW())
              ON CONFLICT ("bpwId") DO UPDATE SET "name" = $3
            `, genId('bpwc'), String(comm.communityNumber), comm.communityName)
            results.communities.created++
          } catch (e: any) {
            results.communities.errors.push(e.message?.slice(0, 80))
          }
        }
      }
    }

    // ── Process Jobs ──
    if (!dataTypes || dataTypes.includes('jobs')) {
      results.jobs = { created: 0, updated: 0, skipped: 0, errors: [] }
      const chunks: any[] = await prisma.$queryRawUnsafe(
        `SELECT "data" FROM "BpwStagingData" WHERE "dataType" = 'jobs' ORDER BY "chunk"`
      )
      for (const chunk of chunks) {
        const items = typeof chunk.data === 'string' ? JSON.parse(chunk.data) : chunk.data
        for (const job of items) {
          if (!job.jobNumber) { results.jobs.skipped++; continue }
          try {
            const scheduledDate = safeParseDate(job.scarStart)
            const scarEndDate = safeParseDate(job.scarEnd)

            // Check if job exists
            const existing: any[] = await prisma.$queryRawUnsafe(
              `SELECT id FROM "Job" WHERE "jobNumber" = $1 LIMIT 1`, job.jobNumber
            )

            if (existing.length > 0) {
              await prisma.$executeRawUnsafe(`
                UPDATE "Job" SET
                  "jobAddress" = COALESCE($2, "jobAddress"),
                  "community" = COALESCE($3, "community"),
                  "scheduledDate" = COALESCE($4::timestamptz, "scheduledDate"),
                  "updatedAt" = NOW()
                WHERE "id" = $1
              `, existing[0].id, job.address || null, job.communityName || null, scheduledDate)

              // Upsert BPW detail
              await prisma.$executeRawUnsafe(`
                INSERT INTO "BpwJobDetail" ("id", "jobId", "bpwPulteId", "plan", "elevation", "npc",
                  "fieldManager", "fieldManagerPhone", "permit", "scarStart", "scarEnd", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, NOW())
                ON CONFLICT ("bpwPulteId") DO UPDATE SET
                  "plan" = $4, "elevation" = $5, "npc" = $6,
                  "fieldManager" = $7, "fieldManagerPhone" = $8, "permit" = $9,
                  "scarStart" = $10::timestamptz, "scarEnd" = $11::timestamptz, "updatedAt" = NOW()
              `, genId('bpwj'), existing[0].id, String(job.pulteId),
                job.plan || null, job.elevation || null, job.npc || job.masterPlanNumber || null,
                job.fieldManager || null, job.fieldManagerPhone || job.phone || null, job.permit || null, scheduledDate, scarEndDate)
              results.jobs.updated++
            } else {
              const jobId = genId('job')
              await prisma.$executeRawUnsafe(`
                INSERT INTO "Job" (
                  "id", "jobNumber", "builderName", "jobAddress", "community",
                  "scopeType", "status", "scheduledDate",
                  "readinessCheck", "materialsLocked", "loadConfirmed",
                  "createdAt", "updatedAt"
                ) VALUES (
                  $1, $2, 'Pulte', $3, $4,
                  'DOORS_AND_TRIM'::"ScopeType", 'CREATED'::"JobStatus", $5::timestamptz,
                  false, false, false, NOW(), NOW()
                )
              `, jobId, job.jobNumber, job.address || null, job.communityName || null, scheduledDate)

              await prisma.$executeRawUnsafe(`
                INSERT INTO "BpwJobDetail" ("id", "jobId", "bpwPulteId", "plan", "elevation", "npc",
                  "fieldManager", "fieldManagerPhone", "permit", "scarStart", "scarEnd", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, NOW())
                ON CONFLICT ("bpwPulteId") DO NOTHING
              `, genId('bpwj'), jobId, String(job.pulteId),
                job.plan || null, job.elevation || null, job.npc || job.masterPlanNumber || null,
                job.fieldManager || null, job.fieldManagerPhone || job.phone || null, job.permit || null, scheduledDate, scarEndDate)
              results.jobs.created++
            }
          } catch (e: any) {
            results.jobs.errors.push(`${job.jobNumber}: ${e.message?.slice(0, 80)}`)
          }
        }
      }
    }

    // ── Process Checks ──
    if (!dataTypes || dataTypes.includes('checks')) {
      results.checks = { created: 0, updated: 0, skipped: 0, errors: [] }
      const chunks: any[] = await prisma.$queryRawUnsafe(
        `SELECT "data" FROM "BpwStagingData" WHERE "dataType" = 'checks' ORDER BY "chunk"`
      )
      for (const chunk of chunks) {
        const items = typeof chunk.data === 'string' ? JSON.parse(chunk.data) : chunk.data
        for (const check of items) {
          if (!check.checkId) { results.checks.skipped++; continue }
          try {
            await prisma.$executeRawUnsafe(`
              INSERT INTO "BpwCheck" ("id", "bpwCheckId", "checkNumber", "checkDate", "total", "ach", "vendor", "createdAt")
              VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7, NOW())
              ON CONFLICT ("bpwCheckId") DO UPDATE SET "total" = $5, "checkDate" = $4::timestamptz
            `, genId('bpwck'), String(check.checkId), String(check.number || ''),
              safeParseDate(check.date),
              check.total || 0, check.ach || 'No', check.vendor || null)
            results.checks.created++
          } catch (e: any) {
            results.checks.errors.push(`${check.number}: ${e.message?.slice(0, 80)}`)
          }
        }
      }
    }

    // ── Process Invoices ──
    if (!dataTypes || dataTypes.includes('invoices')) {
      results.invoices = { created: 0, updated: 0, skipped: 0, errors: [] }
      const chunks: any[] = await prisma.$queryRawUnsafe(
        `SELECT "data" FROM "BpwStagingData" WHERE "dataType" = 'invoices' ORDER BY "chunk"`
      )
      for (const chunk of chunks) {
        const items = typeof chunk.data === 'string' ? JSON.parse(chunk.data) : chunk.data
        for (const inv of items) {
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
            results.invoices.errors.push(`${inv.number}: ${e.message?.slice(0, 80)}`)
          }
        }
      }
    }

    // ── Process FPOs ──
    if (!dataTypes || dataTypes.includes('fpos')) {
      results.fpos = { created: 0, updated: 0, skipped: 0, errors: [] }
      const chunks: any[] = await prisma.$queryRawUnsafe(
        `SELECT "data" FROM "BpwStagingData" WHERE "dataType" = 'fpos' ORDER BY "chunk"`
      )
      for (const chunk of chunks) {
        const items = typeof chunk.data === 'string' ? JSON.parse(chunk.data) : chunk.data
        for (const fpo of items) {
          if (!fpo.poNumber) { results.fpos.skipped++; continue }
          try {
            let amount = 0
            if (fpo.amount) {
              if (typeof fpo.amount === 'number') {
                amount = fpo.amount
              } else {
                const isNeg = String(fpo.amount).includes('(')
                amount = parseFloat(String(fpo.amount).replace(/[$,()]/g, '')) * (isNeg ? -1 : 1)
                if (isNaN(amount)) amount = 0
              }
            }
            await prisma.$executeRawUnsafe(`
              INSERT INTO "BpwFieldPO" ("id", "poNumber", "effectiveDate", "type", "issuer",
                "community", "lot", "description", "amount", "status", "invoiceInfo", "createdAt")
              VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
              ON CONFLICT ("poNumber") DO UPDATE SET "status" = $10, "amount" = $9, "invoiceInfo" = $11
            `, genId('bpwf'), fpo.poNumber,
              safeParseDate(fpo.effectiveDate),
              fpo.type || null, fpo.issuer || null,
              fpo.community || null, fpo.lot || null,
              fpo.description || null, amount, fpo.status || null,
              fpo.invoiceInfo || null)
            results.fpos.created++
          } catch (e: any) {
            results.fpos.errors.push(`PO ${fpo.poNumber}: ${e.message?.slice(0, 80)}`)
          }
        }
      }
    }

    // ── Log the sync ──
    const durationMs = Date.now() - startTime
    const totalCreated = Object.values(results).reduce((s, r) => s + r.created, 0)
    const totalUpdated = Object.values(results).reduce((s, r) => s + r.updated, 0)
    const totalErrors = Object.values(results).reduce((s, r) => s + r.errors.length, 0)

    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "SyncLog" (
          "id", "provider", "syncType", "direction", "status",
          "recordsProcessed", "recordsCreated", "recordsUpdated",
          "recordsSkipped", "recordsFailed",
          "startedAt", "completedAt", "durationMs", "createdAt"
        ) VALUES (
          $1, 'BPW_PULTE', 'staged-import', 'PULL', $2,
          $3, $4, $5, $6, $7,
          $8::timestamptz, NOW(), $9, NOW()
        )
      `, genId('sync'),
        totalErrors > 0 ? 'PARTIAL' : 'SUCCESS',
        totalCreated + totalUpdated,
        totalCreated, totalUpdated,
        Object.values(results).reduce((s, r) => s + r.skipped, 0),
        totalErrors,
        new Date(startTime).toISOString(), durationMs)
    } catch (logErr) {
      console.error('SyncLog write failed:', logErr)
    }

    return NextResponse.json({
      success: true,
      durationMs,
      results,
    }, { status: 200 })

  } catch (error: any) {
    console.error('BPW process error:', error)
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}

// ── Ensure BPW tables ──
async function ensureBpwTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BpwCommunity" (
      "id" TEXT PRIMARY KEY, "bpwId" TEXT UNIQUE NOT NULL, "name" TEXT NOT NULL, "createdAt" TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BpwJobDetail" (
      "id" TEXT PRIMARY KEY, "jobId" TEXT NOT NULL, "bpwPulteId" TEXT UNIQUE NOT NULL,
      "plan" TEXT, "elevation" TEXT, "npc" TEXT, "fieldManager" TEXT, "fieldManagerPhone" TEXT,
      "permit" TEXT, "scarStart" TIMESTAMPTZ, "scarEnd" TIMESTAMPTZ, "updatedAt" TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BpwCheck" (
      "id" TEXT PRIMARY KEY, "bpwCheckId" TEXT UNIQUE NOT NULL, "checkNumber" TEXT,
      "checkDate" TIMESTAMPTZ, "total" FLOAT DEFAULT 0, "ach" TEXT DEFAULT 'No', "vendor" TEXT, "createdAt" TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BpwInvoice" (
      "id" TEXT PRIMARY KEY, "bpwInvoiceId" TEXT UNIQUE NOT NULL, "invoiceNumber" TEXT,
      "invoiceDate" TIMESTAMPTZ, "description" TEXT, "amount" FLOAT DEFAULT 0,
      "checkNumber" TEXT, "bpwCheckId" TEXT, "checkDate" TIMESTAMPTZ, "createdAt" TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BpwFieldPO" (
      "id" TEXT PRIMARY KEY, "poNumber" TEXT UNIQUE NOT NULL, "effectiveDate" TIMESTAMPTZ,
      "type" TEXT, "issuer" TEXT, "community" TEXT, "lot" TEXT, "description" TEXT,
      "amount" FLOAT DEFAULT 0, "status" TEXT, "invoiceInfo" TEXT, "createdAt" TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_bpw_job_detail_jobId" ON "BpwJobDetail" ("jobId")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_bpw_invoice_checkNumber" ON "BpwInvoice" ("checkNumber")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_bpw_invoice_date" ON "BpwInvoice" ("invoiceDate")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_bpw_check_date" ON "BpwCheck" ("checkDate")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_bpw_fpo_community" ON "BpwFieldPO" ("community")`)
}
