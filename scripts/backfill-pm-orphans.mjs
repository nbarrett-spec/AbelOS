#!/usr/bin/env node
// scripts/backfill-pm-orphans.mjs
//
// Close out the remaining Job.assignedPMId = NULL orphans.
//
// Context: scripts/backfill-pm-assignments.mjs assigned 478 jobs. 95 were
// skipped because its WHERE clause excludes status IN ('CLOSED','CANCELLED',
// 'COMPLETE'). (Note: 'CANCELLED' is not in the JobStatus enum — the earlier
// author left a defensive exclusion in case it's added later. Harmless today.)
// 'INVOICED' was NOT excluded by the prior script, which means any remaining
// INVOICED rows are either (a) from after the prior run, or (b) were missed —
// we re-check here anyway.
//
// The goal: classify each of the 95 orphans and take the right action.
//
// Classification buckets (mission-defined):
//   CLOSED_ARCHIVED  — status IN ('CLOSED','COMPLETE','INVOICED')  — leave null
//                      (CANCELLED is in the mission's list but not in the enum;
//                       we include it defensively in case it gets added)
//   STALE            — status is pre-ship AND updatedAt > 180 days old
//                      Action: LEAVE UNASSIGNED. We do NOT flip to CANCELLED
//                      because CANCELLED is not a valid JobStatus enum value
//                      in the current schema — the update would fail. Stale
//                      jobs are logged in the report for Nate to archive manually.
//   ACTIVE_NEEDS_PM  — status IN ('CREATED','READINESS_CHECK','MATERIALS_LOCKED',
//                       'IN_PRODUCTION','STAGED','LOADED','IN_TRANSIT',
//                       'DELIVERED','INSTALLING','PUNCH_LIST')
//                      Action: assign to least-loaded active PM (load-balanced RR).
//   EDGE_CASE        — anything that didn't match above. Logged, not auto-fixed.
//
// The STALE cutoff is 180 days from "now" on the server clock.
//
// The script is DRY-RUN by default. Pass --apply to write.
//
// USAGE:
//   node scripts/backfill-pm-orphans.mjs           # dry-run, writes report
//   node scripts/backfill-pm-orphans.mjs --apply   # dry-run + execute UPDATEs
//
// Output: PM_ORPHAN_REPORT.md in repo root.
//
// Idempotent: a re-run finds fewer ACTIVE_NEEDS_PM (or zero) after --apply.

import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const REPORT_PATH = join(REPO_ROOT, 'PM_ORPHAN_REPORT.md')

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

// Canonical PM roster from CLAUDE.md / memory/people/abel-team.md.
const PM_ROSTER = [
  'Chad Zeh',
  'Brittney Werner',
  'Thomas Robinson',
  'Ben Wilson',
]

const CLOSED_STATUSES = new Set(['CLOSED', 'COMPLETE', 'INVOICED', 'CANCELLED'])
const ACTIVE_STATUSES = new Set([
  'CREATED',
  'READINESS_CHECK',
  'MATERIALS_LOCKED',
  'IN_PRODUCTION',
  'STAGED',
  'LOADED',
  'IN_TRANSIT',
  'DELIVERED',
  'INSTALLING',
  'PUNCH_LIST',
])

const STALE_DAYS = 180
const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000

function classify(job, now) {
  const status = job.status
  if (CLOSED_STATUSES.has(status)) return 'CLOSED_ARCHIVED'
  if (ACTIVE_STATUSES.has(status)) {
    const age = now - new Date(job.updatedAt).getTime()
    if (age > STALE_MS) return 'STALE'
    return 'ACTIVE_NEEDS_PM'
  }
  return 'EDGE_CASE'
}

async function main() {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`PM-orphan close-out  —  mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`)
  console.log(`${'='.repeat(70)}\n`)

  // ── 1. Load active-PM pool. ──
  const allPms = await prisma.staff.findMany({
    where: {
      active: true,
      OR: [
        { role: 'PROJECT_MANAGER' },
        { roles: { contains: 'PROJECT_MANAGER' } },
      ],
    },
    select: { id: true, firstName: true, lastName: true, email: true },
  })

  const byFullName = new Map()
  for (const s of allPms) {
    byFullName.set(`${s.firstName} ${s.lastName}`.toLowerCase(), s)
  }

  const rosterPms = []
  const rosterMissing = []
  for (const name of PM_ROSTER) {
    const hit = byFullName.get(name.toLowerCase())
    if (hit) rosterPms.push(hit)
    else rosterMissing.push(name)
  }
  const pool = rosterPms.length > 0 ? rosterPms : allPms
  console.log(`Active PMs found: ${allPms.length}`)
  console.log(`Named roster matched: ${rosterPms.length} / ${PM_ROSTER.length}`)
  if (rosterMissing.length) {
    console.log(`  Missing from Staff table: ${rosterMissing.join(', ')}`)
  }
  console.log(`Pool for load-balanced assignment:`)
  for (const p of pool) {
    console.log(`  - ${p.firstName} ${p.lastName}  id=${p.id}`)
  }

  // ── 2. Current per-PM load (for load-balancing). ──
  const currentLoadRows = await prisma.$queryRawUnsafe(`
    SELECT "assignedPMId" AS "pmId", COUNT(*)::int AS "count"
    FROM "Job"
    WHERE "assignedPMId" IS NOT NULL
    GROUP BY "assignedPMId"
  `)
  const currentLoad = new Map()
  for (const r of currentLoadRows) currentLoad.set(r.pmId, r.count)

  console.log(`\nCurrent load (all assigned jobs, across every PM):`)
  const poolIds = new Set(pool.map((p) => p.id))
  for (const p of pool) {
    console.log(`  ${(p.firstName + ' ' + p.lastName).padEnd(24)} ${currentLoad.get(p.id) || 0}`)
  }
  // Flag any PM with load that's not in the pool (e.g. inactive or not in roster).
  for (const [pmId, count] of currentLoad.entries()) {
    if (!poolIds.has(pmId)) {
      // only log if it's a non-trivial count
      if (count > 0) {
        const who = await prisma.staff.findUnique({
          where: { id: pmId },
          select: { firstName: true, lastName: true, active: true },
        })
        console.log(
          `  (outside pool) ${(who ? who.firstName + ' ' + who.lastName : pmId).padEnd(24)} ${count}${who && !who.active ? '  [inactive]' : ''}`,
        )
      }
    }
  }

  // ── 3. Load orphan jobs. ──
  const orphans = await prisma.$queryRawUnsafe(`
    SELECT j."id", j."jobNumber", j."builderName",
           j."status"::text AS status,
           j."createdAt", j."updatedAt", j."scheduledDate",
           j."orderId"
    FROM "Job" j
    WHERE j."assignedPMId" IS NULL
    ORDER BY j."createdAt" ASC
  `)
  const orphanCount = orphans.length
  console.log(`\nOrphan jobs (assignedPMId IS NULL): ${orphanCount}`)

  // ── 4. Classify. ──
  const now = Date.now()
  const buckets = {
    CLOSED_ARCHIVED: [],
    STALE: [],
    ACTIVE_NEEDS_PM: [],
    EDGE_CASE: [],
  }
  for (const j of orphans) {
    const b = classify(j, now)
    buckets[b].push(j)
  }

  console.log(`\nClassification:`)
  for (const b of Object.keys(buckets)) {
    console.log(`  ${b.padEnd(18)} ${buckets[b].length}`)
  }

  // ── 5. Plan ACTIVE_NEEDS_PM assignments via load-balanced choice. ──
  // We clone currentLoad and greedily assign each orphan to whichever pool
  // member has the lowest projected load. Deterministic tie-break by PM id.
  const projectedLoad = new Map()
  for (const p of pool) projectedLoad.set(p.id, currentLoad.get(p.id) || 0)

  const assignments = [] // {job, pmId}
  const sortedByName = [...buckets.ACTIVE_NEEDS_PM].sort((a, b) =>
    a.jobNumber.localeCompare(b.jobNumber),
  )
  for (const job of sortedByName) {
    // Pick the PM with the lowest projected load; tie-break by staff.id for
    // determinism (re-running always picks the same PM for the same job).
    let pick = null
    let pickCount = Infinity
    for (const p of pool) {
      const c = projectedLoad.get(p.id) ?? 0
      if (c < pickCount || (c === pickCount && (!pick || p.id < pick.id))) {
        pickCount = c
        pick = p
      }
    }
    assignments.push({ jobId: job.id, jobNumber: job.jobNumber, pmId: pick.id })
    projectedLoad.set(pick.id, pickCount + 1)
  }

  // Per-PM delta from this run.
  const addedPerPm = new Map()
  for (const a of assignments) {
    addedPerPm.set(a.pmId, (addedPerPm.get(a.pmId) || 0) + 1)
  }

  console.log(`\nPlanned assignments (ACTIVE_NEEDS_PM): ${assignments.length}`)
  for (const p of pool) {
    const added = addedPerPm.get(p.id) || 0
    const after = projectedLoad.get(p.id) || 0
    console.log(
      `  ${(p.firstName + ' ' + p.lastName).padEnd(24)}  +${added}  → ${after}`,
    )
  }

  // Sample preview.
  if (assignments.length > 0) {
    console.log(`\nSample (first 5 ACTIVE_NEEDS_PM assignments):`)
    const nameFor = new Map(pool.map((p) => [p.id, `${p.firstName} ${p.lastName}`]))
    for (const a of assignments.slice(0, 5)) {
      console.log(`  ${a.jobNumber.padEnd(16)}  →  ${nameFor.get(a.pmId)}`)
    }
  }

  // ── 6. Apply (if requested). ──
  let written = 0
  if (APPLY && assignments.length > 0) {
    console.log(`\nApplying ${assignments.length} updates…`)
    for (let i = 0; i < assignments.length; i += 200) {
      const batch = assignments.slice(i, i + 200)
      await prisma.$transaction(
        batch.map((u) =>
          prisma.job.update({
            where: { id: u.jobId },
            data: { assignedPMId: u.pmId },
          }),
        ),
      )
      written += batch.length
      process.stdout.write(`\r  wrote ${written}/${assignments.length}`)
    }
    console.log(`\nDone.`)
  } else if (!APPLY) {
    console.log(`\nDry run — no writes. Re-run with --apply to execute.`)
  }

  // ── 7. Verification: re-count after writes. ──
  let orphansAfter = orphanCount
  if (APPLY) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS "c" FROM "Job" WHERE "assignedPMId" IS NULL`,
    )
    orphansAfter = rows[0]?.c ?? orphanCount
  }

  // ── 8. Write report. ──
  const nameFor = new Map(pool.map((p) => [p.id, `${p.firstName} ${p.lastName}`]))

  const lines = []
  lines.push(`# PM Orphan Close-Out Report`)
  lines.push(``)
  lines.push(
    `**Mode:** ${APPLY ? 'APPLY (writes executed)' : 'DRY RUN (no writes)'}`,
  )
  lines.push(`**Run at:** ${new Date().toISOString()}`)
  lines.push(``)
  lines.push(`## Before`)
  lines.push(``)
  lines.push(`- Orphan Jobs (\`assignedPMId IS NULL\`): **${orphanCount}**`)
  lines.push(``)
  lines.push(`## Classification`)
  lines.push(``)
  lines.push(`| Bucket | Count | Action |`)
  lines.push(`|---|---:|---|`)
  lines.push(
    `| CLOSED_ARCHIVED | ${buckets.CLOSED_ARCHIVED.length} | Leave null (archival state, no PM needed) |`,
  )
  lines.push(
    `| STALE | ${buckets.STALE.length} | Leave null, flag for manual archive (see list below). ` +
      `**Note:** CANCELLED is not in the JobStatus enum — can't auto-flip. |`,
  )
  lines.push(
    `| ACTIVE_NEEDS_PM | ${buckets.ACTIVE_NEEDS_PM.length} | ${APPLY ? 'Assigned' : 'Planned'} via load-balanced round-robin |`,
  )
  lines.push(
    `| EDGE_CASE | ${buckets.EDGE_CASE.length} | Logged for manual review |`,
  )
  lines.push(``)
  lines.push(`**Total:** ${Object.values(buckets).reduce((a, b) => a + b.length, 0)}`)
  lines.push(``)

  if (APPLY) {
    lines.push(`## After`)
    lines.push(``)
    lines.push(`- Orphan Jobs remaining (\`assignedPMId IS NULL\`): **${orphansAfter}**`)
    lines.push(
      `- Expected remaining = CLOSED_ARCHIVED + STALE + EDGE_CASE = ` +
        `${buckets.CLOSED_ARCHIVED.length + buckets.STALE.length + buckets.EDGE_CASE.length}`,
    )
    lines.push(``)
  }

  lines.push(`## Per-PM load (after this run)`)
  lines.push(``)
  lines.push(`| PM | Before | Added (this run) | After |`)
  lines.push(`|---|---:|---:|---:|`)
  for (const p of pool) {
    const before = currentLoad.get(p.id) || 0
    const added = addedPerPm.get(p.id) || 0
    const after = before + added
    lines.push(
      `| ${p.firstName} ${p.lastName} | ${before} | ${added} | ${after} |`,
    )
  }
  // Also include any outside-pool PMs with load.
  const outsidePmIds = Array.from(currentLoad.keys()).filter(
    (id) => !poolIds.has(id) && (currentLoad.get(id) || 0) > 0,
  )
  if (outsidePmIds.length > 0) {
    const outside = await prisma.staff.findMany({
      where: { id: { in: outsidePmIds } },
      select: { id: true, firstName: true, lastName: true, active: true },
    })
    for (const s of outside) {
      const before = currentLoad.get(s.id) || 0
      lines.push(
        `| ${s.firstName} ${s.lastName}${s.active ? '' : ' (inactive)'} | ${before} | 0 | ${before} |`,
      )
    }
  }
  lines.push(``)

  // Detail sections.
  function renderJobList(list, limit = 50) {
    const rows = list.slice(0, limit).map((j) => {
      const updated = new Date(j.updatedAt).toISOString().slice(0, 10)
      return `| \`${j.jobNumber}\` | ${j.status} | ${j.builderName || ''} | ${updated} |`
    })
    const header = `| Job # | Status | Builder | Updated |\n|---|---|---|---|`
    const out = [header, ...rows]
    if (list.length > limit) out.push(`| _…${list.length - limit} more_ | | | |`)
    return out.join('\n')
  }

  lines.push(`## STALE jobs (pre-ship status, no activity in 180+ days)`)
  lines.push(``)
  lines.push(
    `These were left unassigned. Recommend Nate/PMs archive manually (there is ` +
      `no CANCELLED enum value, so status can't be flipped automatically today).`,
  )
  lines.push(``)
  if (buckets.STALE.length === 0) {
    lines.push(`_None._`)
  } else {
    lines.push(renderJobList(buckets.STALE))
  }
  lines.push(``)

  lines.push(`## EDGE_CASE jobs (status outside known active/closed sets)`)
  lines.push(``)
  if (buckets.EDGE_CASE.length === 0) {
    lines.push(`_None._`)
  } else {
    lines.push(renderJobList(buckets.EDGE_CASE))
  }
  lines.push(``)

  lines.push(`## CLOSED_ARCHIVED jobs (status in CLOSED/COMPLETE/INVOICED/CANCELLED)`)
  lines.push(``)
  lines.push(`No action taken — archival state, PM not required.`)
  lines.push(``)
  if (buckets.CLOSED_ARCHIVED.length === 0) {
    lines.push(`_None._`)
  } else {
    lines.push(renderJobList(buckets.CLOSED_ARCHIVED))
  }
  lines.push(``)

  // ACTIVE_NEEDS_PM details.
  lines.push(`## ACTIVE_NEEDS_PM assignments`)
  lines.push(``)
  if (assignments.length === 0) {
    lines.push(`_None._`)
  } else {
    const jobById = new Map(orphans.map((j) => [j.id, j]))
    lines.push(`| Job # | Status | Builder | Assigned to |`)
    lines.push(`|---|---|---|---|`)
    const shown = assignments.slice(0, 100)
    for (const a of shown) {
      const j = jobById.get(a.jobId)
      lines.push(
        `| \`${j.jobNumber}\` | ${j.status} | ${j.builderName || ''} | ${nameFor.get(a.pmId)} |`,
      )
    }
    if (assignments.length > 100) {
      lines.push(`| _…${assignments.length - 100} more_ | | | |`)
    }
  }
  lines.push(``)

  lines.push(`## Notes`)
  lines.push(``)
  lines.push(
    `- The JobStatus enum does **not** contain \`CANCELLED\`. The mission asked to ` +
      `flip STALE jobs to CANCELLED, but doing so would fail the Prisma write. ` +
      `Leaving STALE jobs unassigned is the safer option and is documented above.`,
  )
  lines.push(
    `- Load-balanced assignment picks the PM with the lowest current total ` +
      `(existing + already-picked-in-this-run). Tie-break is by staff id so re-runs ` +
      `stay deterministic.`,
  )
  lines.push(
    `- The script is idempotent: once run with \`--apply\`, ACTIVE_NEEDS_PM ` +
      `drops to zero on the next run.`,
  )

  writeFileSync(REPORT_PATH, lines.join('\n'))
  console.log(`\nReport written to: ${REPORT_PATH}`)

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
