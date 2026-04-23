/**
 * staff-manager-backfill.ts — Populate Staff.managerId from CLAUDE.md hierarchy.
 *
 * Context: 2026-04-23 migration added Staff.managerId (nullable FK → Staff.id).
 * All 72 rows currently have managerId = NULL. This script walks the canonical
 * org-chart encoded in CLAUDE.md and writes edges for names we can match.
 *
 * Matching: case-insensitive on (firstName, lastName). Unmatched staff are
 * left NULL and listed in the unresolved report. Nate Barrett is the root
 * (managerId stays NULL). Writes never touch any field besides managerId.
 *
 * Usage:
 *   npx tsx scripts/staff-manager-backfill.ts            # DRY RUN (default)
 *   npx tsx scripts/staff-manager-backfill.ts --commit   # apply updates
 *
 * Safety caps:
 *   - Max 30 edges applied per run.
 *   - Script refuses to self-reference (managerId === id).
 *   - Script refuses to overwrite an existing non-null managerId.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const COMMIT = process.argv.includes('--commit')
const MAX_EDGES = 30

/**
 * Canonical hierarchy from CLAUDE.md (Abel Lumber leadership + roster).
 * Format: [firstName, lastName, managerFirstName | null, managerLastName | null]
 * A null manager means the person is the root of the tree (Nate).
 */
const HIERARCHY: Array<[string, string, string | null, string | null]> = [
  // Root
  ['Nate', 'Barrett', null, null],

  // Direct reports to Nate
  ['Clint', 'Vinson', 'Nate', 'Barrett'],
  ['Josh', 'Barrett', 'Nate', 'Barrett'],
  ['Dalton', 'Whatley', 'Nate', 'Barrett'],

  // Direct reports to Clint
  ['Dawn', 'Meehan', 'Clint', 'Vinson'],
  ['Sean', 'Phillips', 'Clint', 'Vinson'],
  ['Chad', 'Zeh', 'Clint', 'Vinson'],
  ['Brittney', 'Werner', 'Clint', 'Vinson'],
  ['Thomas', 'Robinson', 'Clint', 'Vinson'],
  ['Ben', 'Wilson', 'Clint', 'Vinson'],
  ['Jordyn', 'Steider', 'Clint', 'Vinson'],

  // Estimator — CLAUDE.md says "Dalton or Clint"; picking Dalton (sales lead).
  ['Lisa', 'Adams', 'Dalton', 'Whatley'],

  // Production crew → Jordyn (logistics/production supervisor)
  ['Tiffany', 'Brooks', 'Jordyn', 'Steider'],
  ['Gunner', 'Hacker', 'Jordyn', 'Steider'],
  ['Julio', 'Castro', 'Jordyn', 'Steider'],
  ['Marcus', 'Trevino', 'Jordyn', 'Steider'],
  ['Cody', 'Prichard', 'Jordyn', 'Steider'],
  ['Wyatt', 'Tanner', 'Jordyn', 'Steider'],
  // "Michael" has no last name in CLAUDE.md — resolved case-insensitively on firstName only below.

  // Delivery drivers → Jordyn
  ['Austin', 'Collett', 'Jordyn', 'Steider'],
  ['Aaron', 'Treadaway', 'Jordyn', 'Steider'],
  ['Jack', 'Zenker', 'Jordyn', 'Steider'],
  ['Noah', 'Ridge', 'Jordyn', 'Steider'],
]

// Ambiguous single-name production crew (no last name in CLAUDE.md).
// Match by firstName only if there's exactly one Staff row with that firstName.
const FIRSTNAME_ONLY: Array<[string, string, string]> = [
  ['Michael', 'Jordyn', 'Steider'],
]

// Common nickname → given-name aliases so CLAUDE.md shorthand (Dalton, Sean, Josh)
// still matches the legal firstName stored in Staff.
const NICKNAME_ALIASES: Record<string, string[]> = {
  Dalton: ['James'],
  Sean: ['Robert'],
  Josh: ['Joshua'],
  Joshua: ['Josh'],
  James: ['Dalton'],
  Robert: ['Sean'],
  Benjamin: ['Ben'],
  Ben: ['Benjamin'],
}

type StaffRow = {
  id: string
  firstName: string
  lastName: string
  managerId: string | null
  active: boolean
}

function norm(s: string): string {
  return s.trim().toLowerCase()
}

function findStaff(
  staff: StaffRow[],
  first: string,
  last: string,
): StaffRow | undefined {
  const f = norm(first)
  const l = norm(last)
  // Direct match
  const direct = staff.find(
    (s) => norm(s.firstName) === f && norm(s.lastName) === l,
  )
  if (direct) return direct
  // Nickname aliases on firstName
  const aliases = NICKNAME_ALIASES[first] ?? []
  for (const alias of aliases) {
    const hit = staff.find(
      (s) => norm(s.firstName) === norm(alias) && norm(s.lastName) === l,
    )
    if (hit) return hit
  }
  return undefined
}

async function main() {
  const banner = '='.repeat(72)
  console.log(`\n${banner}`)
  console.log(`Staff.managerId backfill  —  mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'}`)
  console.log(`${banner}\n`)

  const staff: StaffRow[] = await prisma.staff.findMany({
    select: {
      id: true,
      firstName: true,
      lastName: true,
      managerId: true,
      active: true,
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })

  console.log(`Loaded ${staff.length} Staff rows.\n`)
  const alreadySet = staff.filter((s) => s.managerId !== null).length
  if (alreadySet > 0) {
    console.log(`(${alreadySet} rows already have managerId set — those are skipped.)\n`)
  }

  type Edge = {
    childId: string
    childName: string
    managerId: string
    managerName: string
  }
  const edges: Edge[] = []
  const unresolved: string[] = []
  const skippedRoot: string[] = []
  const skippedExisting: string[] = []

  // Main hierarchy pass
  for (const [first, last, mgrFirst, mgrLast] of HIERARCHY) {
    const child = findStaff(staff, first, last)
    if (!child) {
      unresolved.push(`${first} ${last} (not found in Staff)`)
      continue
    }
    if (mgrFirst === null || mgrLast === null) {
      skippedRoot.push(`${child.firstName} ${child.lastName} — root of tree`)
      continue
    }
    const mgr = findStaff(staff, mgrFirst, mgrLast)
    if (!mgr) {
      unresolved.push(
        `${child.firstName} ${child.lastName} — manager ${mgrFirst} ${mgrLast} not found`,
      )
      continue
    }
    if (child.id === mgr.id) {
      unresolved.push(`${child.firstName} ${child.lastName} — self-reference refused`)
      continue
    }
    if (child.managerId !== null) {
      skippedExisting.push(
        `${child.firstName} ${child.lastName} — managerId already set`,
      )
      continue
    }
    edges.push({
      childId: child.id,
      childName: `${child.firstName} ${child.lastName}`,
      managerId: mgr.id,
      managerName: `${mgr.firstName} ${mgr.lastName}`,
    })
  }

  // Firstname-only pass (e.g. "Michael" in production crew)
  for (const [first, mgrFirst, mgrLast] of FIRSTNAME_ONLY) {
    const matches = staff.filter((s) => norm(s.firstName) === norm(first))
    if (matches.length === 0) {
      unresolved.push(`${first} (firstname-only — no match)`)
      continue
    }
    if (matches.length > 1) {
      unresolved.push(
        `${first} (firstname-only — ${matches.length} candidates, cannot disambiguate)`,
      )
      continue
    }
    const child = matches[0]
    if (child.managerId !== null) {
      skippedExisting.push(
        `${child.firstName} ${child.lastName} — managerId already set`,
      )
      continue
    }
    const mgr = findStaff(staff, mgrFirst, mgrLast)
    if (!mgr) {
      unresolved.push(
        `${child.firstName} ${child.lastName} — manager ${mgrFirst} ${mgrLast} not found`,
      )
      continue
    }
    edges.push({
      childId: child.id,
      childName: `${child.firstName} ${child.lastName}`,
      managerId: mgr.id,
      managerName: `${mgr.firstName} ${mgr.lastName}`,
    })
  }

  // Any Staff row that isn't in HIERARCHY and wasn't a root/existing — log as unresolved.
  const touched = new Set([
    ...edges.map((e) => e.childId),
    ...skippedRoot.map((s) => s), // by name — only for reporting
  ])
  const namedInHierarchy = new Set<string>()
  for (const [f, l] of HIERARCHY) namedInHierarchy.add(`${norm(f)} ${norm(l)}`)
  for (const [f] of FIRSTNAME_ONLY) namedInHierarchy.add(`${norm(f)} *`)

  const unmappedStaff: string[] = []
  for (const s of staff) {
    if (touched.has(s.id)) continue
    if (s.managerId !== null) continue // already set; fine
    const key = `${norm(s.firstName)} ${norm(s.lastName)}`
    const wildKey = `${norm(s.firstName)} *`
    if (namedInHierarchy.has(key) || namedInHierarchy.has(wildKey)) continue
    // Also skip the root if named
    if (
      norm(s.firstName) === 'nate' &&
      norm(s.lastName) === 'barrett'
    )
      continue
    unmappedStaff.push(
      `${s.firstName} ${s.lastName}${s.active ? '' : ' [inactive]'}`,
    )
  }

  // Cap at MAX_EDGES.
  let applied = 0
  const toApply = edges.slice(0, MAX_EDGES)
  const overflow = edges.slice(MAX_EDGES)

  console.log(`─── Proposed edges (${edges.length}; cap ${MAX_EDGES}) ───`)
  for (const e of toApply) {
    console.log(`  ${e.childName.padEnd(28)} → ${e.managerName}`)
  }
  if (overflow.length > 0) {
    console.log(`\n(Skipping ${overflow.length} edges — cap hit)`)
    for (const e of overflow) {
      console.log(`  ${e.childName.padEnd(28)} → ${e.managerName}  [DEFERRED]`)
    }
  }

  if (skippedRoot.length > 0) {
    console.log(`\n─── Root (managerId stays NULL) ───`)
    for (const r of skippedRoot) console.log(`  ${r}`)
  }

  if (skippedExisting.length > 0) {
    console.log(`\n─── Skipped (managerId already set) ───`)
    for (const r of skippedExisting) console.log(`  ${r}`)
  }

  if (unresolved.length > 0) {
    console.log(`\n─── Unresolved (from hierarchy) ───`)
    for (const r of unresolved) console.log(`  ${r}`)
  }

  if (unmappedStaff.length > 0) {
    console.log(`\n─── Staff with no hierarchy entry (leave NULL) ───`)
    for (const r of unmappedStaff) console.log(`  ${r}`)
  }

  if (COMMIT) {
    console.log(`\n─── Applying ${toApply.length} edges ───`)
    for (const e of toApply) {
      await prisma.staff.update({
        where: { id: e.childId },
        data: { managerId: e.managerId },
      })
      applied++
      console.log(`  ✓ ${e.childName} → ${e.managerName}`)
    }
    console.log(`\nApplied ${applied} edges.`)
  } else {
    console.log(`\n(DRY RUN — no writes. Re-run with --commit to apply.)`)
  }

  console.log(`\n${banner}`)
  console.log(
    `Summary: proposed=${edges.length}  applied=${applied}  unresolved=${unresolved.length}  unmapped=${unmappedStaff.length}`,
  )
  console.log(`${banner}\n`)
}

main()
  .catch((err) => {
    console.error('FATAL:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
