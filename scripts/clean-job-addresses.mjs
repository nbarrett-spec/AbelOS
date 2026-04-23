#!/usr/bin/env node
/**
 * clean-job-addresses.mjs
 *
 * Bolt import polluted Job.jobAddress with trailing work-scope notes
 * (e.g. "704 COTTONTAIL - EXT. DOORS & ATTIC STAIR", "2717 Barton Springs Int. Doors").
 * The geocoder can't resolve those strings. This script:
 *   1) Backs up every Job.jobAddress into a new column Job.jobAddressRaw
 *      (created if it doesn't exist; only populated if currently NULL so
 *      we don't clobber a previous backup on re-runs).
 *   2) Strips trailing scope-note garbage using a pattern-based cleaner.
 *   3) Updates Job.jobAddress to the cleaned form (only when changed).
 *   4) Reports before/after samples.
 *
 * Safe to re-run — only writes rows whose cleaned value differs from current.
 * The sibling script `geocode-active-jobs.mjs` should be run afterward.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env')
const dbUrl = readFileSync(envPath, 'utf-8').match(/DATABASE_URL="([^"]+)"/)?.[1]
if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1) }

const { neon } = await import('@neondatabase/serverless')
const sql = neon(dbUrl)

// Scope-note keywords that, when they appear trailing/mid-string, indicate
// the address field was overloaded with a work-type tag during Bolt import.
// Matching is case-insensitive and word-boundary aware.
const SCOPE_KEYWORDS = [
  'EXT', 'INT', 'EXT\\.', 'INT\\.',
  'DOORS?', 'TRIM', 'DUNNAGE', 'ATTIC', 'HINGE', 'LABOR',
  'SWAP', 'CARPET', 'STAIRS?', 'HARDWARE', 'REWORK', 'TOUCH[- ]?UP',
  'PUNCH', 'MISC', 'EXTRAS?', 'RETURN', 'REORDER',
]

// Vendor/customer name stamps that sometimes replace the ZIP in polluted rows.
// Kept small and explicit — easier to extend than to guess.
const VENDOR_STAMPS = [
  'Dangelmayr',
  'Young',        // "Young Trim and Doors"
  'Tabler',       // when used as a vendor label, not a street — careful
]

// Regex parts, compiled once.
const SCOPE_ALT = SCOPE_KEYWORDS.join('|')

// Pattern 1: "street - EXT. DOORS & ATTIC STAIR" or "street - Dangelmayr"
// Any " - " (hyphen with spaces, or en-dash, or en-dash with spaces) followed
// by one or more scope keywords / vendor stamps.
const TRAIL_DASH_SCOPE = new RegExp(
  `\\s*[-\u2013\u2014]\\s*(?:${SCOPE_ALT}|${VENDOR_STAMPS.join('|')})\\b.*$`,
  'i',
)

// Pattern 2: mid-string scope without a leading dash:
// "2717 Barton Springs Int. Doors" -> keep "2717 Barton Springs"
// Anchored after a street-type token (or any word) followed by a scope keyword.
// We only strip when the scope word appears AFTER at least one number+word pair,
// to avoid eating legitimate names like "Trimble Rd" or "Doors Landing".
const MID_SCOPE_NO_DASH = new RegExp(
  `^(\\d+\\s+[A-Za-z][A-Za-z0-9'\\.\\- ]*?)\\s+(?:${SCOPE_ALT})\\b.*$`,
  'i',
)

// Pattern 3: bare vendor-only labels like "Young Trim and Doors" with no street
// number — these aren't addresses at all. Mark them unclean-able (leave raw,
// return null so caller can log).
const VENDOR_ONLY = new RegExp(`^(?:${VENDOR_STAMPS.join('|')})\\s`, 'i')

function cleanAddress(raw) {
  if (!raw) return raw
  let s = raw.trim()
  const original = s

  // Pass A: strip trailing " - scope..." chunk
  s = s.replace(TRAIL_DASH_SCOPE, '').trim()

  // Pass B: strip mid-string scope (no leading dash)
  const midMatch = s.match(MID_SCOPE_NO_DASH)
  if (midMatch) s = midMatch[1].trim()

  // Tidy: collapse whitespace, strip trailing punctuation/hyphens
  s = s.replace(/\s+/g, ' ').replace(/[\s\-\u2013\u2014,]+$/, '').trim()

  // Sanity: if the cleaner stripped away everything, keep the original —
  // better to geocode a bad string than an empty one.
  if (!s) return original

  // Sanity: refuse to "clean" a vendor-only row (no street number).
  // Caller can skip these.
  if (VENDOR_ONLY.test(original) && !/^\d/.test(s)) return original

  return s
}

async function main() {
  // 1) Ensure backup column exists. IF NOT EXISTS makes this safe to re-run.
  await sql.query(`ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "jobAddressRaw" TEXT`)

  // 2) Backfill jobAddressRaw for any row where it's NULL — preserves the
  //    untouched original before we overwrite jobAddress.
  const backfill = await sql.query(`
    UPDATE "Job" SET "jobAddressRaw" = "jobAddress"
    WHERE "jobAddressRaw" IS NULL AND "jobAddress" IS NOT NULL
    RETURNING id
  `)
  console.log(`Backfilled jobAddressRaw for ${backfill.length} rows.`)

  // 3) Pull every non-empty jobAddress and clean it in-memory.
  const rows = await sql.query(`
    SELECT id, "jobAddress", latitude, longitude, status::text AS status
    FROM "Job"
    WHERE "jobAddress" IS NOT NULL AND "jobAddress" != ''
  `)
  console.log(`Scanned ${rows.length} Job rows.`)

  const changes = []
  for (const r of rows) {
    const cleaned = cleanAddress(r.jobAddress)
    if (cleaned !== r.jobAddress) {
      changes.push({ id: r.id, before: r.jobAddress, after: cleaned, ungeocoded: r.latitude == null })
    }
  }

  console.log(`Cleaner produced ${changes.length} changes.`)

  if (changes.length === 0) {
    console.log('Nothing to update. Done.')
    return
  }

  // 4) Apply updates in small batches to keep each statement light.
  let applied = 0
  for (const c of changes) {
    await sql.query(`UPDATE "Job" SET "jobAddress" = $1 WHERE id = $2`, [c.after, c.id])
    applied++
  }
  console.log(`Applied ${applied} updates to Job.jobAddress.`)

  // 5) Report a sample — show up to 20 before/after pairs, prioritizing
  //    rows that are currently ungeocoded (those are the ones that matter
  //    for the re-geocode pass).
  const sample = changes
    .slice()
    .sort((a, b) => (b.ungeocoded ? 1 : 0) - (a.ungeocoded ? 1 : 0))
    .slice(0, 20)

  console.log('\nSample (ungeocoded first):')
  for (const c of sample) {
    const tag = c.ungeocoded ? '[NO-GEO]' : '[OK-GEO]'
    console.log(`  ${tag} ${c.before}`)
    console.log(`       -> ${c.after}`)
  }

  const ungeo = changes.filter(c => c.ungeocoded).length
  console.log(`\nSummary: ${rows.length} scanned, ${changes.length} cleaned, ${ungeo} of the cleaned rows are currently ungeocoded.`)
  console.log('Next: run scripts/geocode-active-jobs.mjs to re-geocode the cleaned addresses.')
}

main().catch(e => { console.error(e); process.exit(1) })
