/**
 * Phase 3 of mass data refresh:
 * For products with NULL supplierId, infer the supplier from the most recent
 * PurchaseOrderItem -> PurchaseOrder.vendorId.
 *
 * Usage:
 *   npx tsx scripts/infer-supplier-from-po.ts            # DRY-RUN
 *   npx tsx scripts/infer-supplier-from-po.ts --commit   # apply
 */

import { PrismaClient } from '@prisma/client'

const COMMIT = process.argv.includes('--commit')
const prisma = new PrismaClient()

async function main() {
  console.log(`INFER SUPPLIER FROM PO HISTORY — mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`)

  // Before counts
  const [before] = await prisma.$queryRaw<Array<{ c: bigint }>>`
    SELECT COUNT(*)::bigint c FROM "Product" WHERE "supplierId" IS NULL
  `
  console.log(`\nProducts with NULL supplierId BEFORE: ${Number(before.c)}`)

  // Identify candidates: products with NULL supplierId that have at least one PO line
  // tied to a vendor. Use most-recent PO.
  const candidates = await prisma.$queryRaw<Array<{
    productId: string
    productName: string
    vendorId: string
    vendorName: string | null
    poDate: Date
  }>>`
    SELECT DISTINCT ON (prod.id)
      prod.id           as "productId",
      prod.name         as "productName",
      po."vendorId"     as "vendorId",
      v.name            as "vendorName",
      po."createdAt"    as "poDate"
    FROM "Product" prod
    INNER JOIN "PurchaseOrderItem" poi ON poi."productId" = prod.id
    INNER JOIN "PurchaseOrder" po      ON po.id = poi."purchaseOrderId"
    LEFT JOIN  "Vendor" v              ON v.id = po."vendorId"
    WHERE prod."supplierId" IS NULL
      AND po."vendorId" IS NOT NULL
    ORDER BY prod.id, po."createdAt" DESC
  `

  console.log(`\nInferable products: ${candidates.length}`)
  candidates.slice(0, 20).forEach(c => {
    console.log(`  ${c.productName.slice(0, 50).padEnd(50)} -> ${c.vendorName ?? c.vendorId}`)
  })
  if (candidates.length > 20) console.log(`  ... and ${candidates.length - 20} more`)

  if (!COMMIT) {
    console.log(`\n(dry-run — no writes)`)
    await prisma.$disconnect()
    return
  }

  // Apply in a single SQL UPDATE using a correlated subquery
  const updated = await prisma.$executeRawUnsafe(`
    UPDATE "Product" prod
    SET "supplierId" = sub.vendor_id,
        "updatedAt"  = NOW()
    FROM (
      SELECT DISTINCT ON (poi."productId")
        poi."productId"   as product_id,
        po."vendorId"     as vendor_id
      FROM "PurchaseOrderItem" poi
      INNER JOIN "PurchaseOrder" po ON po.id = poi."purchaseOrderId"
      WHERE po."vendorId" IS NOT NULL
      ORDER BY poi."productId", po."createdAt" DESC
    ) sub
    WHERE prod.id = sub.product_id
      AND prod."supplierId" IS NULL
  `)

  console.log(`\nRows updated: ${updated}`)

  const [after] = await prisma.$queryRaw<Array<{ c: bigint }>>`
    SELECT COUNT(*)::bigint c FROM "Product" WHERE "supplierId" IS NULL
  `
  console.log(`Products with NULL supplierId AFTER:  ${Number(after.c)}`)
  console.log(`Delta: -${Number(before.c) - Number(after.c)}`)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
