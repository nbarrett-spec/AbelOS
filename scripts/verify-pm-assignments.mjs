#!/usr/bin/env node
/**
 * verify-pm-assignments.mjs
 * --------------------------
 * READ-ONLY verification script. Flags PM-assignment anomalies against
 * Nate's ground-truth mapping (captured from 2026-04-24 corrections).
 *
 * Pattern follows scripts/reconcile-allocations.mjs:
 *   - Prisma $queryRawUnsafe for reads only
 *   - No UPDATE / DELETE / INSERT anywhere
 *   - Exit 0 on clean run, 1 on drift detected
 *
 * Classifications (per job):
 *   CORRECT                 — assigned PM matches canonical mapping
 *   MISASSIGNED_THOMAS      — Thomas-owned builder but assigned to someone else (or null)
 *   MISASSIGNED_BRITTNEY    — Brittney-owned builder assigned elsewhere (or null)
 *   MISASSIGNED_BEN         — Ben-owned builder assigned elsewhere (or null)
 *   UNASSIGNED              — assignedPMId IS NULL, and builder is NOT in any owner list
 *                             (null-assign on a mapped builder is bucketed as the MISASSIGNED flavour)
 *   ZOMBIE_INACTIVE_BUILDER — job for an INACTIVE builder, status not in (CLOSED, INVOICED)
 *   WRONG_ENTITY_TYPE       — job against a supplier (McCoys) or labor sub (HWH Construction)
 *   ZOMBIE_LOST_BUILDER     — Pulte/Centex/Del Webb job, status not in (CLOSED, INVOICED)
 *                             (should have been cleaned up in commit 9010d11)
 *   UNKNOWN_BUILDER         — builder name does not match any list
 *
 * Proposed fixes (MISASSIGNED only) are printed as SQL UPDATE statements.
 * Nothing is executed. Exit 1 if any MISASSIGNED / ZOMBIE / WRONG_ENTITY_TYPE found.
 *
 * Usage:
 *   node scripts/verify-pm-assignments.mjs
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ── Canonical PM-per-builder mapping (Nate's 4/24 corrections) ─────────────
const THOMAS_BUILDERS = ['Hayhurst', 'Haven Home Remodeling', 'Haven Home', 'TriStar', 'Bailey Brothers']
const BRITTNEY_BUILDERS = ['Toll', 'Texas R&R', 'Texas RR', 'Texas R & R']
const BEN_BUILDERS = ['Brookson']
const INACTIVE_BUILDERS = ['Truth Construction', 'GH Homes']
const SUPPLIER_NOT_CUSTOMER = ['McCoys']
const LABOR_SUBCONTRACTOR = ['HWH Construction']
const LOST_BUILDERS = ['Pulte', 'Centex', 'Del Webb', 'PulteGroup']

const SAMPLE_SIZE = 10
// Job statuses that mean "job is done / closed" — anything else counts as active.
const CLOSED_STATUSES = new Set(['CLOSED', 'INVOICED'])

function log(...a) { console.log(...a) }
function bar(label) { log(`\n===== ${label} =====`) }

// Case-insensitive partial match against a list. Handles null/empty gracefully.
function matchesAny(builderName, list) {
  if (!builderName) return null
  const hay = builderName.toLowerCase()
  for (const needle of list) {
    if (hay.includes(needle.toLowerCase())) return needle
  }
  return null
}

// Fetch PM staff records so we can display names + identify the "correct" staffId per owner.
async function getStaffByFirstName(firstName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, "firstName", "lastName", active
       FROM "Staff"
      WHERE LOWER("firstName") = LOWER($1)
      ORDER BY active DESC, "lastName" ASC`,
    firstName,
  )
  return rows
}

// Render one Job row compactly for samples.
function fmtJob(j, extra = '') {
  const pm = j.assignedPMId
    ? (j.firstName || j.lastName ? `${j.firstName ?? ''} ${j.lastName ?? ''}`.trim() : j.assignedPMId)
    : 'UNASSIGNED'
  return `  id=${j.id}  job#=${j.jobNumber}  builder=${j.builderName ?? 'NULL'}  community=${j.community ?? '-'}  pm=${pm}  status=${j.status}${extra ? '  ' + extra : ''}`
}

// Build an UPDATE SQL for proposed fix (NOT executed — printed only).
function proposedFixSql(jobId, targetStaffId, pmLabel) {
  return `UPDATE "Job" SET "assignedPMId" = '${targetStaffId}' WHERE id = '${jobId}'; -- reassign to ${pmLabel}`
}

try {
  const started = Date.now()
  log('[verify-pm] mode = DRY-RUN (read only)')
  log('[verify-pm] ground-truth: Nate corrections 2026-04-24')

  // ── Resolve canonical staffIds for proposed-fix UPDATEs ─────────────────
  // First match on firstName. If multiple active Staff rows share the firstName,
  // we leave the target staffId null and print <NEEDS-MANUAL-RESOLUTION>.
  const [thomasRows, brittneyRows, benRows] = await Promise.all([
    getStaffByFirstName('Thomas'),
    getStaffByFirstName('Brittney'),
    getStaffByFirstName('Ben'),
  ])
  const pickActive = rows => {
    const active = rows.filter(r => r.active)
    if (active.length === 1) return active[0].id
    return null
  }
  const thomasId = pickActive(thomasRows)
  const brittneyId = pickActive(brittneyRows)
  const benId = pickActive(benRows)

  log(`[verify-pm] resolved staff: Thomas=${thomasId ?? 'AMBIGUOUS'} Brittney=${brittneyId ?? 'AMBIGUOUS'} Ben=${benId ?? 'AMBIGUOUS'}`)
  if (thomasRows.length !== 1 || brittneyRows.length !== 1 || benRows.length !== 1) {
    log(`[verify-pm] note: found Thomas=${thomasRows.length} Brittney=${brittneyRows.length} Ben=${benRows.length} staff rows by firstName. Proposed-fix SQL will use <NEEDS-MANUAL-RESOLUTION> where ambiguous.`)
  }

  // ── Query all ACTIVE jobs with Staff LEFT-JOIN ──────────────────────────
  const JOBS_SQL = `
    SELECT j."id", j."jobNumber", j."builderName", j."community",
           j."assignedPMId", j."status"::text AS status,
           s."firstName", s."lastName"
      FROM "Job" j
      LEFT JOIN "Staff" s ON s."id" = j."assignedPMId"
     WHERE j."status"::text NOT IN ('CLOSED', 'INVOICED')
     ORDER BY j."builderName" ASC, j."jobNumber" ASC
  `
  const jobs = await prisma.$queryRawUnsafe(JOBS_SQL)
  log(`[verify-pm] scanned ${jobs.length} active jobs`)

  // ── Classify every job ──────────────────────────────────────────────────
  const buckets = {
    CORRECT: [],
    MISASSIGNED_THOMAS: [],
    MISASSIGNED_BRITTNEY: [],
    MISASSIGNED_BEN: [],
    UNASSIGNED: [],
    ZOMBIE_INACTIVE_BUILDER: [],
    WRONG_ENTITY_TYPE: [],
    ZOMBIE_LOST_BUILDER: [],
    UNKNOWN_BUILDER: [],
  }

  // Helper: owner label from assignedPM firstName — rough but fine for comparison.
  function assignedPMFirstName(j) {
    return (j.firstName || '').trim().toLowerCase()
  }

  for (const j of jobs) {
    const bName = j.builderName
    const statusClosed = CLOSED_STATUSES.has(j.status)

    // Priority order matters — check the most-specific / most-dangerous buckets first.

    // 1. Zombie LOST builders (Pulte family) — should have been cleaned up already.
    if (matchesAny(bName, LOST_BUILDERS)) {
      if (!statusClosed) {
        buckets.ZOMBIE_LOST_BUILDER.push(j)
        continue
      }
      // lost-but-closed is fine; fall through to a normal classification,
      // but since we filtered closed at the SQL level, it shouldn't reach here.
    }

    // 2. Wrong entity type (supplier or labor sub recorded as a customer/builder).
    if (matchesAny(bName, SUPPLIER_NOT_CUSTOMER) || matchesAny(bName, LABOR_SUBCONTRACTOR)) {
      buckets.WRONG_ENTITY_TYPE.push(j)
      continue
    }

    // 3. Zombie inactive builders (Truth Construction, GH Homes).
    if (matchesAny(bName, INACTIVE_BUILDERS)) {
      if (!statusClosed) {
        buckets.ZOMBIE_INACTIVE_BUILDER.push(j)
        continue
      }
    }

    // 4. Mapped-owner builders — Thomas / Brittney / Ben.
    const thomasMatch = matchesAny(bName, THOMAS_BUILDERS)
    const brittneyMatch = matchesAny(bName, BRITTNEY_BUILDERS)
    const benMatch = matchesAny(bName, BEN_BUILDERS)

    if (thomasMatch) {
      if (assignedPMFirstName(j) === 'thomas') buckets.CORRECT.push(j)
      else buckets.MISASSIGNED_THOMAS.push(j)
      continue
    }
    if (brittneyMatch) {
      if (assignedPMFirstName(j) === 'brittney') buckets.CORRECT.push(j)
      else buckets.MISASSIGNED_BRITTNEY.push(j)
      continue
    }
    if (benMatch) {
      if (assignedPMFirstName(j) === 'ben') buckets.CORRECT.push(j)
      else buckets.MISASSIGNED_BEN.push(j)
      continue
    }

    // 5. Unmapped. Null builder name OR no mapping match.
    if (!bName) {
      buckets.UNKNOWN_BUILDER.push({ ...j, _note: 'builderName is NULL' })
      continue
    }
    if (!j.assignedPMId) {
      buckets.UNASSIGNED.push(j)
      continue
    }
    buckets.UNKNOWN_BUILDER.push(j)
  }

  // ── Top-line summary ────────────────────────────────────────────────────
  const total = jobs.length
  const correct = buckets.CORRECT.length
  const misassigned = buckets.MISASSIGNED_THOMAS.length + buckets.MISASSIGNED_BRITTNEY.length + buckets.MISASSIGNED_BEN.length
  const zombie = buckets.ZOMBIE_INACTIVE_BUILDER.length + buckets.ZOMBIE_LOST_BUILDER.length + buckets.WRONG_ENTITY_TYPE.length
  const unassigned = buckets.UNASSIGNED.length
  const unknown = buckets.UNKNOWN_BUILDER.length
  const failing = misassigned + zombie + buckets.WRONG_ENTITY_TYPE.length
  const verdict = failing === 0 ? 'PASS' : 'FAIL'

  log('')
  log('================================================================')
  log(`PM assignments integrity: ${correct} correct, ${misassigned} misassigned, ${zombie} zombie, ${unassigned} unassigned — [${verdict}]`)
  log('================================================================')
  log(`total active jobs scanned: ${total}`)
  log(`  UNKNOWN_BUILDER (not in any list): ${unknown}`)

  bar('COUNTS BY CLASSIFICATION')
  for (const [k, v] of Object.entries(buckets)) {
    log(`  ${k.padEnd(28)} ${v.length}`)
  }

  // ── Sample rows per non-empty anomaly bucket ─────────────────────────────
  const showBucket = (name, rows, extraFn) => {
    if (rows.length === 0) return
    bar(`Sample — ${name} (first ${Math.min(SAMPLE_SIZE, rows.length)} of ${rows.length})`)
    rows.slice(0, SAMPLE_SIZE).forEach(r => log(fmtJob(r, extraFn ? extraFn(r) : '')))
  }

  showBucket('MISASSIGNED_THOMAS', buckets.MISASSIGNED_THOMAS, r => `expected=Thomas actual=${assignedPMFirstName(r) || 'UNASSIGNED'}`)
  showBucket('MISASSIGNED_BRITTNEY', buckets.MISASSIGNED_BRITTNEY, r => `expected=Brittney actual=${assignedPMFirstName(r) || 'UNASSIGNED'}`)
  showBucket('MISASSIGNED_BEN', buckets.MISASSIGNED_BEN, r => `expected=Ben actual=${assignedPMFirstName(r) || 'UNASSIGNED'}`)
  showBucket('ZOMBIE_LOST_BUILDER', buckets.ZOMBIE_LOST_BUILDER, r => 'should be CLOSED (Pulte cleanup 9010d11)')
  showBucket('ZOMBIE_INACTIVE_BUILDER', buckets.ZOMBIE_INACTIVE_BUILDER, r => 'builder is inactive — should be CLOSED')
  showBucket('WRONG_ENTITY_TYPE', buckets.WRONG_ENTITY_TYPE, r => 'supplier/labor-sub — not a customer builder')
  showBucket('UNKNOWN_BUILDER', buckets.UNKNOWN_BUILDER, r => r._note ?? 'not in any mapping list')
  showBucket('UNASSIGNED', buckets.UNASSIGNED, () => 'assignedPMId is NULL (unmapped builder)')

  // ── Proposed fixes for MISASSIGNED rows (PRINT ONLY — DO NOT RUN) ────────
  if (misassigned > 0) {
    bar('PROPOSED FIX SQL (review before executing — DO NOT auto-run)')
    log('-- The statements below are NOT executed. Copy/review/run manually after Nate approves.')
    log('')

    const renderFix = (bucket, targetId, label) => {
      if (bucket.length === 0) return
      log(`-- ${label} (${bucket.length} rows)`)
      const tId = targetId ?? '<NEEDS-MANUAL-RESOLUTION>'
      for (const j of bucket) {
        log(proposedFixSql(j.id, tId, label))
      }
      log('')
    }
    renderFix(buckets.MISASSIGNED_THOMAS, thomasId, 'Thomas Robinson')
    renderFix(buckets.MISASSIGNED_BRITTNEY, brittneyId, 'Brittney Werner')
    renderFix(buckets.MISASSIGNED_BEN, benId, 'Ben Wilson')
  }

  // ── Exit code ────────────────────────────────────────────────────────────
  log('')
  log(`elapsed ms: ${Date.now() - started}`)
  if (failing === 0) {
    log('[verify-pm] clean — exit 0')
    process.exit(0)
  } else {
    log(`[verify-pm] drift detected (${failing} anomalies) — exit 1`)
    process.exit(1)
  }
} catch (e) {
  console.error('[verify-pm] FAILED:', e?.message || e)
  if (e?.stack) console.error(e.stack)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
