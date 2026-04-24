#!/usr/bin/env node
/**
 * _backfill-invoice-issuedat.mjs
 *
 * Audit AUDIT-DATA-REPORT.md (HEAD 6169e25, 2026-04-24) flagged
 * `Invoice.issuedAt` and `Payment.receivedAt` stale since 2026-03-23
 * because writers were transitioning DRAFT → SENT/PAID without stamping
 * the issuedAt timestamp. Source-side fixes shipped in companion commit;
 * this script backfills the existing rows.
 *
 * Idempotent — safe to re-run, only touches rows where the target column
 * is still NULL. Run-once on prod after review.
 *
 * Usage (dry-run by default):
 *   node scripts/_backfill-invoice-issuedat.mjs            # prints counts
 *   node scripts/_backfill-invoice-issuedat.mjs --apply    # executes
 *
 * Requires DATABASE_URL set in env. DOES NOT auto-run on prod.
 */

import { PrismaClient } from '@prisma/client'

const APPLY = process.argv.includes('--apply')

const prisma = new PrismaClient()

async function main() {
  console.log(`[backfill-issuedat] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`)

  // ── Invoice.issuedAt ────────────────────────────────────────────────
  // DRAFT and VOID invoices legitimately have no issuedAt — exclude them.
  // Everything else (ISSUED, SENT, PARTIALLY_PAID, PAID, OVERDUE, WRITE_OFF)
  // should have an issuedAt; backfill from createdAt where missing.
  const invCountRow = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n
    FROM "Invoice"
    WHERE "issuedAt" IS NULL
      AND "status"::text NOT IN ('DRAFT', 'VOID')
  `)
  const invCount = invCountRow[0]?.n ?? 0
  console.log(`[backfill-issuedat] Invoice rows to backfill: ${invCount}`)

  if (APPLY && invCount > 0) {
    const r = await prisma.$executeRawUnsafe(`
      UPDATE "Invoice"
         SET "issuedAt" = "createdAt",
             "updatedAt" = NOW()
       WHERE "issuedAt" IS NULL
         AND "status"::text NOT IN ('DRAFT', 'VOID')
    `)
    console.log(`[backfill-issuedat] Invoice rows updated: ${r}`)
  }

  // ── Payment.receivedAt ──────────────────────────────────────────────
  // Every Payment row should have a receivedAt. If any are NULL we treat
  // the createdAt as the canonical received time.
  const payCountRow = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n
    FROM "Payment"
    WHERE "receivedAt" IS NULL
  `)
  const payCount = payCountRow[0]?.n ?? 0
  console.log(`[backfill-issuedat] Payment rows to backfill: ${payCount}`)

  if (APPLY && payCount > 0) {
    const r = await prisma.$executeRawUnsafe(`
      UPDATE "Payment"
         SET "receivedAt" = "createdAt"
       WHERE "receivedAt" IS NULL
    `)
    console.log(`[backfill-issuedat] Payment rows updated: ${r}`)
  }

  if (!APPLY) {
    console.log('[backfill-issuedat] DRY-RUN complete. Re-run with --apply to execute.')
  } else {
    console.log('[backfill-issuedat] Done.')
  }
}

main()
  .catch((e) => {
    console.error('[backfill-issuedat] FAILED', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
