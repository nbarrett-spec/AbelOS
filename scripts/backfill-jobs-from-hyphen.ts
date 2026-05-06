/**
 * Backfill Job.jobAddress, .community, .lotBlock from HyphenOrder records.
 *
 * Join chain: Job.orderId → Order.orderNumber → HyphenOrder.refOrderId
 * (alternate: Order.poNumber → HyphenOrder.builderOrderNum or supplierOrderNum)
 *
 * Also wires Job.hyphenJobId = HyphenOrder.hyphId for future syncs.
 *
 * Usage:
 *   npx tsx scripts/backfill-jobs-from-hyphen.ts            # DRY-RUN
 *   npx tsx scripts/backfill-jobs-from-hyphen.ts --commit   # apply
 */
import { PrismaClient } from '@prisma/client'
const COMMIT = process.argv.includes('--commit')
const prisma = new PrismaClient()

async function main() {
  console.log(`BACKFILL JOBS FROM HYPHEN — mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`)

  // Pull all Jobs missing address that have an Order link → match HyphenOrder
  const candidates = await prisma.$queryRawUnsafe<Array<{
    jobId: string
    jobNumber: string
    builderName: string
    currentAddress: string | null
    currentCommunity: string | null
    hyphAddress: string
    hyphSubdivision: string | null
    hyphLotBlockPlan: string | null
    hyphId: string
  }>>(`
    SELECT
      j.id            as "jobId",
      j."jobNumber"   as "jobNumber",
      j."builderName" as "builderName",
      j."jobAddress"  as "currentAddress",
      j.community     as "currentCommunity",
      ho.address      as "hyphAddress",
      ho.subdivision  as "hyphSubdivision",
      ho."lotBlockPlan" as "hyphLotBlockPlan",
      ho."hyphId"     as "hyphId"
    FROM "Job" j
    INNER JOIN "Order" o ON o.id = j."orderId"
    INNER JOIN "HyphenOrder" ho ON
         ho."refOrderId" = o."orderNumber"
      OR ho."builderOrderNum" = o."poNumber"
      OR ho."supplierOrderNum" = o."orderNumber"
    WHERE (j."jobAddress" IS NULL OR j."jobAddress" = '' OR j.community IS NULL OR j.community = '')
      AND ho.address IS NOT NULL AND ho.address != ''
  `)

  console.log(`\nCandidate joins: ${candidates.length}`)

  // Dedup: one HyphenOrder per Job (multiple HyphenOrder rows can share refOrderId)
  const byJob = new Map<string, typeof candidates[0]>()
  for (const c of candidates) {
    if (!byJob.has(c.jobId)) byJob.set(c.jobId, c)
  }
  console.log(`Unique jobs to update: ${byJob.size}`)

  let updates = 0
  const sample: string[] = []

  for (const [, c] of byJob) {
    const set: Record<string, string> = {}
    if (!c.currentAddress && c.hyphAddress) set.jobAddress = c.hyphAddress
    if (!c.currentCommunity && c.hyphSubdivision) set.community = c.hyphSubdivision
    if (c.hyphLotBlockPlan) set.lotBlock = c.hyphLotBlockPlan
    set.hyphenJobId = c.hyphId   // always wire the linkage

    if (Object.keys(set).length === 0) continue
    updates++
    if (sample.length < 12) {
      sample.push(`  ${c.jobNumber.padEnd(15)} ${c.builderName.slice(0,18).padEnd(18)} → ${c.hyphAddress?.slice(0,40)}`)
    }

    if (COMMIT) {
      const setParts: string[] = []
      const params: any[] = []
      let idx = 1
      for (const [k, v] of Object.entries(set)) {
        setParts.push(`"${k}" = $${idx++}`)
        params.push(v)
      }
      params.push(c.jobId)
      await prisma.$executeRawUnsafe(
        `UPDATE "Job" SET ${setParts.join(', ')}, "updatedAt" = NOW() WHERE id = $${idx}`,
        ...params
      )
    }
  }

  console.log(`\nSample updates:`)
  sample.forEach(s => console.log(s))
  console.log(`\n══ RESULT ══`)
  console.log(`  jobs updated: ${updates}`)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
