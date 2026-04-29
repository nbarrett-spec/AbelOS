import { prisma } from '@/lib/prisma'

interface AutoInvoiceResult {
  success: boolean
  invoiceId?: string
  invoiceNumber?: string
  error?: string
}

/**
 * Auto-generate an invoice from a completed job.
 *
 * Flow:
 * 1. Fetch the job with its linked order and orderItems
 * 2. Check if an invoice already exists for this job (idempotent)
 * 3. Create an Invoice with status=DRAFT, builderId from job/order, orderId, jobId
 * 4. For each OrderItem: create InvoiceItem with description, quantity, unitPrice, lineTotal
 * 5. Calculate subtotal, apply tax if configured, set total and balanceDue
 * 6. Set dueDate based on paymentTerm from builder
 * 7. Generate invoiceNumber with pattern INV-YYYY-NNNN
 * 8. Create linked LienRelease with type='CONDITIONAL', status='PENDING'
 *
 * @param jobId The ID of the job to invoice
 * @returns { success, invoiceId, invoiceNumber, error }
 */
export async function autoGenerateInvoice(jobId: string): Promise<AutoInvoiceResult> {
  try {
    // Fetch job with order and orderItems
    const jobRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        j."id", j."jobNumber", j."orderId", j."builderName",
        o."id" AS "orderId", o."builderId", o."subtotal", o."taxAmount",
        o."total", o."paymentTerm"
      FROM "Job" j
      LEFT JOIN "Order" o ON o."id" = j."orderId"
      WHERE j."id" = $1
    `, jobId)

    if (jobRows.length === 0) {
      return { success: false, error: 'Job not found' }
    }

    const job = jobRows[0]
    const builderId = job.builderId
    const orderId = job.orderId

    if (!builderId) {
      return { success: false, error: 'Job has no associated builder' }
    }

    if (!orderId) {
      return { success: false, error: 'Job has no associated order' }
    }

    // Check if an invoice already exists for this job (idempotent)
    const existingInvoice: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "invoiceNumber"
      FROM "Invoice"
      WHERE "jobId" = $1
    `, jobId)

    if (existingInvoice.length > 0) {
      return {
        success: true,
        invoiceId: existingInvoice[0].id,
        invoiceNumber: existingInvoice[0].invoiceNumber,
      }
    }

    // Fetch order items
    const orderItems: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "description", "quantity", "unitPrice", "lineTotal"
      FROM "OrderItem"
      WHERE "orderId" = $1
    `, orderId)

    if (orderItems.length === 0) {
      return { success: false, error: 'Order has no items' }
    }

    // Calculate totals from order
    const subtotal = job.subtotal || 0
    const taxAmount = job.taxAmount || 0
    const total = job.total || (subtotal + taxAmount)

    // Generate invoice number
    const year = new Date().getFullYear()
    const maxRow: any[] = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(MAX(CAST(SUBSTRING("invoiceNumber" FROM '[0-9]+$') AS INT)), 0) AS max_num
      FROM "Invoice"
      WHERE "invoiceNumber" LIKE $1
    `, `INV-${year}-%`)
    const nextNumber = Number(maxRow[0]?.max_num || 0) + 1
    const invoiceNumber = `INV-${year}-${String(nextNumber).padStart(4, '0')}`

    // Determine payment term and due date
    const paymentTerm = job.paymentTerm || 'NET_15'
    const now = new Date()
    let dueDate = new Date(now)

    // Calculate due date based on payment term
    switch (paymentTerm) {
      case 'PAY_AT_ORDER':
        dueDate = new Date(now) // Due immediately
        break
      case 'PAY_ON_DELIVERY':
        dueDate = new Date(now) // Due on delivery (already done, job is complete)
        break
      case 'NET_15':
        dueDate.setDate(dueDate.getDate() + 15)
        break
      case 'NET_30':
        dueDate.setDate(dueDate.getDate() + 30)
        break
    }

    // Create the invoice, items, and lien release atomically
    const invId = `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`
        INSERT INTO "Invoice" (
          "id", "invoiceNumber", "builderId", "orderId", "jobId", "createdById",
          "subtotal", "taxAmount", "total", "amountPaid", "balanceDue",
          "status", "paymentTerm", "issuedAt", "dueDate", "notes",
          "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, $4, $5, NULL,
          $6, $7, $8, 0, $8,
          'DRAFT'::"InvoiceStatus", $9::"PaymentTerm", NOW(), $10, $11,
          NOW(), NOW()
        )
      `,
        invId,
        invoiceNumber,
        builderId,
        orderId,
        jobId,
        subtotal,
        taxAmount,
        total,
        paymentTerm,
        dueDate.toISOString(),
        `Auto-generated from job ${job.jobNumber}`
      )

      // Create invoice items from order items
      for (const item of orderItems) {
        const itemId = `invitem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
        await tx.$executeRawUnsafe(`
          INSERT INTO "InvoiceItem" ("id", "invoiceId", "description", "quantity", "unitPrice", "lineTotal", "lineType")
          VALUES ($1, $2, $3, $4, $5, $6, 'MATERIAL')
        `, itemId, invId, item.description, item.quantity, item.unitPrice, item.lineTotal)
      }

      // Create linked LienRelease with type='CONDITIONAL', status='PENDING'
      const lienReleaseId = `lien_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      await tx.$executeRawUnsafe(`
        INSERT INTO "LienRelease" (
          "id", "jobId", "builderId", "invoiceId",
          "type", "status", "amount",
          "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, $4,
          'CONDITIONAL', 'PENDING', $5,
          NOW(), NOW()
        )
      `, lienReleaseId, jobId, builderId, invId, total)
    })

    return {
      success: true,
      invoiceId: invId,
      invoiceNumber,
    }
  } catch (error) {
    console.error('autoGenerateInvoice error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
