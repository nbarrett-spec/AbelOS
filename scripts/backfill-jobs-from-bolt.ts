/**
 * Backfill Job.jobAddress, .community, etc. from Bolt JSON exports.
 * Match strategy: Job.boltJobId === bolt.boltId (string).
 *
 * Usage:
 *   npx tsx scripts/backfill-jobs-from-bolt.ts            # DRY-RUN
 *   npx tsx scripts/backfill-jobs-from-bolt.ts --commit   # apply
 */
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const COMMIT = process.argv.includes('--commit')
const prisma = new PrismaClient()

// __dirname will be the scripts folder; go one up to project root, then up to workspace
const WORKSPACE = path.resolve(__dirname, '..', '..')

async function loadAllBoltJobs(): Promise<Map<string, any>> {
  const map = new Map<string, any>()
  for (let i = 0; i <= 9; i++) {
    const f = path.join(WORKSPACE, `bolt-jobs-${i}.json`)
    if (!fs.existsSync(f)) continue
    const arr = JSON.parse(fs.readFileSync(f, 'utf8'))
    const records = Array.isArray(arr) ? arr : Object.values(arr)
    for (const r of records) {
      if (r.boltId) map.set(String(r.boltId), r)
    }
  }
  return map
}

async function main() {
  console.log(`BACKFILL JOBS FROM BOLT — mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`)

  const boltJobs = await loadAllBoltJobs()
  console.log(`\nLoaded ${boltJobs.size} Bolt job records`)

  const aegisJobs = await prisma.$queryRawUnsafe<Array<{
    id: string
    jobNumber: string
    boltJobId: string
    jobAddress: string | null
    community: string | null
  }>>(`
    SELECT id, "jobNumber", "boltJobId", "jobAddress", community
    FROM "Job"
    WHERE "boltJobId" IS NOT NULL
  `)
  console.log(`Aegis jobs with boltJobId: ${aegisJobs.length}`)

  let updated = 0
  let skipped = 0
  let unmatched = 0
  const writes: Array<Promise<any>> = []

  for (const j of aegisJobs) {
    const b = boltJobs.get(String(j.boltJobId))
    if (!b) { unmatched++; continue }

    // Build SET clause only for fields that are NULL in Aegis but present in Bolt
    const updates: Record<string, string> = {}
    if (!j.jobAddress && b.address) updates.jobAddress = b.address
    if (!j.community && b.community) updates.community = b.community

    // Bolt city is "Decatur, TX" — split off the state suffix
    const city = b.city ? b.city.split(',')[0].trim() : null
    // We don't have a city column on Job per current schema (jobAddressRaw maybe), skip city update

    if (b.zip && !j.jobAddress?.match(/\d{5}/)) {
      // append zip to address if not already there
      if (updates.jobAddress) updates.jobAddress += `, ${b.zip}`
    }

    if (Object.keys(updates).length === 0) { skipped++; continue }

    if (COMMIT) {
      const setParts: string[] = []
      const params: any[] = []
      let idx = 1
      for (const [k, v] of Object.entries(updates)) {
        setParts.push(`"${k}" = $${idx++}`)
        params.push(v)
      }
      params.push(j.id)
      writes.push(prisma.$executeRawUnsafe(
        `UPDATE "Job" SET ${setParts.join(', ')}, "updatedAt" = NOW() WHERE id = $${idx}`,
        ...params
      ))
    }
    updated++
    if (updated <= 10) {
      console.log(`  ${j.jobNumber}: ${Object.keys(updates).join(', ')}`)
    }
  }

  if (COMMIT && writes.length) {
    console.log(`\n  Applying ${writes.length} updates...`)
    await Promise.all(writes)
  }

  console.log(`\n══ RESULT ══`)
  console.log(`  matched & updated: ${updated}`)
  console.log(`  matched, no fillable nulls: ${skipped}`)
  console.log(`  unmatched (boltJobId not in JSON): ${unmatched}`)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
