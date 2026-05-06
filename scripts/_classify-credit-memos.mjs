#!/usr/bin/env node
/**
 * _classify-credit-memos.mjs
 *
 * SCAN-A2-DATA-INTEGRITY-DEEP F3 remediation — additive only.
 *
 * Background
 *   585 invoices imported from QB / InFlow with `total < 0` are misclassified
 *   as `status = PAID`. These are credit memos / refund artifacts, not real
 *   AR. They will (a) crash Stripe payment-link generation (`amount < 0`),
 *   (b) push as negative invoices into QB and corrupt the AR sub-ledger,
 *   and (c) hide ~$67K in credits in builder statements.
 *
 * Why this is "Option B" (notes-tag) rather than schema change
 *   `prisma/schema.prisma` `model Invoice` (read-only for W1) has NO
 *   `type` / `kind` enum, NO `meta JSON`, NO `tags` field. The only free-form
 *   carrier is `notes String?`. The `InvoiceStatus` enum has no CREDITED
 *   sentinel either. Per W1's brief, schema mods belong to W2; this script
 *   stays additive by tagging via the existing `notes` column with a fixed
 *   sentinel prefix `[CREDIT_MEMO]` so downstream filters (Stripe link gen,
 *   QB sync, AR aging, ops UI) can detect and exclude them with a simple
 *   `notes ILIKE '[CREDIT_MEMO]%'` predicate today, and trivially migrate
 *   to a real `type` column when W2 ships it.
 *
 * Scope of changes
 *   - Inventory phase: read-only counts + 10-row sample.
 *   - Classification phase (`--apply` only):
 *       UPDATE "Invoice"
 *          SET "notes" = '[CREDIT_MEMO] ' || COALESCE("notes", '')
 *        WHERE "total" < 0
 *          AND ("notes" IS NULL OR "notes" NOT ILIKE '[CREDIT_MEMO]%');
 *     Idempotent — re-runs are no-ops because the `NOT ILIKE` guard skips
 *     rows already tagged.
 *   - DOES NOT modify `total` (negatives stay accurate for accounting).
 *   - DOES NOT delete invoices.
 *   - DOES NOT alter `status` — the `InvoiceStatus` enum has no CREDITED
 *     value, and re-using PAID/VOID would be wrong. Status mutation is
 *     deferred until the schema gains a `type` column (W2).
 *
 * Usage (dry-run by default — DOES NOT auto-run on prod):
 *   node scripts/_classify-credit-memos.mjs            # inventory only
 *   node scripts/_classify-credit-memos.mjs --apply    # tags rows
 *
 * Requires DATABASE_URL.
 */

import { PrismaClient } from '@prisma/client'

const APPLY = process.argv.includes('--apply')
const TAG = '[CREDIT_MEMO]'

const prisma = new PrismaClient()

async function inventory(label) {
  const totalRow = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n,
           COALESCE(SUM("total"), 0)::float AS sum_total
      FROM "Invoice"
     WHERE "total" < 0
  `)
  const total = totalRow[0]?.n ?? 0
  const sumTotal = totalRow[0]?.sum_total ?? 0

  const byStatus = await prisma.$queryRawUnsafe(`
    SELECT "status"::text AS status,
           COUNT(*)::int  AS n,
           COALESCE(SUM("total"), 0)::float AS sum_total
      FROM "Invoice"
     WHERE "total" < 0
     GROUP BY "status"
     ORDER BY n DESC
  `)

  const taggedRow = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n
      FROM "Invoice"
     WHERE "total" < 0
       AND "notes" ILIKE '${TAG}%'
  `)
  const tagged = taggedRow[0]?.n ?? 0

  console.log(`\n[classify-credit-memos] ── ${label} ──`)
  console.log(`  invoices with total < 0:     ${total}`)
  console.log(`  sum(total) of those:         $${sumTotal.toFixed(2)}`)
  console.log(`  already tagged ${TAG}: ${tagged}`)
  console.log(`  remaining to tag:            ${total - tagged}`)
  console.log(`  by status:`)
  for (const row of byStatus) {
    console.log(
      `    ${row.status.padEnd(16)} n=${String(row.n).padStart(4)}  sum=$${row.sum_total.toFixed(2)}`,
    )
  }

  return { total, tagged, remaining: total - tagged }
}

async function sample() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT "id", "invoiceNumber", "status"::text AS status,
           "total", "amountPaid", "balanceDue", "notes"
      FROM "Invoice"
     WHERE "total" < 0
     ORDER BY "createdAt" DESC
     LIMIT 10
  `)
  console.log(`\n[classify-credit-memos] sample (10 latest negative-total invoices):`)
  for (const r of rows) {
    const noteSnip = (r.notes ?? '').slice(0, 60).replace(/\s+/g, ' ')
    console.log(
      `  ${r.invoiceNumber.padEnd(18)} status=${r.status.padEnd(14)} total=${String(r.total).padStart(10)}  notes="${noteSnip}"`,
    )
  }
}

async function classify() {
  // Idempotent: only tag rows where the sentinel is not already present.
  const updated = await prisma.$executeRawUnsafe(`
    UPDATE "Invoice"
       SET "notes"     = '${TAG} ' || COALESCE("notes", ''),
           "updatedAt" = NOW()
     WHERE "total" < 0
       AND ("notes" IS NULL OR "notes" NOT ILIKE '${TAG}%')
  `)
  console.log(`\n[classify-credit-memos] tagged rows: ${updated}`)
  return updated
}

async function main() {
  console.log(`[classify-credit-memos] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`)

  const before = await inventory('BEFORE')
  await sample()

  if (!APPLY) {
    console.log(
      `\n[classify-credit-memos] DRY-RUN complete. Re-run with --apply to tag ${before.remaining} row(s).`,
    )
    return
  }

  if (before.remaining === 0) {
    console.log(
      `\n[classify-credit-memos] nothing to do — all negative-total invoices already tagged.`,
    )
    return
  }

  const updated = await classify()
  await inventory('AFTER')

  if (updated !== before.remaining) {
    console.warn(
      `[classify-credit-memos] WARN: expected to update ${before.remaining}, actually updated ${updated}.`,
    )
    process.exitCode = 2
  }
}

main()
  .catch((err) => {
    console.error('[classify-credit-memos] FAILED:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
