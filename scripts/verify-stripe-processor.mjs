#!/usr/bin/env node
/**
 * scripts/verify-stripe-processor.mjs
 *
 * End-to-end verification of src/lib/webhooks/stripe-processor.ts.
 *
 * Runs three synthetic Stripe events against the real processor and the real
 * production DB, then cleans up.
 *
 *   1. checkout.session.completed  → Invoice paid, Payment inserted,
 *                                    Order marked PAID, AuditLog row, notify
 *   2. (re-run same session.id)    → idempotent: no duplicate Payment row
 *   3. checkout.session.expired    → Invoice stripeSessionId/PaymentUrl cleared
 *   4. payment_intent.payment_failed → AuditLog row with action=PAYMENT_FAILED
 *
 * The script creates a disposable Builder, Order, and Invoice up front with
 * guard prefixes in every name/ID so we can hard-delete at the end without
 * risking real data. All work is done via direct SQL so nothing depends on
 * Prisma client generation being current.
 *
 * This is the first time the fixed processor has been exercised against the
 * live DB since the staffName-column fix + Payment-INSERT addition landed in
 * src/lib/webhooks/stripe-processor.ts.
 *
 * Usage:
 *   node scripts/verify-stripe-processor.mjs
 *   node scripts/verify-stripe-processor.mjs --keep  (skip cleanup; debug only)
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { randomBytes } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const KEEP = process.argv.includes('--keep')


// ── Env load ──────────────────────────────────────────────────────────────
const envPath = join(__dirname, '..', '.env')
let envContent = ''
try { envContent = readFileSync(envPath, 'utf-8') } catch { /* ignore */ }
const envLocal = join(__dirname, '..', '.env.local')
try { envContent += '\n' + readFileSync(envLocal, 'utf-8') } catch { /* ignore */ }

function envVal (key) {
  if (process.env[key]) return process.env[key]
  const m = envContent.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\n\\r]+)"?`, 'm'))
  return m?.[1] ?? null
}

const dbUrl = envVal('DATABASE_URL')
if (!dbUrl) {
  console.error('ERROR: DATABASE_URL not set')
  process.exit(1)
}
process.env.DATABASE_URL = dbUrl

const { neon } = await import('@neondatabase/serverless')
const sql = neon(dbUrl)

// ── Guarded identifiers ───────────────────────────────────────────────────
const RUN_TAG = 'vrf-' + randomBytes(4).toString('hex')
const BUILDER_ID = RUN_TAG + '-bld'
const ORDER_ID = RUN_TAG + '-ord'
const INVOICE_ID = RUN_TAG + '-inv'
const INVOICE_NUMBER = 'INV-VRF-' + Date.now().toString(36).toUpperCase()
const SESSION_ID = 'cs_test_' + RUN_TAG
const PI_ID = 'pi_test_' + RUN_TAG

const log = (...a) => console.log(...a)
const divider = (t) => { log('\n' + '─'.repeat(74)); if (t) log(t); if (t) log('─'.repeat(74)) }
const PASS = 'PASS'
const FAIL = 'FAIL'

let passes = 0
let fails = 0
function check (label, cond, extra) {
  if (cond) { passes++; log(`  [${PASS}] ${label}`) }
  else { fails++; log(`  [${FAIL}] ${label}${extra ? '  ← ' + extra : ''}`) }
}

// ── Cleanup helper ─ runs in finally ──────────────────────────────────────
async function cleanup () {
  if (KEEP) { log('\n--keep flag set; skipping cleanup. Guarded tag:', RUN_TAG); return }
  try {
    await sql.query(`DELETE FROM "AuditLog" WHERE "entityId" = $1 OR details->>'stripeSessionId' = $2 OR details->>'stripePaymentIntentId' = $3`, [INVOICE_ID, SESSION_ID, PI_ID])
    // notifyPaymentReceived writes to BuilderNotification + EmailQueue (best-effort)
    try { await sql.query(`DELETE FROM "BuilderNotification" WHERE "builderId" = $1`, [BUILDER_ID]) } catch { /* may not exist */ }
    try { await sql.query(`DELETE FROM "EmailQueue" WHERE "toEmail" = $1`, [RUN_TAG + '@vrf.test']) } catch { /* may not exist */ }
    await sql.query(`DELETE FROM "Payment" WHERE "invoiceId" = $1`, [INVOICE_ID])
    await sql.query(`DELETE FROM "Invoice" WHERE id = $1`, [INVOICE_ID])
    await sql.query(`DELETE FROM "Order" WHERE id = $1`, [ORDER_ID])
    await sql.query(`DELETE FROM "Builder" WHERE id = $1`, [BUILDER_ID])
  } catch (e) {
    log('Cleanup error (non-fatal):', e.message)
  }
}

// ── Seed synthetic Builder, Order, Invoice ────────────────────────────────
async function seed () {
  divider('Seeding synthetic data (will be deleted at end)')

  // Builder — explicit column list matching live DB reality.
  await sql.query(
    `INSERT INTO "Builder" (
       id, "companyName", "contactName", email, "passwordHash",
       "paymentTerm", "accountBalance", "taxExempt", status, "emailVerified",
       "createdAt", "updatedAt", role
     ) VALUES (
       $1, $2, $3, $4, $5, 'NET_30', 0, false, 'ACTIVE', false,
       NOW(), NOW(), 'PRIMARY'
     )`,
    [BUILDER_ID, RUN_TAG + ' Verification Co', RUN_TAG + ' Contact', RUN_TAG + '@vrf.test', 'vrf-nohash']
  )

  // Order — explicit columns, enum-valid values.
  await sql.query(
    `INSERT INTO "Order" (
       id, "builderId", "orderNumber", subtotal, "taxAmount", "shippingCost",
       total, "paymentTerm", "paymentStatus", status, "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, $3, 500.0, 0, 0, 500.0, 'NET_30', 'INVOICED', 'DELIVERED', NOW(), NOW()
     )`,
    [ORDER_ID, BUILDER_ID, 'ORD-VRF-' + Date.now().toString(36).toUpperCase()]
  )

  // Invoice — createdById is NOT NULL, use any existing Staff.
  const staffRow = await sql.query(`SELECT id FROM "Staff" LIMIT 1`)
  const staffId = staffRow[0]?.id
  if (!staffId) throw new Error('No Staff row exists; Invoice.createdById requires one')

  await sql.query(
    `INSERT INTO "Invoice" (
       id, "invoiceNumber", "builderId", "orderId", "createdById",
       subtotal, "taxAmount", total, "amountPaid", "balanceDue",
       status, "paymentTerm", "stripeSessionId", "stripePaymentUrl",
       "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, $3, $4, $5, 500.0, 0, 500.0, 0, 500.0,
       'SENT', 'NET_30', $6, $7, NOW(), NOW()
     )`,
    [
      INVOICE_ID, INVOICE_NUMBER, BUILDER_ID, ORDER_ID, staffId,
      SESSION_ID, 'https://checkout.stripe.com/pay/' + SESSION_ID,
    ]
  )

  log(`  Builder  id=${BUILDER_ID}`)
  log(`  Order    id=${ORDER_ID}`)
  log(`  Invoice  id=${INVOICE_ID}  number=${INVOICE_NUMBER}  balanceDue=$500`)
  log(`  session=${SESSION_ID}  pi=${PI_ID}`)
}

// ── Driver: invoke processStripeEvent via tsx in a subprocess ─────────────
// Why a subprocess?
//   • stripe-processor.ts uses the `@/` tsconfig-paths alias.
//   • tsx resolves those paths automatically, but only when it is the loader.
//   • In-process tsx registration triggered Node 24's require(esm)-cycle
//     error when @/lib/prisma was imported transitively.
// Running the driver via `node <tsx-cli> <driver.ts>` keeps the loader in
// the child, avoids the cycle, and keeps the parent in plain .mjs.
//
// We write the driver file (scripts/_verify-stripe-driver.ts) once per run
// and delete it during cleanup. The driver reads the event payload from an
// env var (no arg escaping to worry about across Windows shells).
const DRIVER_PATH = join(__dirname, '_verify-stripe-driver.ts')
const TSX_CLI = join(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs')

async function writeDriverOnce () {
  if (writeDriverOnce._written) return
  const { writeFileSync } = await import('fs')
  const driver = [
    "import { processStripeEvent } from '@/lib/webhooks/stripe-processor'",
    "const ev = JSON.parse(process.env.__VRF_EVENT__ || '{}')",
    "processStripeEvent(ev as any).then(() => {",
    "  console.log('__VRF_OK__')",
    "  process.exit(0)",
    "}).catch((e: any) => {",
    "  console.error('__VRF_ERR__', e?.message || String(e))",
    "  if (e?.stack) console.error(e.stack)",
    "  process.exit(1)",
    "})",
    "",
  ].join('\n')
  writeFileSync(DRIVER_PATH, driver)
  writeDriverOnce._written = true
}

async function runProcessor (event) {
  await writeDriverOnce()
  const { spawn } = await import('child_process')
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [TSX_CLI, DRIVER_PATH],
      {
        cwd: join(__dirname, '..'),
        env: { ...process.env, __VRF_EVENT__: JSON.stringify(event) },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    let out = ''
    let err = ''
    child.stdout.on('data', d => { out += d.toString() })
    child.stderr.on('data', d => { err += d.toString() })
    child.on('close', code => {
      if (code === 0 && out.includes('__VRF_OK__')) resolve({ ok: true, out, err })
      else resolve({ ok: false, err: (err || out).trim(), stack: err, code })
    })
    child.on('error', e => resolve({ ok: false, err: e.message }))
  })
}

async function flushUnlinks () {
  const { unlinkSync } = await import('fs')
  try { unlinkSync(DRIVER_PATH) } catch { /* ignore */ }
}


// ── Test Phase 1: checkout.session.completed ──────────────────────────────
async function phase1_checkoutCompleted () {
  divider('Phase 1 — checkout.session.completed (first fire)')
  const event = {
    id: 'evt_vrf_' + RUN_TAG + '_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: SESSION_ID,
        payment_intent: PI_ID,
        amount_total: 50000, // cents = $500
        payment_status: 'paid',
        metadata: { invoiceId: INVOICE_ID, invoiceNumber: INVOICE_NUMBER, builderId: BUILDER_ID },
      },
    },
  }
  const res = await runProcessor(event)
  if (!res.ok) {
    log('Processor invocation failed:')
    log(res.err)
    if (res.stack) log(res.stack)
    check('processor invocation succeeded', false, res.err)
    return
  }
  check('processor invocation succeeded', true)

  // Invoice paid/balanceDue=0
  const inv = (await sql.query(`SELECT "amountPaid", "balanceDue", status::text, "paidAt" FROM "Invoice" WHERE id = $1`, [INVOICE_ID]))[0]
  check('Invoice.amountPaid = 500', Math.abs(inv.amountPaid - 500) < 0.01, `actual=${inv.amountPaid}`)
  check('Invoice.balanceDue = 0', Math.abs(inv.balanceDue) < 0.01, `actual=${inv.balanceDue}`)
  check('Invoice.status = PAID', inv.status === 'PAID', `actual=${inv.status}`)
  check('Invoice.paidAt set', !!inv.paidAt)

  // Payment row inserted
  const pay = await sql.query(`SELECT id, amount, method::text, reference, status FROM "Payment" WHERE "invoiceId" = $1`, [INVOICE_ID])
  check('Payment row inserted (count=1)', pay.length === 1, `count=${pay.length}`)
  if (pay.length === 1) {
    check('Payment.amount = 500', Math.abs(pay[0].amount - 500) < 0.01, `actual=${pay[0].amount}`)
    check('Payment.method = CREDIT_CARD', pay[0].method === 'CREDIT_CARD', `actual=${pay[0].method}`)
    check('Payment.reference = pi id', pay[0].reference === PI_ID, `actual=${pay[0].reference}`)
    check('Payment.status = RECEIVED', pay[0].status === 'RECEIVED', `actual=${pay[0].status}`)
  }

  // Order paymentStatus = PAID
  const ord = (await sql.query(`SELECT "paymentStatus"::text, "paidAt" FROM "Order" WHERE id = $1`, [ORDER_ID]))[0]
  check('Order.paymentStatus = PAID', ord.paymentStatus === 'PAID', `actual=${ord.paymentStatus}`)
  check('Order.paidAt set', !!ord.paidAt)

  // AuditLog row
  const audit = await sql.query(
    `SELECT id, action, entity, details FROM "AuditLog"
     WHERE action = 'PAYMENT_RECEIVED' AND "entityId" = $1`,
    [INVOICE_ID]
  )
  check('AuditLog PAYMENT_RECEIVED written (count=1)', audit.length === 1, `count=${audit.length}`)
  if (audit.length === 1) {
    const d = audit[0].details
    check('AuditLog.details.stripeSessionId present', d?.stripeSessionId === SESSION_ID, `actual=${d?.stripeSessionId}`)
    check('AuditLog.details.amount correct', Math.abs((d?.amount ?? 0) - 500) < 0.01, `actual=${d?.amount}`)
  }
}

// ── Test Phase 2: idempotent re-run (same session.id) ─────────────────────
async function phase2_idempotency () {
  divider('Phase 2 — checkout.session.completed (replay, idempotency check)')
  const event = {
    id: 'evt_vrf_' + RUN_TAG + '_2',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: SESSION_ID,
        payment_intent: PI_ID,
        amount_total: 50000,
        payment_status: 'paid',
        metadata: { invoiceId: INVOICE_ID, invoiceNumber: INVOICE_NUMBER, builderId: BUILDER_ID },
      },
    },
  }
  const res = await runProcessor(event)
  check('processor replay invocation succeeded', res.ok, res.err)

  // Payment count should still be 1 (not 2)
  const pay = await sql.query(`SELECT COUNT(*)::int AS n FROM "Payment" WHERE "invoiceId" = $1`, [INVOICE_ID])
  check('Payment row NOT duplicated on replay', pay[0].n === 1, `count=${pay[0].n}`)

  // Invoice amountPaid should NOT have gone to $1000 — LEAST(amountPaid+amt,total) caps it.
  const inv = (await sql.query(`SELECT "amountPaid" FROM "Invoice" WHERE id = $1`, [INVOICE_ID]))[0]
  check('Invoice.amountPaid stays at 500 (LEAST cap held)', Math.abs(inv.amountPaid - 500) < 0.01, `actual=${inv.amountPaid}`)
}

// ── Test Phase 3: checkout.session.expired ────────────────────────────────
async function phase3_expired () {
  divider('Phase 3 — checkout.session.expired')
  // First reset invoice back to pre-pay so we can test expired re-clears url
  await sql.query(
    `UPDATE "Invoice" SET "stripeSessionId" = $1, "stripePaymentUrl" = $2 WHERE id = $3`,
    [SESSION_ID, 'https://checkout.stripe.com/pay/' + SESSION_ID, INVOICE_ID]
  )
  const event = {
    id: 'evt_vrf_' + RUN_TAG + '_3',
    type: 'checkout.session.expired',
    data: { object: { id: SESSION_ID, metadata: { invoiceId: INVOICE_ID } } },
  }
  const res = await runProcessor(event)
  check('processor expired invocation succeeded', res.ok, res.err)

  const inv = (await sql.query(`SELECT "stripeSessionId", "stripePaymentUrl" FROM "Invoice" WHERE id = $1`, [INVOICE_ID]))[0]
  check('Invoice.stripeSessionId cleared on expired', inv.stripeSessionId === null, `actual=${inv.stripeSessionId}`)
  check('Invoice.stripePaymentUrl cleared on expired', inv.stripePaymentUrl === null, `actual=${inv.stripePaymentUrl}`)
}

// ── Test Phase 4: payment_intent.payment_failed ───────────────────────────
async function phase4_paymentFailed () {
  divider('Phase 4 — payment_intent.payment_failed')
  const event = {
    id: 'evt_vrf_' + RUN_TAG + '_4',
    type: 'payment_intent.payment_failed',
    data: {
      object: {
        id: PI_ID,
        metadata: { invoiceId: INVOICE_ID },
        last_payment_error: { message: 'Your card was declined (synthetic).' },
      },
    },
  }
  const res = await runProcessor(event)
  check('processor failed-pi invocation succeeded', res.ok, res.err)

  const audit = await sql.query(
    `SELECT details FROM "AuditLog"
     WHERE action = 'PAYMENT_FAILED' AND "entityId" = $1`,
    [INVOICE_ID]
  )
  check('AuditLog PAYMENT_FAILED written (count=1)', audit.length === 1, `count=${audit.length}`)
  if (audit.length === 1) {
    check('AuditLog.details.stripePaymentIntentId present', audit[0].details?.stripePaymentIntentId === PI_ID)
    check('AuditLog.details.error captured', !!audit[0].details?.error)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
;(async () => {
  log('╔══════════════════════════════════════════════════════════════════════════╗')
  log('║  Stripe processor end-to-end verification (synthetic)'.padEnd(75) + '║')
  log('║  run tag: ' + RUN_TAG.padEnd(64) + '║')
  log('╚══════════════════════════════════════════════════════════════════════════╝')

  try {
    await seed()
    await phase1_checkoutCompleted()
    await phase2_idempotency()
    await phase3_expired()
    await phase4_paymentFailed()
  } catch (e) {
    log('Fatal error during verification:', e.message)
    log(e.stack)
    fails++
  } finally {
    await cleanup()
  }

  await flushUnlinks()

  divider('Summary')
  log(`PASS: ${passes}`)
  log(`FAIL: ${fails}`)
  if (fails > 0) process.exit(1)
})()
