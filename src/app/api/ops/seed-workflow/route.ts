export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireDevAdmin } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/seed-workflow — Seeds jobs and invoices from existing orders
// Creates realistic downstream workflow data so the platform feels live.
// DEV ONLY, ADMIN required.
// ──────────────────────────────────────────────────────────────────────────

function toTsSql(val: string | Date | null): string {
  if (!val) return 'NULL'
  const iso = val instanceof Date ? val.toISOString() : val
  return `'${iso}'::timestamptz`
}

export async function POST(request: NextRequest) {
  try {
    audit(request, 'RUN_SEED_WORKFLOW', 'Database', undefined, { migration: 'RUN_SEED_WORKFLOW' }, 'CRITICAL').catch(() => {})
    const guard = requireDevAdmin(request)
    if (guard) return guard

    const results: Record<string, any> = { jobs: 0, invoices: 0, invoiceItems: 0, payments: 0, errors: [] }

    // Get staff members for assignment
    const staffRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "role", "firstName", "lastName" FROM "Staff" WHERE "active" = true LIMIT 20
    `)
    const pms = staffRows.filter(s => s.role === 'PROJECT_MANAGER' || s.role === 'ADMIN' || s.role === 'MANAGER')
    const accountingStaff = staffRows.filter(s => s.role === 'ACCOUNTING' || s.role === 'ADMIN')
    const defaultPM = pms[0] || staffRows[0]
    const defaultAcct = accountingStaff[0] || staffRows[0]

    if (!defaultPM || !defaultAcct) {
      return NextResponse.json({ error: 'No staff found — seed staff first' }, { status: 400 })
    }

    // Get max existing job/invoice numbers to avoid collisions
    const maxJobRow: any[] = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(MAX(CAST(SUBSTRING("jobNumber" FROM '[0-9]+$') AS INT)), 1000) AS max_num FROM "Job"
    `)
    const maxInvRow: any[] = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(MAX(CAST(SUBSTRING("invoiceNumber" FROM '[0-9]+$') AS INT)), 1000) AS max_num FROM "Invoice"
    `)
    let jobNum = Number(maxJobRow[0]?.max_num || 1000)
    let invNum = Number(maxInvRow[0]?.max_num || 1000)

    // Get ALL orders with builder info
    const orders: any[] = await prisma.$queryRawUnsafe(`
      SELECT o."id", o."orderNumber", o."builderId", o."status", o."paymentStatus",
             o."total", o."subtotal", o."taxAmount", o."shippingCost",
             o."paymentTerm", o."deliveryDate", o."deliveryNotes", o."createdAt",
             b."companyName" AS "builderName", b."contactName" AS "builderContact", b."email" AS "builderEmail"
      FROM "Order" o
      JOIN "Builder" b ON b."id" = o."builderId"
      ORDER BY o."createdAt" DESC
    `)

    // Check existing jobs to avoid duplicates
    const existingJobOrderIds: any[] = await prisma.$queryRawUnsafe(`
      SELECT "orderId" FROM "Job" WHERE "orderId" IS NOT NULL
    `)
    const jobOrderSet = new Set(existingJobOrderIds.map(r => r.orderId))

    // Check existing invoices to avoid duplicates
    const existingInvOrderIds: any[] = await prisma.$queryRawUnsafe(`
      SELECT "orderId" FROM "Invoice" WHERE "orderId" IS NOT NULL
    `)
    const invOrderSet = new Set(existingInvOrderIds.map(r => r.orderId))

    // Community names for realism
    const communities = [
      'Canyon Ridge', 'Wildflower Estates', 'Heritage Hills', 'Oak Creek',
      'Shadow Creek', 'Lone Star Ranch', 'Prairie Vista', 'Stone Bridge',
      'Sunset Valley', 'Eagle Mountain', 'Cedar Park', 'Monarch Ranch',
      'Sienna Hills', 'Pecan Grove', 'Lakewood Trails', 'Copper Canyon',
      'Timber Ridge', 'Iron Horse', 'Whispering Oaks', 'Silver Lake'
    ]
    const scopeTypes = ['DOORS_ONLY', 'TRIM_ONLY', 'DOORS_AND_TRIM', 'FULL_PACKAGE', 'DOORS_AND_TRIM', 'DOORS_AND_TRIM']
    const dropPlans = ['Single Drop', 'Staged', 'Multi-Drop', 'Single Drop', 'Single Drop']

    for (const order of orders) {
      if (jobOrderSet.has(order.id)) continue // Skip if job already exists

      // Determine job status based on order status
      let jobStatus: string
      let readiness = false, materialsLocked = false, loadConfirmed = false
      let completedAt: string | null = null
      let actualDate: string | null = null

      // Use deliveryDate or fallback to createdAt (ensure we always have a valid date)
      const baseDate = order.deliveryDate || order.createdAt
      const baseDateStr = baseDate instanceof Date ? baseDate.toISOString() : String(baseDate)

      switch (order.status) {
        case 'RECEIVED': {
          const recRand = Math.random()
          if (recRand < 0.4) jobStatus = 'CREATED'
          else if (recRand < 0.7) { jobStatus = 'READINESS_CHECK'; readiness = true }
          else { jobStatus = 'MATERIALS_LOCKED'; readiness = true; materialsLocked = true }
          break
        }
        case 'CONFIRMED': {
          const confRand = Math.random()
          readiness = true; materialsLocked = true
          if (confRand < 0.5) jobStatus = 'IN_PRODUCTION'
          else { jobStatus = 'STAGED'; loadConfirmed = true }
          break
        }
        case 'DELIVERED': {
          readiness = true; materialsLocked = true; loadConfirmed = true
          const delRand = Math.random()
          if (delRand < 0.3) jobStatus = 'DELIVERED'
          else if (delRand < 0.5) jobStatus = 'INSTALLING'
          else if (delRand < 0.6) jobStatus = 'PUNCH_LIST'
          else {
            jobStatus = 'COMPLETE'
            const cd = new Date(baseDateStr)
            cd.setDate(cd.getDate() + Math.floor(Math.random() * 5) + 1)
            completedAt = cd.toISOString()
            actualDate = completedAt
          }
          if (!actualDate && order.deliveryDate) {
            actualDate = order.deliveryDate instanceof Date ? order.deliveryDate.toISOString() : String(order.deliveryDate)
          }
          break
        }
        case 'COMPLETE': {
          readiness = true; materialsLocked = true; loadConfirmed = true
          jobStatus = Math.random() < 0.4 ? 'INVOICED' : 'CLOSED'
          const compDate = new Date(baseDateStr)
          compDate.setDate(compDate.getDate() + Math.floor(Math.random() * 3) + 1)
          completedAt = compDate.toISOString()
          actualDate = completedAt
          break
        }
        default:
          jobStatus = 'CREATED'
      }

      const pmAssign = pms[Math.floor(Math.random() * pms.length)] || defaultPM
      const community = communities[Math.floor(Math.random() * communities.length)]
      const lotNum = Math.floor(Math.random() * 50) + 1
      const blockNum = Math.floor(Math.random() * 8) + 1
      const scope = scopeTypes[Math.floor(Math.random() * scopeTypes.length)]
      const drop = dropPlans[Math.floor(Math.random() * dropPlans.length)]
      jobNum++

      const jobId = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const jobNumber = `JOB-2026-${String(jobNum).padStart(4, '0')}`

      try {
        // ALL date values inlined with ::timestamptz to avoid Prisma type mismatch
        await prisma.$executeRawUnsafe(`
          INSERT INTO "Job" (
            "id", "jobNumber", "orderId", "builderName", "builderContact", "jobAddress",
            "lotBlock", "community", "scopeType", "dropPlan",
            "assignedPMId", "status", "readinessCheck", "materialsLocked", "loadConfirmed",
            "scheduledDate", "actualDate", "completedAt", "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9::"ScopeType", $10,
            $11, '${jobStatus}'::"JobStatus", $12, $13, $14,
            ${toTsSql(baseDateStr)}, ${toTsSql(actualDate)}, ${toTsSql(completedAt)},
            ${toTsSql(order.createdAt)}, NOW()
          )
        `,
          jobId, jobNumber, order.id,
          order.builderName, order.builderContact,
          order.deliveryNotes || `${community} - Lot ${lotNum}`,
          `Lot ${lotNum} Block ${blockNum}`, community, scope, drop,
          pmAssign.id, readiness, materialsLocked, loadConfirmed
        )
        results.jobs++
      } catch (e: any) {
        results.errors.push(`Job for ${order.orderNumber}: ${e.message?.substring(0, 120)}`)
        continue
      }

      // Create invoice for DELIVERED (complete jobs) and COMPLETE orders
      if (['DELIVERED', 'COMPLETE'].includes(order.status) && !invOrderSet.has(order.id)) {
        invNum++
        const invId = `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
        const invNumber = `INV-2026-${String(invNum).padStart(4, '0')}`
        const acctAssign = accountingStaff[Math.floor(Math.random() * accountingStaff.length)] || defaultAcct

        // Determine invoice status based on payment status
        let invStatus: string
        let amountPaid = 0
        let paidAt: string | null = null
        const issuedDate = new Date(baseDateStr)
        issuedDate.setDate(issuedDate.getDate() + 1)
        const dueDate = new Date(issuedDate)
        if (order.paymentTerm === 'NET_30') dueDate.setDate(dueDate.getDate() + 30)
        else if (order.paymentTerm === 'NET_15') dueDate.setDate(dueDate.getDate() + 15)
        else dueDate.setDate(dueDate.getDate() + 15)

        switch (order.paymentStatus) {
          case 'PAID':
            invStatus = 'PAID'
            amountPaid = Number(order.total) || 0
            const pd = new Date(issuedDate)
            pd.setDate(pd.getDate() + Math.floor(Math.random() * 20) + 3)
            paidAt = pd.toISOString()
            break
          case 'INVOICED':
            invStatus = dueDate < new Date() ? 'OVERDUE' : 'SENT'
            break
          case 'PENDING':
          default:
            invStatus = 'ISSUED'
            break
        }

        const balanceDue = (Number(order.total) || 0) - amountPaid

        try {
          await prisma.$executeRawUnsafe(`
            INSERT INTO "Invoice" (
              "id", "invoiceNumber", "builderId", "orderId", "jobId", "createdById",
              "subtotal", "taxAmount", "total", "amountPaid", "balanceDue",
              "status", "paymentTerm", "issuedAt", "dueDate", "paidAt",
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, $4, $5, $6,
              $7, $8, $9, $10, $11,
              '${invStatus}'::"InvoiceStatus", '${order.paymentTerm || 'NET_15'}'::"PaymentTerm",
              ${toTsSql(issuedDate.toISOString())},
              ${toTsSql(dueDate.toISOString())},
              ${toTsSql(paidAt)},
              ${toTsSql(issuedDate.toISOString())}, NOW()
            )
          `,
            invId, invNumber, order.builderId, order.id, jobId, acctAssign.id,
            Number(order.subtotal) || 0, Number(order.taxAmount) || 0,
            Number(order.total) || 0, amountPaid, balanceDue
          )
          results.invoices++

          // Create invoice line item
          const itemId = `invitem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
          try {
            await prisma.$executeRawUnsafe(`
              INSERT INTO "InvoiceItem" (
                "id", "invoiceId", "description", "quantity", "unitPrice", "lineTotal"
              ) VALUES ($1, $2, $3, $4, $5, $6)
            `,
              itemId, invId,
              `${scope.replace(/_/g, ' ').toLowerCase()} - ${order.orderNumber}`,
              1, Number(order.subtotal) || 0, Number(order.subtotal) || 0
            )
            results.invoiceItems++
          } catch (e: any) {
            // Non-fatal
          }

          // Create payment record for PAID invoices
          if (invStatus === 'PAID' && paidAt) {
            const payId = `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
            const payMethods = ['CHECK', 'ACH', 'WIRE', 'CHECK', 'CHECK', 'ACH']
            const method = payMethods[Math.floor(Math.random() * payMethods.length)]
            try {
              await prisma.$executeRawUnsafe(`
                INSERT INTO "Payment" (
                  "id", "invoiceId", "amount", "method", "reference", "receivedAt"
                ) VALUES ($1, $2, $3, '${method}'::"PaymentMethod", $4, ${toTsSql(paidAt)})
              `,
                payId, invId, amountPaid,
                method === 'CHECK' ? `CHK-${Math.floor(Math.random() * 90000) + 10000}` : `REF-${Math.floor(Math.random() * 900000) + 100000}`
              )
              results.payments++
            } catch (e: any) {
              // Non-fatal
            }
          }
        } catch (e: any) {
          results.errors.push(`Invoice for ${order.orderNumber}: ${e.message?.substring(0, 120)}`)
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Seeded ${results.jobs} jobs, ${results.invoices} invoices, ${results.invoiceItems} line items, ${results.payments} payments`,
      ...results,
      errors: results.errors.slice(0, 10)
    })
  } catch (error: any) {
    console.error('Seed workflow error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
