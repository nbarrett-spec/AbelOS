#!/usr/bin/env node
/**
 * Canonicalize Job.builderName to match Builder.companyName.
 *
 * The denormalized Job.builderName column has drift — visually-separate
 * strings for what's actually the same builder. Reports (PM Command Center
 * at /ops/projects) group by this raw string, so drift splits accounts.
 *
 * The Builder table was deduplicated in an earlier wave. This script aligns
 * Job.builderName to the canonical Builder.companyName without touching
 * Builder rows or the schema.
 *
 * Algorithm:
 *   1. Load every Builder.companyName (all statuses — we want to align even
 *      CLOSED builders' historical jobs so reports group correctly).
 *   2. For each distinct Job.builderName, try to resolve to a canonical
 *      Builder.companyName via:
 *      a. Exact match (no-op, skip)
 *      b. Synonym table (hardcoded for the known drift groups — Pulte,
 *         BROOKFIELD, etc.)
 *      c. Normalized match (accents stripped, whitespace collapsed,
 *         lowercased). If exactly one Builder normalizes to the same key,
 *         that's the canonical.
 *   3. Emit per-group mapping report (variant → canonical, count).
 *   4. On --commit, UPDATE Job.builderName in batches and re-query
 *      DISTINCT builderName among active jobs to verify cleanup.
 *
 * Jobs whose builderName doesn't resolve to any Builder are left alone
 * (including 'Unknown', which is handled by backfill-unknown-builders.mjs).
 *
 * Dry-run by default. Pass --commit to apply.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbUrl = readFileSync(join(__dirname, '..', '.env'), 'utf-8').match(
  /DATABASE_URL="([^"]+)"/,
)?.[1]
if (!dbUrl) {
  console.error('No DATABASE_URL in .env')
  process.exit(1)
}

const commit = process.argv.includes('--commit')

const { neon } = await import('@neondatabase/serverless')
const sql = neon(dbUrl)

const ACTIVE_STATUSES = [
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
]

/** Normalize: strip accents, lowercase, collapse whitespace, trim. */
function norm(s) {
  if (!s) return ''
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Hardcoded synonyms for drift groups where the normalized form doesn't
 * collapse cleanly (e.g. "Pulte" vs "Pulte Homes" — same company, different
 * strings that don't normalize to the same key).
 *
 * Key = normalized variant; Value = canonical Builder.companyName (must
 * exist in the Builder table).
 */
const SYNONYMS = {
  pulte: 'Pulte Homes',
  'pulte homes dfw': 'Pulte Homes',
  centex: 'Pulte Homes',
  'centex homes': 'Pulte Homes',
  'del webb': 'Pulte Homes',
  brookfield: 'Brookfield Homes',
  'brookfield residential': 'Brookfield Homes',
  'bwp': 'Brookfield Homes',
  'toll brothers dfw': 'Toll Brothers',
}

async function main() {
  // ----- Phase 0: reference data -----
  const builderRows = await sql.query(
    `SELECT "companyName", status FROM "Builder" WHERE "companyName" IS NOT NULL`,
  )
  const builderNames = builderRows.map((r) => r.companyName).filter(Boolean)

  // normKey -> canonical Builder.companyName (first wins; duplicates warned)
  const normToBuilder = new Map()
  const builderNormCollisions = []
  for (const name of builderNames) {
    const k = norm(name)
    if (!k) continue
    if (normToBuilder.has(k) && normToBuilder.get(k) !== name) {
      builderNormCollisions.push({ key: k, existing: normToBuilder.get(k), incoming: name })
      // keep first (alphabetic order from DB — arbitrary but stable)
      continue
    }
    normToBuilder.set(k, name)
  }
  if (builderNormCollisions.length) {
    console.log('NOTE: Builder table has normalization collisions (not changing Builder rows):')
    for (const c of builderNormCollisions) {
      console.log(`  "${c.existing}"  vs  "${c.incoming}"  (key="${c.key}")`)
    }
  }

  const exactBuilderSet = new Set(builderNames)

  // ----- Phase 1: distinct Job.builderName counts -----
  const distinctRows = await sql.query(
    `SELECT "builderName", COUNT(*)::int n
       FROM "Job"
      WHERE "builderName" IS NOT NULL
      GROUP BY "builderName"
      ORDER BY n DESC`,
  )
  console.log(`\nDistinct Job.builderName values: ${distinctRows.length}`)

  // ----- Phase 2: resolve each variant -----
  // plan: [{ variant, canonical, count, reason }]
  const plan = []
  const unchanged = []
  const unresolved = []

  for (const r of distinctRows) {
    const variant = r.builderName
    const count = r.n

    // 2a. Exact match → skip
    if (exactBuilderSet.has(variant)) {
      unchanged.push({ variant, count, reason: 'exact-match' })
      continue
    }

    // 2b. Synonym
    const k = norm(variant)
    if (SYNONYMS[k]) {
      const canonical = SYNONYMS[k]
      if (!exactBuilderSet.has(canonical)) {
        console.warn(`  WARN: synonym "${variant}" → "${canonical}" but canonical not in Builder table — skipping`)
        unresolved.push({ variant, count, reason: 'synonym-target-missing' })
        continue
      }
      if (canonical === variant) {
        unchanged.push({ variant, count, reason: 'exact-match' })
        continue
      }
      plan.push({ variant, canonical, count, reason: 'synonym' })
      continue
    }

    // 2c. Normalized match against Builder table
    const canonical = normToBuilder.get(k)
    if (canonical && canonical !== variant) {
      plan.push({ variant, canonical, count, reason: 'normalized' })
      continue
    }

    // 2d. No match — leave alone
    unresolved.push({ variant, count, reason: 'no-builder-match' })
  }

  // ----- Phase 3: report -----
  console.log('\n=== Planned updates (variant → canonical, rows affected) ===')
  if (!plan.length) {
    console.log('  (no drift to fix)')
  } else {
    // group by canonical for the per-group summary
    const byCanonical = new Map()
    for (const p of plan) {
      if (!byCanonical.has(p.canonical)) byCanonical.set(p.canonical, [])
      byCanonical.get(p.canonical).push(p)
    }
    for (const [canonical, variants] of [...byCanonical.entries()].sort(
      (a, b) => b[1].reduce((s, v) => s + v.count, 0) - a[1].reduce((s, v) => s + v.count, 0),
    )) {
      const total = variants.reduce((s, v) => s + v.count, 0)
      console.log(`\n  → "${canonical}"  (+${total} rows)`)
      for (const v of variants) {
        console.log(`      "${v.variant}"  ${String(v.count).padStart(5)}  [${v.reason}]`)
      }
    }
  }

  console.log(`\n=== Unchanged (already canonical) ===  ${unchanged.length} variants`)
  console.log(`=== Unresolved (no Builder match, left alone) ===  ${unresolved.length} variants`)
  for (const u of unresolved.slice(0, 20)) {
    console.log(`  "${u.variant}"  (${u.count})  [${u.reason}]`)
  }
  if (unresolved.length > 20) console.log(`  ... and ${unresolved.length - 20} more`)

  // ----- Phase 4: apply -----
  if (!commit) {
    console.log('\n[DRY RUN] Re-run with --commit to apply.')
    return
  }

  console.log('\n--- Applying updates ---')
  let totalUpdated = 0
  for (const p of plan) {
    const res = await sql.query(
      `UPDATE "Job" SET "builderName" = $1, "updatedAt" = NOW() WHERE "builderName" = $2`,
      [p.canonical, p.variant],
    )
    // neon serverless: result is an array; for UPDATE without RETURNING we
    // rely on the announced plan count. Confirm with a COUNT query per
    // variant would double-query; trust p.count.
    console.log(`  "${p.variant}"  →  "${p.canonical}"   (${p.count} rows)`)
    totalUpdated += p.count
  }
  console.log(`\nTotal rows updated: ${totalUpdated}`)

  // ----- Phase 5: verify -----
  const postActive = await sql.query(
    `SELECT DISTINCT "builderName" FROM "Job" WHERE status::text = ANY($1) ORDER BY "builderName"`,
    [ACTIVE_STATUSES],
  )
  console.log(`\n=== Post-apply: DISTINCT Job.builderName among active jobs (${postActive.length}) ===`)
  for (const r of postActive) console.log(`  "${r.builderName}"`)

  // flag any surviving value that still doesn't match a Builder
  const surviving = postActive
    .map((r) => r.builderName)
    .filter((n) => n && !exactBuilderSet.has(n))
  if (surviving.length) {
    console.log('\nStill non-canonical among active jobs:')
    for (const s of surviving) console.log(`  "${s}"`)
  } else {
    console.log('\nAll active Job.builderName values match a Builder.companyName exactly.')
  }

  console.log('\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
