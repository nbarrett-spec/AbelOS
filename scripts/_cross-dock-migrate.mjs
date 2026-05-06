// One-off: create cross-dock columns on PurchaseOrderItem + sanity-count current data.
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('[cross-dock] ALTER TABLE PurchaseOrderItem …')

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "PurchaseOrderItem"
    ADD COLUMN IF NOT EXISTS "crossDockFlag" BOOLEAN DEFAULT false
  `)
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "PurchaseOrderItem"
    ADD COLUMN IF NOT EXISTS "crossDockJobIds" TEXT[]
  `)
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "PurchaseOrderItem"
    ADD COLUMN IF NOT EXISTS "crossDockCheckedAt" TIMESTAMPTZ
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_poi_cross_dock_flag"
      ON "PurchaseOrderItem" ("crossDockFlag")
      WHERE "crossDockFlag" = true
  `)
  console.log('[cross-dock] columns + index ready')

  // Shape counts
  const counts = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT COUNT(*)::int FROM "InventoryAllocation" WHERE status = 'BACKORDERED')      AS backordered,
      (SELECT COUNT(*)::int FROM "PurchaseOrder"
        WHERE status IN ('SENT_TO_VENDOR','APPROVED','PARTIALLY_RECEIVED')
          AND "expectedDate" IS NOT NULL
          AND "expectedDate" <= NOW() + INTERVAL '7 days'
          AND "expectedDate" >= NOW() - INTERVAL '7 days')                                AS open_pos_next_7d,
      (SELECT COUNT(*)::int FROM "Job"
        WHERE "scheduledDate" IS NOT NULL
          AND "scheduledDate" <= NOW() + INTERVAL '48 hours'
          AND "scheduledDate" >= NOW() - INTERVAL '24 hours')                             AS urgent_jobs_48h
  `)
  console.log('[cross-dock] baseline:', counts)

  // Preview: how many PO lines would get flagged right now
  const preview = await prisma.$queryRawUnsafe(`
    SELECT COUNT(DISTINCT poi.id)::int AS flaggable_lines
    FROM "PurchaseOrderItem" poi
    JOIN "PurchaseOrder" po ON po.id = poi."purchaseOrderId"
    WHERE po.status IN ('SENT_TO_VENDOR','APPROVED','PARTIALLY_RECEIVED')
      AND po."expectedDate" IS NOT NULL
      AND po."expectedDate" <= NOW() + INTERVAL '7 days'
      AND poi."productId" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "InventoryAllocation" ia
        JOIN "Job" j ON j.id = ia."jobId"
        WHERE ia.status = 'BACKORDERED'
          AND ia."productId" = poi."productId"
          AND j."scheduledDate" IS NOT NULL
          AND j."scheduledDate" <= NOW() + INTERVAL '48 hours'
      )
  `)
  console.log('[cross-dock] preview flaggable lines:', preview)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
