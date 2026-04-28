#!/usr/bin/env node
/**
 * Read-only probe for P3.4 — lists Orders stuck in RECEIVED status by age
 * bucket and builder. Use this output to decide which to cancel manually,
 * NOT to bulk-cancel automatically.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/_probe-stale-orders.mjs
 *
 * Why no --apply flag: bulk-cancelling 246 orders is destructive. Some of
 * these may be legit orders waiting on PM action. Review the by-builder
 * counts first, then decide per-builder whether to cancel.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const buckets = await prisma.$queryRawUnsafe(`
    SELECT
      CASE
        WHEN "createdAt" < NOW() - INTERVAL '365 days' THEN 'over_1y'
        WHEN "createdAt" < NOW() - INTERVAL '180 days' THEN '180-365d'
        WHEN "createdAt" < NOW() - INTERVAL '90 days'  THEN '90-180d'
        WHEN "createdAt" < NOW() - INTERVAL '30 days'  THEN '30-90d'
        ELSE 'under_30d'
      END AS bucket,
      COUNT(*)::int AS count,
      SUM("total")::float AS total_value
    FROM "Order"
    WHERE "status"::text = 'RECEIVED'
    GROUP BY bucket
    ORDER BY
      CASE bucket
        WHEN 'over_1y' THEN 1
        WHEN '180-365d' THEN 2
        WHEN '90-180d' THEN 3
        WHEN '30-90d' THEN 4
        ELSE 5
      END
  `)

  console.log('\n== RECEIVED orders by age bucket ==\n')
  for (const b of buckets) {
    console.log(`  ${b.bucket.padEnd(12)} ${String(b.count).padStart(4)} orders   $${(b.total_value || 0).toLocaleString()}`)
  }

  const byBuilder = await prisma.$queryRawUnsafe(`
    SELECT
      b."companyName" AS builder,
      COUNT(*)::int AS count,
      MIN(o."createdAt") AS oldest,
      MAX(o."createdAt") AS newest,
      SUM(o."total")::float AS total_value
    FROM "Order" o
    LEFT JOIN "Builder" b ON b."id" = o."builderId"
    WHERE o."status"::text = 'RECEIVED'
      AND o."createdAt" < NOW() - INTERVAL '90 days'
    GROUP BY b."companyName"
    ORDER BY count DESC
    LIMIT 20
  `)

  console.log('\n\n== Top 20 builders with 90+ day stale RECEIVED orders ==\n')
  for (const r of byBuilder) {
    const oldest = r.oldest ? new Date(r.oldest).toISOString().slice(0, 10) : '?'
    const newest = r.newest ? new Date(r.newest).toISOString().slice(0, 10) : '?'
    console.log(
      `  ${(r.builder || '(unknown)').padEnd(35)} ${String(r.count).padStart(4)} orders` +
      `   $${(r.total_value || 0).toLocaleString().padStart(10)}` +
      `   ${oldest} → ${newest}`,
    )
  }

  console.log('\n\nNext steps:')
  console.log('  1. Pick a cutoff (e.g. 180 days for orders to definitely cancel)')
  console.log('  2. Spot-check a few in /ops/orders to confirm they\'re truly dead')
  console.log('  3. Run a targeted UPDATE — keep the original status in audit log details:')
  console.log('     UPDATE "Order" SET "status" = \'CANCELLED\'::\"OrderStatus\", "updatedAt" = NOW()')
  console.log('     WHERE "status"::text = \'RECEIVED\' AND "createdAt" < NOW() - INTERVAL \'180 days\';')
  console.log('  4. Pulte orders specifically should be reviewed against the zombie-cleanup doc.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
