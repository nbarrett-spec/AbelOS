#!/usr/bin/env node
/**
 * reconcile-allocations.mjs
 * -------------------------
 * Orphan-allocation reconciliation — read-only by default, destructive with --fix.
 *
 * Context: the April 2026 Pulte cleanup (see scripts/cleanup-pulte-zombies.mjs)
 * processed 517 zombie jobs. Some of those — plus any legacy data — left
 * `InventoryAllocation` rows dangling. This script finds and (optionally) heals
 * the three orphan flavours that most often appear after a cleanup pass:
 *
 *   A. Ghost-job allocations   — jobId references a Job row that no longer exists.
 *   B. Closed-job stuck        — status ∈ {RESERVED,BACKORDERED} but Job.status=CLOSED
 *                                OR AuditLog carries semanticStatus='CANCELLED'.
 *   C. Stale BACKORDERED       — status='BACKORDERED' and createdAt < NOW() - 60 days.
 *
 * Dry run is the default; nothing is written without --fix. Every mutating
 * action emits an AuditLog row so the reconciliation is traceable.
 *
 * Schema notes (verified against prisma/schema.prisma @ 2026-04-23):
 *   • InventoryAllocation has no `meta` JSONB column; we stash the reason in
 *     the existing `notes` String? column (matches cleanup-pulte-zombies.mjs,
 *     which uses `notes` the same way via ALLOC_RELEASE_NOTE).
 *   • AuditLog column is `entity` (not `entityType`) — see schema line 3424.
 *   • Job has no `semanticStatus` column; the CANCELLED semantic lives in
 *     AuditLog.details->>'semanticStatus' where action='PULTE_CLEANUP'.
 *
 * Flags:
 *   (none)  — dry-run report only
 *   --fix   — apply the three buckets' remediations + write AuditLog rows
 *
 * Exit codes:
 *   0 — success (dry-run OR fix)
 *   1 — any query or write error
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const args = new Set(process.argv.slice(2))
const FIX = args.has('--fix')

const prisma = new PrismaClient()

const ACTOR_ID = null // explicit per spec (reconciliation is system-driven)
const SAMPLE_SIZE = 10
const STALE_BACKORDER_DAYS = 60

function log(...a) { console.log(...a) }

function bar(label) {
  log(`\n===== ${label} =====`)
}

function fmtRow(r) {
  // Compact one-line sample for the report
  return `  id=${r.id}  prod=${r.productId}  job=${r.jobId ?? 'null'}  qty=${r.quantity}  status=${r.status}  created=${r.createdAt?.toISOString?.().slice(0,10) ?? r.createdAt}`
}

async function q(sql, ...params) {
  return prisma.$queryRawUnsafe(sql, ...params)
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

try {
  const started = Date.now()
  log(`[reconcile] mode = ${FIX ? 'FIX (will mutate)' : 'DRY-RUN (read only)'}`)
  log(`[reconcile] stale-backorder threshold = ${STALE_BACKORDER_DAYS} days`)

  // ── Bucket A: Ghost-job allocations ──────────────────────────────────
  // jobId is set but the Job row it points to no longer exists.
  // (Allocations with jobId IS NULL are legitimate — sales-order-only rows — skip.)
  const GHOST_SQL = `
    SELECT a."id", a."productId", a."jobId", a."quantity",
           a."status", a."createdAt", a."notes"
    FROM "InventoryAllocation" a
    LEFT JOIN "Job" j ON j."id" = a."jobId"
    WHERE a."jobId" IS NOT NULL
      AND j."id" IS NULL
    ORDER BY a."createdAt" ASC
  `
  const ghostRows = await q(GHOST_SQL)

  // ── Bucket B: Closed-job stuck reservations ──────────────────────────
  // Active allocation (RESERVED or BACKORDERED) where the job is either
  //   (i)  Job.status = 'CLOSED', or
  //   (ii) AuditLog carries semanticStatus='CANCELLED' for that Job.
  // We union the two conditions so a CLOSED+CANCELLED row counts once.
  const CLOSED_STUCK_SQL = `
    SELECT DISTINCT a."id", a."productId", a."jobId", a."quantity",
           a."status", a."createdAt", a."notes",
           j."status"::text AS job_status,
           (SELECT details->>'semanticStatus'
              FROM "AuditLog"
             WHERE entity = 'Job'
               AND "entityId" = a."jobId"
               AND details->>'semanticStatus' = 'CANCELLED'
             ORDER BY "createdAt" DESC
             LIMIT 1) AS semantic_status
    FROM "InventoryAllocation" a
    JOIN "Job" j ON j."id" = a."jobId"
    WHERE a."status" IN ('RESERVED', 'BACKORDERED')
      AND (
        j."status"::text = 'CLOSED'
        OR EXISTS (
          SELECT 1 FROM "AuditLog" al
          WHERE al.entity = 'Job'
            AND al."entityId" = a."jobId"
            AND al.details->>'semanticStatus' = 'CANCELLED'
        )
      )
    ORDER BY a."createdAt" ASC
  `
  const closedStuckRows = await q(CLOSED_STUCK_SQL)

  // ── Bucket C: Stale BACKORDERED ──────────────────────────────────────
  // BACKORDERED rows older than the threshold should be released — either the
  // supply arrived and we forgot to convert, or the demand went away.
  const STALE_BO_SQL = `
    SELECT a."id", a."productId", a."jobId", a."quantity",
           a."status", a."createdAt", a."notes"
    FROM "InventoryAllocation" a
    WHERE a."status" = 'BACKORDERED'
      AND a."createdAt" < NOW() - INTERVAL '${STALE_BACKORDER_DAYS} days'
    ORDER BY a."createdAt" ASC
  `
  const staleBoRows = await q(STALE_BO_SQL)

  // ── Dedup: a row can legitimately fall in B AND C (closed job with an old
  //   BACKORDERED line). Bucket A is mutually exclusive with B/C (B/C join Job;
  //   A is where Job doesn't exist). De-dupe C against B so we don't double-fix.
  const bIds = new Set(closedStuckRows.map(r => r.id))
  const staleBoOnly = staleBoRows.filter(r => !bIds.has(r.id))

  // ── On-hand units tied up ────────────────────────────────────────────
  const sumQty = rows => rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0)
  const totals = {
    a: { count: ghostRows.length,      qty: sumQty(ghostRows) },
    b: { count: closedStuckRows.length, qty: sumQty(closedStuckRows) },
    c: { count: staleBoOnly.length,     qty: sumQty(staleBoOnly) },
  }
  const grandTotal   = totals.a.count + totals.b.count + totals.c.count
  const grandTiedUp  = totals.a.qty   + totals.b.qty   + totals.c.qty

  // ── Report ───────────────────────────────────────────────────────────
  bar('ORPHAN ALLOCATION REPORT')
  log(`total orphan rows:      ${grandTotal}`)
  log(`total units tied up:    ${grandTiedUp}`)
  log('')
  log(`A. Ghost-job rows:      ${totals.a.count}   (${totals.a.qty} units)`)
  log(`B. Closed-job stuck:    ${totals.b.count}   (${totals.b.qty} units)`)
  log(`C. Stale BACKORDERED:   ${totals.c.count}   (${totals.c.qty} units, >${STALE_BACKORDER_DAYS}d old)`)

  if (ghostRows.length > 0) {
    bar(`Sample A — ghost-job (first ${SAMPLE_SIZE} of ${ghostRows.length})`)
    ghostRows.slice(0, SAMPLE_SIZE).forEach(r => log(fmtRow(r)))
  }
  if (closedStuckRows.length > 0) {
    bar(`Sample B — closed-job stuck (first ${SAMPLE_SIZE} of ${closedStuckRows.length})`)
    closedStuckRows.slice(0, SAMPLE_SIZE).forEach(r => {
      const why = r.semantic_status === 'CANCELLED'
        ? 'CANCELLED(audit)'
        : r.job_status
      log(fmtRow(r) + `  job=${why}`)
    })
  }
  if (staleBoOnly.length > 0) {
    bar(`Sample C — stale BACKORDERED (first ${SAMPLE_SIZE} of ${staleBoOnly.length})`)
    staleBoOnly.slice(0, SAMPLE_SIZE).forEach(r => log(fmtRow(r)))
  }

  // ── DRY-RUN: stop here ───────────────────────────────────────────────
  if (!FIX) {
    bar('DRY-RUN COMPLETE')
    log('no writes. re-run with --fix to apply remediations.')
    log(`elapsed ms: ${Date.now() - started}`)
    process.exit(0)
  }

  // ── FIX path ─────────────────────────────────────────────────────────
  bar('APPLYING FIXES')
  const fixResult = { deleted: 0, releasedB: 0, releasedC: 0, auditRows: 0, errors: [] }

  // Helper: write one AuditLog row per reconciled allocation.
  async function writeAudit(action, allocationId, details) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AuditLog"
           (id, "staffId", action, entity, "entityId", details, "createdAt", severity)
         VALUES ($1, $2, $3, 'InventoryAllocation', $4, $5::jsonb, NOW(), 'INFO')`,
        newId('auditlog_reconcile'),
        ACTOR_ID,
        action,
        allocationId,
        JSON.stringify(details),
      )
      fixResult.auditRows++
    } catch (e) {
      fixResult.errors.push({ phase: 'audit', allocationId, error: e.message })
    }
  }

  // ── A: delete ghost-job allocations ─────────────────────────────────
  for (const r of ghostRows) {
    const before = { id: r.id, productId: r.productId, jobId: r.jobId,
                     quantity: r.quantity, status: r.status,
                     createdAt: r.createdAt, notes: r.notes }
    try {
      const delRes = await prisma.$executeRawUnsafe(
        `DELETE FROM "InventoryAllocation" WHERE id = $1`,
        r.id,
      )
      if (delRes > 0) {
        fixResult.deleted++
        await writeAudit('RECONCILE_DELETE', r.id, {
          reason: 'reconcile: ghost job (jobId references non-existent Job)',
          before,
          after: null,
        })
      }
    } catch (e) {
      fixResult.errors.push({ phase: 'A-delete', allocationId: r.id, error: e.message })
    }
  }

  // ── B: release closed-job stuck ─────────────────────────────────────
  for (const r of closedStuckRows) {
    const reason = 'reconcile: closed job'
    const newNote = [r.notes, `[RECONCILED ${new Date().toISOString().slice(0,10)}: ${reason}]`]
      .filter(Boolean).join(' ')
    const before = { id: r.id, status: r.status, releasedAt: null,
                     jobStatus: r.job_status, semanticStatus: r.semantic_status,
                     notes: r.notes }
    try {
      const updRes = await prisma.$executeRawUnsafe(
        `UPDATE "InventoryAllocation"
            SET "status" = 'RELEASED',
                "releasedAt" = NOW(),
                "notes" = $2,
                "updatedAt" = NOW()
          WHERE id = $1
            AND "status" IN ('RESERVED', 'BACKORDERED')`,
        r.id,
        newNote,
      )
      if (updRes > 0) {
        fixResult.releasedB++
        await writeAudit('RECONCILE_RELEASE', r.id, {
          reason, before,
          after: { status: 'RELEASED', releasedAt: 'NOW()', notes: newNote },
        })
      }
    } catch (e) {
      fixResult.errors.push({ phase: 'B-release', allocationId: r.id, error: e.message })
    }
  }

  // ── C: release stale backorders ─────────────────────────────────────
  for (const r of staleBoOnly) {
    const reason = `reconcile: stale backorder ${STALE_BACKORDER_DAYS}d+`
    const newNote = [r.notes, `[RECONCILED ${new Date().toISOString().slice(0,10)}: ${reason}]`]
      .filter(Boolean).join(' ')
    const before = { id: r.id, status: r.status, releasedAt: null,
                     createdAt: r.createdAt, notes: r.notes }
    try {
      const updRes = await prisma.$executeRawUnsafe(
        `UPDATE "InventoryAllocation"
            SET "status" = 'RELEASED',
                "releasedAt" = NOW(),
                "notes" = $2,
                "updatedAt" = NOW()
          WHERE id = $1
            AND "status" = 'BACKORDERED'`,
        r.id,
        newNote,
      )
      if (updRes > 0) {
        fixResult.releasedC++
        await writeAudit('RECONCILE_RELEASE', r.id, {
          reason, before,
          after: { status: 'RELEASED', releasedAt: 'NOW()', notes: newNote },
        })
      }
    } catch (e) {
      fixResult.errors.push({ phase: 'C-release', allocationId: r.id, error: e.message })
    }
  }

  // ── FIX summary ─────────────────────────────────────────────────────
  bar('FIX SUMMARY')
  log(`A. deleted (ghost):           ${fixResult.deleted}  / ${totals.a.count}`)
  log(`B. released (closed-job):     ${fixResult.releasedB} / ${totals.b.count}`)
  log(`C. released (stale 60d+):     ${fixResult.releasedC} / ${totals.c.count}`)
  log(`AuditLog rows written:        ${fixResult.auditRows}`)
  log(`errors:                       ${fixResult.errors.length}`)
  if (fixResult.errors.length > 0) {
    log('\nfirst 10 errors:')
    log(fixResult.errors.slice(0, 10))
  }
  log(`elapsed ms: ${Date.now() - started}`)

  // Post-fix re-check: confirm no orphans remain.
  const postA = await q(GHOST_SQL)
  const postB = await q(CLOSED_STUCK_SQL)
  const postC = await q(STALE_BO_SQL)
  log('\npost-fix orphan counts:')
  log(`  A=${postA.length}  B=${postB.length}  C=${postC.length}`)
  if (postA.length + postB.length + postC.length > 0) {
    log('  (non-zero — see errors above or inspect manually)')
  } else {
    log('  clean.')
  }

  process.exit(0)
} catch (e) {
  console.error('[reconcile] FAILED:', e?.message || e)
  if (e?.stack) console.error(e.stack)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
