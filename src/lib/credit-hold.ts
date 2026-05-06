/**
 * Builder Credit Hold
 *
 * Single source of truth for whether a builder is allowed to open a new
 * order. Pulls the same dimensions the ops/orders route currently inlines:
 *  - Account status (SUSPENDED/CLOSED → hard block, always on)
 *  - Overdue AR beyond grace (>$25k or >60 days → hard block, always on)
 *  - Credit limit vs. current AR balance (opt-in via STRICT_CREDIT_LIMIT=true)
 *
 * Call from POST /api/ops/orders; fail with 403 if `ok === false`.
 * MANAGER+ roles can pass an override reason to bypass.
 *
 * Also used by a daily cron: builders with overdue AR > $threshold get
 * flagged automatically (status → SUSPENDED + InboxItem for accounting).
 */
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { logAudit } from '@/lib/audit'

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

    // Credit-limit check — opt-in via STRICT_CREDIT_LIMIT=true so we can roll
    // it out without breaking existing flows that rely on AR > limit being
    // soft-warning only. Hard blocks above (SUSPENDED/CLOSED, overdue) stay on.
    if (process.env.STRICT_CREDIT_LIMIT === 'true' && base.creditLimit && base.creditLimit > 0) {
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

/**
 * Enforcement helper for order-creation endpoints.
 *
 * Runs the full credit-hold check for the builder + the proposed order total.
 * If blocked, logs a CREDIT_HOLD_BLOCK audit row and returns a NextResponse
 * that the caller should `return` immediately.
 *
 * Returns `null` on the happy path so the caller can proceed.
 *
 *   const blocked = await enforceCreditHold(builderId, total, request, { source: 'POST /api/orders' })
 *   if (blocked) return blocked
 *
 * Error codes returned to the client:
 *   - CREDIT_HOLD               — account SUSPENDED/CLOSED or overdue AR
 *   - CREDIT_LIMIT_EXCEEDED     — projected AR would breach creditLimit (only
 *                                 when STRICT_CREDIT_LIMIT=true)
 */
export async function enforceCreditHold(
  builderId: string,
  proposedOrderTotal: number,
  request?: NextRequest,
  context?: { source?: string; quoteId?: string; orderNumber?: string }
): Promise<NextResponse | null> {
  if (!builderId) return null
  let status: CreditStatus
  try {
    status = await checkBuilderCreditStatus(builderId, proposedOrderTotal)
  } catch (e) {
    // Fail-open on unexpected error — log loudly but don't block legitimate orders.
    logger.error('credit_hold_enforce_errored', e as any, { builderId })
    return null
  }
  if (status.ok) return null

  // Pick the wire-error code by reason. CREDIT_LIMIT_EXCEEDED is the only
  // soft-flag-gated one; everything else is CREDIT_HOLD.
  const isLimitBreach = status.reason === 'would_exceed_credit_limit'
  const errorCode = isLimitBreach ? 'CREDIT_LIMIT_EXCEEDED' : 'CREDIT_HOLD'

  const message = isLimitBreach
    ? status.suggestedAction || 'Order would exceed builder credit limit. Contact AR before placing orders.'
    : status.suggestedAction || 'This builder is on credit hold. Contact AR before placing orders.'

  // Audit the blocked attempt — fire-and-forget so a logging hiccup never
  // prevents the 403 from going out, but await the actual logAudit so we
  // don't lose ordering when the route returns immediately after.
  try {
    const ip = request?.headers.get('x-forwarded-for') || request?.headers.get('x-real-ip') || undefined
    const ua = request?.headers.get('user-agent') || undefined
    const staffId = request?.headers.get('x-staff-id') || `builder:${builderId}`
    await logAudit({
      staffId,
      action: 'CREDIT_HOLD_BLOCK',
      entity: 'Order',
      entityId: context?.orderNumber || context?.quoteId,
      severity: 'WARN',
      details: {
        builderId,
        reason: status.reason,
        accountStatus: status.accountStatus,
        currentAR: status.currentAR,
        creditLimit: status.creditLimit,
        overdueAmount: status.overdueAmount,
        overdueDays: status.overdueDays,
        attemptedTotal: proposedOrderTotal,
        source: context?.source,
      },
      ipAddress: ip,
      userAgent: ua,
    })
  } catch {
    // never let logging block the refusal
  }

  const payload: Record<string, any> = {
    error: errorCode,
    message,
    builderId,
    reason: status.reason,
  }
  if (isLimitBreach) {
    payload.currentBalance = status.currentAR
    payload.attemptedTotal = proposedOrderTotal
    payload.creditLimit = status.creditLimit
  } else {
    payload.accountStatus = status.accountStatus
    if (status.overdueAmount > 0) {
      payload.overdueAmount = status.overdueAmount
      payload.overdueDays = status.overdueDays
    }
  }

  return NextResponse.json(payload, { status: 403 })
}
