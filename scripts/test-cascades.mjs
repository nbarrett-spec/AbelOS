#!/usr/bin/env node
/**
 * scripts/test-cascades.mjs
 *
 * End-to-end smoke test for the 5 cross-entity cascades in src/lib/cascades/:
 *
 *   1. order-lifecycle     — onOrderConfirmed → Job, onOrderDelivered → Invoice DRAFT,
 *                             onOrderComplete → Job CLOSED, runOrderStatusCascades dispatcher.
 *   2. invoice-lifecycle   — onInvoicePaid (closes Order + Job), onInvoiceOverdue (InboxItem).
 *   3. po-lifecycle        — onPOSent, onPOPartialReceive, onPOReceived.
 *   4. delivery-lifecycle  — onDeliveryScheduled, onDeliveryComplete, onDeliveryFailed.
 *   5. job-lifecycle       — advanceJobWithGuards (QC-gate aware transitions).
 *
 * Each test creates isolated test entities (prefix `TEST-CASCADE-*`), invokes
 * the cascade helpers directly (NOT via HTTP), and asserts the expected
 * downstream writes exist. Every entity is cleaned up in a finally block.
 *
 * Run with tsx so the .ts cascade modules + @/* path aliases resolve:
 *   npx tsx scripts/test-cascades.mjs
 *
 * Exit code 0 = all pass, 1 = any failure.
 */

import { PrismaClient } from '@prisma/client'

// Dynamic imports so this file can be run via `node` or `tsx`. When run via
// `node`, these `.ts` imports will fail and we print a helpful message.
let cascades
try {
  const [order, invoice, po, delivery, job] = await Promise.all([
    import('../src/lib/cascades/order-lifecycle.ts'),
    import('../src/lib/cascades/invoice-lifecycle.ts'),
    import('../src/lib/cascades/po-lifecycle.ts'),
    import('../src/lib/cascades/delivery-lifecycle.ts'),
    import('../src/lib/cascades/job-lifecycle.ts'),
  ])
  cascades = { order, invoice, po, delivery, job }
} catch (e) {
  console.error(
    '\nFailed to import cascade modules. Run via tsx:\n' +
    '  npx tsx scripts/test-cascades.mjs\n'
  )
  console.error('Underlying error:', e?.message || e)
  process.exit(1)
}

const prisma = new PrismaClient()

const RUN_ID = `TC${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const results = []
const createdIds = {
  orders: [],
  jobs: [],
  invoices: [],
  payments: [],
  deliveries: [],
  purchaseOrders: [],
  inboxItems: [],
  builders: [],
  staff: [],
  products: [],
  inventory: [],
}

function log(name, pass, note = '') {
  const tag = pass ? 'PASS' : 'FAIL'
  console.log(`  [${tag}] ${name}${note ? ` — ${note}` : ''}`)
  results.push({ name, pass, note })
}

async function getOrCreateStaff() {
  const existing = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Staff" ORDER BY "createdAt" ASC LIMIT 1`
  )
  if (existing[0]?.id) return existing[0].id
  const id = `staff_${RUN_ID}`
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Staff" ("id","email","firstName","lastName","role","department","active","createdAt","updatedAt")
     VALUES ($1, $2, 'Cascade', 'Tester', 'ADMIN', 'EXECUTIVE', true, NOW(), NOW())`,
    id, `cascade.test.${RUN_ID}@local`
  )
  createdIds.staff.push(id)
  return id
}

async function createTestBuilder(idSuffix = '') {
  const id = `bldr_${RUN_ID}${idSuffix}`
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Builder" (
        "id","companyName","contactName","email","passwordHash","phone","paymentTerm","status",
        "createdAt","updatedAt"
     ) VALUES ($1,$2,$3,$4,$5,$6,'NET_15'::"PaymentTerm",'ACTIVE'::"AccountStatus",NOW(),NOW())`,
    id,
    `CASCADE-TEST-${RUN_ID}${idSuffix}`,
    'Test Contact',
    `cascade.${RUN_ID}${idSuffix}@local.test`,
    'not-a-real-hash', // required NOT NULL but unused by these tests
    '555-000-0000'
  )
  createdIds.builders.push(id)
  return id
}

async function createTestOrder(builderId, opts = {}) {
  const id = `ord_${RUN_ID}${opts.suffix || ''}`
  const status = opts.status || 'RECEIVED'
  const paymentStatus = opts.paymentStatus || 'PENDING'
  const orderNumber = `TEST-CASCADE-${RUN_ID}${opts.suffix || ''}`
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Order" (
        "id","builderId","orderNumber","subtotal","taxAmount","total",
        "paymentTerm","paymentStatus","status","createdAt","updatedAt"
     ) VALUES ($1,$2,$3,$4,$5,$6,'NET_15'::"PaymentTerm",$7::"PaymentStatus",$8::"OrderStatus",NOW(),NOW())`,
    id, builderId, orderNumber, 1000, 80, 1080, paymentStatus, status
  )
  createdIds.orders.push(id)
  return { id, orderNumber }
}

async function createTestJob(orderId) {
  const id = `job_${RUN_ID}_${Math.random().toString(36).slice(2, 6)}`
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Job" (
        "id","jobNumber","orderId","builderName","scopeType","status","createdAt","updatedAt"
     ) VALUES ($1,$2,$3,'CASCADE Test Builder','DOORS_AND_TRIM'::"ScopeType",'CREATED'::"JobStatus",NOW(),NOW())`,
    id, `JOB-TEST-${RUN_ID}-${Math.random().toString(36).slice(2, 6)}`, orderId
  )
  createdIds.jobs.push(id)
  return id
}

async function createTestInvoice(builderId, orderId, createdById, opts = {}) {
  const id = `inv_${RUN_ID}${opts.suffix || ''}`
  const status = opts.status || 'DRAFT'
  const dueDate = opts.dueDate || new Date(Date.now() + 15 * 86400 * 1000)
  const amountPaid = opts.amountPaid ?? 0
  const total = opts.total ?? 1080
  const balanceDue = total - amountPaid
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Invoice" (
        "id","invoiceNumber","builderId","orderId","createdById",
        "subtotal","taxAmount","total","amountPaid","balanceDue",
        "status","paymentTerm","dueDate","createdAt","updatedAt"
     ) VALUES (
        $1, $2, $3, $4, $5,
        1000, 80, $6, $7, $8,
        $9::"InvoiceStatus",'NET_15'::"PaymentTerm", $10, NOW(), NOW())`,
    id,
    `TEST-INV-${RUN_ID}${opts.suffix || ''}`,
    builderId,
    orderId,
    createdById,
    total, amountPaid, balanceDue,
    status,
    dueDate
  )
  createdIds.invoices.push(id)
  return id
}

async function createTestDelivery(jobId, status = 'SCHEDULED') {
  const id = `del_${RUN_ID}_${Math.random().toString(36).slice(2, 6)}`
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Delivery" (
        "id","jobId","deliveryNumber","routeOrder","address","status","createdAt","updatedAt"
     ) VALUES ($1,$2,$3,0,'123 Test St',$4::"DeliveryStatus",NOW(),NOW())`,
    id, jobId,
    `TEST-DEL-${RUN_ID}-${Math.random().toString(36).slice(2, 6)}`,
    status
  )
  createdIds.deliveries.push(id)
  return id
}

async function cleanup() {
  // Order matters: children before parents.
  for (const id of createdIds.deliveries) {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "DeliveryTracking" WHERE "deliveryId"=$1`, id)
      await prisma.$executeRawUnsafe(`DELETE FROM "Delivery" WHERE "id"=$1`, id)
    } catch { /* ignore */ }
  }
  // ScheduleEntry rows created by onDeliveryScheduled
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "ScheduleEntry" WHERE "title" ILIKE $1`,
      `%TEST-DEL-${RUN_ID}%`
    )
  } catch { /* ignore */ }
  for (const id of createdIds.payments) {
    try { await prisma.$executeRawUnsafe(`DELETE FROM "Payment" WHERE "id"=$1`, id) } catch {}
  }
  for (const id of createdIds.invoices) {
    try { await prisma.$executeRawUnsafe(`DELETE FROM "Invoice" WHERE "id"=$1`, id) } catch {}
  }
  // PurchaseOrder children
  for (const id of createdIds.purchaseOrders) {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "BackorderItem" WHERE "purchaseOrderId"=$1`, id)
      await prisma.$executeRawUnsafe(`DELETE FROM "PurchaseOrderItem" WHERE "purchaseOrderId"=$1`, id)
      await prisma.$executeRawUnsafe(`DELETE FROM "PurchaseOrder" WHERE "id"=$1`, id)
    } catch {}
  }
  for (const id of createdIds.jobs) {
    try { await prisma.$executeRawUnsafe(`DELETE FROM "Job" WHERE "id"=$1`, id) } catch {}
  }
  for (const id of createdIds.orders) {
    try { await prisma.$executeRawUnsafe(`DELETE FROM "Order" WHERE "id"=$1`, id) } catch {}
  }
  for (const id of createdIds.builders) {
    try { await prisma.$executeRawUnsafe(`DELETE FROM "Builder" WHERE "id"=$1`, id) } catch {}
  }
  for (const id of createdIds.products) {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "InventoryItem" WHERE "productId"=$1`, id)
      await prisma.$executeRawUnsafe(`DELETE FROM "Product" WHERE "id"=$1`, id)
    } catch {}
  }
  // InboxItems created by cascades (any matching our run id)
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "InboxItem"
       WHERE ("title" ILIKE $1 OR "description" ILIKE $1)
         AND "createdAt" > NOW() - INTERVAL '1 hour'`,
      `%${RUN_ID}%`
    )
  } catch {}
  // Audit log entries for our test invoice IDs
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "AuditLog" WHERE "entityId" = ANY($1::text[])`,
      [...createdIds.invoices, ...createdIds.orders, ...createdIds.jobs]
    )
  } catch {}
  // Staff — only delete the one we created for this run
  for (const id of createdIds.staff) {
    try { await prisma.$executeRawUnsafe(`DELETE FROM "Staff" WHERE "id"=$1`, id) } catch {}
  }
}

// ─── Test suites ────────────────────────────────────────────────────────

async function testOrderCascades() {
  console.log('\n[1] order-lifecycle')
  const builderId = await createTestBuilder('A')
  const { id: orderId } = await createTestOrder(builderId, { suffix: 'A', status: 'CONFIRMED' })

  // onOrderConfirmed — should create a Job
  const r1 = await cascades.order.onOrderConfirmed(orderId)
  log('onOrderConfirmed returns ok', r1.ok, r1.detail)
  log('onOrderConfirmed created a Job', !!r1.jobId)
  if (r1.jobId) createdIds.jobs.push(r1.jobId)

  const jobRows = await prisma.$queryRawUnsafe(
    `SELECT "id","status"::text AS status FROM "Job" WHERE "orderId"=$1`,
    orderId
  )
  log('Job exists in DB after onOrderConfirmed', jobRows.length === 1, jobRows[0]?.status)

  // Idempotency — second call should not create a second Job
  const r1b = await cascades.order.onOrderConfirmed(orderId)
  const jobCountAfter = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Job" WHERE "orderId"=$1`, orderId
  ))[0].n
  log('onOrderConfirmed is idempotent', jobCountAfter === 1, `jobs=${jobCountAfter}`)

  // onOrderDelivered — should create Invoice DRAFT
  const r2 = await cascades.order.onOrderDelivered(orderId)
  log('onOrderDelivered returns ok', r2.ok, r2.detail)
  log('onOrderDelivered created an Invoice', !!r2.invoiceId)
  if (r2.invoiceId) createdIds.invoices.push(r2.invoiceId)

  const invRows = await prisma.$queryRawUnsafe(
    `SELECT "id","status"::text AS status FROM "Invoice" WHERE "orderId"=$1`,
    orderId
  )
  log('Invoice DRAFT exists after onOrderDelivered', invRows.length === 1 && invRows[0]?.status === 'DRAFT',
    `status=${invRows[0]?.status}`)

  // Idempotent second call
  const r2b = await cascades.order.onOrderDelivered(orderId)
  const invCountAfter = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Invoice" WHERE "orderId"=$1`, orderId
  ))[0].n
  log('onOrderDelivered is idempotent', invCountAfter === 1, `invoices=${invCountAfter}`)

  // onOrderComplete — should bump any non-closed Job to COMPLETE
  const r3 = await cascades.order.onOrderComplete(orderId)
  log('onOrderComplete returns ok', r3.ok, r3.detail)
  const jobStatusAfter = (await prisma.$queryRawUnsafe(
    `SELECT "status"::text AS status FROM "Job" WHERE "orderId"=$1`, orderId
  ))[0]?.status
  log('Job advanced to COMPLETE after onOrderComplete', jobStatusAfter === 'COMPLETE',
    `status=${jobStatusAfter}`)

  // dispatcher — runOrderStatusCascades('DELIVERED') should be no-op here
  // since invoice already exists; asserting it completes without throwing.
  let dispatcherThrew = false
  try {
    await cascades.order.runOrderStatusCascades(orderId, 'DELIVERED')
  } catch (e) {
    dispatcherThrew = true
  }
  log('runOrderStatusCascades(DELIVERED) does not throw', !dispatcherThrew)
}

async function testInvoiceCascades() {
  console.log('\n[2] invoice-lifecycle')
  const createdById = await getOrCreateStaff()
  const builderId = await createTestBuilder('B')
  const { id: orderId } = await createTestOrder(builderId, { suffix: 'B', status: 'DELIVERED', paymentStatus: 'INVOICED' })
  const jobId = await createTestJob(orderId)
  // Simulate a Job that is in COMPLETE so we can verify it transitions to CLOSED
  await prisma.$executeRawUnsafe(
    `UPDATE "Job" SET "status"='COMPLETE'::"JobStatus", "updatedAt"=NOW() WHERE "id"=$1`,
    jobId
  )

  // Fully paid invoice — onInvoicePaid should cascade
  const invoiceId = await createTestInvoice(builderId, orderId, createdById, {
    suffix: 'B',
    amountPaid: 1080, // fully paid
    total: 1080,
    status: 'PARTIALLY_PAID',
  })

  const r = await cascades.invoice.onInvoicePaid(invoiceId)
  log('onInvoicePaid returns ok', r.ok, r.detail)

  const invAfter = (await prisma.$queryRawUnsafe(
    `SELECT "status"::text AS status, "paidAt", "balanceDue" FROM "Invoice" WHERE "id"=$1`,
    invoiceId
  ))[0]
  log('Invoice status = PAID', invAfter?.status === 'PAID', `status=${invAfter?.status}`)
  log('Invoice.paidAt set', !!invAfter?.paidAt)
  log('Invoice.balanceDue = 0', Number(invAfter?.balanceDue ?? -1) === 0,
    `balanceDue=${invAfter?.balanceDue}`)

  const orderAfter = (await prisma.$queryRawUnsafe(
    `SELECT "paymentStatus"::text AS ps FROM "Order" WHERE "id"=$1`, orderId
  ))[0]
  log('Order.paymentStatus = PAID', orderAfter?.ps === 'PAID', `ps=${orderAfter?.ps}`)

  const jobAfter = (await prisma.$queryRawUnsafe(
    `SELECT "status"::text AS status FROM "Job" WHERE "id"=$1`, jobId
  ))[0]
  log('Job.status = CLOSED (from COMPLETE)', jobAfter?.status === 'CLOSED', `status=${jobAfter?.status}`)

  // Idempotent
  const r2 = await cascades.invoice.onInvoicePaid(invoiceId)
  log('onInvoicePaid is idempotent', r2.ok)

  // onInvoiceOverdue — create an overdue invoice
  const overdueInvoiceId = await createTestInvoice(builderId, orderId, createdById, {
    suffix: 'B_OVER',
    amountPaid: 0,
    total: 500,
    status: 'ISSUED',
    dueDate: new Date(Date.now() - 10 * 86400 * 1000), // 10 days past due
  })
  const r3 = await cascades.invoice.onInvoiceOverdue(overdueInvoiceId)
  log('onInvoiceOverdue returns ok', r3.ok, r3.detail)

  const overdueAfter = (await prisma.$queryRawUnsafe(
    `SELECT "status"::text AS status FROM "Invoice" WHERE "id"=$1`, overdueInvoiceId
  ))[0]
  log('Invoice status = OVERDUE', overdueAfter?.status === 'OVERDUE', `status=${overdueAfter?.status}`)

  const inboxRows = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "InboxItem"
     WHERE "type"='COLLECTION_ACTION' AND "entityType"='Invoice' AND "entityId"=$1`,
    overdueInvoiceId
  )
  log('onInvoiceOverdue created COLLECTION_ACTION InboxItem', inboxRows.length >= 1)
}

async function testDeliveryCascades() {
  console.log('\n[3] delivery-lifecycle')
  const builderId = await createTestBuilder('D')
  const { id: orderId } = await createTestOrder(builderId, { suffix: 'D', status: 'READY_TO_SHIP' })
  const jobId = await createTestJob(orderId)
  const deliveryId = await createTestDelivery(jobId, 'SCHEDULED')

  // onDeliveryScheduled — should create ScheduleEntry + InboxItem
  const r = await cascades.delivery.onDeliveryScheduled(deliveryId)
  log('onDeliveryScheduled returns ok', r.ok, r.detail)

  const schedRows = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "ScheduleEntry" WHERE "jobId"=$1`, jobId
  )
  log('ScheduleEntry created', schedRows.length >= 1)

  // Idempotent
  const r2 = await cascades.delivery.onDeliveryScheduled(deliveryId)
  const schedAfter = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "ScheduleEntry" WHERE "jobId"=$1`, jobId
  ))[0].n
  log('onDeliveryScheduled is idempotent', schedAfter === schedRows.length, `entries=${schedAfter}`)

  // onDeliveryComplete — should advance Order.status to DELIVERED, create Invoice DRAFT
  const r3 = await cascades.delivery.onDeliveryComplete(deliveryId)
  log('onDeliveryComplete returns ok', r3.ok, r3.detail)

  const orderAfter = (await prisma.$queryRawUnsafe(
    `SELECT "status"::text AS status FROM "Order" WHERE "id"=$1`, orderId
  ))[0]
  log('Order.status advanced to DELIVERED', orderAfter?.status === 'DELIVERED', `status=${orderAfter?.status}`)

  const invRows = await prisma.$queryRawUnsafe(
    `SELECT "id","status"::text AS status FROM "Invoice" WHERE "orderId"=$1`, orderId
  )
  log('Invoice DRAFT created via onOrderDelivered chain',
    invRows.length === 1 && invRows[0]?.status === 'DRAFT',
    `found=${invRows.length} status=${invRows[0]?.status}`)
  if (invRows[0]?.id) createdIds.invoices.push(invRows[0].id)

  // onDeliveryFailed — flip to RESCHEDULED
  const failedDeliveryId = await createTestDelivery(jobId, 'SCHEDULED')
  const r4 = await cascades.delivery.onDeliveryFailed(failedDeliveryId, 'customer not on site')
  log('onDeliveryFailed returns ok', r4.ok, r4.detail)
  const failedAfter = (await prisma.$queryRawUnsafe(
    `SELECT "status"::text AS status FROM "Delivery" WHERE "id"=$1`, failedDeliveryId
  ))[0]
  log('Delivery.status = RESCHEDULED', failedAfter?.status === 'RESCHEDULED', `status=${failedAfter?.status}`)
}

async function testJobCascades() {
  console.log('\n[5] job-lifecycle')
  const builderId = await createTestBuilder('J')
  const { id: orderId } = await createTestOrder(builderId, { suffix: 'J', status: 'CONFIRMED' })
  const jobId = await createTestJob(orderId)

  // CREATED → READINESS_CHECK — allowed
  const r1 = await cascades.job.advanceJobWithGuards(jobId, 'CREATED', 'READINESS_CHECK')
  log('CREATED → READINESS_CHECK transition ok', r1.ok, r1.reason || '')

  // Try invalid transition: READINESS_CHECK → LOADED (not allowed, plus QC gate)
  const r2 = await cascades.job.advanceJobWithGuards(jobId, 'READINESS_CHECK', 'LOADED')
  log('Invalid transition blocked', !r2.ok && r2.blocked === true, `reason=${r2.reason}`)

  // Walk to STAGED
  await prisma.$executeRawUnsafe(
    `UPDATE "Job" SET "status"='IN_PRODUCTION'::"JobStatus", "updatedAt"=NOW() WHERE "id"=$1`, jobId
  )
  const r3 = await cascades.job.advanceJobWithGuards(jobId, 'IN_PRODUCTION', 'STAGED')
  log('IN_PRODUCTION → STAGED ok (non-ship gate)', r3.ok, r3.reason || '')

  // STAGED → LOADED without QC should be blocked
  const r4 = await cascades.job.advanceJobWithGuards(jobId, 'STAGED', 'LOADED')
  log('STAGED → LOADED without QC is blocked', !r4.ok && r4.blocked === true,
    `reason=${r4.reason}`)

  // ADMIN override with reason should pass
  const r5 = await cascades.job.advanceJobWithGuards(
    jobId, 'STAGED', 'LOADED',
    { staffId: 'override-test', staffRole: 'ADMIN', overrideReason: 'test override' }
  )
  log('STAGED → LOADED with ADMIN override succeeds', r5.ok, r5.reason || '')
}

async function testPOCascades() {
  console.log('\n[4] po-lifecycle')
  // Get or create vendor
  const vrows = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Vendor" ORDER BY "createdAt" ASC LIMIT 1`
  )
  let vendorId = vrows[0]?.id
  if (!vendorId) {
    vendorId = `ven_${RUN_ID}`
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Vendor" ("id","name","code","active","createdAt","updatedAt")
       VALUES ($1, $2, $3, true, NOW(), NOW())`,
      vendorId, `TEST-VEN-${RUN_ID}`, `T${RUN_ID.slice(-3).toUpperCase()}`
    )
  }

  const createdById = await getOrCreateStaff()

  // Create PO.
  // NOTE: PurchaseOrder.category is in the Prisma schema but missing from this
  // DB (known drift). We omit it; the DEFAULT 'GENERAL' handled at the app
  // layer isn't applied here, but the cascade tests don't read category.
  const poId = `po_${RUN_ID}`
  const poNumber = `TEST-PO-${RUN_ID}`
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PurchaseOrder" (
        "id","poNumber","vendorId","createdById","status",
        "subtotal","shippingCost","total","createdAt","updatedAt"
     ) VALUES ($1,$2,$3,$4,'DRAFT'::"POStatus",
        500,0,500,NOW(),NOW())`,
    poId, poNumber, vendorId, createdById
  )
  createdIds.purchaseOrders.push(poId)

  // PO item — without a product link for simplicity
  const poItemId = `poi_${RUN_ID}`
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PurchaseOrderItem" (
        "id","purchaseOrderId","vendorSku","description","quantity","unitCost",
        "lineTotal","receivedQty","damagedQty","createdAt","updatedAt"
     ) VALUES ($1,$2,'TEST-SKU','Test line',10,50,500,3,0,NOW(),NOW())`,
    poItemId, poId
  )

  // onPOSent — best-effort email. Skip if no vendor email — cascade handles that.
  const r1 = await cascades.po.onPOSent(poId)
  log('onPOSent returns ok', r1.ok, r1.detail)

  const marker = (await prisma.$queryRawUnsafe(
    `SELECT "notes" FROM "PurchaseOrder" WHERE "id"=$1`, poId
  ))[0]?.notes || ''
  log('PO has CASCADE:PO_SENT_NOTIFIED marker', marker.includes('[CASCADE:PO_SENT_NOTIFIED]'))

  // Idempotent
  const r1b = await cascades.po.onPOSent(poId)
  log('onPOSent is idempotent', r1b.ok && r1b.detail === 'already_sent')

  // onPOPartialReceive — 3 of 10 received, should try to create backorder
  const r2 = await cascades.po.onPOPartialReceive(poId)
  log('onPOPartialReceive returns ok', r2.ok, r2.detail)

  // onPOReceived — no orders in AWAITING_MATERIAL expected, should be no-op ok
  const r3 = await cascades.po.onPOReceived(poId)
  log('onPOReceived returns ok', r3.ok, r3.detail)
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Cascade End-to-End Smoke Test (run ${RUN_ID}) ===`)
  console.log(`Cleanup marker: TEST-CASCADE-${RUN_ID}`)

  let fatalErr = null
  try {
    await testOrderCascades()
    await testInvoiceCascades()
    await testDeliveryCascades()
    await testPOCascades()
    await testJobCascades()
  } catch (e) {
    fatalErr = e
    console.error('\nFATAL during test:', e?.message || e)
  } finally {
    console.log('\nCleaning up test entities...')
    await cleanup()
  }

  const passed = results.filter((r) => r.pass).length
  const failed = results.length - passed
  console.log(`\n=== Summary: ${passed}/${results.length} passed, ${failed} failed ===`)
  if (failed > 0) {
    console.log('\nFailures:')
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`  - ${r.name}${r.note ? ` (${r.note})` : ''}`)
    }
  }
  if (fatalErr) process.exit(1)
  process.exit(failed > 0 ? 1 : 0)
}

main()
  .catch((e) => {
    console.error('UNHANDLED', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
