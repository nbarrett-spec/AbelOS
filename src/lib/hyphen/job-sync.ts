// ──────────────────────────────────────────────────────────────────────────
// Hyphen per-Job sync orchestrator
//
// Given a jobId, calls the scraper for:
//   - schedule           → persists scalar audit row in HyphenJobDocument AND
//                          updates Job.scheduledDate / .hyphenScheduleSyncedAt
//   - closing date       → persists scalar audit row in HyphenJobDocument AND
//                          updates Job.closingDate (column added in
//                          add_job_hyphen_scrape_fields.sql)
//   - red-line PDFs      → persist rows into "HyphenJobDocument"
//   - plan set group 1/2 → persist rows into "HyphenJobDocument"
//   - change-order PDFs  → persist rows into "HyphenJobDocument"
//
// Upstream dependency: fetchJobSchedule / fetchJobClosingDate in scraper.ts
// are still NotImplementedError stubs (Playwright is not installed). They
// always return { ok:false, reason:'SCRAPE_ERROR' } today, so the Job-table
// updates below are wired but unreachable until Playwright ships. When the
// fetchers return real ScheduleResult / ClosingDateResult objects, Job rows
// will start updating automatically — no further code changes needed here.
//
// Failure policy: partial-failure is OK. Every scraper call is wrapped
// in try/catch. A step that returns `ok:false` is recorded and we move
// on — the orchestrator never throws. Job-table writes are also try/catched
// so a Prisma error on the Job update doesn't lose the audit row.
//
// Output: { ok:true, jobId, wrote, skipped, errors[] } always.
// ──────────────────────────────────────────────────────────────────────────

import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import {
  fetchJobSchedule,
  fetchJobClosingDate,
  fetchJobRedLines,
  fetchJobPlanSet,
  fetchJobChangeOrders,
  isScraperEnabled,
  getScraperConfig,
  type PdfDoc,
  type ScrapeFailure,
} from './scraper'

export interface SyncJobResult {
  ok: boolean
  jobId: string
  scraperEnabled: boolean
  skipped: boolean
  skippedReason?: string
  wrote: {
    schedule: number
    closingDate: number
    redLines: number
    planSet1: number
    planSet2: number
    changeOrders: number
  }
  errors: Array<{ step: string; message: string }>
}

let tableEnsured = false

/**
 * Create the HyphenJobDocument table if it doesn't exist. Matches the
 * auto-create pattern used in auth.ts / processor.ts. Idempotent — safe
 * to call on every request.
 */
export async function ensureHyphenJobDocumentTable(): Promise<void> {
  if (tableEnsured) return
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "HyphenJobDocument" (
        "id" TEXT PRIMARY KEY,
        "jobId" TEXT NOT NULL,
        "kind" TEXT,
        "url" TEXT,
        "fetchedAt" TIMESTAMPTZ DEFAULT NOW(),
        "sha256" TEXT,
        "metadata" JSONB
      )
    `)
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "idx_hyphenjobdoc_job" ON "HyphenJobDocument" ("jobId")`
    )
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "idx_hyphenjobdoc_kind" ON "HyphenJobDocument" ("kind")`
    )
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "idx_hyphenjobdoc_sha" ON "HyphenJobDocument" ("sha256")`
    )
    tableEnsured = true
  } catch (e: any) {
    // Table may already exist with a compatible shape; swallow and continue.
    // Next persist attempt will surface any real schema conflict.
    tableEnsured = true
    logger.error('hyphen_job_doc_table_ensure_failed', e)
  }
}

/**
 * Persist a single scraped PDF reference. De-dupes on (jobId, url) — if
 * the same URL was stored on an earlier sync we touch fetchedAt instead
 * of inserting a second row. Returns 1 on insert, 0 on no-op/failure.
 */
async function persistDoc(jobId: string, doc: PdfDoc): Promise<number> {
  if (!doc.url) return 0
  try {
    // Check for an existing row with the same (jobId, url) to keep this
    // idempotent across replays. We don't rely on a unique index because
    // the additive CREATE TABLE IF NOT EXISTS above deliberately avoids
    // constraints that could conflict with an existing production schema.
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "HyphenJobDocument" WHERE "jobId" = $1 AND "url" = $2 LIMIT 1`,
      jobId,
      doc.url
    )
    if (existing.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "HyphenJobDocument" SET "fetchedAt" = NOW() WHERE "id" = $1`,
        existing[0].id
      )
      return 0
    }
    const id = 'hjd_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex')
    await prisma.$executeRawUnsafe(
      `INSERT INTO "HyphenJobDocument" ("id", "jobId", "kind", "url", "fetchedAt", "sha256", "metadata")
       VALUES ($1, $2, $3, $4, NOW(), $5, $6::jsonb)`,
      id,
      jobId,
      doc.kind,
      doc.url,
      doc.sha256 || null,
      JSON.stringify({
        fileName: doc.fileName || null,
        sizeBytes: doc.sizeBytes || null,
        ...(doc.metadata || {}),
      })
    )
    return 1
  } catch (e: any) {
    logger.error('hyphen_job_doc_persist_failed', e, { jobId, url: doc.url })
    return 0
  }
}

async function persistScalarRecord(
  jobId: string,
  kind: string,
  metadata: Record<string, any>
): Promise<number> {
  try {
    const id = 'hjd_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex')
    await prisma.$executeRawUnsafe(
      `INSERT INTO "HyphenJobDocument" ("id", "jobId", "kind", "url", "fetchedAt", "sha256", "metadata")
       VALUES ($1, $2, $3, NULL, NOW(), NULL, $4::jsonb)`,
      id,
      jobId,
      kind,
      JSON.stringify(metadata)
    )
    return 1
  } catch (e: any) {
    logger.error('hyphen_job_doc_scalar_persist_failed', e, { jobId, kind })
    return 0
  }
}

function isFailure(r: any): r is ScrapeFailure {
  return r && r.ok === false
}

/**
 * Sync everything we can for one job. Graceful: missing creds / missing
 * playwright / single-step errors all resolve to ok:true with the reason
 * recorded in errors[].
 */
export async function syncJob(jobId: string): Promise<SyncJobResult> {
  const result: SyncJobResult = {
    ok: true,
    jobId,
    scraperEnabled: isScraperEnabled(),
    skipped: false,
    wrote: {
      schedule: 0,
      closingDate: 0,
      redLines: 0,
      planSet1: 0,
      planSet2: 0,
      changeOrders: 0,
    },
    errors: [],
  }

  if (!result.scraperEnabled) {
    const cfg = getScraperConfig()
    const reason = !cfg.hasCreds
      ? 'HYPHEN_CREDS_MISSING'
      : !cfg.hasUrl
        ? 'HYPHEN_URL_MISSING'
        : 'PLAYWRIGHT_NOT_INSTALLED'
    result.skipped = true
    result.skippedReason = reason
    return result
  }

  await ensureHyphenJobDocumentTable()

  // 1. Schedule
  try {
    const sched = await fetchJobSchedule(jobId)
    if (isFailure(sched)) {
      result.errors.push({ step: 'schedule', message: `${sched.reason}: ${sched.message || ''}` })
    } else {
      result.wrote.schedule += await persistScalarRecord(jobId, 'schedule', {
        requestedStart: sched.requestedStart,
        requestedEnd: sched.requestedEnd,
        acknowledgedStart: sched.acknowledgedStart,
        acknowledgedEnd: sched.acknowledgedEnd,
        actualStart: sched.actualStart,
        actualEnd: sched.actualEnd,
        notes: sched.notes,
      })
      // Mirror the most authoritative date onto Job.scheduledDate so the
      // ops dashboard and downstream views can read it without joining
      // HyphenJobDocument. Preference order: actualStart > acknowledgedStart
      // > requestedStart. Failures here are non-fatal — the audit row above
      // already captured the raw scrape.
      const bestDate =
        sched.actualStart || sched.acknowledgedStart || sched.requestedStart
      if (bestDate) {
        try {
          await prisma.job.update({
            where: { id: jobId },
            data: {
              scheduledDate: new Date(bestDate),
              hyphenScheduleSyncedAt: new Date(),
            },
          })
        } catch (e: any) {
          logger.error('hyphen_job_schedule_update_failed', e, { jobId })
          result.errors.push({
            step: 'schedule',
            message: `job_update_failed: ${e?.message || 'unknown'}`,
          })
        }
      }
    }
  } catch (e: any) {
    result.errors.push({ step: 'schedule', message: e?.message || 'schedule fetch threw' })
  }

  // 2. Closing date
  try {
    const cd = await fetchJobClosingDate(jobId)
    if (isFailure(cd)) {
      result.errors.push({ step: 'closingDate', message: `${cd.reason}: ${cd.message || ''}` })
    } else if (cd.closingDate) {
      result.wrote.closingDate += await persistScalarRecord(jobId, 'closing_date', {
        closingDate: cd.closingDate,
        source: cd.source,
      })
      // Persist closing date on Job. Column was added in
      // add_job_hyphen_scrape_fields.sql. Non-fatal on failure.
      try {
        await prisma.job.update({
          where: { id: jobId },
          data: { closingDate: new Date(cd.closingDate) },
        })
      } catch (e: any) {
        logger.error('hyphen_job_closing_update_failed', e, { jobId })
        result.errors.push({
          step: 'closingDate',
          message: `job_update_failed: ${e?.message || 'unknown'}`,
        })
      }
    }
  } catch (e: any) {
    result.errors.push({ step: 'closingDate', message: e?.message || 'closingDate fetch threw' })
  }

  // 3. Red lines
  try {
    const rl = await fetchJobRedLines(jobId)
    if (isFailure(rl)) {
      result.errors.push({ step: 'redLines', message: `${rl.reason}: ${rl.message || ''}` })
    } else {
      for (const doc of rl.documents) {
        result.wrote.redLines += await persistDoc(jobId, doc)
      }
    }
  } catch (e: any) {
    result.errors.push({ step: 'redLines', message: e?.message || 'redLines fetch threw' })
  }

  // 4a. Plan set group 1
  try {
    const p1 = await fetchJobPlanSet(jobId, 1)
    if (isFailure(p1)) {
      result.errors.push({ step: 'planSet1', message: `${p1.reason}: ${p1.message || ''}` })
    } else {
      for (const doc of p1.documents) {
        result.wrote.planSet1 += await persistDoc(jobId, doc)
      }
    }
  } catch (e: any) {
    result.errors.push({ step: 'planSet1', message: e?.message || 'planSet1 fetch threw' })
  }

  // 4b. Plan set group 2
  try {
    const p2 = await fetchJobPlanSet(jobId, 2)
    if (isFailure(p2)) {
      result.errors.push({ step: 'planSet2', message: `${p2.reason}: ${p2.message || ''}` })
    } else {
      for (const doc of p2.documents) {
        result.wrote.planSet2 += await persistDoc(jobId, doc)
      }
    }
  } catch (e: any) {
    result.errors.push({ step: 'planSet2', message: e?.message || 'planSet2 fetch threw' })
  }

  // 5. Change orders
  try {
    const co = await fetchJobChangeOrders(jobId)
    if (isFailure(co)) {
      result.errors.push({ step: 'changeOrders', message: `${co.reason}: ${co.message || ''}` })
    } else {
      for (const entry of co.changeOrders) {
        if (entry.pdfUrl) {
          result.wrote.changeOrders += await persistDoc(jobId, {
            url: entry.pdfUrl,
            fileName: entry.coNumber,
            kind: 'change_order',
            metadata: {
              coNumber: entry.coNumber,
              summary: entry.summary,
              netValueChange: entry.netValueChange,
              reason: entry.reason,
            },
          })
        } else {
          result.wrote.changeOrders += await persistScalarRecord(jobId, 'change_order', {
            coNumber: entry.coNumber,
            summary: entry.summary,
            netValueChange: entry.netValueChange,
            reason: entry.reason,
          })
        }
      }
    }
  } catch (e: any) {
    result.errors.push({ step: 'changeOrders', message: e?.message || 'changeOrders fetch threw' })
  }

  return result
}

/**
 * Sync every active job. "Active" = Job.status NOT IN COMPLETED/CANCELLED.
 * Caps the batch at 100 to keep the on-demand route well under the
 * default 300s maxDuration for cron-style handlers.
 */
export async function syncAllActiveJobs(limit = 100): Promise<{
  jobsSynced: number
  totalWritten: number
  errors: Array<{ jobId: string; errors: Array<{ step: string; message: string }> }>
  skippedReason?: string
}> {
  if (!isScraperEnabled()) {
    const cfg = getScraperConfig()
    const reason = !cfg.hasCreds
      ? 'HYPHEN_CREDS_MISSING'
      : !cfg.hasUrl
        ? 'HYPHEN_URL_MISSING'
        : 'PLAYWRIGHT_NOT_INSTALLED'
    return { jobsSynced: 0, totalWritten: 0, errors: [], skippedReason: reason }
  }

  let rows: Array<{ id: string }> = []
  try {
    rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "Job"
         WHERE "status" NOT IN ('COMPLETED','CANCELLED')
           AND ("hyphenJobId" IS NOT NULL OR "bwpPoNumber" IS NOT NULL)
         ORDER BY "updatedAt" DESC
         LIMIT $1`,
      limit
    )
  } catch (e: any) {
    logger.error('hyphen_sync_all_list_failed', e)
    return { jobsSynced: 0, totalWritten: 0, errors: [] }
  }

  const errors: Array<{ jobId: string; errors: Array<{ step: string; message: string }> }> = []
  let totalWritten = 0
  for (const row of rows) {
    const r = await syncJob(row.id)
    totalWritten +=
      r.wrote.schedule +
      r.wrote.closingDate +
      r.wrote.redLines +
      r.wrote.planSet1 +
      r.wrote.planSet2 +
      r.wrote.changeOrders
    if (r.errors.length > 0) errors.push({ jobId: row.id, errors: r.errors })
  }
  return { jobsSynced: rows.length, totalWritten, errors }
}
