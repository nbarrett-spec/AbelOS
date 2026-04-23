export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { withCronRun } from '@/lib/cron'

// ────────────────────────────────────────────────────────────────────────────
// Data Quality Watchdog (Phase 4.5)
//
// Complementary to the rule-table-driven /api/cron/data-quality cron.
// This cron runs a hard-coded set of integrity checks focused on silent drift:
// impossible states (paid > total, committed > on-hand), missing FK/dimension
// data, and NULL requireds that should never exist post-dedup.
//
// Findings are written to InboxItem with type='DATA_QUALITY'. entityId uses a
// dq_<check>_<sourceId> namespace so there is zero collision risk with the
// ETL chat's InboxItem writes (which use different type/id conventions).
//
// Idempotent: an open finding for the same entityId is left alone (updatedAt
// bumped). Resolved-then-regressed findings re-open cleanly on the next run.
//
// Schedule: 0 12 * * * (6 AM Central standard, 7 AM Central summer).
// ────────────────────────────────────────────────────────────────────────────

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

interface Finding {
  checkKey: string          // stable identifier for the check (e.g. 'orders_no_builder')
  entityId: string          // source row id
  entityType: string | null // Order | Job | Invoice | Builder | InventoryItem | Staff | Product
  title: string
  description: string
  priority: Severity
  financialImpact?: number | null
}

// InboxItem 'priority' field uses CRITICAL|HIGH|MEDIUM|LOW (see schema:3093).
// Task copy asked for CRITICAL/WARN/INFO — mapped to the canonical priority
// scale so the inbox queue sorts them correctly.
const WARN: Severity = 'HIGH'
const INFO: Severity = 'MEDIUM'
const CRITICAL: Severity = 'CRITICAL'

// ─── Checks ──────────────────────────────────────────────────────────────

async function checkOrdersMissingBuilder(): Promise<Finding[]> {
  // Post-dedup, Order.builderId is NOT NULL in the schema — this check catches
  // regression if the column ever goes nullable or a raw insert bypasses Prisma.
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; orderNumber: string }>>(
    `SELECT id, "orderNumber" FROM "Order" WHERE "builderId" IS NULL`
  )
  return rows.map(r => ({
    checkKey: 'orders_no_builder',
    entityId: r.id,
    entityType: 'Order',
    title: `Order ${r.orderNumber} has no builder`,
    description: `Order row is missing builderId — schema regression or raw insert bypassed Prisma validation.`,
    priority: INFO,
  }))
}

async function checkJobsMissingScheduledDate(): Promise<Finding[]> {
  // Terminal statuses that legitimately have no scheduledDate.
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; jobNumber: string; status: string }>>(
    `SELECT id, "jobNumber", status FROM "Job"
     WHERE "scheduledDate" IS NULL
       AND status NOT IN ('COMPLETE', 'CLOSED', 'INVOICED')`
  )
  return rows.map(r => ({
    checkKey: 'jobs_no_scheduled_date',
    entityId: r.id,
    entityType: 'Job',
    title: `Job ${r.jobNumber} missing scheduledDate`,
    description: `Active job (status=${r.status}) has no scheduledDate — PM cannot T-72/T-48/T-24.`,
    priority: INFO,
  }))
}

async function checkJobsMissingBuilder(): Promise<Finding[]> {
  // Job has no direct builderId FK — use orderId->Order.builderId as the proxy.
  // Missing means: orderId is NULL AND builderName is empty/placeholder.
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; jobNumber: string }>>(
    `SELECT id, "jobNumber" FROM "Job"
     WHERE "orderId" IS NULL
       AND ("builderName" IS NULL OR "builderName" = '' OR "builderName" = 'UNKNOWN')`
  )
  return rows.map(r => ({
    checkKey: 'jobs_no_builder',
    entityId: r.id,
    entityType: 'Job',
    title: `Job ${r.jobNumber} has no builder linkage`,
    description: `Job has no orderId and no builderName — cannot route to PM or invoice.`,
    priority: INFO,
  }))
}

async function checkInvoiceOverpaid(): Promise<Finding[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; invoiceNumber: string; total: number; amountPaid: number }>>(
    `SELECT id, "invoiceNumber", total, "amountPaid"
     FROM "Invoice"
     WHERE "amountPaid" > total + 0.01`
  )
  return rows.map(r => ({
    checkKey: 'invoice_overpaid',
    entityId: r.id,
    entityType: 'Invoice',
    title: `Invoice ${r.invoiceNumber} overpaid by $${(r.amountPaid - r.total).toFixed(2)}`,
    description: `amountPaid ($${r.amountPaid}) exceeds total ($${r.total}). Data integrity bug — check payment posting logic.`,
    priority: CRITICAL,
    financialImpact: r.amountPaid - r.total,
  }))
}

async function checkInvoiceBalanceDrift(): Promise<Finding[]> {
  // balanceDue should equal total - amountPaid. 1-cent tolerance for float math.
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; invoiceNumber: string; total: number; amountPaid: number; balanceDue: number }>>(
    `SELECT id, "invoiceNumber", total, "amountPaid", "balanceDue"
     FROM "Invoice"
     WHERE ABS("balanceDue" - (total - "amountPaid")) > 0.01`
  )
  return rows.map(r => {
    const expected = r.total - r.amountPaid
    const drift = r.balanceDue - expected
    return {
      checkKey: 'invoice_balance_drift',
      entityId: r.id,
      entityType: 'Invoice',
      title: `Invoice ${r.invoiceNumber} balance math drift ($${drift.toFixed(2)})`,
      description: `balanceDue=${r.balanceDue} but total-amountPaid=${expected.toFixed(2)}. Recalc required.`,
      priority: CRITICAL,
      financialImpact: Math.abs(drift),
    }
  })
}

async function checkStaleActiveBuilders(): Promise<Finding[]> {
  // ACTIVE builders with no orders in the last 180 days — stale classification.
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; companyName: string; last_order: Date | null }>>(
    `SELECT b.id, b."companyName", MAX(o."createdAt") AS last_order
     FROM "Builder" b
     LEFT JOIN "Order" o ON o."builderId" = b.id
     WHERE b.status = 'ACTIVE'
     GROUP BY b.id, b."companyName"
     HAVING MAX(o."createdAt") IS NULL OR MAX(o."createdAt") < NOW() - INTERVAL '180 days'`
  )
  return rows.map(r => ({
    checkKey: 'builder_active_no_recent_orders',
    entityId: r.id,
    entityType: 'Builder',
    title: `Builder ${r.companyName} marked ACTIVE but no orders in 180 days`,
    description: r.last_order
      ? `Last order: ${new Date(r.last_order).toISOString().slice(0, 10)}. Reclassify as INACTIVE?`
      : `Never ordered. Reclassify as PENDING or INACTIVE?`,
    priority: WARN,
  }))
}

async function checkInventoryOverCommitted(): Promise<Finding[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; sku: string | null; productName: string | null; onHand: number; committed: number }>>(
    `SELECT id, sku, "productName", "onHand", committed
     FROM "InventoryItem"
     WHERE committed > "onHand"`
  )
  return rows.map(r => ({
    checkKey: 'inventory_over_committed',
    entityId: r.id,
    entityType: 'InventoryItem',
    title: `InventoryItem ${r.sku ?? r.id} committed (${r.committed}) > onHand (${r.onHand})`,
    description: `Impossible allocation: committed exceeds on-hand stock. Will cause pick failures. Product: ${r.productName ?? 'unknown'}.`,
    priority: CRITICAL,
  }))
}

async function checkStaffMissingRoleOrDept(): Promise<Finding[]> {
  // Staff.role + Staff.department are both NOT NULL in schema. This check
  // catches regression or partial-import rows. Uses empty-string fallback
  // since Prisma rejects NULL on required String columns at runtime.
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; firstName: string; lastName: string; role: string | null; department: string | null }>>(
    `SELECT id, "firstName", "lastName", role::text AS role, department::text AS department
     FROM "Staff"
     WHERE role IS NULL OR department IS NULL`
  )
  return rows.map(r => ({
    checkKey: 'staff_missing_role_or_dept',
    entityId: r.id,
    entityType: 'Staff',
    title: `Staff ${r.firstName} ${r.lastName} missing role/department`,
    description: `role=${r.role ?? 'NULL'}, department=${r.department ?? 'NULL'}. Permissions + inbox scoping broken until set.`,
    priority: WARN,
  }))
}

async function checkProductNegativeMargin(): Promise<Finding[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; sku: string; name: string; cost: number; basePrice: number }>>(
    `SELECT id, sku, name, cost, "basePrice"
     FROM "Product"
     WHERE active = true AND "basePrice" < cost AND "basePrice" > 0`
  )
  return rows.map(r => ({
    checkKey: 'product_negative_margin',
    entityId: r.id,
    entityType: 'Product',
    title: `Product ${r.sku} sells below cost ($${r.basePrice} < $${r.cost})`,
    description: `basePrice ($${r.basePrice}) is below cost ($${r.cost}) — every sale loses money. Review pricing.`,
    priority: WARN,
    financialImpact: r.cost - r.basePrice,
  }))
}

async function checkPaidOrdersWithoutPayment(): Promise<Finding[]> {
  // Order.paymentStatus = PAID but no Payment row exists via the invoice join.
  // Looks up Payment via Invoice.orderId -> Invoice.id -> Payment.invoiceId.
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; orderNumber: string; total: number }>>(
    `SELECT o.id, o."orderNumber", o.total
     FROM "Order" o
     WHERE o."paymentStatus" = 'PAID'
       AND NOT EXISTS (
         SELECT 1 FROM "Invoice" i
         JOIN "Payment" p ON p."invoiceId" = i.id
         WHERE i."orderId" = o.id
       )`
  )
  return rows.map(r => ({
    checkKey: 'order_paid_no_payment',
    entityId: r.id,
    entityType: 'Order',
    title: `Order ${r.orderNumber} flagged PAID but no Payment row`,
    description: `paymentStatus=PAID on $${r.total} order, but no corresponding Payment found via invoice. Cascade gap.`,
    priority: CRITICAL,
    financialImpact: r.total,
  }))
}

// ─── Writer ──────────────────────────────────────────────────────────────

async function upsertFinding(f: Finding): Promise<'created' | 'updated' | 'skipped'> {
  const namespacedEntityId = `dq_${f.checkKey}_${f.entityId}`
  // Look up existing OPEN (non-terminal) finding for this composite key.
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string; status: string }>>(
    `SELECT id, status FROM "InboxItem"
     WHERE type = 'DATA_QUALITY' AND "entityId" = $1
       AND status IN ('PENDING', 'SNOOZED')
     LIMIT 1`,
    namespacedEntityId
  )

  if (existing.length > 0) {
    await prisma.$executeRawUnsafe(
      `UPDATE "InboxItem"
       SET "updatedAt" = NOW(), priority = $2, title = $3, description = $4,
           "financialImpact" = $5
       WHERE id = $1`,
      existing[0].id, f.priority, f.title, f.description, f.financialImpact ?? null
    )
    return 'updated'
  }

  const id = `inb_dq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  await prisma.$executeRawUnsafe(
    `INSERT INTO "InboxItem"
       (id, type, source, title, description, priority, "entityType", "entityId",
        "financialImpact", "actionData", status, "createdAt", "updatedAt")
     VALUES ($1, 'DATA_QUALITY', 'data-quality-watchdog', $2, $3, $4, $5, $6, $7, $8, 'PENDING', NOW(), NOW())`,
    id, f.title, f.description, f.priority, f.entityType, namespacedEntityId,
    f.financialImpact ?? null,
    JSON.stringify({ checkKey: f.checkKey, sourceId: f.entityId })
  )
  return 'created'
}

// ─── Orchestration ───────────────────────────────────────────────────────

async function runWatchdog() {
  const [
    ordersNoBuilder,
    jobsNoSchedule,
    jobsNoBuilder,
    invoiceOverpaid,
    invoiceBalanceDrift,
    staleActiveBuilders,
    inventoryOverCommitted,
    staffMissingRole,
    productNegativeMargin,
    paidOrdersNoPayment,
  ] = await Promise.all([
    checkOrdersMissingBuilder().catch(e => { logger.error('dq_check_failed', e, { check: 'orders_no_builder' }); return [] as Finding[] }),
    checkJobsMissingScheduledDate().catch(e => { logger.error('dq_check_failed', e, { check: 'jobs_no_scheduled_date' }); return [] as Finding[] }),
    checkJobsMissingBuilder().catch(e => { logger.error('dq_check_failed', e, { check: 'jobs_no_builder' }); return [] as Finding[] }),
    checkInvoiceOverpaid().catch(e => { logger.error('dq_check_failed', e, { check: 'invoice_overpaid' }); return [] as Finding[] }),
    checkInvoiceBalanceDrift().catch(e => { logger.error('dq_check_failed', e, { check: 'invoice_balance_drift' }); return [] as Finding[] }),
    checkStaleActiveBuilders().catch(e => { logger.error('dq_check_failed', e, { check: 'builder_active_no_recent_orders' }); return [] as Finding[] }),
    checkInventoryOverCommitted().catch(e => { logger.error('dq_check_failed', e, { check: 'inventory_over_committed' }); return [] as Finding[] }),
    checkStaffMissingRoleOrDept().catch(e => { logger.error('dq_check_failed', e, { check: 'staff_missing_role_or_dept' }); return [] as Finding[] }),
    checkProductNegativeMargin().catch(e => { logger.error('dq_check_failed', e, { check: 'product_negative_margin' }); return [] as Finding[] }),
    checkPaidOrdersWithoutPayment().catch(e => { logger.error('dq_check_failed', e, { check: 'order_paid_no_payment' }); return [] as Finding[] }),
  ])

  const byCategory = {
    orders_no_builder: ordersNoBuilder.length,
    jobs_no_scheduled_date: jobsNoSchedule.length,
    jobs_no_builder: jobsNoBuilder.length,
    invoice_overpaid: invoiceOverpaid.length,
    invoice_balance_drift: invoiceBalanceDrift.length,
    builder_active_no_recent_orders: staleActiveBuilders.length,
    inventory_over_committed: inventoryOverCommitted.length,
    staff_missing_role_or_dept: staffMissingRole.length,
    product_negative_margin: productNegativeMargin.length,
    order_paid_no_payment: paidOrdersNoPayment.length,
  }

  const allFindings: Finding[] = [
    ...ordersNoBuilder,
    ...jobsNoSchedule,
    ...jobsNoBuilder,
    ...invoiceOverpaid,
    ...invoiceBalanceDrift,
    ...staleActiveBuilders,
    ...inventoryOverCommitted,
    ...staffMissingRole,
    ...productNegativeMargin,
    ...paidOrdersNoPayment,
  ]

  let created = 0
  let updated = 0
  for (const f of allFindings) {
    try {
      const outcome = await upsertFinding(f)
      if (outcome === 'created') created++
      else if (outcome === 'updated') updated++
    } catch (e) {
      logger.error('dq_upsert_failed', e, { checkKey: f.checkKey, entityId: f.entityId })
    }
  }

  return {
    totalFindings: allFindings.length,
    created,
    updated,
    byCategory,
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return withCronRun('data-quality-watchdog', async () => {
    const result = await runWatchdog()
    logger.info('data_quality_watchdog_complete', result)
    return NextResponse.json(result)
  })
}
