export const dynamic = 'force-dynamic'
import * as Sentry from '@sentry/nextjs'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { notifyInvoiceCreated } from '@/lib/notifications'
import { requireValidTransition, transitionErrorResponse } from '@/lib/status-guard'

interface RouteParams {
  params: { id: string }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params

    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT i."id", i."invoiceNumber", i."builderId", i."orderId", i."jobId",
             i."createdById", i."subtotal", i."taxAmount", i."total",
             i."amountPaid", (i."total" - COALESCE(i."amountPaid",0))::float AS "balanceDue", i."status"::text AS "status",
             i."paymentTerm"::text AS "paymentTerm",
             i."issuedAt", i."dueDate", i."paidAt", i."notes",
             i."createdAt", i."updatedAt",
             b."companyName" AS "builderName",
             s."firstName" AS "createdByFirstName", s."lastName" AS "createdByLastName"
      FROM "Invoice" i
      LEFT JOIN "Builder" b ON b."id" = i."builderId"
      LEFT JOIN "Staff" s ON s."id" = i."createdById"
      WHERE i."id" = $1
    `, id)

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const inv = rows[0]

    // Get items — include lineType + any existing Installation/ScheduleEntry
    // assignment so the UI can render "Already scheduled on X by crew Y".
    const items: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        ii."id", ii."invoiceId", ii."productId", ii."description",
        ii."quantity", ii."unitPrice", ii."lineTotal",
        COALESCE(ii."lineType", 'MATERIAL') AS "lineType",
        ins."id" AS "installationId",
        ins."installNumber" AS "installationNumber",
        ins."scheduledDate" AS "installationScheduledDate",
        ins."status"::text AS "installationStatus",
        ins."crewId" AS "installationCrewId",
        insc."name" AS "installationCrewName",
        se."id" AS "scheduleEntryId",
        se."scheduledDate" AS "scheduleEntryScheduledDate",
        se."status"::text AS "scheduleEntryStatus",
        se."crewId" AS "scheduleEntryCrewId",
        sec."name" AS "scheduleEntryCrewName"
      FROM "InvoiceItem" ii
      LEFT JOIN LATERAL (
        SELECT * FROM "Installation"
        WHERE "invoiceItemId" = ii."id"
        ORDER BY "createdAt" DESC LIMIT 1
      ) ins ON TRUE
      LEFT JOIN "Crew" insc ON insc."id" = ins."crewId"
      LEFT JOIN LATERAL (
        SELECT * FROM "ScheduleEntry"
        WHERE "invoiceItemId" = ii."id"
        ORDER BY "createdAt" DESC LIMIT 1
      ) se ON TRUE
      LEFT JOIN "Crew" sec ON sec."id" = se."crewId"
      WHERE ii."invoiceId" = $1
    `, id)

    // Get payments
    const payments: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "invoiceId", "amount", "method"::text AS "method", "reference", "receivedAt", "notes"
      FROM "Payment" WHERE "invoiceId" = $1 ORDER BY "receivedAt" DESC
    `, id)

    return NextResponse.json({
      ...inv,
      builderName: inv.builderName || 'Unknown Builder',
      items,
      payments,
      createdBy: inv.createdByFirstName ? {
        id: inv.createdById,
        firstName: inv.createdByFirstName,
        lastName: inv.createdByLastName,
      } : null,
    })
  } catch (error) {
    console.error('GET /api/ops/invoices/[id] error:', error)
    Sentry.captureException(error, { tags: { route: '/api/ops/invoices/[id]', method: 'GET' } })
    return NextResponse.json({ error: 'Failed to fetch invoice' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params
    const body = await request.json()
    const { status, notes, issuedAt, dueDate } = body

    // Guard: enforce InvoiceStatus state machine before writing.
    if (status !== undefined) {
      const currentRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "status"::text AS "status" FROM "Invoice" WHERE "id" = $1`,
        id
      )
      if (currentRows.length === 0) {
        return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
      }
      try {
        requireValidTransition('invoice', currentRows[0].status, status)
      } catch (e) {
        const res = transitionErrorResponse(e)
        if (res) return res
        throw e
      }
    }

    const setClauses: string[] = ['"updatedAt" = NOW()']

    if (status !== undefined) {
      setClauses.push(`"status" = '${status}'::"InvoiceStatus"`)
      // Stamp issuedAt the first time an invoice leaves DRAFT for any
      // billable state. Audit (2026-04-24) found issuedAt stale since
      // 3/23 because workflows often skip the explicit ISSUED step
      // (DRAFT → SENT, DRAFT → PARTIALLY_PAID, etc.). COALESCE preserves
      // any explicit value the caller passed in via `issuedAt`.
      if (status && status !== 'DRAFT' && status !== 'VOID') {
        setClauses.push(`"issuedAt" = COALESCE("issuedAt", NOW())`)
      }
      if (status === 'PAID') setClauses.push(`"paidAt" = NOW()`)
    }
    if (notes !== undefined) {
      setClauses.push(`"notes" = '${(notes || '').replace(/'/g, "''")}'`)
    }
    if (issuedAt !== undefined) {
      setClauses.push(issuedAt ? `"issuedAt" = '${issuedAt}'::timestamptz` : `"issuedAt" = NULL`)
    }
    if (dueDate !== undefined) {
      setClauses.push(dueDate ? `"dueDate" = '${dueDate}'::timestamptz` : `"dueDate" = NULL`)
    }

    await prisma.$executeRawUnsafe(`
      UPDATE "Invoice" SET ${setClauses.join(', ')} WHERE "id" = $1
    `, id)

    // Re-fetch the updated invoice
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT i.*, b."companyName" AS "builderName",
             s."firstName" AS "createdByFirstName", s."lastName" AS "createdByLastName"
      FROM "Invoice" i
      LEFT JOIN "Builder" b ON b."id" = i."builderId"
      LEFT JOIN "Staff" s ON s."id" = i."createdById"
      WHERE i."id" = $1
    `, id)

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const inv = rows[0]
    const items: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM "InvoiceItem" WHERE "invoiceId" = $1
    `, id)
    const payments: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "invoiceId", "amount", "method"::text AS "method", "reference", "receivedAt", "notes"
      FROM "Payment" WHERE "invoiceId" = $1 ORDER BY "receivedAt" DESC
    `, id)

    await audit(request, 'UPDATE', 'Invoice', id, { status, notes, issuedAt, dueDate })

    // Send notification when invoice is issued or sent to builder
    // ── Kill switch: builder invoice emails are OFF until explicitly enabled ──
    // Set BUILDER_INVOICE_EMAILS_ENABLED=true in env to re-enable.
    if ((status === 'ISSUED' || status === 'SENT') && process.env.BUILDER_INVOICE_EMAILS_ENABLED === 'true') {
      try {
        const builderRows: any[] = await prisma.$queryRawUnsafe(
          `SELECT email FROM "Builder" WHERE id = $1`, inv.builderId
        )
        if (builderRows.length > 0) {
          const dueStr = inv.dueDate
            ? new Date(inv.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : 'Upon receipt'
          notifyInvoiceCreated(
            inv.builderId,
            builderRows[0].email,
            inv.invoiceNumber,
            Number(inv.total),
            dueStr
          ).catch(() => {})
        }
      } catch { /* Notification is best-effort */ }
    }

    return NextResponse.json({
      ...inv,
      builderName: inv.builderName || 'Unknown Builder',
      items,
      payments,
      createdBy: inv.createdByFirstName ? {
        id: inv.createdById,
        firstName: inv.createdByFirstName,
        lastName: inv.createdByLastName,
      } : null,
    })
  } catch (error) {
    console.error('PATCH /api/ops/invoices/[id] error:', error)
    Sentry.captureException(error, { tags: { route: '/api/ops/invoices/[id]', method: 'PATCH' } })
    return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 })
  }
}
