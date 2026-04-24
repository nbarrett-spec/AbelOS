#!/usr/bin/env node
/**
 * seed-gold-stock-kits.mjs
 * ------------------------
 * Identify recurring (builder, plan) combinations with enough historical
 * Job volume to justify pre-kitting their door/jamb/trim materials, and
 * seed GoldStockKit + GoldStockKitComponent rows.
 *
 * How we detect a "kit candidate":
 *   - Joins Job → Order → Builder and counts jobs per builder over last 12mo.
 *   - Cross-references CommunityFloorPlan rows in communities owned by those
 *     builders (live data has spotty Job.communityId; CFPs themselves are the
 *     canonical plan catalog).
 *   - A builder with > 8 jobs in 12 months whose builderId matches a CFP-owner
 *     community is considered recurring.
 *
 * How we synthesize the BoM:
 *   - For each (builder, plan) candidate, we pull the most recent Order for
 *     that builder and copy its OrderItem set as the kit's component list.
 *     This reflects what actually shipped for that builder's door-package
 *     style; kits can be tuned in the UI later.
 *   - Fallback: if the builder has no Orders, skip the kit and log it.
 *
 * Defaults:
 *   reorderQty = ceil(historical_demand / 4)   — 3 months of buffer
 *   minQty     = 1
 *   status     = ACTIVE
 *
 * Flags:
 *   --dry-run   (default) — compute, print, do not write
 *   --commit    — insert GoldStockKit + GoldStockKitComponent rows
 *
 * Idempotent: kit rows use `kitCode = GSK-{builderSlug}-{planNumber||planSlug}`;
 * re-running updates qty targets instead of duplicating.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const args = new Set(process.argv.slice(2))
const COMMIT = args.has('--commit')
const LOOKBACK_DAYS = 365
const MIN_JOBS = 8

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'na'
}

async function main() {
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  // Builders with > MIN_JOBS jobs in the lookback window.
  // We go via Order because Job.communityId is ~unpopulated in live data.
  const builderVolume = await prisma.$queryRawUnsafe(`
    SELECT
      b."id" AS "builderId",
      b."companyName",
      COUNT(DISTINCT j."id") AS "jobCount12mo"
    FROM "Job" j
    JOIN "Order" o ON o."id" = j."orderId"
    JOIN "Builder" b ON b."id" = o."builderId"
    WHERE j."createdAt" >= $1
    GROUP BY b."id", b."companyName"
    HAVING COUNT(DISTINCT j."id") > $2
    ORDER BY COUNT(DISTINCT j."id") DESC
  `, cutoff, MIN_JOBS)

  console.log(`Builders with > ${MIN_JOBS} jobs in last ${LOOKBACK_DAYS}d: ${builderVolume.length}`)

  const candidates = []

  for (const b of builderVolume) {
    // Pull every plan owned by a community whose builderId matches this one.
    const plans = await prisma.$queryRawUnsafe(`
      SELECT cfp."id" AS "planId", cfp."name" AS "planName",
             cfp."planNumber", cfp."interiorDoorCount", cfp."exteriorDoorCount",
             c."name" AS "communityName", cfp."active"
      FROM "CommunityFloorPlan" cfp
      JOIN "Community" c ON c."id" = cfp."communityId"
      WHERE c."builderId" = $1 AND cfp."active" = true
      ORDER BY cfp."name"
    `, b.builderId)

    if (plans.length === 0) continue

    // Pull the most recent Order's items for this builder — used as the
    // synthesized BoM for every plan under that builder (can be split per
    // plan later via the UI).
    const orderItems = await prisma.$queryRawUnsafe(`
      SELECT oi."productId", oi."quantity"
      FROM "OrderItem" oi
      JOIN "Order" o ON o."id" = oi."orderId"
      WHERE o."builderId" = $1
      ORDER BY o."createdAt" DESC
      LIMIT 200
    `, b.builderId)

    if (orderItems.length === 0) {
      console.log(`  skip ${b.companyName}: no OrderItems available`)
      continue
    }

    // Aggregate duplicates across the sample window (use max to represent
    // a "typical job" BoM rather than summed across multiple orders).
    const bomMap = new Map()
    for (const it of orderItems) {
      const prev = bomMap.get(it.productId) || 0
      // Use max qty seen per product as the per-kit qty — closer to a single
      // job's consumption than a 200-item sum would be.
      if (Number(it.quantity) > prev) bomMap.set(it.productId, Number(it.quantity))
    }
    const bom = Array.from(bomMap.entries()).map(([productId, quantity]) => ({
      productId,
      quantity,
    }))

    // Per-plan split of historical demand: divide builder's total job count
    // evenly across their active plans (rough but defensible without real
    // plan-level linkage in production data).
    const perPlanJobs = Math.max(1, Math.floor(Number(b.jobCount12mo) / plans.length))

    for (const p of plans) {
      const builderSlug = slug(b.companyName)
      const planSlug = p.planNumber || slug(p.planName)
      const kitCode = `GSK-${builderSlug}-${planSlug}`.toUpperCase().slice(0, 60)
      const kitName = `${b.companyName} — ${p.planName}`
      const reorderQty = Math.max(1, Math.ceil(perPlanJobs / 4))
      const minQty = 1

      candidates.push({
        builderId: b.builderId,
        builderName: b.companyName,
        planId: p.planId,
        planName: p.planName,
        planNumber: p.planNumber,
        kitCode,
        kitName,
        reorderQty,
        minQty,
        perPlanJobs,
        bom,
      })
    }
  }

  console.log(`\nCandidate kits: ${candidates.length}`)
  const sample = candidates.slice(0, 10)
  for (const c of sample) {
    console.log(`  • ${c.kitCode}  reorderQty=${c.reorderQty}  components=${c.bom.length}  est-annual=${c.perPlanJobs}`)
  }

  if (!COMMIT) {
    console.log('\n[dry-run] no writes. pass --commit to insert.')
    await prisma.$disconnect()
    return
  }

  // Insert / upsert
  let inserted = 0
  let updated = 0
  let components = 0

  for (const c of candidates) {
    // Upsert kit
    const existing = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "GoldStockKit" WHERE "kitCode" = $1 LIMIT 1`,
      c.kitCode
    )
    let kitId
    if (existing.length > 0) {
      kitId = existing[0].id
      await prisma.$executeRawUnsafe(
        `UPDATE "GoldStockKit"
           SET "reorderQty" = $1,
               "minQty" = $2,
               "kitName" = $3,
               "builderId" = $4,
               "planId" = $5
           WHERE "id" = $6`,
        c.reorderQty, c.minQty, c.kitName, c.builderId, c.planId, kitId
      )
      updated++
      // Refresh components — easiest: wipe & re-insert
      await prisma.$executeRawUnsafe(
        `DELETE FROM "GoldStockKitComponent" WHERE "kitId" = $1`,
        kitId
      )
    } else {
      kitId = `gsk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      await prisma.$executeRawUnsafe(
        `INSERT INTO "GoldStockKit"
          ("id", "kitCode", "builderId", "planId", "kitName", "reorderQty", "minQty",
           "currentQty", "status", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'ACTIVE', NOW())`,
        kitId, c.kitCode, c.builderId, c.planId, c.kitName, c.reorderQty, c.minQty
      )
      inserted++
    }

    for (const comp of c.bom) {
      const compId = `gskc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      await prisma.$executeRawUnsafe(
        `INSERT INTO "GoldStockKitComponent" ("id", "kitId", "productId", "quantity")
         VALUES ($1, $2, $3, $4)`,
        compId, kitId, comp.productId, comp.quantity
      )
      components++
    }
  }

  console.log(`\n[commit] kits inserted=${inserted} updated=${updated} components=${components}`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
