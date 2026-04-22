export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { notifyInvoiceCreated } from '@/lib/notifications'

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

    // Get items
    const items: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "invoiceId", "productId", "description", "quantity", "unitPrice", "lineTotal"
      FROM "InvoiceItem" WHERE "invoiceId" = $1
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

    const setClauses: string[] = ['"updatedAt" = NOW()']

    if (status !== undefined) {
      setClauses.push(`"status" = '${status}'::"InvoiceStatus"`)
      if (status === 'ISSUED') setClauses.push(`"issuedAt" = NOW()`)
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
    if (status === 'ISSUED' || status === 'SENT') {
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
    return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 })
  }
}
