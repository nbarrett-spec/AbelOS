#!/usr/bin/env node
/**
 * Phase 1 of community-fallback geocoding.
 *
 * Purpose: geocode the Community table itself (~10 rows) and store the
 * coordinates on each Community row, so Phase 2 can copy them to Jobs.
 *
 * Does NOT touch Job rows. That's Phase 2 (geocode-community-fallback-2.mjs).
 *
 * Strategy:
 *   1. Ensure Community.latitude / Community.longitude columns exist (ALTER).
 *   2. For each Community with NULL lat/lng, geocode via Nominatim using
 *      name + city + state + "TX" country bias. 1 req/sec per Nominatim policy.
 *   3. Write the coords back to Community.latitude / Community.longitude.
 *
 * Usage:
 *   node scripts/geocode-community-fallback.mjs            # dry run (default)
 *   node scripts/geocode-community-fallback.mjs --apply    # write to DB
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env')
const dbUrl = readFileSync(envPath, 'utf-8').match(/DATABASE_URL="([^"]+)"/)?.[1]
if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1) }

const APPLY = process.argv.includes('--apply')

const { neon } = await import('@neondatabase/serverless')
const sql = neon(dbUrl)

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function geocode(q) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&countrycodes=us`,
      { headers: { 'User-Agent': 'Aegis-Geocoder/1.0 (n.barrett@abellumber.com)' } }
    )
    if (!r.ok) return null
    const j = await r.json()
    if (j.length > 0) return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) }
    return null
  } catch { return null }
}

async function ensureColumns() {
  // These ALTERs are idempotent — IF NOT EXISTS is safe to run every time.
  if (!APPLY) {
    console.log('[dry-run] Would ensure Community.latitude / longitude columns exist.')
    return
  }
  await sql.query(`ALTER TABLE "Community" ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION`)
  await sql.query(`ALTER TABLE "Community" ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION`)
  console.log('Ensured Community.latitude / longitude columns.')
}

async function currentCounts() {
  const totalRow = await sql.query(`SELECT COUNT(*)::int AS n FROM "Community"`)
  const missingRow = APPLY
    ? await sql.query(`SELECT COUNT(*)::int AS n FROM "Community" WHERE latitude IS NULL OR longitude IS NULL`)
    : [{ n: totalRow[0].n }] // before ALTER runs, can't query these columns
  return { total: totalRow[0].n, missing: missingRow[0].n }
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN (no writes)'}`)

  await ensureColumns()

  const before = await currentCounts()
  console.log(`Communities: ${before.total} total, ${before.missing} missing lat/lng.`)

  // If we're dry-running, we can't read latitude / longitude yet — pretend all rows need geocoding.
  const communities = APPLY
    ? await sql.query(`
        SELECT id, name, address, city, state, zip
        FROM "Community"
        WHERE latitude IS NULL OR longitude IS NULL
        ORDER BY name
      `)
    : await sql.query(`
        SELECT id, name, address, city, state, zip
        FROM "Community"
        ORDER BY name
      `)

  if (communities.length === 0) {
    console.log('Nothing to do.')
    return
  }

  console.log(`\nGeocoding ${communities.length} communities (Nominatim, 1 req/sec)...`)
  const start = Date.now()
  let ok = 0, okCity = 0, fail = 0, wouldWrite = 0

  for (const c of communities) {
    // Build the best query string we can from what the row has.
    // Nominatim does well with "<name>, <city>, <state> USA" format.
    const parts = []
    if (c.name)    parts.push(c.name)
    if (c.address) parts.push(c.address)
    if (c.city)    parts.push(c.city)
    if (c.state)   parts.push(c.state)
    else           parts.push('TX') // DFW bias — Abel's market is Texas
    if (c.zip)     parts.push(c.zip)
    const q = parts.join(', ')

    let coords = await geocode(q)
    let source = 'full'

    // Fallback: subdivisions are often unknown to OSM. Drop back to city+state
    // which gives us a city-center coordinate — for small DFW suburbs this is
    // within a few miles of the actual community and vastly better than NULL.
    if (!coords && c.city && (c.state || true)) {
      await sleep(1050)
      const cityQ = [c.city, c.state || 'TX'].join(', ')
      coords = await geocode(cityQ)
      if (coords) source = 'city'
    }

    if (coords) {
      if (source === 'full') ok++; else okCity++
      console.log(`  OK(${source === 'full' ? 'name' : 'city'}) ${c.name}  ->  (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})  [${q}]`)
      if (APPLY) {
        await sql.query(
          `UPDATE "Community" SET latitude=$1, longitude=$2 WHERE id=$3`,
          [coords.lat, coords.lng, c.id]
        )
      } else {
        wouldWrite++
      }
    } else {
      fail++
      console.log(`  FAIL ${c.name}  (query: "${q}")`)
    }

    await sleep(1050) // honor 1 req/sec Nominatim policy
  }

  const secs = ((Date.now() - start) / 1000).toFixed(0)
  console.log(`\nDone in ${secs}s. ok(name)=${ok}, ok(city-fallback)=${okCity}, fail=${fail}, wouldWrite=${wouldWrite}`)

  if (APPLY) {
    const after = await currentCounts()
    console.log(`After: ${after.total} total, ${after.missing} still missing lat/lng.`)
  } else {
    console.log('Re-run with --apply to write.')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
