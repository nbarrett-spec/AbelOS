#!/usr/bin/env node
/**
 * scripts/audit-stripe-payments.mjs
 *
 * Read-only audit of Stripe charges vs. Aegis Payment rows over the last 90
 * days.
 *
 * For every Stripe charge we classify:
 *   MATCHED       Aegis has a Payment row whose `reference` equals the charge
 *                 id (or the associated PaymentIntent / Checkout Session id),
 *                 and the amount agrees within $0.01.
 *   MISSING       Stripe has the charge, Aegis has no Payment row.
 *   MISMATCH      Aegis has a Payment row referencing the charge, but the
 *                 amount disagrees.
 *
 * Separately we look for:
 *   ORPHAN_AEGIS  A Payment row whose `reference` looks like a Stripe id
 *                 (ch_*, pi_*, cs_*) but no matching charge exists on Stripe.
 *
 * The script is strictly read-only: no writes, no side effects, no commits.
 * If STRIPE_SECRET_KEY is missing it still runs an Aegis-side reconnaissance
 * pass so you know whether the Payment table has any Stripe-shaped rows at
 * all — which by itself is a strong signal about whether the webhook path
 * is landing records.
 *
 * Usage:
 *   node scripts/audit-stripe-payments.mjs
 *   node scripts/audit-stripe-payments.mjs --days 30
 *   node scripts/audit-stripe-payments.mjs --verbose
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const DAYS = Number(argValue(args, '--days')) || 90
const VERBOSE = args.includes('--verbose') || args.includes('-v')
const SAMPLE = Number(argValue(args, '--sample')) || 10

function argValue (list, flag) {
  const i = list.indexOf(flag)
  return i >= 0 ? list[i + 1] : null
}

// ── Env load ──────────────────────────────────────────────────────────────
const envPath = join(__dirname, '..', '.env')
let envContent = ''
try { envContent = readFileSync(envPath, 'utf-8') } catch { /* ignore */ }
const envLocal = join(__dirname, '..', '.env.local')
try { envContent += '\n' + readFileSync(envLocal, 'utf-8') } catch { /* ignore */ }

function envVal (key) {
  // Prefer real process.env so CI can override, fall back to .env file scan.
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
  if (!stripeKey) throw new Error('STRIPE_SECRET_KEY not set')
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

// ── Report ────────────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════════════════════════════════╗')
console.log(`║  Stripe Payment Audit — last ${String(DAYS).padEnd(3)} days`.padEnd(75) + '║')
console.log(`║  ${new Date().toISOString()}`.padEnd(75) + '║')
console.log('╚══════════════════════════════════════════════════════════════════════════╝')

// ── 1. Aegis-side survey (always runs) ────────────────────────────────────
divider('1. Aegis Payment table survey')

const cutoff = `NOW() - INTERVAL '${DAYS} days'`

const aegisTotals = await sql.query(`
  SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE method = 'CREDIT_CARD')::int AS credit_card,
    COUNT(*) FILTER (WHERE reference LIKE 'ch_%')::int AS ref_charge,
    COUNT(*) FILTER (WHERE reference LIKE 'pi_%')::int AS ref_pi,
    COUNT(*) FILTER (WHERE reference LIKE 'cs_%')::int AS ref_cs,
    COUNT(*) FILTER (WHERE reference IS NULL)::int AS ref_null,
    MIN("receivedAt")::text AS min_rx,
    MAX("receivedAt")::text AS max_rx
  FROM "Payment"
  WHERE "receivedAt" >= ${cutoff}
`)
const a = aegisTotals[0]
console.log(`Payment rows in window:  ${a.total}`)
console.log(`  method=CREDIT_CARD:    ${a.credit_card}`)
console.log(`  reference ~ ch_*:      ${a.ref_charge}`)
console.log(`  reference ~ pi_*:      ${a.ref_pi}`)
console.log(`  reference ~ cs_*:      ${a.ref_cs}`)
console.log(`  reference NULL:        ${a.ref_null}`)
console.log(`Window:                  ${a.min_rx?.substring(0, 10) || 'n/a'} → ${a.max_rx?.substring(0, 10) || 'n/a'}`)

// Collect all possibly-stripe Aegis rows up front; we will cross-reference
// below (used for both MATCHED checks and ORPHAN_AEGIS detection).
const aegisStripeRows = await sql.query(`
  SELECT id, "invoiceId", amount, method::text AS method, reference,
         "receivedAt"::text AS received_at
  FROM "Payment"
  WHERE "receivedAt" >= ${cutoff}
    AND (
      reference LIKE 'ch_%' OR
      reference LIKE 'pi_%' OR
      reference LIKE 'cs_%' OR
      method = 'CREDIT_CARD'
    )
`)

// ── 2. Webhook-processor inspection (structural risk) ─────────────────────
divider('2. Structural risk check')

// The processStripeEvent function (src/lib/webhooks/stripe-processor.ts)
// updates Invoice.amountPaid but does NOT insert into the Payment table.
// If that's still the case, MATCHED count will be zero even when Stripe is
// working perfectly — every Stripe charge is a "MISSING" finding.
//
// NOTE: The AuditLog schema changed — there is no `staffName` column on the
// live DB; audit rows use `staffId` and `details` JSONB. Stripe-processor.ts
// still writes `staffName`, so those INSERTs silently fail (wrapped in a
// try/catch in the processor). We probe by entity/action + details JSON.
const invUpdates = await sql.query(`
  SELECT COUNT(*)::int AS n
  FROM "AuditLog"
  WHERE "createdAt" >= ${cutoff}
    AND action = 'PAYMENT_RECEIVED'
    AND entity = 'Invoice'
    AND (details->>'stripeSessionId' IS NOT NULL
         OR details->>'stripePaymentIntentId' IS NOT NULL)
`)
console.log(`AuditLog Stripe PAYMENT_RECEIVED rows (detected):   ${invUpdates[0].n}`)
console.log(`Aegis Payment rows with stripe-shaped reference:    ${aegisStripeRows.length}`)
if (invUpdates[0].n > 0 && aegisStripeRows.length === 0) {
  console.log('  → Webhook is firing (invoices updated) but no Payment rows are being written.')
  console.log("  → stripe-processor.ts updates Invoice.amountPaid but never INSERTs Payment.")
}
if (invUpdates[0].n === 0 && aegisStripeRows.length === 0) {
  console.log('  → No Stripe-signal activity detected in AuditLog or Payment table.')
  console.log('  → Either: (a) no Stripe traffic in window, (b) webhook not firing,')
  console.log('    (c) audit INSERT is silently failing (staffName column no longer exists).')
}

// ── 3. Stripe side ────────────────────────────────────────────────────────
divider('3. Stripe charges (last ' + DAYS + ' days)')

if (!stripeKey) {
  console.log('STRIPE_SECRET_KEY is not configured in .env / .env.local.')
  console.log('Skipping live-Stripe phase; Aegis-side reconnaissance above stands.')
  console.log('')
  console.log('To run the full audit, set STRIPE_SECRET_KEY (sk_live_... or sk_test_...)')
  console.log('in .env and rerun this script.')
  summary({
    mode: 'aegis-only',
    aegisStripeRows: aegisStripeRows.length,
    aegisPaymentRows: a.total,
    aegisCreditCard: a.credit_card,
  })
  process.exit(0)
}

const gteSeconds = Math.floor(Date.now() / 1000) - DAYS * 86400
let charges = []
try {
  charges = await stripeList('/charges', { 'created[gte]': String(gteSeconds) })
} catch (e) {
  console.error('Stripe fetch failed:', e.message)
  console.log('Exiting without classification. (No writes attempted.)')
  process.exit(2)
}

console.log(`Stripe charges fetched: ${charges.length}`)
const succeeded = charges.filter(c => c.status === 'succeeded' && !c.refunded)
console.log(`  status=succeeded:     ${succeeded.length}`)
console.log(`  status=failed:        ${charges.filter(c => c.status === 'failed').length}`)
console.log(`  refunded:             ${charges.filter(c => c.refunded).length}`)

if (succeeded.length === 0) {
  console.log('\nNo succeeded Stripe charges in window — nothing to reconcile.')
  summary({
    mode: 'full', matched: 0, missing: 0, mismatch: 0,
    orphan: aegisStripeRows.length,
  })
  process.exit(0)
}

// Build a lookup of Aegis refs → Payment row for fast classification.
const aegisByRef = new Map()
for (const p of aegisStripeRows) {
  if (p.reference) aegisByRef.set(p.reference, p)
}

// ── 4. Classify each charge ──────────────────────────────────────────────
const matched = []
const missing = []
const mismatch = []

for (const c of succeeded) {
  const candidates = [c.id, c.payment_intent, c.metadata?.checkout_session].filter(Boolean)
  let hit = null
  for (const ref of candidates) {
    const row = aegisByRef.get(ref)
    if (row) { hit = { row, matchedRef: ref }; break }
  }

  const stripeAmount = (c.amount ?? 0) / 100  // cents → dollars
  if (!hit) {
    missing.push({ charge: c, amount: stripeAmount })
  } else {
    const aegisAmount = Number(hit.row.amount ?? 0)
    if (Math.abs(aegisAmount - stripeAmount) <= 0.01) {
      matched.push({ charge: c, row: hit.row })
    } else {
      mismatch.push({ charge: c, row: hit.row, stripe: stripeAmount, aegis: aegisAmount })
    }
  }
}

// ── 5. ORPHAN_AEGIS: Aegis rows with Stripe ref not found on Stripe ──────
const stripeRefs = new Set()
for (const c of succeeded) {
  stripeRefs.add(c.id)
  if (c.payment_intent) stripeRefs.add(c.payment_intent)
}
const orphanAegis = aegisStripeRows.filter(
  p => p.reference && /^(ch_|pi_|cs_)/.test(p.reference) && !stripeRefs.has(p.reference)
)

// ── 6. Report ─────────────────────────────────────────────────────────────
divider('4. Classification results')
console.log(`MATCHED:       ${String(matched.length).padStart(5)}   (charge id in Aegis Payment.reference, amounts agree)`)
console.log(`MISSING:       ${String(missing.length).padStart(5)}   (Stripe has it, Aegis has no Payment row)`)
console.log(`MISMATCH:      ${String(mismatch.length).padStart(5)}   (Payment row exists, amounts disagree)`)
console.log(`ORPHAN_AEGIS:  ${String(orphanAegis.length).padStart(5)}   (Aegis Payment.reference looks Stripe, not on Stripe)`)

if (missing.length > 0) {
  divider(`Sample of MISSING (${Math.min(SAMPLE, missing.length)} of ${missing.length})`)
  for (const m of missing.slice(0, SAMPLE)) {
    const c = m.charge
    const rx = new Date(c.created * 1000).toISOString()
    const invoiceNumber = c.metadata?.invoiceNumber || c.metadata?.invoice_number || '—'
    console.log(`  ${c.id}  ${money(m.amount).padStart(12)}  ${rx}  invoice=${invoiceNumber}  desc="${(c.description || '').slice(0, 40)}"`)
  }
}

if (mismatch.length > 0) {
  divider(`Sample of MISMATCH (${Math.min(SAMPLE, mismatch.length)} of ${mismatch.length})`)
  for (const m of mismatch.slice(0, SAMPLE)) {
    console.log(`  ${m.charge.id}  stripe=${money(m.stripe)}  aegis=${money(m.aegis)}  Δ=${money(m.stripe - m.aegis)}`)
  }
}

if (orphanAegis.length > 0) {
  divider(`Sample of ORPHAN_AEGIS (${Math.min(SAMPLE, orphanAegis.length)} of ${orphanAegis.length})`)
  for (const p of orphanAegis.slice(0, SAMPLE)) {
    console.log(`  Payment ${p.id}  ref=${p.reference}  ${money(p.amount)}  received=${p.received_at}`)
  }
}

if (VERBOSE && matched.length > 0) {
  divider(`Sample of MATCHED (${Math.min(SAMPLE, matched.length)} of ${matched.length})`)
  for (const m of matched.slice(0, SAMPLE)) {
    console.log(`  ${m.charge.id}  ${money(m.charge.amount / 100)}  aegis=${m.row.id}`)
  }
}

summary({
  mode: 'full',
  matched: matched.length,
  missing: missing.length,
  mismatch: mismatch.length,
  orphan: orphanAegis.length,
  totalChargesChecked: succeeded.length,
})

// If there are MISSING charges, nudge the operator to use the backfill
// reconciler (dry-run by default).
if (missing.length > 0) {
  console.log('\nNext step: run the dry-run reconciler to preview inserts:')
  console.log('  node scripts/backfill-stripe-payments.mjs')
  console.log('Add --apply only after you have reviewed the dry-run output.')
}

function summary (obj) {
  divider('Summary')
  console.log(JSON.stringify(obj, null, 2))
}
