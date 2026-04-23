// ──────────────────────────────────────────────────────────────────────────
// scripts/hyphen-backfill.ts
//
// Manual PO-matching backfill: walk HyphenOrder rows, try to find a Job that
// already exists in our system and stamp Job.hyphenJobId so the UI finally
// links HyphenOrder → Job without waiting for the broken hyphen-sync cron
// (blocked on missing IntegrationConfig row — see CRON_FIX_HYPHEN_SYNC).
//
// Match strategy, in priority order:
//   1. HyphenOrder.builderOrderNum === Job.bwpPoNumber   (strongest — literal PO)
//   2. HyphenOrder.subdivision === Job.community
//      AND first token of HyphenOrder.lotBlockPlan matches Job.lotBlock
//
// Dry-run by default. Pass --apply to actually write.
//
// Usage:
//   npx tsx scripts/hyphen-backfill.ts             # dry-run, prints counts
//   npx tsx scripts/hyphen-backfill.ts --apply     # writes hyphenJobId
// ──────────────────────────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma'

const APPLY = process.argv.includes('--apply')

function normalizeLot(v: string | null | undefined): string | null {
  if (!v) return null
  // "Lot 14 Block 3" → "14-3"; "11BF06 / F" → "11BF06"
  const m = v.match(/Lot\s*(\d+)\s*Block\s*(\d+)/i)
  if (m) return `${m[1]}-${m[2]}`
  const firstTok = v.split(/[\s/]/)[0]
  return firstTok || null
}

async function main() {
  const hyphenOrders: any[] = await (prisma as any).$queryRawUnsafe(
    `SELECT "id", "hyphId", "builderOrderNum", "builderName", "subdivision", "lotBlockPlan"
     FROM "HyphenOrder"
     WHERE "hyphId" IS NOT NULL`
  )

  let matchedByPO = 0
  let matchedByLot = 0
  let ambiguous = 0
  let noMatch = 0
  const writes: Array<{ jobId: string; hyphenJobId: string; strategy: string }> = []
  const seenJobs = new Set<string>()

  for (const ho of hyphenOrders) {
    let jobs: any[] = []
    let strategy = ''

    if (ho.builderOrderNum) {
      jobs = await (prisma as any).$queryRawUnsafe(
        `SELECT "id" FROM "Job" WHERE "bwpPoNumber" = $1 AND "hyphenJobId" IS NULL LIMIT 2`,
        ho.builderOrderNum
      )
      strategy = 'bwpPoNumber'
    }

    if (jobs.length === 0 && ho.subdivision && ho.lotBlockPlan) {
      const lotKey = normalizeLot(ho.lotBlockPlan)
      if (lotKey) {
        jobs = await (prisma as any).$queryRawUnsafe(
          `SELECT "id" FROM "Job"
           WHERE "community" = $1
             AND ("lotBlock" ILIKE '%' || $2 || '%' OR "lotBlock" = $2)
             AND "hyphenJobId" IS NULL LIMIT 2`,
          ho.subdivision, lotKey
        )
        strategy = 'community+lot'
      }
    }

    if (jobs.length === 0) {
      noMatch++
      continue
    }
    if (jobs.length > 1) {
      ambiguous++
      continue
    }
    const jobId = jobs[0].id
    if (seenJobs.has(jobId)) {
      ambiguous++ // one job claimed by multiple orders — skip to be safe
      continue
    }
    seenJobs.add(jobId)
    if (strategy === 'bwpPoNumber') matchedByPO++
    else matchedByLot++
    writes.push({ jobId, hyphenJobId: ho.hyphId, strategy })
  }

  console.log('─ Hyphen → Job backfill ─')
  console.log(`  HyphenOrder rows scanned:   ${hyphenOrders.length}`)
  console.log(`  Matched by bwpPoNumber:     ${matchedByPO}`)
  console.log(`  Matched by community+lot:   ${matchedByLot}`)
  console.log(`  Ambiguous (>1 job hit):     ${ambiguous}`)
  console.log(`  No match:                   ${noMatch}`)
  console.log(`  Writes queued:              ${writes.length}`)
  console.log(`  Mode:                       ${APPLY ? 'APPLY' : 'DRY-RUN'}`)

  if (APPLY && writes.length > 0) {
    let applied = 0
    for (const w of writes) {
      await (prisma as any).$executeRawUnsafe(
        `UPDATE "Job" SET "hyphenJobId" = $1, "updatedAt" = NOW() WHERE "id" = $2 AND "hyphenJobId" IS NULL`,
        w.hyphenJobId, w.jobId
      )
      applied++
    }
    console.log(`  Applied updates:            ${applied}`)
  }
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
