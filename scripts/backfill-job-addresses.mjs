#!/usr/bin/env node
/**
 * One-time backfill: fill jobAddress on the 304 stub Job rows.
 *
 * Mirrors src/app/api/ops/jobs/backfill-addresses/route.ts logic exactly.
 * Source-of-truth waterfall (only fills blanks, never overwrites):
 *   1. Order.deliveryNotes "Address: <line>" (Hyphen-style importer output)
 *   2. Community address (when Job.communityId or Job.community matches)
 *   3. HyphenOrderEvent.rawPayload.header.job (street + city + state + zip)
 *   4. Bolt — already written at import time, counter only (safety net)
 *
 * Defaults to DRY-RUN. Set DRYRUN=0 to apply.
 *
 * Per the diagnostic, the 304 stub jobs came from scripts/backfill-order-jobs.mjs
 * on 2026-04-23 (a 4-min window) and have ZERO of: jobAddress, community,
 * lotBlock, jobType, projectId. They DO have orderId (284/304) and builderName
 * (304/304). The route's source 1 (Order.deliveryNotes "Address:" pattern)
 * is the only realistic source for these specific rows. Sources 2/3 will
 * mostly miss. That's expected.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const DRYRUN = process.env.DRYRUN !== '0'

async function main() {
  console.log(`[backfill-job-addresses] mode: ${DRYRUN ? 'DRY-RUN' : 'APPLY'}`)
  console.log(
    `[backfill-job-addresses] DB: ${process.env.DATABASE_URL?.split('@')[1]?.split('?')[0] || '(unknown)'}`,
  )

  const jobsNeedingAddr = await prisma.$queryRawUnsafe(`
    SELECT j."id", j."jobNumber", j."orderId", j."communityId", j."community",
           j."lotBlock", j."boltJobId", j."hyphenJobId"
    FROM "Job" j
    WHERE j."jobAddress" IS NULL OR j."jobAddress" = ''
    LIMIT 500
  `)

  console.log(`[backfill-job-addresses] candidates: ${jobsNeedingAddr.length}`)

  let enriched = 0
  const sources = { deliveryNotes: 0, community: 0, hyphenEvent: 0, bolt: 0 }
  const noSourceFound = []
  const samples = []

  for (const job of jobsNeedingAddr) {
    let address = null
    let sourceUsed = null

    // Source 1: Order.deliveryNotes "Address: <line>"
    if (!address && job.orderId) {
      const orderRow = await prisma.$queryRawUnsafe(
        `SELECT "deliveryNotes" FROM "Order" WHERE "id" = $1 LIMIT 1`,
        job.orderId,
      )
      if (orderRow.length > 0 && orderRow[0].deliveryNotes) {
        const m = String(orderRow[0].deliveryNotes).match(/Address:\s*(.+)/i)
        if (m && m[1] && m[1].trim().length > 5) {
          address = m[1].trim()
          sourceUsed = 'deliveryNotes'
          sources.deliveryNotes++
        }
      }
    }

    // Source 2: Community address
    if (!address && job.communityId) {
      const comm = await prisma.$queryRawUnsafe(
        `SELECT "address", "city", "state", "zip" FROM "Community" WHERE "id" = $1 LIMIT 1`,
        job.communityId,
      )
      if (comm.length > 0 && comm[0].address) {
        address = [comm[0].address, comm[0].city, comm[0].state, comm[0].zip]
          .filter(Boolean)
          .join(', ')
        if (job.lotBlock) address = `${job.lotBlock}, ${address}`
        sourceUsed = 'community'
        sources.community++
      }
    } else if (!address && job.community) {
      const comm = await prisma.$queryRawUnsafe(
        `SELECT "address", "city", "state", "zip" FROM "Community" WHERE "name" ILIKE $1 LIMIT 1`,
        `%${job.community}%`,
      )
      if (comm.length > 0 && comm[0].address) {
        address = [comm[0].address, comm[0].city, comm[0].state, comm[0].zip]
          .filter(Boolean)
          .join(', ')
        if (job.lotBlock) address = `${job.lotBlock}, ${address}`
        sourceUsed = 'community'
        sources.community++
      }
    }

    // Source 3: Hyphen event raw payload
    if (!address && job.hyphenJobId) {
      const events = await prisma.$queryRawUnsafe(
        `SELECT "rawPayload" FROM "HyphenOrderEvent"
         WHERE "externalId" = $1 AND "status" = 'PROCESSED'
         ORDER BY "processedAt" DESC LIMIT 1`,
        job.hyphenJobId,
      )
      if (events.length > 0 && events[0].rawPayload) {
        const payload =
          typeof events[0].rawPayload === 'string'
            ? JSON.parse(events[0].rawPayload)
            : events[0].rawPayload
        const hJob = payload?.header?.job
        if (hJob) {
          const parts = [hJob.street, hJob.city, hJob.stateCode, hJob.postalCode].filter(Boolean)
          if (parts.length >= 2) {
            address = parts.join(', ')
            sourceUsed = 'hyphenEvent'
            sources.hyphenEvent++
          }
        }
      }
    }

    // Source 4: Bolt — counter only (the route's pattern)
    if (!address && job.boltJobId) {
      sources.bolt++
    }

    if (address && address.length > 5) {
      if (samples.length < 25) {
        samples.push({ jobNumber: job.jobNumber, source: sourceUsed, address })
      }
      enriched++
      if (!DRYRUN) {
        await prisma.$executeRawUnsafe(
          `UPDATE "Job" SET "jobAddress" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
          address,
          job.id,
        )
      }
    } else {
      if (noSourceFound.length < 10) {
        noSourceFound.push({
          jobNumber: job.jobNumber,
          orderId: job.orderId,
          hasCommunityId: !!job.communityId,
          hasHyphenJobId: !!job.hyphenJobId,
          hasBoltJobId: !!job.boltJobId,
        })
      }
    }
  }

  console.log('')
  console.log(`[backfill-job-addresses] would enrich: ${enriched}`)
  console.log(`[backfill-job-addresses]   from deliveryNotes: ${sources.deliveryNotes}`)
  console.log(`[backfill-job-addresses]   from community: ${sources.community}`)
  console.log(`[backfill-job-addresses]   from hyphenEvent: ${sources.hyphenEvent}`)
  console.log(`[backfill-job-addresses]   from bolt (counter only): ${sources.bolt}`)
  console.log(
    `[backfill-job-addresses] no source found: ${jobsNeedingAddr.length - enriched} of ${jobsNeedingAddr.length}`,
  )
  console.log('')

  if (samples.length > 0) {
    console.log('Sample enrichments (first 25):')
    for (const s of samples) {
      console.log(`  ${s.jobNumber}  [${s.source}]  →  ${s.address}`)
    }
    console.log('')
  }

  if (noSourceFound.length > 0) {
    console.log('Sample rows with NO source available (first 10):')
    for (const n of noSourceFound) {
      console.log(`  ${n.jobNumber}  order=${n.orderId ?? '∅'}  comm=${n.hasCommunityId}  hyphen=${n.hasHyphenJobId}  bolt=${n.hasBoltJobId}`)
    }
    console.log('')
  }

  if (DRYRUN) {
    console.log('[backfill-job-addresses] DRY-RUN — no rows updated. Re-run with DRYRUN=0 to apply.')
  } else {
    console.log(`[backfill-job-addresses] APPLIED — ${enriched} rows updated.`)
  }
}

main()
  .catch((err) => {
    console.error('[backfill-job-addresses] failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
