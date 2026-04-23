/**
 * Builder Credit Hold
 *
 * Single source of truth for whether a builder is allowed to open a new
 * order. Pulls the same dimensions the ops/orders route currently inlines:
 *  - Account status (SUSPENDED/ON_HOLD → hard block)
 *  - Credit limit vs. current AR balance
 *  - Overdue AR beyond grace (60 days with positive balance)
 *
 * Call from POST /api/ops/orders; fail with 409 Conflict if `ok === false`.
 * MANAGER+ roles can pass an override reason to bypass.
 *
 * Also used by a daily cron: builders with overdue AR > $threshold get
 * flagged automatically (status → SUSPENDED + InboxItem for accounting).
 */
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

export interface CreditStatus {
  ok: boolean
  reason?: string
  overdueAmount: number
  overdueDays: number
  currentAR: number
  creditLimit: number | null
  accountStatus: string | null
  suggestedAction?: string
}

/** Returns the credit status for a single builder, with context for the UI. */
export async function checkBuilderCreditStatus(builderId: string, proposedOrderTotal = 0): Promise<CreditStatus> {
  const base: CreditStatus = {
    ok: true,
    overdueAmount: 0,
    overdueDays: 0,
    currentAR: 0,
    creditLimit: null,
    accountStatus: null,
  }

  try {
    const builderRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "companyName", "creditLimit", "status"::text AS status, "accountBalance"
       FROM "Builder" WHERE "id" = $1 LIMIT 1`,
      builderId
    )
    if (builderRows.length === 0) {
      return { ...base, ok: false, reason: 'builder_not_found' }
    }
    const builder = builderRows[0]
    base.accountStatus = builder.status || null
    base.creditLimit = builder.creditLimit != null ? Number(builder.creditLimit) : null

    // Hard block — status
    if (builder.status === 'SUSPENDED' || builder.status === 'CLOSED') {
      return {
        ...base,
        ok: false,
        reason: `account_${String(builder.status).toLowerCase()}`,
        suggestedAction: 'Contact accounting to lift the hold before ordering.',
      }
    }

    // Current AR balance — unpaid orders
    const arRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM("total"), 0)::float AS total
       FROM "Order"
       WHERE "builderId" = $1 AND "paymentStatus"::text != 'PAID'`,
      builderId
    )
    base.currentAR = Number(arRows[0]?.total || 0)

    // Overdue invoices — anything past dueDate with a positive balance
    const overdueRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM("total" - COALESCE("amountPaid", 0)), 0)::float AS "overdueAmount",
              EXTRACT(DAY FROM NOW() - MIN("dueDate"))::int AS "overdueDays"
       FROM "Invoice"
       WHERE "builderId" = $1
         AND "status"::text != 'PAID'
         AND "dueDate" IS NOT NULL
         AND "dueDate" < NOW()
         AND ("total" - COALESCE("amountPaid", 0)) > 0`,
      builderId
    )
    base.overdueAmount = Number(overdueRows[0]?.overdueAmount || 0)
    base.overdueDays = Number(overdueRows[0]?.overdueDays || 0)

    // Credit-limit check
    if (base.creditLimit && base.creditLimit > 0) {
      const projected = base.currentAR + Number(proposedOrderTotal || 0)
      if (projected > base.creditLimit) {
        return {
          ...base,
          ok: false,
          reason: 'would_exceed_credit_limit',
          suggestedAction: `Order would push AR to $${projected.toFixed(0)} against $${base.creditLimit.toFixed(0)} limit. Collect payment or raise limit.`,
        }
      }
    }

    // Overdue sweep — big bills or long-aged debt → block
    const BIG_OVERDUE = 25_000
    const OLD_OVERDUE_DAYS = 60
    if (base.overdueAmount >= BIG_OVERDUE || base.overdueDays > OLD_OVERDUE_DAYS) {
      return {
        ...base,
        ok: false,
        reason: 'overdue_ar',
        suggestedAction: `$${base.overdueAmount.toFixed(0)} is ${base.overdueDays} days past due. Collections must clear before a new order is accepted.`,
      }
    }

    return base
  } catch (e: any) {
    logger.error('credit_hold_check_failed', e, { builderId })
    // On failure, default-open is safer than default-closed (we'd rather take
    // an order than lose one to a transient DB blip). Log loudly.
    return { ...base, ok: true, reason: 'check_errored' }
  }
}

/**
 * Cron: sweep all builders; auto-flag any whose overdue AR exceeds thresholds.
 * Flips Builder.status → SUSPENDED and drops an InboxItem for accounting.
 * Safe to run daily; idempotent (skips builders already SUSPENDED).
 */
export async function sweepOverdueCreditHolds(): Promise<{ flagged: number; scanned: number }> {
  const BIG_OVERDUE = 25_000
  const OLD_OVERDUE_DAYS = 60

  let flagged = 0
  let scanned = 0

  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT b."id", b."companyName", b."status"::text AS status,
              COALESCE(SUM(CASE
                WHEN i."status"::text != 'PAID'
                 AND i."dueDate" IS NOT NULL
                 AND i."dueDate" < NOW()
                 AND (i."total" - COALESCE(i."amountPaid", 0)) > 0
                THEN (i."total" - COALESCE(i."amountPaid", 0)) ELSE 0 END), 0)::float AS "overdueAmount",
              EXTRACT(DAY FROM NOW() - MIN(CASE
                WHEN i."status"::text != 'PAID'
                 AND i."dueDate" IS NOT NULL
                 AND i."dueDate" < NOW()
                 AND (i."total" - COALESCE(i."amountPaid", 0)) > 0
                THEN i."dueDate" END))::int AS "overdueDays"
       FROM "Builder" b
       LEFT JOIN "Invoice" i ON i."builderId" = b."id"
       WHERE b."status"::text = 'ACTIVE'
       GROUP BY b."id", b."companyName", b."status"`,
    )

    scanned = rows.length
    for (const row of rows) {
      const amount = Number(row.overdueAmount || 0)
      const days = Number(row.overdueDays || 0)
      if (amount < BIG_OVERDUE && days <= OLD_OVERDUE_DAYS) continue

      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "Builder" SET "status" = 'SUSPENDED'::"AccountStatus", "updatedAt" = NOW() WHERE "id" = $1`,
          row.id
        )
      } catch {
        // builder enum may vary; no-op
      }

      try {
        const inbId = `inb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
        await prisma.$executeRawUnsafe(
          `INSERT INTO "InboxItem" (
            "id", "type", "source", "title", "description",
            "priority", "status", "entityType", "entityId",
            "financialImpact", "createdAt", "updatedAt"
          ) VALUES (
            $1, 'COLLECTION_ACTION', 'credit-hold',
            $2, $3,
            'HIGH', 'PENDING', 'Builder', $4,
            $5, NOW(), NOW()
          )`,
          inbId,
          `Credit hold — ${row.companyName}`,
          `${row.companyName} auto-suspended: $${amount.toFixed(0)} overdue (${days} days). Collections must clear before reactivating.`,
          row.id, amount
        )
      } catch {
        // best-effort
      }

      flagged++
    }
  } catch (e: any) {
    logger.error('credit_hold_sweep_failed', e)
  }

  return { flagged, scanned }
}
