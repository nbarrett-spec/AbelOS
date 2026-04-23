#!/usr/bin/env node
/**
 * Batch-geocode active Jobs that are missing lat/lng. Uses Nominatim (OSM).
 * Rate-limited to 1 req/sec per Nominatim policy.
 * Idempotent — skips jobs that already have lat/lng.
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

const ACTIVE_STATUSES = ['CREATED','READINESS_CHECK','MATERIALS_LOCKED','IN_PRODUCTION','STAGED','LOADED','IN_TRANSIT','DELIVERED','INSTALLING','PUNCH_LIST']

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function geocode(addr) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1&countrycodes=us`,
      { headers: { 'User-Agent': 'Aegis-Geocoder/1.0 (n.barrett@abellumber.com)' } }
    )
    if (!r.ok) return null
    const j = await r.json()
    if (j.length > 0) return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) }
    return null
  } catch { return null }
}

async function main() {
  const statusList = ACTIVE_STATUSES.map(s => `'${s}'`).join(',')
  const jobs = await sql.query(`
    SELECT id, "jobAddress", city, state
    FROM "Job"
    WHERE "jobAddress" IS NOT NULL AND "jobAddress" != ''
      AND (latitude IS NULL OR longitude IS NULL)
      AND status::text IN (${statusList})
    ORDER BY "createdAt" DESC
  `)
  console.log(`📍 Geocoding ${jobs.length} active jobs (Nominatim, 1 req/sec)...`)
  const start = Date.now()
  let ok = 0, fail = 0

  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i]
    let addr = j.jobAddress
    if (j.city && !addr.toLowerCase().includes(j.city.toLowerCase())) addr += `, ${j.city}`
    if (j.state && !addr.toLowerCase().includes(j.state.toLowerCase())) addr += `, ${j.state}`
    if (!/tx|texas/i.test(addr)) addr += ', TX'

    const coords = await geocode(addr)
    if (coords) {
      await sql.query(`UPDATE "Job" SET latitude=$1, longitude=$2 WHERE id=$3`, [coords.lat, coords.lng, j.id])
      ok++
    } else {
      fail++
    }

    if ((i+1) % 25 === 0) {
      const elapsed = ((Date.now()-start)/1000).toFixed(0)
      console.log(`  ${i+1}/${jobs.length} (${ok} ok, ${fail} fail, ${elapsed}s)`)
    }
    await sleep(1050) // 1 req/sec + buffer
  }

  console.log(`\n✅ Done. ${ok} geocoded, ${fail} failed, ${((Date.now()-start)/1000).toFixed(0)}s total.`)
}

main().catch(e => { console.error(e); process.exit(1) })
