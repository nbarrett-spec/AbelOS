/**
 * scripts/seed-dq-rules-v2.ts
 *
 * Expands the DataQualityRule set beyond the 9 baseline rules seeded by the
 * data-quality cron. Adds 21 new rules across 6 categories:
 *
 *   1. Referential integrity  (orphan FKs, missing parents)
 *   2. Required-field backfill (vendors, products, builders missing key fields)
 *   3. Sane bounds             (negative / zero amounts, impossible values)
 *   4. Staleness               (stuck orders, stale jobs, un-synced sync queues)
 *   5. Business rules          (invoice math, pricing below cost, credit over limit)
 *   6. Duplicate detection     (case-insensitive SKU / company collisions)
 *
 * Idempotent — rules are keyed by a deterministic id prefix `dqr_v2_<slug>`
 * and use `INSERT ... ON CONFLICT DO NOTHING`. Re-running does not duplicate.
 *
 * Usage:
 *   npx tsx scripts/seed-dq-rules-v2.ts             # DRY-RUN (default)
 *   npx tsx scripts/seed-dq-rules-v2.ts --commit    # write to DB
 *
 * Safe: writes to DataQualityRule + a single InboxItem. Does not touch the
 * existing 9 rules, does not write DataQualityIssue (cron handles that).
 */

import { PrismaClient } from '@prisma/client'

const DRY_RUN = !process.argv.includes('--commit')
const SOURCE_TAG = 'DQ_RULES_V2'
const ID_PREFIX = 'dqr_v2_'

// Each rule's id is deterministic: `dqr_v2_<slug>` — re-runs are idempotent.
type Rule = {
  slug: string
  name: string
  description: string
  entity: string
  severity: 'CRITICAL' | 'WARNING' | 'INFO'
  category: string
  query: string
  fixUrl?: string
}

const NEW_RULES: Rule[] = [
  // ─── 1. Referential integrity ────────────────────────────────────────
  {
    slug: 'order_items_orphan_product',
    name: 'OrderItem pointing at missing Product',
    description: 'OrderItem rows whose productId does not exist in Product',
    entity: 'OrderItem',
    severity: 'CRITICAL',
    category: 'referential',
    query: `SELECT oi.id, oi.description AS name FROM "OrderItem" oi LEFT JOIN "Product" p ON p.id = oi."productId" WHERE p.id IS NULL`,
  },
  {
    slug: 'invoice_items_orphan_invoice',
    name: 'InvoiceItem orphaned from Invoice',
    description: 'InvoiceItem rows whose invoiceId has no matching Invoice',
    entity: 'InvoiceItem',
    severity: 'CRITICAL',
    category: 'referential',
    query: `SELECT ii.id, ii.description AS name FROM "InvoiceItem" ii LEFT JOIN "Invoice" i ON i.id = ii."invoiceId" WHERE i.id IS NULL`,
  },
  {
    slug: 'po_items_orphan_po',
    name: 'PurchaseOrderItem orphaned from PurchaseOrder',
    description: 'POItem rows whose purchaseOrderId has no matching PurchaseOrder',
    entity: 'PurchaseOrderItem',
    severity: 'CRITICAL',
    category: 'referential',
    query: `SELECT poi.id, poi.description AS name FROM "PurchaseOrderItem" poi LEFT JOIN "PurchaseOrder" po ON po.id = poi."purchaseOrderId" WHERE po.id IS NULL`,
  },
  {
    slug: 'job_orphan_order',
    name: 'Job referencing missing Order',
    description: 'Jobs with an orderId that does not resolve to an Order row',
    entity: 'Job',
    severity: 'WARNING',
    category: 'referential',
    query: `SELECT j.id, j."jobNumber" AS name FROM "Job" j LEFT JOIN "Order" o ON o.id = j."orderId" WHERE j."orderId" IS NOT NULL AND o.id IS NULL`,
    fixUrl: '/ops/jobs/{id}',
  },
  {
    slug: 'job_orphan_community',
    name: 'Job referencing missing Community',
    description: 'Jobs with communityId set but no Community row exists',
    entity: 'Job',
    severity: 'WARNING',
    category: 'referential',
    query: `SELECT j.id, j."jobNumber" AS name FROM "Job" j LEFT JOIN "Community" c ON c.id = j."communityId" WHERE j."communityId" IS NOT NULL AND c.id IS NULL`,
    fixUrl: '/ops/jobs/{id}',
  },
  {
    slug: 'vendor_product_orphan_product',
    name: 'VendorProduct orphan Product',
    description: 'VendorProduct mappings whose productId no longer exists',
    entity: 'VendorProduct',
    severity: 'WARNING',
    category: 'referential',
    query: `SELECT vp.id, vp."vendorSku" AS name FROM "VendorProduct" vp LEFT JOIN "Product" p ON p.id = vp."productId" WHERE p.id IS NULL`,
  },

  // ─── 2. Required-field backfill ──────────────────────────────────────
  {
    slug: 'vendor_missing_payment_terms',
    name: 'Vendors missing payment terms',
    description: 'Active vendors without paymentTermDays set — blocks PO auto-dating',
    entity: 'Vendor',
    severity: 'WARNING',
    category: 'backfill',
    query: `SELECT id, name FROM "Vendor" WHERE active = true AND ("paymentTermDays" IS NULL OR "paymentTermDays" = 0)`,
    fixUrl: '/ops/vendors/{id}',
  },
  {
    slug: 'vendor_missing_email',
    name: 'Vendors missing contact email',
    description: 'Active vendors with no email on file — blocks PO auto-send',
    entity: 'Vendor',
    severity: 'WARNING',
    category: 'backfill',
    query: `SELECT id, name FROM "Vendor" WHERE active = true AND (email IS NULL OR email = '')`,
    fixUrl: '/ops/vendors/{id}',
  },
  {
    slug: 'product_missing_base_price',
    name: 'Products missing base price',
    description: 'Active products with no basePrice set — will quote at zero',
    entity: 'Product',
    severity: 'CRITICAL',
    category: 'backfill',
    query: `SELECT id, name FROM "Product" WHERE active = true AND ("basePrice" IS NULL OR "basePrice" = 0)`,
    fixUrl: '/ops/catalog/{id}',
  },
  {
    slug: 'product_missing_category',
    name: 'Products missing category',
    description: 'Active products with no category — breaks margin rollups',
    entity: 'Product',
    severity: 'WARNING',
    category: 'backfill',
    query: `SELECT id, name FROM "Product" WHERE active = true AND (category IS NULL OR category = '')`,
    fixUrl: '/ops/catalog/{id}',
  },
  {
    slug: 'builder_missing_address',
    name: 'Active builders missing ship-to address',
    description: 'Active builders without city/state populated',
    entity: 'Builder',
    severity: 'WARNING',
    category: 'backfill',
    query: `SELECT id, "companyName" AS name FROM "Builder" WHERE status = 'ACTIVE' AND (city IS NULL OR city = '' OR state IS NULL OR state = '')`,
    fixUrl: '/ops/accounts/{id}',
  },
  {
    slug: 'community_missing_lot_count',
    name: 'Communities missing lot counts',
    description: 'Active communities with totalLots = 0 — breaks capacity planning',
    entity: 'Community',
    severity: 'INFO',
    category: 'backfill',
    query: `SELECT id, name FROM "Community" WHERE status = 'ACTIVE' AND ("totalLots" IS NULL OR "totalLots" = 0)`,
  },

  // ─── 3. Sane bounds ──────────────────────────────────────────────────
  {
    slug: 'product_negative_cost',
    name: 'Products with negative cost',
    description: 'Product.cost is negative — data-entry error',
    entity: 'Product',
    severity: 'CRITICAL',
    category: 'bounds',
    query: `SELECT id, name FROM "Product" WHERE cost < 0`,
    fixUrl: '/ops/catalog/{id}',
  },
  {
    slug: 'invoice_total_mismatch',
    name: 'Invoice total does not match line items',
    description: 'Invoice.total deviates from sum(InvoiceItem.lineTotal) + taxAmount by more than $0.01',
    entity: 'Invoice',
    severity: 'CRITICAL',
    category: 'bounds',
    query: `
      SELECT i.id, i."invoiceNumber" AS name
      FROM "Invoice" i
      LEFT JOIN (
        SELECT "invoiceId", SUM("lineTotal") AS items_total
        FROM "InvoiceItem"
        GROUP BY "invoiceId"
      ) s ON s."invoiceId" = i.id
      WHERE i.status::text NOT IN ('VOID', 'WRITE_OFF')
        AND ABS(COALESCE(s.items_total, 0) + COALESCE(i."taxAmount", 0) - i.total) > 0.01
    `,
    fixUrl: '/ops/finance/invoices/{id}',
  },
  {
    slug: 'invoice_balance_due_overstated',
    name: 'Invoice balanceDue exceeds total',
    description: 'balanceDue should never be greater than total',
    entity: 'Invoice',
    severity: 'CRITICAL',
    category: 'bounds',
    query: `SELECT id, "invoiceNumber" AS name FROM "Invoice" WHERE "balanceDue" > total + 0.01`,
    fixUrl: '/ops/finance/invoices/{id}',
  },
  {
    slug: 'invoice_paid_negative_balance',
    name: 'Paid invoices with non-zero balance',
    description: 'Invoice.status=PAID but balanceDue > 0',
    entity: 'Invoice',
    severity: 'WARNING',
    category: 'bounds',
    query: `SELECT id, "invoiceNumber" AS name FROM "Invoice" WHERE status::text = 'PAID' AND "balanceDue" > 0.01`,
    fixUrl: '/ops/finance/invoices/{id}',
  },
  {
    slug: 'po_total_mismatch',
    name: 'PO total mismatches line items',
    description: 'PurchaseOrder.total diverges from sum(items.lineTotal) + shippingCost by >$0.01',
    entity: 'PurchaseOrder',
    severity: 'WARNING',
    category: 'bounds',
    query: `
      SELECT po.id, po."poNumber" AS name
      FROM "PurchaseOrder" po
      LEFT JOIN (
        SELECT "purchaseOrderId", SUM("lineTotal") AS items_total
        FROM "PurchaseOrderItem"
        GROUP BY "purchaseOrderId"
      ) s ON s."purchaseOrderId" = po.id
      WHERE po.status::text NOT IN ('CANCELLED')
        AND ABS(COALESCE(s.items_total, 0) + COALESCE(po."shippingCost", 0) - po.total) > 0.01
    `,
    fixUrl: '/ops/purchasing/po/{id}',
  },
  {
    slug: 'po_received_qty_exceeds_ordered',
    name: 'PO item receivedQty exceeds ordered quantity',
    description: 'PurchaseOrderItem.receivedQty > quantity — physical-count conflict',
    entity: 'PurchaseOrderItem',
    severity: 'WARNING',
    category: 'bounds',
    query: `SELECT id, "vendorSku" AS name FROM "PurchaseOrderItem" WHERE "receivedQty" > quantity`,
  },

  // ─── 4. Staleness ────────────────────────────────────────────────────
  {
    slug: 'order_received_30d',
    name: 'Orders stuck in RECEIVED > 30 days',
    description: 'Order.status=RECEIVED with no progression for 30+ days',
    entity: 'Order',
    severity: 'WARNING',
    category: 'staleness',
    query: `SELECT id, "orderNumber" AS name FROM "Order" WHERE status::text = 'RECEIVED' AND "updatedAt" < NOW() - INTERVAL '30 days'`,
    fixUrl: '/ops/orders/{id}',
  },
  {
    slug: 'po_approved_not_sent_14d',
    name: 'POs approved but not sent to vendor (14d)',
    description: 'PurchaseOrder.status=APPROVED for 14+ days without moving to SENT_TO_VENDOR',
    entity: 'PurchaseOrder',
    severity: 'WARNING',
    category: 'staleness',
    query: `SELECT id, "poNumber" AS name FROM "PurchaseOrder" WHERE status::text = 'APPROVED' AND "updatedAt" < NOW() - INTERVAL '14 days'`,
    fixUrl: '/ops/purchasing/po/{id}',
  },
  {
    slug: 'invoice_draft_30d',
    name: 'Invoices stuck in DRAFT > 30 days',
    description: 'Invoice.status=DRAFT for 30+ days — likely forgotten / needs issue or void',
    entity: 'Invoice',
    severity: 'WARNING',
    category: 'staleness',
    query: `SELECT id, "invoiceNumber" AS name FROM "Invoice" WHERE status::text = 'DRAFT' AND "createdAt" < NOW() - INTERVAL '30 days'`,
    fixUrl: '/ops/finance/invoices/{id}',
  },
  {
    slug: 'quote_sent_not_decided_45d',
    name: 'Quotes SENT > 45 days with no decision',
    description: 'Quote.status=SENT with no approval/rejection after 45 days — likely dead',
    entity: 'Quote',
    severity: 'INFO',
    category: 'staleness',
    query: `SELECT id, "quoteNumber" AS name FROM "Quote" WHERE status::text = 'SENT' AND "updatedAt" < NOW() - INTERVAL '45 days'`,
    fixUrl: '/ops/sales/quotes/{id}',
  },

  // ─── 5. Business rules ───────────────────────────────────────────────
  {
    slug: 'builder_pricing_below_cost',
    name: 'BuilderPricing below product cost',
    description: 'BuilderPricing.customPrice is less than Product.cost — selling at a loss',
    entity: 'BuilderPricing',
    severity: 'CRITICAL',
    category: 'business',
    query: `
      SELECT bp.id, p.name AS name
      FROM "BuilderPricing" bp
      JOIN "Product" p ON p.id = bp."productId"
      WHERE bp."customPrice" < p.cost AND p.cost > 0
    `,
  },
  {
    slug: 'product_base_price_below_cost',
    name: 'Product basePrice below cost',
    description: 'Product.basePrice < Product.cost — catalog will quote at a loss',
    entity: 'Product',
    severity: 'CRITICAL',
    category: 'business',
    query: `SELECT id, name FROM "Product" WHERE active = true AND "basePrice" < cost AND cost > 0`,
    fixUrl: '/ops/catalog/{id}',
  },
  {
    slug: 'builder_over_credit_limit',
    name: 'Builders over credit limit',
    description: 'Builder.accountBalance exceeds creditLimit (when set) — stop-ship candidate',
    entity: 'Builder',
    severity: 'CRITICAL',
    category: 'business',
    query: `SELECT id, "companyName" AS name FROM "Builder" WHERE status = 'ACTIVE' AND "creditLimit" IS NOT NULL AND "creditLimit" > 0 AND "accountBalance" > "creditLimit"`,
    fixUrl: '/ops/accounts/{id}',
  },
  {
    slug: 'vendor_credit_hold_with_open_pos',
    name: 'Vendors on credit hold with open POs',
    description: 'Vendor.creditHold=true but has non-final POs in flight',
    entity: 'Vendor',
    severity: 'CRITICAL',
    category: 'business',
    query: `
      SELECT DISTINCT v.id, v.name AS name
      FROM "Vendor" v
      JOIN "PurchaseOrder" po ON po."vendorId" = v.id
      WHERE v."creditHold" = true
        AND po.status::text NOT IN ('RECEIVED', 'CANCELLED')
    `,
    fixUrl: '/ops/vendors/{id}',
  },
  {
    slug: 'invoice_overdue_not_flagged',
    name: 'Overdue invoices not marked OVERDUE',
    description: 'dueDate has passed and balanceDue > 0 but status is still ISSUED/SENT',
    entity: 'Invoice',
    severity: 'WARNING',
    category: 'business',
    query: `SELECT id, "invoiceNumber" AS name FROM "Invoice" WHERE "dueDate" < NOW() AND "balanceDue" > 0 AND status::text IN ('ISSUED', 'SENT')`,
    fixUrl: '/ops/finance/invoices/{id}',
  },

  // ─── 6. Duplicate detection ──────────────────────────────────────────
  {
    slug: 'product_duplicate_sku_case',
    name: 'Product SKU duplicates (case/space insensitive)',
    description: 'Two+ products whose SKUs collide after trim + upper-case — likely dupes',
    entity: 'Product',
    severity: 'WARNING',
    category: 'duplicate',
    query: `
      SELECT p.id, p.name AS name
      FROM "Product" p
      JOIN (
        SELECT UPPER(TRIM(sku)) AS norm_sku
        FROM "Product"
        GROUP BY UPPER(TRIM(sku))
        HAVING COUNT(*) > 1
      ) d ON UPPER(TRIM(p.sku)) = d.norm_sku
    `,
    fixUrl: '/ops/catalog/{id}',
  },
  {
    slug: 'builder_duplicate_company_name',
    name: 'Builder companyName duplicates (case-insensitive)',
    description: 'Two+ builders whose companyName collides ignoring case / whitespace',
    entity: 'Builder',
    severity: 'WARNING',
    category: 'duplicate',
    query: `
      SELECT b.id, b."companyName" AS name
      FROM "Builder" b
      JOIN (
        SELECT UPPER(TRIM("companyName")) AS norm_name
        FROM "Builder"
        GROUP BY UPPER(TRIM("companyName"))
        HAVING COUNT(*) > 1
      ) d ON UPPER(TRIM(b."companyName")) = d.norm_name
    `,
    fixUrl: '/ops/accounts/{id}',
  },
  {
    slug: 'vendor_duplicate_code',
    name: 'Vendor code duplicates (case-insensitive)',
    description: 'Vendor.code collisions after UPPER/TRIM — masks a unique-index bypass',
    entity: 'Vendor',
    severity: 'WARNING',
    category: 'duplicate',
    query: `
      SELECT v.id, v.name AS name
      FROM "Vendor" v
      JOIN (
        SELECT UPPER(TRIM(code)) AS norm_code
        FROM "Vendor"
        GROUP BY UPPER(TRIM(code))
        HAVING COUNT(*) > 1
      ) d ON UPPER(TRIM(v.code)) = d.norm_code
    `,
    fixUrl: '/ops/vendors/{id}',
  },
]

async function main() {
  console.log(`Seed DataQualityRule v2 — ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`  Source tag: ${SOURCE_TAG}`)
  console.log(`  Candidate rules: ${NEW_RULES.length}`)
  console.log()

  const prisma = new PrismaClient()

  try {
    // Validate every rule's SQL parses and returns an id column — do this
    // EXPLAIN-style so we don't accidentally mutate data or time out.
    console.log('Validating SQL for each rule (EXPLAIN)...')
    let validOk = 0
    let validFail = 0
    const failures: Array<{ slug: string; err: string }> = []
    for (const r of NEW_RULES) {
      try {
        await prisma.$queryRawUnsafe(`EXPLAIN ${r.query}`)
        validOk++
      } catch (e: any) {
        validFail++
        failures.push({ slug: r.slug, err: String(e.message || e).slice(0, 200) })
      }
    }
    console.log(`  OK: ${validOk}   FAIL: ${validFail}`)
    if (validFail > 0) {
      console.log('  Failing queries:')
      for (const f of failures) console.log(`    - ${f.slug}: ${f.err}`)
      if (validFail > 0 && !DRY_RUN) {
        throw new Error(`Refusing to commit — ${validFail} rule queries failed EXPLAIN.`)
      }
    }
    console.log()

    // Print summary by category
    const byCategory: Record<string, Rule[]> = {}
    for (const r of NEW_RULES) {
      byCategory[r.category] = byCategory[r.category] || []
      byCategory[r.category].push(r)
    }
    console.log('By category:')
    for (const [cat, rs] of Object.entries(byCategory)) {
      const crit = rs.filter((x) => x.severity === 'CRITICAL').length
      const warn = rs.filter((x) => x.severity === 'WARNING').length
      const info = rs.filter((x) => x.severity === 'INFO').length
      console.log(
        `  ${cat.padEnd(14)} ${rs.length} rules  (CRITICAL=${crit} WARNING=${warn} INFO=${info})`,
      )
    }
    console.log()

    // Sample CRITICAL rules
    console.log('Sample CRITICAL rules:')
    for (const r of NEW_RULES.filter((x) => x.severity === 'CRITICAL').slice(0, 6)) {
      console.log(`  - [${r.entity.padEnd(18)}] ${r.name}`)
    }
    console.log()

    if (DRY_RUN) {
      console.log('DRY-RUN complete — re-run with --commit to write to the database.')
      return
    }

    // Insert rules (idempotent via ON CONFLICT DO NOTHING on deterministic id)
    let inserted = 0
    let skipped = 0
    for (const r of NEW_RULES) {
      const id = `${ID_PREFIX}${r.slug}`
      const result = await prisma.$executeRawUnsafe(
        `INSERT INTO "DataQualityRule"
          (id, name, description, entity, severity, query, "fixUrl", "isActive", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        id,
        r.name,
        r.description,
        r.entity,
        r.severity,
        r.query,
        r.fixUrl ?? null,
      )
      if (result && Number(result) > 0) inserted++
      else skipped++
    }

    console.log(`Rules inserted: ${inserted}   (skipped existing: ${skipped})`)

    // Current total rule count
    const total = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count FROM "DataQualityRule"`,
    )
    const totalCount = total[0]?.count ?? 0
    console.log(`Total DataQualityRule rows now: ${totalCount}`)

    // Summary InboxItem (idempotent via deterministic id)
    const inboxId = `inbox_${SOURCE_TAG.toLowerCase()}`
    await prisma.$executeRawUnsafe(
      `INSERT INTO "InboxItem"
        (id, type, source, title, description, priority, status, "entityType", "entityId", "actionData", "createdAt", "updatedAt")
       VALUES ($1, 'SYSTEM', 'data-quality', $2, $3, 'MEDIUM', 'PENDING', 'DataQualityRule', NULL, $4::jsonb, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         description = EXCLUDED.description,
         "actionData" = EXCLUDED."actionData",
         "updatedAt"  = NOW()`,
      inboxId,
      `Data-quality rule set expanded to ${totalCount} rules`,
      `v2 seed added ${inserted} new rules across 6 categories (referential, backfill, bounds, staleness, business, duplicate). Next data-quality cron run will begin evaluating them.`,
      JSON.stringify({
        sourceTag: SOURCE_TAG,
        inserted,
        skipped,
        totalRules: totalCount,
        categories: Object.fromEntries(
          Object.entries(byCategory).map(([k, v]) => [k, v.length]),
        ),
      }),
    )
    console.log(`InboxItem upserted: ${inboxId}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
