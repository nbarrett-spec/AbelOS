#!/usr/bin/env node
/**
 * scripts/verify-delivery-invoice-cascade.mjs
 *
 * Focused verifier for the auto-invoice-on-delivery cascade.
 *
 * Flow under test:
 *   onDeliveryComplete(deliveryId)
 *     → onOrderDelivered(orderId)
 *       → INSERT INTO "Invoice" (status = DRAFT, dueDate = computed from paymentTerm)
 *
 * Scenarios:
 *   1. Standard path — NET_15 builder with autoInvoiceOnDelivery = true.
 *      Expect: Invoice DRAFT exists, dueDate ≈ now + 15 days, total matches
 *      Order.total.
 *   2. Opt-out path — Builder.autoInvoiceOnDelivery = false.
 *      Expect: cascade returns skipped_auto_invoice_disabled, no Invoice row.
 *   3. Idempotency — calling onDeliveryComplete twice creates at most one
 *      Invoice.
 *
 * All test entities are prefixed VERIFY-DEL-CASCADE-<run-id> and cleaned up
 * in the `finally` block. Exit code 0 = every assertion passed.
 *
 * Run with tsx so the .ts cascade modules resolve:
 *   npx tsx scripts/verify-delivery-invoice-cascade.mjs
 */

import { PrismaClient } from '@prisma/client'

let cascades
try {
  const [order, delivery] = await Promise.all([
    import('../src/lib/cascades/order-lifecycle.ts'),
    import('../src/lib/cascades/delivery-lifecycle.ts'),
  ])
  cascades = { order, delivery }
} catch (e) {
  console.error(
    '\nFailed to import cascade modules. Run via tsx:\n' +
    '  npx tsx scripts/verify-delivery-invoice-cascade.mjs\n'
  )
  console.error('Underlying error:', e?.message || e)
  process.exit(1)
}

const prisma = new PrismaClient()

const RUN_ID = `VDC${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const results = []
const created = {
  builders: [],
  orders: [],
  jobs: [],
  invoices: [],
  deliveries: [],
  staff: [],
}

function step(name, pass, note = '') {
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
     VALUES ($1, $2, 'Verify', 'Tester', 'ADMIN', 'EXECUTIVE', true, NOW(), NOW())`,
    id, `verify.cascade.${RUN_ID}@local`
  )
  created.staff.push(id)
  return id
}

async function makeBuilder({ autoInvoice = true, suffix = '' }) {
  const id = `bldr_${RUN_ID}${suffix}`
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Builder" (
       "id","companyName","contactName","email","passwordHash","phone",
       "paymentTerm","status","autoInvoiceOnDelivery","createdAt","updatedAt"
     ) VALUES ($1,$2,$3,$4,$5,$6,'NET_15'::"PaymentTerm",'ACTIVE'::"AccountStatus",$7,NOW(),NOW())`,
    id,
    `VERIFY-DEL-CASCADE-${RUN_ID}${suffix}`,
    'Verify Contact',
    `verify.${RUN_ID}${suffix}@local.test`,
    'not-a-real-hash',
    '555-000-0000',
    autoInvoice
  )
  created.builders.push(id)
  return id
}

async function makeOrder(builderId, suffix = '') {
  const id = `ord_${RUN_ID}${suffix}`
  const total = 1080
  const subtotal = 1000
  const taxAmount = 80
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Order" (
       "id","builderId","orderNumber","subtotal","taxAmount","total",
       "paymentTerm","paymentStatus","status","createdAt","updatedAt"
     ) VALUES ($1,$2,$3,$4,$5,$6,
               'NET_15'::"PaymentTerm",'PENDING'::"PaymentStatus",
               'READY_TO_SHIP'::"OrderStatus",NOW(),NOW())`,
    id, builderId, `VERIFY-ORD-${RUN_ID}${suffix}`, subtotal, taxAmount, total
  )
  created.orders.push(id)
  return { id, total, subtotal, taxAmount }
}

async function makeJob(orderId) {
  const id = `job_${RUN_ID}_${Math.random().toString(36).slice(2, 6)}`
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Job" (
       "id","jobNumber","orderId","builderName","scopeType","status",
       "createdAt","updatedAt"
     ) VALUES ($1,$2,$3,'VERIFY Builder','DOORS_AND_TRIM'::"ScopeType",'CREATED'::"JobStatus",NOW(),NOW())`,
    id, `VERIFY-JOB-${RUN_ID}-${Math.random().toString(36).slice(2, 6)}`, orderId
  )
  created.jobs.push(id)
  return id
}

async function makeDelivery(jobId) {
  const id = `del_${RUN_ID}_${Math.random().toString(36).slice(2, 6)}`
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Delivery" (
       "id","jobId","deliveryNumber","routeOrder","address","status",
       "createdAt","updatedAt"
     ) VALUES ($1,$2,$3,0,'100 Verify Lane','SCHEDULED'::"DeliveryStatus",NOW(),NOW())`,
    id, jobId, `VERIFY-DEL-${RUN_ID}-${Math.random().toString(36).slice(2, 6)}`
  )
  created.deliveries.push(id)
  return id
}

async function cleanup() {
  // Delete children before parents.
  for (const id of created.deliveries) {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "DeliveryTracking" WHERE "deliveryId"=$1`, id)
      await prisma.$executeRawUnsafe(`DELETE FROM "Delivery" WHERE "id"=$1`, id)
    } catch {}
  }
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "ScheduleEntry" WHERE "title" ILIKE $1`,
      `%VERIFY-DEL-${RUN_ID}%`
    )
  } catch {}
  for (const id of created.invoices) {
    try { await prisma.$executeRawUnsafe(`DELETE FROM "Invoice" WHERE "id"=$1`, id) } catch {}
  }
  for (const id of created.jobs) {
    try { await prisma.$executeRawUnsafe(`DELETE FROM "Job" WHERE "id"=$1`, id) } catch {}
  }
  for (const id of created.orders) {
    try { await prisma.$executeRawUnsafe(`DELETE FROM "Order" WHERE "id"=$1`, id) } catch {}
  }
  for (const id of created.builders) {
    try { await prisma.$executeRawUnsafe(`DELETE FROM "Builder" WHERE "id"=$1`, id) } catch {}
  }
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "InboxItem"
       WHERE ("title" ILIKE $1 OR "description" ILIKE $1)
         AND "createdAt" > NOW() - INTERVAL '1 hour'`,
      `%${RUN_ID}%`
    )
  } catch {}
  for (const id of created.staff) {
    try { await prisma.$executeRawUnsafe(`DELETE FROM "Staff" WHERE "id"=$1`, id) } catch {}
  }
}

async function scenarioStandardPath() {
  console.log('\n[Scenario 1] autoInvoiceOnDelivery = true (standard path)')
  const builderId = await makeBuilder({ autoInvoice: true, suffix: 'A' })
  const { id: orderId, total, subtotal, taxAmount } = await makeOrder(builderId, 'A')
  const jobId = await makeJob(orderId)
  const deliveryId = await makeDelivery(jobId)

  // Simulate what the driver portal does inline before calling the cascade:
  // mark the Delivery complete in-DB, then call onDeliveryComplete.
  // Note: DeliveryStatus enum terminal value is COMPLETE (not DELIVERED).
  await prisma.$executeRawUnsafe(
    `UPDATE "Delivery" SET "status"='COMPLETE'::"DeliveryStatus", "completedAt"=NOW(), "updatedAt"=NOW() WHERE "id"=$1`,
    deliveryId
  )

  const before = Date.now()
  const res = await cascades.delivery.onDeliveryComplete(deliveryId)
  step('onDeliveryComplete returns ok', res.ok, res.detail)

  // Order should have flipped to DELIVERED.
  const ord = (await prisma.$queryRawUnsafe(
    `SELECT "status"::text AS status, "paymentStatus"::text AS ps, "dueDate"
     FROM "Order" WHERE "id"=$1`, orderId
  ))[0]
  step('Order.status = DELIVERED', ord?.status === 'DELIVERED', `status=${ord?.status}`)
  step('Order.paymentStatus = INVOICED', ord?.ps === 'INVOICED', `ps=${ord?.ps}`)

  // Invoice should exist and be DRAFT.
  const invs = await prisma.$queryRawUnsafe(
    `SELECT "id","status"::text AS status,"total","subtotal","taxAmount",
            "balanceDue","amountPaid","dueDate","paymentTerm"::text AS "paymentTerm"
     FROM "Invoice" WHERE "orderId"=$1`, orderId
  )
  step('Exactly one Invoice row created', invs.length === 1, `count=${invs.length}`)
  if (invs[0]?.id) created.invoices.push(invs[0].id)

  const inv = invs[0]
  step('Invoice.status = DRAFT', inv?.status === 'DRAFT', `status=${inv?.status}`)
  step('Invoice.total matches Order.total',
    Number(inv?.total) === total, `inv.total=${inv?.total} ord.total=${total}`)
  step('Invoice.subtotal matches Order.subtotal',
    Number(inv?.subtotal) === subtotal, `inv.subtotal=${inv?.subtotal}`)
  step('Invoice.taxAmount matches Order.taxAmount',
    Number(inv?.taxAmount) === taxAmount, `inv.taxAmount=${inv?.taxAmount}`)
  step('Invoice.amountPaid = 0',
    Number(inv?.amountPaid) === 0, `amountPaid=${inv?.amountPaid}`)
  step('Invoice.balanceDue = total',
    Number(inv?.balanceDue) === total, `balanceDue=${inv?.balanceDue}`)
  step('Invoice.paymentTerm inherited from Order (NET_15)',
    inv?.paymentTerm === 'NET_15', `paymentTerm=${inv?.paymentTerm}`)

  // dueDate should be ~15 days out from when the cascade fired.
  const due = new Date(inv?.dueDate).getTime()
  const expected = before + 15 * 86400 * 1000
  // Allow ±1 day tolerance to tolerate DB clock drift / time-of-day wrap.
  const tolerance = 86400 * 1000
  const diff = Math.abs(due - expected)
  step('Invoice.dueDate ≈ order delivery + 15 days (NET_15)',
    diff <= tolerance, `diff=${Math.round(diff / 1000)}s`)

  // Idempotency: run twice, invoice count must stay at 1.
  const res2 = await cascades.delivery.onDeliveryComplete(deliveryId)
  step('onDeliveryComplete second call returns ok', res2.ok, res2.detail)
  const count = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Invoice" WHERE "orderId"=$1`, orderId
  ))[0].n
  step('Still exactly one Invoice after second call (idempotent)', count === 1, `count=${count}`)
}

async function scenarioOptOut() {
  console.log('\n[Scenario 2] autoInvoiceOnDelivery = false (opt-out)')
  const builderId = await makeBuilder({ autoInvoice: false, suffix: 'B' })
  const { id: orderId } = await makeOrder(builderId, 'B')
  const jobId = await makeJob(orderId)
  const deliveryId = await makeDelivery(jobId)

  await prisma.$executeRawUnsafe(
    `UPDATE "Delivery" SET "status"='COMPLETE'::"DeliveryStatus", "completedAt"=NOW(), "updatedAt"=NOW() WHERE "id"=$1`,
    deliveryId
  )

  const res = await cascades.delivery.onDeliveryComplete(deliveryId)
  step('onDeliveryComplete returns ok (opt-out)', res.ok, res.detail)

  // Order.status still advances to DELIVERED — that's orthogonal to invoicing.
  const ord = (await prisma.$queryRawUnsafe(
    `SELECT "status"::text AS status FROM "Order" WHERE "id"=$1`, orderId
  ))[0]
  step('Order.status = DELIVERED (still advances on opt-out)',
    ord?.status === 'DELIVERED', `status=${ord?.status}`)

  // But no Invoice should have been created.
  const count = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Invoice" WHERE "orderId"=$1`, orderId
  ))[0].n
  step('No Invoice created when toggle is off', count === 0, `count=${count}`)

  // Directly verify the skip signal from onOrderDelivered for clarity.
  const direct = await cascades.order.onOrderDelivered(orderId)
  step('onOrderDelivered returns skipped_auto_invoice_disabled',
    direct.ok && direct.detail === 'skipped_auto_invoice_disabled',
    `detail=${direct.detail}`)
}

async function main() {
  console.log(`\nRun ID: ${RUN_ID}`)
  try {
    await getOrCreateStaff() // ensure there's at least one Staff for createdById

    await scenarioStandardPath()
    await scenarioOptOut()

    const passed = results.filter(r => r.pass).length
    const failed = results.filter(r => !r.pass)
    console.log(`\n── Summary ───────────────`)
    console.log(`  ${passed}/${results.length} checks passed`)
    if (failed.length > 0) {
      console.log('  Failures:')
      failed.forEach(f => console.log(`    - ${f.name}${f.note ? ` — ${f.note}` : ''}`))
    }
    return failed.length === 0 ? 0 : 1
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
}

main()
  .then(code => process.exit(code))
  .catch(e => {
    console.error('\nFATAL:', e?.stack || e)
    process.exit(1)
  })
