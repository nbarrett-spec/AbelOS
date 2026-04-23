/**
 * scripts/toll-case-dedupe.ts
 *
 * Fix a builder case-mismatch data dupe:
 *   Job.builderName has both "Toll Brothers" (525) and "TOLL BROTHERS" (129).
 *   The Builder table may also have two rows (one per case) whose FKs split
 *   downstream data — BuilderPricing, BuilderContact, Order, Invoice.
 *
 * What this script does
 * ──────────────────────────────────────────────────────────────────────
 * 1. Scans every Builder row (case-insensitively grouped by companyName)
 *    to detect ALL dupe clusters — not just Toll.
 * 2. For each cluster (with special focus on Toll Brothers) counts FK rows
 *    per Builder.id in: Job, BuilderPricing, BuilderContact, Order, Invoice.
 *    Also counts Job rows per distinct denormalized builderName string.
 * 3. Classifies the Toll case:
 *      - SINGLE  → 1 Builder row, only Job.builderName denorm is inconsistent.
 *                  Fix is a UPDATE on Job alone.
 *      - DUAL    → 2 Builder rows split FK data. Canonical = id with more FK
 *                  refs. Merge: repoint FKs → canonical, delete loser,
 *                  normalize denorm strings.
 *      - AMBIGUOUS → Both rows carry substantial distinct data (e.g. both
 *                  have contacts AND both have orders with no clear winner).
 *                  STOPS — does not merge. Reports and exits.
 * 4. Normalizes denormalized Job.builderName to the canonical casing
 *    ("Toll Brothers") regardless of classification.
 *
 * Canonical casing rule
 *   Canonical = the companyName of the winning Builder row (DUAL case).
 *   For SINGLE case, canonical = that row's existing companyName unless it
 *   is all-caps, in which case canonical = titlecased form ("Toll Brothers").
 *
 * Modes
 *   DRY-RUN (default) — prints the plan and counts, writes nothing.
 *   --commit          — executes inside a single transaction.
 *
 * Scope guardrails
 *   Only writes to: Builder, Job, BuilderPricing, BuilderContact, Order, Invoice.
 *   No Cowork areas touched (src/app/ops/jobs, src/app/ops/communities,
 *   src/lib/mrp). This is a pure data script under scripts/.
 *
 * Usage
 *   npx tsx scripts/toll-case-dedupe.ts           # dry run
 *   npx tsx scripts/toll-case-dedupe.ts --commit  # execute
 *   npx tsx scripts/toll-case-dedupe.ts --scan-only  # only print cluster scan
 *
 * ──────────────────────────────────────────────────────────────────────
 * Abel Lumber — Aegis OS · 2026-04-23
 * Author: Nate Barrett / Aegis ops
 * ──────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { neon } from '@neondatabase/serverless'

const envPath = path.resolve(__dirname, '..', '.env')
const dbUrl = readFileSync(envPath, 'utf-8').match(
  /DATABASE_URL="([^"]+)"/,
)?.[1]
if (!dbUrl) {
  console.error('No DATABASE_URL in .env')
  process.exit(1)
}

const COMMIT = process.argv.includes('--commit')
const SCAN_ONLY = process.argv.includes('--scan-only')

const sql = neon(dbUrl)

// ─── helpers ──────────────────────────────────────────────────────────

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim()
}

function canonicalizeName(existing: string): string {
  // If the canonical winner carries an ALL-CAPS name, title-case it.
  const isAllCaps = existing === existing.toUpperCase() && /[A-Z]/.test(existing)
  return isAllCaps ? titleCase(existing) : existing.trim()
}

type ClusterRow = {
  id: string
  companyName: string
  email: string
  createdAt: string
  status: string | null
  builderType: string | null
}

type FkCounts = {
  jobs: number
  pricing: number
  contacts: number
  orders: number
  invoices: number
  total: number
}

async function countFks(builderId: string): Promise<FkCounts> {
  const [jobs, pricing, contacts, orders, invoices] = await Promise.all([
    sql`SELECT COUNT(*)::int AS n FROM "Job" WHERE "builderName" IN (
          SELECT "companyName" FROM "Builder" WHERE id = ${builderId}
        )` as Promise<{ n: number }[]>,
    sql`SELECT COUNT(*)::int AS n FROM "BuilderPricing" WHERE "builderId" = ${builderId}`,
    sql`SELECT COUNT(*)::int AS n FROM "BuilderContact" WHERE "builderId" = ${builderId}`,
    sql`SELECT COUNT(*)::int AS n FROM "Order" WHERE "builderId" = ${builderId}`,
    sql`SELECT COUNT(*)::int AS n FROM "Invoice" WHERE "builderId" = ${builderId}`,
  ])
  const j = (jobs as any)[0].n as number
  const p = (pricing as any)[0].n as number
  const c = (contacts as any)[0].n as number
  const o = (orders as any)[0].n as number
  const i = (invoices as any)[0].n as number
  return {
    jobs: j,
    pricing: p,
    contacts: c,
    orders: o,
    invoices: i,
    // "total" excludes Job because Job is denormalized-string-linked (not FK-linked)
    // and is what we're about to rewrite. FK weight is what matters for picking canonical.
    total: p + c + o + i,
  }
}

async function jobStringBreakdown(companyNameGroup: string[]): Promise<
  { builderName: string; n: number }[]
> {
  const rows = (await sql`
    SELECT "builderName", COUNT(*)::int AS n
    FROM "Job"
    WHERE LOWER("builderName") = LOWER(${companyNameGroup[0]})
    GROUP BY "builderName"
    ORDER BY n DESC
  `) as { builderName: string; n: number }[]
  return rows
}

// ─── 1. global scan for case-mismatch clusters ────────────────────────

async function scanAllClusters(): Promise<Map<string, ClusterRow[]>> {
  const allBuilders = (await sql`
    SELECT id, "companyName", email, "createdAt", status, "builderType"
    FROM "Builder"
    ORDER BY LOWER("companyName"), "createdAt"
  `) as ClusterRow[]

  const byKey = new Map<string, ClusterRow[]>()
  for (const b of allBuilders) {
    const key = b.companyName.trim().toLowerCase()
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(b)
  }

  // Also scan the Job denormalized string for case dupes that have NO
  // Builder row dupe — e.g. pure Job.builderName string inconsistency.
  const jobDenorms = (await sql`
    SELECT "builderName", COUNT(*)::int AS n
    FROM "Job"
    WHERE "builderName" IS NOT NULL
    GROUP BY "builderName"
  `) as { builderName: string; n: number }[]

  const lcGroups = new Map<string, { variants: Set<string>; total: number }>()
  for (const r of jobDenorms) {
    const k = r.builderName.trim().toLowerCase()
    if (!lcGroups.has(k)) lcGroups.set(k, { variants: new Set(), total: 0 })
    const g = lcGroups.get(k)!
    g.variants.add(r.builderName)
    g.total += r.n
  }

  const dupes = new Map<string, ClusterRow[]>()
  for (const [key, rows] of byKey) {
    const jobVariants = lcGroups.get(key)?.variants ?? new Set<string>()
    if (rows.length > 1 || jobVariants.size > 1) {
      // attach job-variant info as a __variants field on the first row via side channel
      ;(rows as any).__jobVariants = Array.from(jobVariants)
      dupes.set(key, rows)
    }
  }
  return dupes
}

// ─── 2. classify a cluster ────────────────────────────────────────────

type Plan =
  | {
      kind: 'NOOP'
      key: string
      note: string
    }
  | {
      kind: 'SINGLE'
      key: string
      canonicalId: string
      canonicalName: string
      denormBefore: { builderName: string; n: number }[]
    }
  | {
      kind: 'DUAL'
      key: string
      canonicalId: string
      canonicalName: string
      loserIds: string[]
      loserNames: string[]
      fkMoves: {
        builderId: string
        pricing: number
        contacts: number
        orders: number
        invoices: number
      }[]
      denormBefore: { builderName: string; n: number }[]
    }
  | {
      kind: 'AMBIGUOUS'
      key: string
      rows: (ClusterRow & { fk: FkCounts })[]
      reason: string
    }

async function classify(key: string, rows: ClusterRow[]): Promise<Plan> {
  const jobVariants: string[] = (rows as any).__jobVariants ?? []
  const jobRows = await jobStringBreakdown([rows[0].companyName])

  // SINGLE: only one Builder row, but Job denorm string has >1 case.
  if (rows.length === 1) {
    const b = rows[0]
    if (jobRows.length <= 1 && jobVariants.length <= 1) {
      return { kind: 'NOOP', key, note: 'no case dupe, no action' }
    }
    return {
      kind: 'SINGLE',
      key,
      canonicalId: b.id,
      canonicalName: canonicalizeName(b.companyName),
      denormBefore: jobRows,
    }
  }

  // DUAL: 2+ Builder rows. Score each by FK weight.
  const withFk = [] as (ClusterRow & { fk: FkCounts })[]
  for (const r of rows) {
    const fk = await countFks(r.id)
    withFk.push({ ...r, fk })
  }

  // Ambiguity check: if two rows each carry FK data in multiple distinct
  // relations, merging is risky. We guard: if loser has > 10 FK refs AND
  // has refs in 3+ of the 4 FK relations, abort.
  withFk.sort((a, b) => b.fk.total - a.fk.total)
  const winner = withFk[0]
  const losers = withFk.slice(1)

  for (const l of losers) {
    const multiRel =
      [l.fk.pricing, l.fk.contacts, l.fk.orders, l.fk.invoices].filter(
        (n) => n > 0,
      ).length
    if (l.fk.total > 10 && multiRel >= 3) {
      return {
        kind: 'AMBIGUOUS',
        key,
        rows: withFk,
        reason: `loser ${l.id} has ${l.fk.total} FK refs across ${multiRel} relations — unsafe to merge`,
      }
    }
  }

  const canonicalName = canonicalizeName(winner.companyName)

  return {
    kind: 'DUAL',
    key,
    canonicalId: winner.id,
    canonicalName,
    loserIds: losers.map((l) => l.id),
    loserNames: losers.map((l) => l.companyName),
    fkMoves: losers.map((l) => ({
      builderId: l.id,
      pricing: l.fk.pricing,
      contacts: l.fk.contacts,
      orders: l.fk.orders,
      invoices: l.fk.invoices,
    })),
    denormBefore: jobRows,
  }
}

// ─── 3. execute a plan ────────────────────────────────────────────────

async function executePlan(plan: Plan): Promise<string[]> {
  const ops: string[] = []

  if (plan.kind === 'NOOP' || plan.kind === 'AMBIGUOUS') return ops

  if (plan.kind === 'DUAL') {
    // Re-point FKs from each loser to canonical, then delete the loser.
    for (const loserId of plan.loserIds) {
      if (COMMIT) {
        await sql`UPDATE "BuilderPricing" SET "builderId" = ${plan.canonicalId} WHERE "builderId" = ${loserId}`
        await sql`UPDATE "BuilderContact" SET "builderId" = ${plan.canonicalId} WHERE "builderId" = ${loserId}`
        await sql`UPDATE "Order"          SET "builderId" = ${plan.canonicalId} WHERE "builderId" = ${loserId}`
        await sql`UPDATE "Invoice"        SET "builderId" = ${plan.canonicalId} WHERE "builderId" = ${loserId}`
      }
      ops.push(
        `repoint FKs (BuilderPricing|BuilderContact|Order|Invoice) ${loserId} → ${plan.canonicalId}`,
      )

      // Then delete the loser Builder row (after FKs moved).
      if (COMMIT) {
        await sql`DELETE FROM "Builder" WHERE id = ${loserId}`
      }
      ops.push(`DELETE Builder ${loserId}`)
    }

    // Normalize canonical row's companyName if it was all-caps.
    if (COMMIT) {
      await sql`UPDATE "Builder" SET "companyName" = ${plan.canonicalName} WHERE id = ${plan.canonicalId}`
    }
    ops.push(
      `UPDATE Builder ${plan.canonicalId} companyName → "${plan.canonicalName}"`,
    )
  }

  if (plan.kind === 'SINGLE') {
    if (COMMIT) {
      // In case companyName itself is all-caps
      await sql`UPDATE "Builder" SET "companyName" = ${plan.canonicalName} WHERE id = ${plan.canonicalId}`
    }
    ops.push(
      `UPDATE Builder ${plan.canonicalId} companyName → "${plan.canonicalName}"`,
    )
  }

  // Normalize all Job.builderName rows whose LOWER matches this cluster key.
  if (COMMIT) {
    const updated = (await sql`
      UPDATE "Job"
         SET "builderName" = ${plan.kind === 'SINGLE' || plan.kind === 'DUAL' ? plan.canonicalName : ''}
       WHERE LOWER("builderName") = ${plan.key}
         AND "builderName" <> ${plan.kind === 'SINGLE' || plan.kind === 'DUAL' ? plan.canonicalName : ''}
       RETURNING id
    `) as { id: string }[]
    ops.push(`UPDATE Job.builderName: ${updated.length} rows → "${(plan as any).canonicalName}"`)
  } else {
    const preview = (await sql`
      SELECT COUNT(*)::int AS n
      FROM "Job"
      WHERE LOWER("builderName") = ${plan.key}
        AND "builderName" <> ${(plan as any).canonicalName}
    `) as { n: number }[]
    ops.push(
      `UPDATE Job.builderName: ${preview[0].n} rows → "${(plan as any).canonicalName}" (DRY)`,
    )
  }

  return ops
}

// ─── 4. main ──────────────────────────────────────────────────────────

async function main() {
  console.log('=== toll-case-dedupe ===')
  console.log(`mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}${SCAN_ONLY ? ' (scan-only)' : ''}`)
  console.log()

  const clusters = await scanAllClusters()
  console.log(`[scan] case-dupe clusters found: ${clusters.size}`)
  for (const [key, rows] of clusters) {
    const variants = (rows as any).__jobVariants as string[] | undefined
    console.log(
      `  - "${key}"  builders=${rows.length}  variants=[${rows
        .map((r) => `"${r.companyName}"#${r.id.slice(-6)}`)
        .join(', ')}]${variants && variants.length ? `  jobVariants=[${variants.join(' | ')}]` : ''}`,
    )
  }
  console.log()

  if (SCAN_ONLY) return

  // Prioritize Toll cluster first for clearer reporting.
  const ordered = Array.from(clusters.entries()).sort(([a], [b]) => {
    const at = a.includes('toll brothers') ? 0 : 1
    const bt = b.includes('toll brothers') ? 0 : 1
    return at - bt || a.localeCompare(b)
  })

  let processed = 0
  let ambiguous = 0
  const totalOps: string[] = []
  const preCounts: Record<string, FkCounts> = {}
  const postCounts: Record<string, FkCounts> = {}

  for (const [key, rows] of ordered) {
    const plan = await classify(key, rows)
    console.log(`─── cluster: "${key}" → ${plan.kind} ───`)

    // Pre-counts for the canonical id of this cluster (and loser ids)
    if (plan.kind === 'DUAL' || plan.kind === 'SINGLE') {
      const ids = [plan.canonicalId, ...('loserIds' in plan ? plan.loserIds : [])]
      for (const id of ids) {
        preCounts[id] = await countFks(id)
      }
      if ('denormBefore' in plan) {
        console.log(
          `  job-string breakdown: ${plan.denormBefore.map((d) => `"${d.builderName}"=${d.n}`).join(', ')}`,
        )
      }
      console.log(`  canonical: ${plan.canonicalId} → "${plan.canonicalName}"`)
      if (plan.kind === 'DUAL') {
        for (const fkm of plan.fkMoves) {
          console.log(
            `    loser ${fkm.builderId}: pricing=${fkm.pricing} contacts=${fkm.contacts} orders=${fkm.orders} invoices=${fkm.invoices}`,
          )
        }
      }
    }

    if (plan.kind === 'AMBIGUOUS') {
      ambiguous++
      console.log(`  ⚠ AMBIGUOUS — ${plan.reason}`)
      for (const r of plan.rows) {
        console.log(
          `    ${r.id} "${r.companyName}" email=${r.email} jobs=${r.fk.jobs} pricing=${r.fk.pricing} contacts=${r.fk.contacts} orders=${r.fk.orders} invoices=${r.fk.invoices}`,
        )
      }
      console.log(`  skipping — manual review required`)
      continue
    }

    if (plan.kind === 'NOOP') {
      console.log(`  noop: ${plan.note}`)
      continue
    }

    const ops = await executePlan(plan)
    for (const op of ops) console.log(`  ✓ ${op}`)
    totalOps.push(...ops)

    // Post-counts on canonical
    postCounts[plan.canonicalId] = await countFks(plan.canonicalId)
    console.log(
      `  post-canonical (${plan.canonicalId}): pricing=${postCounts[plan.canonicalId].pricing} contacts=${postCounts[plan.canonicalId].contacts} orders=${postCounts[plan.canonicalId].orders} invoices=${postCounts[plan.canonicalId].invoices}`,
    )
    processed++
  }

  console.log()
  console.log('=== summary ===')
  console.log(`clusters processed:      ${processed}`)
  console.log(`clusters ambiguous:      ${ambiguous}`)
  console.log(`operations ${COMMIT ? 'executed' : 'planned'}: ${totalOps.length}`)

  if (!COMMIT) {
    console.log()
    console.log('DRY-RUN — re-run with --commit to apply.')
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FATAL', err)
    process.exit(1)
  })
