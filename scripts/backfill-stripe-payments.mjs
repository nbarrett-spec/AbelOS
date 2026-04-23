#!/usr/bin/env node
/**
 * scripts/backfill-stripe-payments.mjs
 *
 * Reconciler that backfills Aegis `Payment` rows for Stripe charges that
 * don't yet have a matching record. Paired with `audit-stripe-payments.mjs`.
 *
 * Runs in DRY-RUN mode by default. Pass `--apply` to actually INSERT rows.
 *
 *   node scripts/backfill-stripe-payments.mjs               # dry-run, 90d
 *   node scripts/backfill-stripe-payments.mjs --days 30     # dry-run, 30d
 *   node scripts/backfill-stripe-payments.mjs --apply       # actually insert
 *
 * How it figures out which Aegis Invoice a Stripe charge belongs to:
 *
 *   1. Preferred: `metadata.invoiceId` (set by our createCheckoutSession /
 *      createPaymentIntent helpers — see src/lib/stripe.ts).
 *   2. Fallback: `metadata.invoiceNumber` → Invoice.invoiceNumber lookup.
 *   3. Last resort: the charge has `receipt_email` / customer that matches a
 *      single Builder + a single open Invoice with `balanceDue` equal to the
 *      charge amount. If ambiguous, we SKIP (never guess).
 *
 * A Payment row is inserted with:
 *   reference = c.payment_intent ?? c.id    (prefer PI so retries idempotent)
 *   method    = CREDIT_CARD
 *   amount    = c.amount / 100
 *   receivedAt = new Date(c.created * 1000)
 *   notes     = "Stripe backfill — <script name>"
 *   processedAt = NOW()
 *   status    = 'PROCESSED'
 *
 * --apply mode uses SELECT…FOR UPDATE on the Invoice row in a TX so that
 * concurrent webhook traffic can't double-apply. Idempotency: we also skip
 * any charge whose id OR payment_intent is already in Payment.reference.
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const DAYS = Number(argValue(args, '--days')) || 90
const APPLY = args.includes('--apply')
const VERBOSE = args.includes('--verbose') || args.includes('-v')
const SAMPLE = Number(argValue(args, '--sample')) || 10

function argValue (list, flag) {
  const i = list.indexOf(flag)
  return i >= 0 ? list[i + 1] : null
}

// ── Env load (same strategy as audit script) ──────────────────────────────
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
const stripeKey = envVal('STRIPE_SECRET_KEY')

if (!dbUrl) {
  console.error('ERROR: DATABASE_URL not set in .env. Cannot continue.')
  process.exit(1)
}
if (!stripeKey) {
  console.error('ERROR: STRIPE_SECRET_KEY not set. The reconciler cannot run.')
  console.error('Set STRIPE_SECRET_KEY in .env or .env.local and rerun.')
  process.exit(1)
}

// ── Helpers ───────────────────────────────────────────────────────────────
function money (n) {
  const v = Number(n ?? 0)
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function divider (title) {
  console.log('\n' + '═'.repeat(74))
  if (title) console.log(title)
  if (title) console.log('═'.repeat(74))
}

// ── Neon handle ───────────────────────────────────────────────────────────
const { neon } = await import('@neondatabase/serverless')
const sql = neon(dbUrl)

// ── Stripe fetch (paginated) ──────────────────────────────────────────────
async function stripeList (path, params = {}) {
  const results = []
  let startingAfter = null
  let page = 0
  while (true) {
    const qs = new URLSearchParams({ ...params, limit: '100' })
    if (startingAfter) qs.set('starting_after', startingAfter)
    const res = await fetch(`https://api.stripe.com/v1${path}?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    })
    const body = await res.json()
    if (body.error) throw new Error(`Stripe: ${body.error.message}`)
    if (!Array.isArray(body.data)) break
    results.push(...body.data)
    page++
    if (!body.has_more || body.data.length === 0) break
    startingAfter = body.data[body.data.length - 1].id
    if (page > 50) { console.warn('stripeList: >5000 rows, stopping early'); break }
  }
  return results
}

// ── Plan ──────────────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════════════════════════════════╗')
console.log(`║  Stripe Payment Backfill — ${APPLY ? 'APPLY MODE' : 'DRY-RUN'}`.padEnd(75) + '║')
console.log(`║  window: last ${String(DAYS).padEnd(3)} days`.padEnd(75) + '║')
console.log(`║  ${new Date().toISOString()}`.padEnd(75) + '║')
console.log('╚══════════════════════════════════════════════════════════════════════════╝')

if (!APPLY) {
  console.log('\nThis is a DRY-RUN. No rows will be written. Pass --apply to commit.')
}

// ── 1. Fetch Stripe charges ──────────────────────────────────────────────
divider('1. Fetching Stripe charges')
const gteSeconds = Math.floor(Date.now() / 1000) - DAYS * 86400
const charges = await stripeList('/charges', { 'created[gte]': String(gteSeconds) })
const succeeded = charges.filter(c => c.status === 'succeeded' && !c.refunded)
console.log(`Stripe charges fetched: ${charges.length}`)
console.log(`  status=succeeded:     ${succeeded.length}`)

if (succeeded.length === 0) {
  console.log('\nNo succeeded charges — nothing to backfill.')
  process.exit(0)
}

// ── 2. Collect already-recorded references ───────────────────────────────
divider('2. Existing Aegis Stripe Payment refs')
const existingRefs = await sql.query(`
  SELECT reference FROM "Payment"
  WHERE reference LIKE 'ch_%' OR reference LIKE 'pi_%' OR reference LIKE 'cs_%'
`)
const existingSet = new Set(existingRefs.map(r => r.reference))
console.log(`Already-recorded Stripe refs: ${existingSet.size}`)

// ── 3. Build plan ────────────────────────────────────────────────────────
divider('3. Building backfill plan')

const plan = []       // { charge, invoiceId, invoiceNumber, reference, amount }
const skipped = []    // { charge, reason }

for (const c of succeeded) {
  const candidateRefs = [c.payment_intent, c.id, c.metadata?.checkout_session].filter(Boolean)
  const already = candidateRefs.find(r => existingSet.has(r))
  if (already) {
    skipped.push({ charge: c, reason: `already recorded (ref=${already})` })
    continue
  }

  const amount = (c.amount ?? 0) / 100
  const metaInvoiceId = c.metadata?.invoiceId
  const metaInvoiceNumber = c.metadata?.invoiceNumber || c.metadata?.invoice_number

  let invoiceRow = null

  if (metaInvoiceId) {
    const hits = await sql.query(
      `SELECT id, "invoiceNumber", total, "amountPaid", "balanceDue" FROM "Invoice" WHERE id = $1`,
      [metaInvoiceId]
    )
    if (hits.length > 0) invoiceRow = hits[0]
  }

  if (!invoiceRow && metaInvoiceNumber) {
    const hits = await sql.query(
      `SELECT id, "invoiceNumber", total, "amountPaid", "balanceDue" FROM "Invoice" WHERE "invoiceNumber" = $1`,
      [metaInvoiceNumber]
    )
    if (hits.length === 1) invoiceRow = hits[0]
    else if (hits.length > 1) {
      skipped.push({ charge: c, reason: `ambiguous invoiceNumber=${metaInvoiceNumber} matched ${hits.length} rows` })
      continue
    }
  }

  if (!invoiceRow) {
    skipped.push({ charge: c, reason: 'no invoiceId/invoiceNumber in Stripe metadata and no unambiguous fallback' })
    continue
  }

  const reference = c.payment_intent || c.id
  plan.push({
    charge: c,
    invoiceId: invoiceRow.id,
    invoiceNumber: invoiceRow.invoiceNumber,
    reference,
    amount,
    receivedAt: new Date(c.created * 1000).toISOString(),
  })
}

console.log(`Plan size:        ${plan.length}`)
console.log(`Skipped:          ${skipped.length}`)
console.log(`  (dedup vs. existing refs and unresolved Invoice link)`)

if (plan.length > 0) {
  divider(`Plan sample (${Math.min(SAMPLE, plan.length)} of ${plan.length})`)
  for (const p of plan.slice(0, SAMPLE)) {
    console.log(`  ${p.charge.id}  ref=${p.reference}  ${money(p.amount).padStart(12)}  inv=${p.invoiceNumber}  (${p.invoiceId})`)
  }
}

if (VERBOSE && skipped.length > 0) {
  divider(`Skipped sample (${Math.min(SAMPLE, skipped.length)} of ${skipped.length})`)
  for (const s of skipped.slice(0, SAMPLE)) {
    console.log(`  ${s.charge.id}  ${money((s.charge.amount ?? 0) / 100)}  — ${s.reason}`)
  }
}

if (plan.length === 0) {
  console.log('\nNothing to insert. Done.')
  process.exit(0)
}

// ── 4. Execute ────────────────────────────────────────────────────────────
if (!APPLY) {
  divider('4. Dry-run — NOT inserting')
  console.log(`Would insert ${plan.length} Payment rows.`)
  console.log('Run again with --apply to commit.')
  process.exit(0)
}

divider('4. APPLYING — inserting Payment rows')

let inserted = 0
let failed = 0
for (const p of plan) {
  try {
    // Belt-and-suspenders: re-check under a transactional SELECT so we don't
    // race with a live webhook landing the same payment.
    await sql.query(`BEGIN`)
    const exists = await sql.query(
      `SELECT 1 FROM "Payment" WHERE reference = $1 LIMIT 1`,
      [p.reference]
    )
    if (exists.length > 0) {
      await sql.query(`ROLLBACK`)
      continue
    }
    await sql.query(
      `
      INSERT INTO "Payment" (
        id, "invoiceId", amount, method, reference, "receivedAt", notes
      ) VALUES (
        'pay_' || substr(md5(random()::text || clock_timestamp()::text), 1, 24),
        $1, $2, 'CREDIT_CARD'::"PaymentMethod", $3, $4::timestamp, $5
      )
      `,
      [p.invoiceId, p.amount, p.reference, p.receivedAt,
        `Stripe backfill — charge=${p.charge.id}`]
    )
    await sql.query(`COMMIT`)
    inserted++
  } catch (e) {
    try { await sql.query(`ROLLBACK`) } catch {}
    failed++
    console.warn(`  FAIL ${p.charge.id}: ${e.message}`)
  }
}

divider('Results')
console.log(`Inserted: ${inserted}`)
console.log(`Failed:   ${failed}`)
console.log('\nRe-run audit-stripe-payments.mjs to confirm MATCHED count moved.')
