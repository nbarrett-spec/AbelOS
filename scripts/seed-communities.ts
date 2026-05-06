/**
 * Seed Community table from bolt-communities.json and backfill Job.communityId.
 *
 * Phase A: Upsert Community records from bolt-communities.json (127 records).
 *          Resolves builderId by fuzzy-matching customer name → Builder.companyName.
 * Phase B: Backfill Job.communityId by matching Job.community text (case-insensitive trim)
 *          to Community.name. For OYL entries, matches on (name=OYL + city + builder).
 *
 * Usage:
 *   npx tsx scripts/seed-communities.ts            # DRY-RUN (reports what would change)
 *   npx tsx scripts/seed-communities.ts --commit   # apply changes to DB
 *
 * Safe to re-run — idempotent (upsert by boltId, skip Jobs already linked).
 */

import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const COMMIT = process.argv.includes('--commit')
const prisma = new PrismaClient()

interface BoltCommunity {
  boltId: string
  name: string
  city: string
  customer: string
  supervisor: string
  active: string
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Strip state suffix for city matching: "Frisco, TX" → "frisco"
function normalizeCity(city: string): string {
  return normalize(city.split(',')[0])
}

async function main() {
  console.log(`SEED COMMUNITIES — mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}\n`)

  // ─── Load bolt-communities.json ───────────────────────────────────────────
  const jsonPath = path.resolve(__dirname, '../../bolt-communities.json')
  if (!fs.existsSync(jsonPath)) {
    // Try workspace root
    const alt = path.resolve(__dirname, '../../../bolt-communities.json')
    if (!fs.existsSync(alt)) {
      console.error('ERROR: bolt-communities.json not found at', jsonPath, 'or', alt)
      process.exit(1)
    }
  }
  const raw: BoltCommunity[] = JSON.parse(
    fs.readFileSync(
      fs.existsSync(jsonPath) ? jsonPath : path.resolve(__dirname, '../../../bolt-communities.json'),
      'utf-8'
    )
  )
  console.log(`Loaded ${raw.length} bolt community records`)

  // ─── Phase A: Resolve builders + upsert Communities ────────────────────────
  const builders = await prisma.builder.findMany({ select: { id: true, companyName: true } })
  const builderMap = new Map<string, string>() // normalized name → id
  builders.forEach(b => {
    if (b.companyName) builderMap.set(normalize(b.companyName), b.id)
  })
  console.log(`Loaded ${builders.length} builders for name matching\n`)

  // Known aliases: bolt customer name → actual Builder.companyName
  const ALIASES: Record<string, string> = {
    'brookfield homes': 'brookfield residential',
    'brookfield': 'brookfield residential',
    'mill creek': 'mill creek residential',
    'pulte': 'pultegroup',
    'del webb': 'pultegroup',
    'centex': 'pultegroup',
    'abel z customer': '', // skip — internal placeholder
    'z - custom customer': '', // skip — internal placeholder
  }

  function resolveBuilder(customer: string): string | null {
    const norm = normalize(customer)
    // Direct match
    if (builderMap.has(norm)) return builderMap.get(norm)!
    // Alias match
    const alias = ALIASES[norm]
    if (alias === '') return null // explicitly skip
    if (alias && builderMap.has(alias)) return builderMap.get(alias)!
    // Fuzzy: check if any builder name contains this customer or vice versa
    for (const [bName, bId] of builderMap) {
      if (bName.includes(norm) || norm.includes(bName)) return bId
    }
    return null
  }

  let upserted = 0
  let skippedNoBuilder = 0
  let alreadyExisted = 0
  const communityIdMap = new Map<string, string>() // boltId → community.id

  for (const rec of raw) {
    const builderId = resolveBuilder(rec.customer)
    if (!builderId) {
      skippedNoBuilder++
      if (rec.name !== 'OYL') {
        console.log(`  SKIP (no builder match): "${rec.name}" — customer="${rec.customer}"`)
      }
      continue
    }

    const cityClean = rec.city.replace(/,?\s*(TX|Texas|OK|Oklahoma)$/i, '').trim()
    const stateMatch = rec.city.match(/(TX|Texas|OK|Oklahoma)\s*$/i)
    const state = stateMatch ? (stateMatch[1].match(/TX|Texas/i) ? 'TX' : 'OK') : null

    if (COMMIT) {
      // Upsert by boltId — store boltId in the `code` field for idempotency
      const existing = await prisma.community.findFirst({
        where: { code: rec.boltId }
      })

      if (existing) {
        communityIdMap.set(rec.boltId, existing.id)
        alreadyExisted++
        continue
      }

      const created = await prisma.community.create({
        data: {
          builderId,
          name: rec.name,
          code: rec.boltId,
          city: cityClean || null,
          state: state,
          status: rec.active === 'Yes' ? 'ACTIVE' : 'INACTIVE',
        }
      })
      communityIdMap.set(rec.boltId, created.id)
      upserted++
    } else {
      upserted++
    }
  }

  console.log(`\nPhase A results:`)
  console.log(`  Upserted: ${upserted}`)
  console.log(`  Already existed: ${alreadyExisted}`)
  console.log(`  Skipped (no builder): ${skippedNoBuilder}`)

  // ─── Phase B: Backfill Job.communityId ─────────────────────────────────────
  console.log(`\n--- Phase B: Backfill Job.communityId ---\n`)

  // Reload communities from DB (need IDs)
  const communities = await prisma.community.findMany({
    select: { id: true, name: true, city: true, builderId: true, code: true }
  })
  console.log(`${communities.length} communities in DB`)

  // Build lookup indexes
  // For named communities: normalized name → community[]
  const namedIndex = new Map<string, typeof communities>()
  // For OYL: normalized(city) + builderId → community
  const oylIndex = new Map<string, typeof communities[0]>()

  for (const c of communities) {
    const normName = normalize(c.name)
    if (normName === 'oyl') {
      const key = `oyl|${normalizeCity(c.city || '')}|${c.builderId}`
      oylIndex.set(key, c)
    } else {
      if (!namedIndex.has(normName)) namedIndex.set(normName, [])
      namedIndex.get(normName)!.push(c)
    }
  }

  // Find jobs with community text but no communityId
  const jobs = await prisma.job.findMany({
    where: {
      communityId: null,
      community: { not: null }
    },
    select: { id: true, community: true, builderName: true, jobAddress: true }
  })
  console.log(`Jobs with community text but no communityId: ${jobs.length}`)

  // Also get builder name → id for OYL matching
  const builderNameToId = new Map<string, string>()
  builders.forEach(b => {
    if (b.companyName) builderNameToId.set(normalize(b.companyName), b.id)
  })

  let linked = 0
  let noMatch = 0

  for (const job of jobs) {
    const jobComm = normalize(job.community!)

    let matchedCommunityId: string | null = null

    if (jobComm === 'oyl') {
      // OYL matching: need city from jobAddress + builder
      // Extract city from jobAddress (format varies: "123 Main St, Frisco, TX 75034" or just "Frisco")
      // For now, try builder match only — OYL + same builder is often enough
      // This is a weaker match, so we skip OYL backfill for now unless we have city
      noMatch++
      continue
    } else {
      // Named community: direct match
      const matches = namedIndex.get(jobComm)
      if (matches && matches.length === 1) {
        matchedCommunityId = matches[0].id
      } else if (matches && matches.length > 1) {
        // Multiple — try to disambiguate by builder
        const jobBuilder = normalize(job.builderName || '')
        const byBuilder = matches.filter(m => {
          const bld = builders.find(b => b.id === m.builderId)
          return bld && normalize(bld.companyName || '') === jobBuilder
        })
        matchedCommunityId = byBuilder.length === 1 ? byBuilder[0].id : matches[0].id
      } else {
        // Fuzzy: check if job community contains or is contained by any named community
        for (const [normName, cArr] of namedIndex) {
          if (jobComm.includes(normName) || normName.includes(jobComm)) {
            matchedCommunityId = cArr[0].id
            break
          }
        }
      }
    }

    if (matchedCommunityId) {
      if (COMMIT) {
        await prisma.job.update({
          where: { id: job.id },
          data: { communityId: matchedCommunityId }
        })
      }
      linked++
    } else {
      noMatch++
    }
  }

  console.log(`\nPhase B results:`)
  console.log(`  Jobs linked: ${linked}`)
  console.log(`  No match found: ${noMatch}`)
  console.log(`  (OYL jobs skipped — need city extraction logic for accurate match)`)

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`SUMMARY — ${COMMIT ? 'COMMITTED' : 'DRY-RUN (no changes made)'}`)
  console.log(`  Communities upserted: ${upserted}`)
  console.log(`  Jobs linked to communityId: ${linked}`)
  console.log(`  Jobs still unlinked: ${noMatch}`)
  if (!COMMIT) {
    console.log(`\n  → Run with --commit to apply changes`)
  }

  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  prisma.$disconnect()
  process.exit(1)
})
