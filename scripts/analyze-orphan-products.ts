/**
 * Diagnose remaining 1,950 products with NULL supplierId.
 * Are they actually in use? Or dead/test data we should flag inactive?
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const [total]   = await prisma.$queryRaw<Array<{c:bigint}>>`SELECT COUNT(*)::bigint c FROM "Product" WHERE "supplierId" IS NULL`
  const [withPO]  = await prisma.$queryRaw<Array<{c:bigint}>>`
    SELECT COUNT(DISTINCT prod.id)::bigint c
    FROM "Product" prod
    INNER JOIN "PurchaseOrderItem" poi ON poi."productId" = prod.id
    WHERE prod."supplierId" IS NULL
  `
  const [withQuote] = await prisma.$queryRaw<Array<{c:bigint}>>`
    SELECT COUNT(DISTINCT prod.id)::bigint c
    FROM "Product" prod
    INNER JOIN "QuoteItem" qi ON qi."productId" = prod.id
    WHERE prod."supplierId" IS NULL
  `
  const [withInv] = await prisma.$queryRaw<Array<{c:bigint}>>`
    SELECT COUNT(DISTINCT prod.id)::bigint c
    FROM "Product" prod
    INNER JOIN "InvoiceItem" il ON il."productId" = prod.id
    WHERE prod."supplierId" IS NULL
  `
  const [withOrder] = await prisma.$queryRaw<Array<{c:bigint}>>`
    SELECT COUNT(DISTINCT prod.id)::bigint c
    FROM "Product" prod
    INNER JOIN "OrderItem" oi ON oi."productId" = prod.id
    WHERE prod."supplierId" IS NULL
  `
  const [withInventory] = await prisma.$queryRaw<Array<{c:bigint}>>`
    SELECT COUNT(DISTINCT prod.id)::bigint c
    FROM "Product" prod
    WHERE prod."supplierId" IS NULL AND prod."inStock" = true
  `
  const [active] = await prisma.$queryRaw<Array<{c:bigint}>>`
    SELECT COUNT(*)::bigint c FROM "Product" WHERE "supplierId" IS NULL AND "active" = true
  `

  console.log(`\n══ ORPHAN PRODUCT ANALYSIS ══`)
  console.log(`  total NULL supplierId:           ${Number(total.c)}`)
  console.log(`    of those isActive=true:        ${Number(active.c)}`)
  console.log(`    have PO history:               ${Number(withPO.c)}`)
  console.log(`    have Quote history:            ${Number(withQuote.c)}`)
  console.log(`    have Invoice history:          ${Number(withInv.c)}`)
  console.log(`    have Order history:            ${Number(withOrder.c)}`)
  console.log(`    have inventory or reorder pt:  ${Number(withInventory.c)}`)

  // The truly dead ones: no PO, no quote, no invoice, no inventory
  const [dead] = await prisma.$queryRaw<Array<{c:bigint}>>`
    SELECT COUNT(*)::bigint c
    FROM "Product" prod
    WHERE prod."supplierId" IS NULL
      AND prod."active" = true
      AND NOT EXISTS (SELECT 1 FROM "PurchaseOrderItem" poi WHERE poi."productId" = prod.id)
      AND NOT EXISTS (SELECT 1 FROM "QuoteItem"         qi  WHERE qi."productId"  = prod.id)
      AND NOT EXISTS (SELECT 1 FROM "InvoiceItem"       il  WHERE il."productId"  = prod.id)
      AND NOT EXISTS (SELECT 1 FROM "OrderItem"         oi  WHERE oi."productId"  = prod.id)
      AND prod."inStock" = false
  `
  console.log(`\n  TRULY DEAD (no PO, quote, invoice, stock — flag inactive):`)
  console.log(`    ${Number(dead.c)}`)

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
