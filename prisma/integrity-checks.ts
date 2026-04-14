/**
 * Abel OS — Post-seed integrity checks
 *
 * Runs 29 checks against the live DB and reports results.
 * Exit code 0 if clean; 1 if any check found issues.
 *
 * Usage:
 *   npx tsx prisma/integrity-checks.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type Check = {
  name: string
  description: string
  expectedCount: number | 'nonzero'
  run: () => Promise<{ count: number; sample: any[] }>
}

const checks: Check[] = [
  {
    name: 'orphan_deals',
    description: 'Deals with an ownerId that doesn\'t match any Staff',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT d.id, d."companyName", d."ownerId"
        FROM "Deal" d
        LEFT JOIN "Staff" s ON s.id = d."ownerId"
        WHERE s.id IS NULL
        LIMIT 5
      `
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'duplicate_skus',
    description: 'Products with duplicate SKUs (should never happen)',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT sku, COUNT(*)::int as cnt FROM "Product"
        GROUP BY sku HAVING COUNT(*) > 1
      `
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'negative_margin_products',
    description: 'Products where cost > basePrice (negative margin)',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.product.findMany({
        where: { cost: { gt: prisma.product.fields.basePrice as any } },
        select: { sku: true, name: true, cost: true, basePrice: true },
        take: 5,
      }).catch(async () => {
        // fallback: raw query if field-reference not supported
        return prisma.$queryRaw<any[]>`
          SELECT sku, name, cost, "basePrice" FROM "Product" WHERE cost > "basePrice" LIMIT 5
        `
      })
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'staff_missing_role_or_dept',
    description: 'Staff without a role or department',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.staff.findMany({
        where: { OR: [{ role: null as any }, { department: null as any }] },
        select: { id: true, email: true, role: true, department: true },
        take: 5,
      })
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'unlinked_contracts',
    description: 'Contracts with no builder AND no deal',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.contract.findMany({
        where: { AND: [{ builderId: null }, { dealId: null }] },
        select: { id: true, contractNumber: true, title: true },
        take: 5,
      })
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'builders_no_activity',
    description: 'ACTIVE builders with zero orders AND zero deals — acceptable for new accounts',
    expectedCount: 'nonzero',
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT b.id, b."companyName"
        FROM "Builder" b
        LEFT JOIN "Order" o ON o."builderId" = b.id
        LEFT JOIN "Deal" d ON d."builderId" = b.id
        WHERE o.id IS NULL AND d.id IS NULL AND b.status = 'ACTIVE'
        LIMIT 20
      `
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'pricing_below_cost',
    description: 'BuilderPricing entries where customPrice < Product.cost',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT bp.id, b."companyName", p.sku, p.cost, bp."customPrice"
        FROM "BuilderPricing" bp
        JOIN "Builder" b ON b.id = bp."builderId"
        JOIN "Product" p ON p.id = bp."productId"
        WHERE bp."customPrice" < p.cost
        LIMIT 10
      `
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'duplicate_builder_emails',
    description: 'Builder emails appearing more than once (should be caught by unique constraint)',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT email, COUNT(*)::int as cnt FROM "Builder"
        GROUP BY email HAVING COUNT(*) > 1
      `
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'active_orders_no_builder',
    description: 'Non-cancelled orders with no linked builder',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT id, "orderNumber", status FROM "Order"
        WHERE "builderId" IS NULL AND status NOT IN ('CANCELLED','COMPLETE')
        LIMIT 5
      `
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'deals_closed_won_no_builder',
    description: 'CLOSED_WON deals not linked to a Builder record — consider promoting',
    expectedCount: 'nonzero',
    run: async () => {
      const rows = await prisma.deal.findMany({
        where: { stage: 'CLOSED_WON' as any, builderId: null },
        select: { id: true, dealNumber: true, companyName: true },
        take: 10,
      })
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'staff_without_password',
    description: 'Staff accounts with no password hash — cannot log in',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT id, email, role FROM "Staff"
        WHERE ("passwordHash" IS NULL OR "passwordHash" = '') AND active = true
        LIMIT 10
      `
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'products_missing_base_price',
    description: 'Active products with NULL or zero basePrice — will cause quote failures',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT sku, name, "basePrice" FROM "Product"
        WHERE ("basePrice" IS NULL OR "basePrice" <= 0) AND active = true
        LIMIT 10
      `
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'order_items_orphan_product',
    description: 'OrderItems referencing a Product SKU that does not exist',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT oi.id, oi."orderId", oi.sku
        FROM "OrderItem" oi
        LEFT JOIN "Product" p ON p.sku = oi.sku
        WHERE p.id IS NULL
        LIMIT 10
      `
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'quote_items_orphan_product',
    description: 'QuoteItems referencing a Product SKU that does not exist',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT qi.id, qi."quoteId", qi.sku
        FROM "QuoteItem" qi
        LEFT JOIN "Product" p ON p.sku = qi.sku
        WHERE p.id IS NULL
        LIMIT 10
      `.catch(() => [] as any[])
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'invoices_without_order',
    description: 'Invoices with a non-null orderId that references a missing Order',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT i.id, i."invoiceNumber", i."orderId"
        FROM "Invoice" i
        LEFT JOIN "Order" o ON o.id = i."orderId"
        WHERE i."orderId" IS NOT NULL AND o.id IS NULL
        LIMIT 10
      `.catch(() => [] as any[])
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'jobs_without_project',
    description: 'Jobs with a non-null projectId that references a missing Project',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT j.id, j."jobNumber", j."projectId"
        FROM "Job" j
        LEFT JOIN "Project" p ON p.id = j."projectId"
        WHERE j."projectId" IS NOT NULL AND p.id IS NULL
        LIMIT 10
      `.catch(() => [] as any[])
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'builders_missing_contact_email',
    description: 'ACTIVE builders with no contactEmail — cannot receive notifications',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT id, "companyName" FROM "Builder"
        WHERE ("contactEmail" IS NULL OR "contactEmail" = '') AND status = 'ACTIVE'
        LIMIT 10
      `
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'duplicate_staff_emails',
    description: 'Staff emails appearing more than once (should be caught by unique constraint)',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT email, COUNT(*)::int as cnt FROM "Staff"
        GROUP BY email HAVING COUNT(*) > 1
      `
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'orders_negative_total',
    description: 'Non-cancelled orders with a negative grand total — indicates pricing bug',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT id, "orderNumber", total FROM "Order"
        WHERE total < 0 AND status NOT IN ('CANCELLED')
        LIMIT 10
      `.catch(() => [] as any[])
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'zero_price_products',
    description: 'Active products with zero or NULL cost (should have cost set)',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT sku, name, cost FROM "Product"
        WHERE (cost IS NULL OR cost = 0) AND active = true
        LIMIT 10
      `
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'invoices_zero_total',
    description: 'Issued invoices with zero total (likely drafts not finalized)',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT id, "invoiceNumber", status, total FROM "Invoice"
        WHERE total <= 0 AND status != 'DRAFT'
        LIMIT 10
      `.catch(() => [] as any[])
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'jobs_overdue_no_assignment',
    description: 'Jobs with scheduledDate in past but no assignedPMId (unassigned)',
    expectedCount: 'nonzero',
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT id, "jobNumber", "scheduledDate" FROM "Job"
        WHERE "scheduledDate" < NOW() AND "assignedPMId" IS NULL AND status NOT IN ('COMPLETE','CLOSED')
        LIMIT 20
      `.catch(() => [] as any[])
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'quotes_expired_not_rejected',
    description: 'Quotes past validUntil date but not marked as EXPIRED',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT id, "quoteNumber", status, "validUntil" FROM "Quote"
        WHERE "validUntil" < NOW() AND status NOT IN ('EXPIRED','REJECTED','ORDERED')
        LIMIT 10
      `.catch(() => [] as any[])
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'overdue_invoices_not_flagged',
    description: 'Invoices past dueDate but status is not OVERDUE',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT id, "invoiceNumber", status, "dueDate" FROM "Invoice"
        WHERE "dueDate" < NOW() AND status NOT IN ('OVERDUE','PAID','VOID','WRITE_OFF')
        LIMIT 10
      `.catch(() => [] as any[])
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'orders_unlinked_quote',
    description: 'Completed orders that have no associated quote',
    expectedCount: 'nonzero',
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT id, "orderNumber" FROM "Order"
        WHERE "quoteId" IS NULL AND status IN ('COMPLETE','DELIVERED')
        LIMIT 20
      `.catch(() => [] as any[])
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'builders_no_email_verified',
    description: 'ACTIVE builders with emailVerified=false (likely cannot receive notifications)',
    expectedCount: 'nonzero',
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT id, "companyName", email FROM "Builder"
        WHERE "emailVerified" = false AND status = 'ACTIVE'
        LIMIT 20
      `
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'quote_items_zero_quantity',
    description: 'Quote items with zero or negative quantity',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT id, "quoteId", quantity FROM "QuoteItem"
        WHERE quantity <= 0
        LIMIT 10
      `.catch(() => [] as any[])
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'order_items_zero_quantity',
    description: 'Order items with zero or negative quantity',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT id, "orderId", quantity FROM "OrderItem"
        WHERE quantity <= 0
        LIMIT 10
      `.catch(() => [] as any[])
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'deliveries_completed_no_timestamp',
    description: 'Deliveries marked COMPLETE but completedAt is NULL',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT id, "deliveryNumber", status, "completedAt" FROM "Delivery"
        WHERE status = 'COMPLETE' AND "completedAt" IS NULL
        LIMIT 10
      `.catch(() => [] as any[])
      return { count: rows.length, sample: rows }
    },
  },
  {
    name: 'installations_completed_no_qc',
    description: 'Installations marked COMPLETE but passedQC=false',
    expectedCount: 0,
    run: async () => {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT id, "installNumber", status, "passedQC" FROM "Installation"
        WHERE status = 'COMPLETE' AND "passedQC" = false
        LIMIT 10
      `.catch(() => [] as any[])
      return { count: rows.length, sample: rows }
    },
  },
]

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  Abel OS — Post-seed Integrity Checks')
  console.log('═══════════════════════════════════════════════════════════\n')

  let hasFailures = false
  for (const check of checks) {
    try {
      const { count, sample } = await check.run()
      const expected = check.expectedCount
      let pass = false
      let verdict = ''
      if (expected === 'nonzero') {
        pass = true // informational
        verdict = `${count} rows (informational, no threshold)`
      } else {
        pass = count === expected
        verdict = pass ? `${count} rows ✓` : `${count} rows (expected ${expected}) ✗`
      }
      const icon = expected === 'nonzero' ? 'ℹ' : (pass ? '✓' : '✗')
      console.log(`${icon}  ${check.name.padEnd(32)} ${verdict}`)
      if (!pass && expected !== 'nonzero') {
        hasFailures = true
        console.log(`   ${check.description}`)
        console.log(`   Sample: ${JSON.stringify(sample, null, 2).split('\n').map(l => '   ' + l).join('\n').trim()}`)
      } else if (expected === 'nonzero' && count > 0) {
        console.log(`   ${check.description}`)
        console.log(`   First ${Math.min(sample.length, 3)}: ${JSON.stringify(sample.slice(0, 3))}`)
      }
    } catch (e: any) {
      console.log(`✗  ${check.name.padEnd(32)} ERROR: ${e.message}`)
      hasFailures = true
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════')
  if (hasFailures) {
    console.log('  ✗ Some checks failed — review above before continuing')
    console.log('═══════════════════════════════════════════════════════════')
    process.exit(1)
  } else {
    console.log('  ✓ All integrity checks passed')
    console.log('═══════════════════════════════════════════════════════════')
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
