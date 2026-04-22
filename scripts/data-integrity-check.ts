/**
 * data-integrity-check.ts — Comprehensive data integrity audit.
 *
 * Checks:
 *   1. Orphan FK references (child points to non-existent parent)
 *   2. Required fields that are null/empty where they shouldn't be
 *   3. Duplicate unique constraints (emails, SKUs)
 *   4. Business logic violations (zero-price products, negative balances, etc.)
 *   5. Seed data completeness (expected counts)
 *
 * Run: npx tsx scripts/data-integrity-check.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface Finding {
  severity: 'CRITICAL' | 'WARN' | 'INFO'
  category: string
  check: string
  detail: string
  count?: number
}

const findings: Finding[] = []

function log(f: Finding) {
  findings.push(f)
  const icon = f.severity === 'CRITICAL' ? '🔴' : f.severity === 'WARN' ? '🟡' : '🟢'
  console.log(`${icon} [${f.category}] ${f.check}: ${f.detail}${f.count !== undefined ? ` (${f.count})` : ''}`)
}

async function run() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  ABEL OS — Data Integrity Audit')
  console.log('  ' + new Date().toISOString())
  console.log('═══════════════════════════════════════════════════════════\n')

  // ── 1. TABLE COUNTS ────────────────────────────────────────────────
  console.log('── Table Counts ──────────────────────────────────────────\n')

  const counts: Record<string, number> = {}
  const tables = [
    ['Builder', prisma.builder.count()],
    ['Community', prisma.community.count()],
    ['BuilderContact', prisma.builderContact.count()],
    ['Product', prisma.product.count()],
    ['BomEntry', prisma.bomEntry.count()],
    ['BuilderPricing', prisma.builderPricing.count()],
    ['Project', prisma.project.count()],
    ['Quote', prisma.quote.count()],
    ['QuoteItem', prisma.quoteItem.count()],
    ['Order', prisma.order.count()],
    ['OrderItem', prisma.orderItem.count()],
    ['Staff', prisma.staff.count()],
    ['Job', prisma.job.count()],
    ['Invoice', prisma.invoice.count()],
    ['Payment', prisma.payment.count()],
    ['PurchaseOrder', prisma.purchaseOrder.count()],
    ['PurchaseOrderItem', prisma.purchaseOrderItem.count()],
    ['Vendor', prisma.vendor.count()],
    ['VendorProduct', prisma.vendorProduct.count()],
    ['InventoryItem', prisma.inventoryItem.count()],
    ['Delivery', prisma.delivery.count()],
    ['Deal', prisma.deal.count()],
    ['Task', prisma.task.count()],
    ['Notification', prisma.notification.count()],
    ['Conversation', prisma.conversation.count()],
    ['Message', prisma.message.count()],
    ['CronRun', prisma.cronRun.count()],
    ['WebhookEvent', prisma.webhookEvent.count()],
    ['FinancialSnapshot', prisma.financialSnapshot.count()],
    ['AIInvocation', prisma.aIInvocation.count()],
    ['CollectionRule', prisma.collectionRule.count()],
    ['CollectionAction', prisma.collectionAction.count()],
    ['DataQualityRule', prisma.dataQualityRule.count()],
    ['DataQualityIssue', prisma.dataQualityIssue.count()],
    ['OutreachSequence', prisma.outreachSequence.count()],
  ] as const

  for (const [name, promise] of tables) {
    try {
      const c = await (promise as Promise<number>)
      counts[name as string] = c
      console.log(`  ${String(name).padEnd(24)} ${String(c).padStart(8)}`)
    } catch (e: any) {
      console.log(`  ${String(name).padEnd(24)}   ERROR: ${e.message}`)
    }
  }

  // ── 2. SEED DATA EXPECTED COUNTS ──────────────────────────────────
  console.log('\n── Seed Data Verification ────────────────────────────────\n')

  if ((counts.Product || 0) < 2800) {
    log({ severity: 'CRITICAL', category: 'SEED', check: 'Product count', detail: `Expected ~2,852, got ${counts.Product}`, count: counts.Product })
  } else {
    log({ severity: 'INFO', category: 'SEED', check: 'Product count', detail: `${counts.Product} products loaded`, count: counts.Product })
  }

  if ((counts.BomEntry || 0) < 7000) {
    log({ severity: 'CRITICAL', category: 'SEED', check: 'BOM count', detail: `Expected ~7,416, got ${counts.BomEntry}`, count: counts.BomEntry })
  } else {
    log({ severity: 'INFO', category: 'SEED', check: 'BOM count', detail: `${counts.BomEntry} BOM entries loaded`, count: counts.BomEntry })
  }

  if ((counts.Builder || 0) < 90) {
    log({ severity: 'WARN', category: 'SEED', check: 'Builder count', detail: `Expected ~95, got ${counts.Builder}`, count: counts.Builder })
  } else {
    log({ severity: 'INFO', category: 'SEED', check: 'Builder count', detail: `${counts.Builder} builders loaded`, count: counts.Builder })
  }

  if ((counts.BuilderPricing || 0) < 900) {
    log({ severity: 'WARN', category: 'SEED', check: 'Pricing count', detail: `Expected ~945, got ${counts.BuilderPricing}`, count: counts.BuilderPricing })
  } else {
    log({ severity: 'INFO', category: 'SEED', check: 'Pricing count', detail: `${counts.BuilderPricing} pricing entries loaded`, count: counts.BuilderPricing })
  }

  if ((counts.Staff || 0) === 0) {
    log({ severity: 'CRITICAL', category: 'SEED', check: 'Staff count', detail: 'No staff records — nobody can log in', count: 0 })
  } else {
    log({ severity: 'INFO', category: 'SEED', check: 'Staff count', detail: `${counts.Staff} staff records`, count: counts.Staff })
  }

  // ── 3. ORPHAN FK CHECKS ───────────────────────────────────────────
  console.log('\n── Orphan FK Checks ──────────────────────────────────────\n')

  // Orders with no builder
  const orphanOrders = await prisma.$queryRaw<{count: bigint}[]>`
    SELECT COUNT(*) as count FROM "Order" o
    WHERE NOT EXISTS (SELECT 1 FROM "Builder" b WHERE b.id = o."builderId")
  `
  const ooc = Number(orphanOrders[0]?.count || 0)
  if (ooc > 0) log({ severity: 'CRITICAL', category: 'FK', check: 'Orders → Builder', detail: `${ooc} orders reference non-existent builders`, count: ooc })

  // OrderItems with no order
  const orphanOI = await prisma.$queryRaw<{count: bigint}[]>`
    SELECT COUNT(*) as count FROM "OrderItem" oi
    WHERE NOT EXISTS (SELECT 1 FROM "Order" o WHERE o.id = oi."orderId")
  `
  const oic = Number(orphanOI[0]?.count || 0)
  if (oic > 0) log({ severity: 'CRITICAL', category: 'FK', check: 'OrderItems → Order', detail: `${oic} order items reference non-existent orders`, count: oic })

  // OrderItems with no product
  const orphanOIProd = await prisma.$queryRaw<{count: bigint}[]>`
    SELECT COUNT(*) as count FROM "OrderItem" oi
    WHERE oi."productId" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "Product" p WHERE p.id = oi."productId")
  `
  const oipc = Number(orphanOIProd[0]?.count || 0)
  if (oipc > 0) log({ severity: 'CRITICAL', category: 'FK', check: 'OrderItems → Product', detail: `${oipc} order items reference non-existent products`, count: oipc })

  // QuoteItems with no quote
  const orphanQI = await prisma.$queryRaw<{count: bigint}[]>`
    SELECT COUNT(*) as count FROM "QuoteItem" qi
    WHERE NOT EXISTS (SELECT 1 FROM "Quote" q WHERE q.id = qi."quoteId")
  `
  const qic = Number(orphanQI[0]?.count || 0)
  if (qic > 0) log({ severity: 'CRITICAL', category: 'FK', check: 'QuoteItems → Quote', detail: `${qic} quote items reference non-existent quotes`, count: qic })

  // BomEntry with no parent product
  const orphanBomParent = await prisma.$queryRaw<{count: bigint}[]>`
    SELECT COUNT(*) as count FROM "BomEntry" be
    WHERE NOT EXISTS (SELECT 1 FROM "Product" p WHERE p.id = be."parentId")
  `
  const bpc = Number(orphanBomParent[0]?.count || 0)
  if (bpc > 0) log({ severity: 'CRITICAL', category: 'FK', check: 'BomEntry → Parent Product', detail: `${bpc} BOM entries reference non-existent parent products`, count: bpc })

  // BomEntry with no component product
  const orphanBomComp = await prisma.$queryRaw<{count: bigint}[]>`
    SELECT COUNT(*) as count FROM "BomEntry" be
    WHERE NOT EXISTS (SELECT 1 FROM "Product" p WHERE p.id = be."componentId")
  `
  const bcc = Number(orphanBomComp[0]?.count || 0)
  if (bcc > 0) log({ severity: 'CRITICAL', category: 'FK', check: 'BomEntry → Component Product', detail: `${bcc} BOM entries reference non-existent component products`, count: bcc })

  // BuilderPricing with no builder
  const orphanBP = await prisma.$queryRaw<{count: bigint}[]>`
    SELECT COUNT(*) as count FROM "BuilderPricing" bp
    WHERE NOT EXISTS (SELECT 1 FROM "Builder" b WHERE b.id = bp."builderId")
  `
  const bpoc = Number(orphanBP[0]?.count || 0)
  if (bpoc > 0) log({ severity: 'CRITICAL', category: 'FK', check: 'BuilderPricing → Builder', detail: `${bpoc} pricing entries reference non-existent builders`, count: bpoc })

  // BuilderPricing with no product
  const orphanBPProd = await prisma.$queryRaw<{count: bigint}[]>`
    SELECT COUNT(*) as count FROM "BuilderPricing" bp
    WHERE NOT EXISTS (SELECT 1 FROM "Product" p WHERE p.id = bp."productId")
  `
  const bppoc = Number(orphanBPProd[0]?.count || 0)
  if (bppoc > 0) log({ severity: 'CRITICAL', category: 'FK', check: 'BuilderPricing → Product', detail: `${bppoc} pricing entries reference non-existent products`, count: bppoc })

  // Communities with no builder
  const orphanComm = await prisma.$queryRaw<{count: bigint}[]>`
    SELECT COUNT(*) as count FROM "Community" c
    WHERE NOT EXISTS (SELECT 1 FROM "Builder" b WHERE b.id = c."builderId")
  `
  const coc = Number(orphanComm[0]?.count || 0)
  if (coc > 0) log({ severity: 'CRITICAL', category: 'FK', check: 'Community → Builder', detail: `${coc} communities reference non-existent builders`, count: coc })

  // Jobs with no order
  const orphanJobs = await prisma.$queryRaw<{count: bigint}[]>`
    SELECT COUNT(*) as count FROM "Job" j
    WHERE j."orderId" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o.id = j."orderId")
  `
  const joc = Number(orphanJobs[0]?.count || 0)
  if (joc > 0) log({ severity: 'WARN', category: 'FK', check: 'Job → Order', detail: `${joc} jobs reference non-existent orders`, count: joc })

  // PurchaseOrderItems with no PO
  const orphanPOI = await prisma.$queryRaw<{count: bigint}[]>`
    SELECT COUNT(*) as count FROM "PurchaseOrderItem" poi
    WHERE NOT EXISTS (SELECT 1 FROM "PurchaseOrder" po WHERE po.id = poi."purchaseOrderId")
  `
  const poic = Number(orphanPOI[0]?.count || 0)
  if (poic > 0) log({ severity: 'CRITICAL', category: 'FK', check: 'POItems → PO', detail: `${poic} PO items reference non-existent purchase orders`, count: poic })

  // InvoiceItems with no invoice
  const orphanII = await prisma.$queryRaw<{count: bigint}[]>`
    SELECT COUNT(*) as count FROM "InvoiceItem" ii
    WHERE NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i.id = ii."invoiceId")
  `
  const iic = Number(orphanII[0]?.count || 0)
  if (iic > 0) log({ severity: 'CRITICAL', category: 'FK', check: 'InvoiceItems → Invoice', detail: `${iic} invoice items reference non-existent invoices`, count: iic })

  // CollectionActions with no rule
  const orphanCA = await prisma.$queryRaw<{count: bigint}[]>`
    SELECT COUNT(*) as count FROM "CollectionAction" ca
    WHERE NOT EXISTS (SELECT 1 FROM "CollectionRule" cr WHERE cr.id = ca."ruleId")
  `
  const cac = Number(orphanCA[0]?.count || 0)
  if (cac > 0) log({ severity: 'WARN', category: 'FK', check: 'CollectionAction → Rule', detail: `${cac} collection actions reference non-existent rules`, count: cac })

  if (ooc + oic + oipc + qic + bpc + bcc + bpoc + bppoc + coc + joc + poic + iic + cac === 0) {
    log({ severity: 'INFO', category: 'FK', check: 'All FK checks', detail: 'No orphan references found across 13 checks' })
  }

  // ── 4. DUPLICATE CHECKS ──────────────────────────────────────────
  console.log('\n── Duplicate Checks ──────────────────────────────────────\n')

  // Duplicate builder emails
  const dupBuilderEmails = await prisma.$queryRaw<{email: string, cnt: bigint}[]>`
    SELECT email, COUNT(*) as cnt FROM "Builder"
    GROUP BY email HAVING COUNT(*) > 1
  `
  if (dupBuilderEmails.length > 0) {
    log({ severity: 'CRITICAL', category: 'DUP', check: 'Builder emails', detail: `${dupBuilderEmails.length} duplicate emails: ${dupBuilderEmails.map(d => d.email).join(', ')}`, count: dupBuilderEmails.length })
  } else {
    log({ severity: 'INFO', category: 'DUP', check: 'Builder emails', detail: 'No duplicates' })
  }

  // Duplicate staff emails
  const dupStaffEmails = await prisma.$queryRaw<{email: string, cnt: bigint}[]>`
    SELECT email, COUNT(*) as cnt FROM "Staff"
    GROUP BY email HAVING COUNT(*) > 1
  `
  if (dupStaffEmails.length > 0) {
    log({ severity: 'CRITICAL', category: 'DUP', check: 'Staff emails', detail: `${dupStaffEmails.length} duplicate emails: ${dupStaffEmails.map(d => d.email).join(', ')}`, count: dupStaffEmails.length })
  } else {
    log({ severity: 'INFO', category: 'DUP', check: 'Staff emails', detail: 'No duplicates' })
  }

  // Duplicate product SKUs
  const dupSKUs = await prisma.$queryRaw<{sku: string, cnt: bigint}[]>`
    SELECT sku, COUNT(*) as cnt FROM "Product"
    WHERE sku IS NOT NULL AND sku != ''
    GROUP BY sku HAVING COUNT(*) > 1
  `
  if (dupSKUs.length > 0) {
    log({ severity: 'WARN', category: 'DUP', check: 'Product SKUs', detail: `${dupSKUs.length} duplicate SKUs`, count: dupSKUs.length })
  } else {
    log({ severity: 'INFO', category: 'DUP', check: 'Product SKUs', detail: 'No duplicates' })
  }

  // ── 5. BUSINESS LOGIC CHECKS ────────────────────────────────────
  console.log('\n── Business Logic Checks ─────────────────────────────────\n')

  // Products with zero or null price
  const zeroPriceProducts = await prisma.product.count({
    where: { OR: [{ basePrice: 0 }, { basePrice: null }] }
  })
  if (zeroPriceProducts > 50) {
    log({ severity: 'WARN', category: 'BIZ', check: 'Zero-price products', detail: `${zeroPriceProducts} products have $0 or null base price`, count: zeroPriceProducts })
  } else {
    log({ severity: 'INFO', category: 'BIZ', check: 'Zero-price products', detail: `${zeroPriceProducts} products with $0/null price`, count: zeroPriceProducts })
  }

  // Products with no name
  const noNameProducts = await prisma.product.count({
    where: { OR: [{ name: '' }, { name: null as any }] }
  })
  if (noNameProducts > 0) {
    log({ severity: 'CRITICAL', category: 'BIZ', check: 'Nameless products', detail: `${noNameProducts} products have empty/null names`, count: noNameProducts })
  }

  // Products with no category
  const noCatProducts = await prisma.product.count({
    where: { OR: [{ category: '' }, { category: null }] }
  })
  if (noCatProducts > 100) {
    log({ severity: 'WARN', category: 'BIZ', check: 'Uncategorized products', detail: `${noCatProducts} products missing category`, count: noCatProducts })
  } else {
    log({ severity: 'INFO', category: 'BIZ', check: 'Uncategorized products', detail: `${noCatProducts} products missing category`, count: noCatProducts })
  }

  // Builders with negative balance
  const negBalBuilders = await prisma.builder.count({
    where: { accountBalance: { lt: 0 } }
  })
  if (negBalBuilders > 0) {
    log({ severity: 'WARN', category: 'BIZ', check: 'Negative builder balances', detail: `${negBalBuilders} builders have negative account balance`, count: negBalBuilders })
  }

  // Builders with status ACTIVE but no password hash
  const activeNoPass = await prisma.builder.count({
    where: { status: 'ACTIVE', passwordHash: '' }
  })
  if (activeNoPass > 0) {
    log({ severity: 'WARN', category: 'BIZ', check: 'Active builders no password', detail: `${activeNoPass} active builders have empty password hash`, count: activeNoPass })
  }

  // Orders with null/zero total
  const zeroOrders = await prisma.order.count({
    where: { OR: [{ total: 0 }, { total: null }] }
  })
  if (zeroOrders > 10) {
    log({ severity: 'WARN', category: 'BIZ', check: 'Zero-total orders', detail: `${zeroOrders} orders have $0 or null total`, count: zeroOrders })
  } else {
    log({ severity: 'INFO', category: 'BIZ', check: 'Zero-total orders', detail: `${zeroOrders} orders with $0/null total`, count: zeroOrders })
  }

  // BOM circular reference check (parent = component)
  const circularBom = await prisma.$queryRaw<{count: bigint}[]>`
    SELECT COUNT(*) as count FROM "BomEntry"
    WHERE "parentId" = "componentId"
  `
  const cboc = Number(circularBom[0]?.count || 0)
  if (cboc > 0) {
    log({ severity: 'CRITICAL', category: 'BIZ', check: 'Circular BOM', detail: `${cboc} BOM entries where parent = component`, count: cboc })
  } else {
    log({ severity: 'INFO', category: 'BIZ', check: 'Circular BOM', detail: 'No circular references' })
  }

  // BuilderPricing with negative or zero price
  const badPricing = await prisma.builderPricing.count({
    where: { price: { lte: 0 } }
  })
  if (badPricing > 0) {
    log({ severity: 'WARN', category: 'BIZ', check: 'Non-positive pricing', detail: `${badPricing} builder pricing entries with price <= 0`, count: badPricing })
  }

  // ── 6. INDEX / CONSTRAINT HEALTH ────────────────────────────────
  console.log('\n── Index Health ──────────────────────────────────────────\n')

  const indexes = await prisma.$queryRaw<{tablename: string, indexname: string}[]>`
    SELECT tablename, indexname FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `
  log({ severity: 'INFO', category: 'IDX', check: 'Total indexes', detail: `${indexes.length} indexes across all tables`, count: indexes.length })

  // Check for tables with no indexes besides PK
  const tableIndexCounts = new Map<string, number>()
  for (const idx of indexes) {
    tableIndexCounts.set(idx.tablename, (tableIndexCounts.get(idx.tablename) || 0) + 1)
  }
  const underIndexed = [...tableIndexCounts.entries()].filter(([, c]) => c <= 1)
  if (underIndexed.length > 0) {
    log({ severity: 'INFO', category: 'IDX', check: 'Under-indexed tables', detail: `${underIndexed.length} tables with only PK index: ${underIndexed.map(([t]) => t).join(', ')}`, count: underIndexed.length })
  }

  // ── 7. MIGRATION STATUS ─────────────────────────────────────────
  console.log('\n── Migration Status ──────────────────────────────────────\n')

  const migrations = await prisma.$queryRaw<{migration_name: string, finished_at: Date | null}[]>`
    SELECT migration_name, finished_at FROM "_prisma_migrations"
    ORDER BY started_at DESC LIMIT 10
  `
  const pendingMigrations = migrations.filter(m => !m.finished_at)
  if (pendingMigrations.length > 0) {
    log({ severity: 'CRITICAL', category: 'MIGRATE', check: 'Pending migrations', detail: `${pendingMigrations.length} migrations not finished: ${pendingMigrations.map(m => m.migration_name).join(', ')}`, count: pendingMigrations.length })
  } else {
    log({ severity: 'INFO', category: 'MIGRATE', check: 'Migration status', detail: `Last 10 migrations all completed. Latest: ${migrations[0]?.migration_name || 'none'}` })
  }

  // ── SUMMARY ─────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('  SUMMARY')
  console.log('═══════════════════════════════════════════════════════════\n')

  const critical = findings.filter(f => f.severity === 'CRITICAL').length
  const warn = findings.filter(f => f.severity === 'WARN').length
  const info = findings.filter(f => f.severity === 'INFO').length

  console.log(`  🔴 CRITICAL:  ${critical}`)
  console.log(`  🟡 WARN:      ${warn}`)
  console.log(`  🟢 INFO:      ${info}`)
  console.log(`  TOTAL CHECKS: ${findings.length}`)

  if (critical > 0) {
    console.log('\n  ⚠️  CRITICAL ISSUES FOUND — review before go-live:\n')
    findings.filter(f => f.severity === 'CRITICAL').forEach(f => {
      console.log(`    → [${f.category}] ${f.check}: ${f.detail}`)
    })
  }

  if (warn > 0) {
    console.log('\n  ⚡ WARNINGS:\n')
    findings.filter(f => f.severity === 'WARN').forEach(f => {
      console.log(`    → [${f.category}] ${f.check}: ${f.detail}`)
    })
  }

  console.log('')
}

run()
  .catch(e => {
    console.error('Fatal error:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
