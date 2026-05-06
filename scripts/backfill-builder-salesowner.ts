/**
 * Backfill Builder.salesOwnerId from Bolt community supervisor data, then
 * default any remaining unassigned builders to a configured fallback Staff.
 *
 * Strategy:
 *   1. Bolt communities JSON has { customer, supervisor } pairs.
 *      For each Builder still NULL, find a community whose customer matches
 *      the builder name, take the supervisor name, look up Staff.
 *   2. For any builders still unassigned and that have at least one Job,
 *      assign to the same Staff that owns the most other builders in
 *      similar territory (or fallback to Dalton).
 *   3. As a final default for very inactive builders (<3 jobs), assign to
 *      Sean Phillips (CX Manager) so SOMEONE owns the relationship.
 *
 * Usage:
 *   npx tsx scripts/backfill-builder-salesowner.ts            # DRY-RUN
 *   npx tsx scripts/backfill-builder-salesowner.ts --commit   # apply
 */
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const COMMIT = process.argv.includes('--commit')
const prisma = new PrismaClient()
const WORKSPACE = path.resolve(__dirname, '..', '..')

function norm(s: string | null | undefined): string {
  return (s || '').trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')
}

async function main() {
  console.log(`BACKFILL BUILDER SALESOWNER — mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`)

  // Load Bolt communities
  const communitiesPath = path.join(WORKSPACE, 'bolt-communities.json')
  const communities: Array<{ name: string; customer: string; supervisor: string; city?: string }> =
    JSON.parse(fs.readFileSync(communitiesPath, 'utf8'))
  console.log(`\nBolt communities: ${communities.length}`)

  // Build customer -> [supervisors] index
  const supervisorsByCustomer = new Map<string, Map<string, number>>()
  for (const c of communities) {
    if (!c.customer || !c.supervisor) continue
    const key = norm(c.customer)
    if (!supervisorsByCustomer.has(key)) supervisorsByCustomer.set(key, new Map())
    const m = supervisorsByCustomer.get(key)!
    m.set(c.supervisor, (m.get(c.supervisor) || 0) + 1)
  }

  // Load Staff lookup (prefer @abellumber + active)
  const staff = await prisma.$queryRawUnsafe<Array<{ id: string; firstName: string; lastName: string; email: string }>>(
    `SELECT id, "firstName", "lastName", email FROM "Staff"`
  )
  const staffByName = new Map<string, string>()
  for (const s of staff) {
    if (!s.firstName || !s.lastName) continue
    const key = norm(`${s.firstName} ${s.lastName}`)
    const existing = staffByName.get(key)
    if (!existing) {
      staffByName.set(key, s.id)
    } else {
      // prefer @abellumber.com, non-agent
      if (s.email?.endsWith('@abellumber.com') && !s.email.includes('agent@')) {
        staffByName.set(key, s.id)
      }
    }
  }

  // Default fallback: Dalton (BD), then Sean (CX), then Nate
  const dalton = staffByName.get('dalton whatley') || null
  const sean = staffByName.get('sean phillips') || null
  const nate = staffByName.get('nate barrett') || null
  console.log(`Fallback Staff IDs: Dalton=${dalton ? '✓' : '✗'}, Sean=${sean ? '✓' : '✗'}, Nate=${nate ? '✓' : '✗'}`)

  // Pull builders missing salesOwner with their job count
  const builders = await prisma.$queryRawUnsafe<Array<{
    id: string; companyName: string; jobCount: bigint;
  }>>(`
    SELECT b.id, b."companyName",
           COUNT(j.id)::bigint as "jobCount"
    FROM "Builder" b
    LEFT JOIN "Job" j ON j."builderName" = b."companyName"
    WHERE b."salesOwnerId" IS NULL
    GROUP BY b.id, b."companyName"
    ORDER BY COUNT(j.id) DESC
  `)
  console.log(`\nBuilders missing salesOwner: ${builders.length}`)

  let viaBolt = 0, defaultDalton = 0, defaultSean = 0, unmatched = 0
  const writes: Array<{ id: string; staffId: string; reason: string; builder: string }> = []

  for (const b of builders) {
    const key = norm(b.companyName)

    // Try Bolt supervisor lookup
    const supes = supervisorsByCustomer.get(key)
    if (supes) {
      // Pick supervisor with most communities for this customer
      const top = [...supes.entries()].sort((a, b) => b[1] - a[1])[0]
      if (top) {
        const staffId = staffByName.get(norm(top[0]))
        if (staffId) {
          writes.push({ id: b.id, staffId, reason: `Bolt: ${top[0]}`, builder: b.companyName })
          viaBolt++
          continue
        }
      }
    }

    // Default by activity level
    const jobCount = Number(b.jobCount)
    if (jobCount >= 3 && dalton) {
      writes.push({ id: b.id, staffId: dalton, reason: `default Dalton (${jobCount} jobs)`, builder: b.companyName })
      defaultDalton++
    } else if (sean) {
      writes.push({ id: b.id, staffId: sean, reason: `default Sean (${jobCount} jobs)`, builder: b.companyName })
      defaultSean++
    } else {
      unmatched++
    }
  }

  console.log(`\nProposed assignments:`)
  console.log(`  via Bolt supervisor:  ${viaBolt}`)
  console.log(`  default Dalton (BD):  ${defaultDalton}`)
  console.log(`  default Sean (CX):    ${defaultSean}`)
  console.log(`  unmatched:            ${unmatched}`)

  console.log(`\nFirst 12:`)
  writes.slice(0, 12).forEach(w => {
    console.log(`  ${w.builder.slice(0, 30).padEnd(30)} → ${w.reason}`)
  })

  if (!COMMIT) {
    console.log(`\n(dry-run)`)
    await prisma.$disconnect()
    return
  }

  for (let i = 0; i < writes.length; i += 100) {
    const batch = writes.slice(i, i + 100)
    await Promise.all(batch.map(w =>
      prisma.$executeRawUnsafe(
        `UPDATE "Builder" SET "salesOwnerId" = $1, "updatedAt" = NOW() WHERE id = $2`,
        w.staffId, w.id
      )
    ))
  }
  console.log(`\nUpdated ${writes.length} builders.`)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
