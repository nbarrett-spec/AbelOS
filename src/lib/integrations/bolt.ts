// ──────────────────────────────────────────────────────────────────────────
// ECI Bolt / Spruce — API Integration
// Handles customers, orders, invoices, inventory, and pricing
// Auth: API key from ECI account manager
// ──────────────────────────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma'
import type { BoltCustomer, BoltOrder, BoltInvoice, SyncResult } from './types'

interface BoltConfig {
  apiKey: string
  baseUrl: string
  companyId: string
}

async function getConfig(): Promise<BoltConfig | null> {
  const config = await (prisma as any).integrationConfig.findUnique({
    where: { provider: 'ECI_BOLT' },
  })
  if (!config || config.status !== 'CONNECTED' || !config.apiKey || !config.baseUrl) {
    return null
  }
  return { apiKey: config.apiKey, baseUrl: config.baseUrl, companyId: config.companyId || '' }
}

async function boltFetch(path: string, config: BoltConfig, options?: RequestInit) {
  const url = `${config.baseUrl}${path}`
  const response = await fetch(url, {
    ...options,
    headers: {
      'X-Api-Key': config.apiKey,
      'X-Company-Id': config.companyId,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options?.headers || {}),
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`ECI Bolt API ${response.status}: ${text}`)
  }

  return response.json()
}

// ─── Customer Sync ───────────────────────────────────────────────────

export async function syncCustomers(): Promise<SyncResult> {
  const startedAt = new Date()
  const config = await getConfig()
  if (!config) {
    return {
      provider: 'ECI_BOLT', syncType: 'customers', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: 'ECI Bolt not configured',
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  let created = 0, updated = 0, failed = 0

  try {
    const data = await boltFetch('/api/v1/customers', config)
    const customers: BoltCustomer[] = data.customers || data

    for (const boltCust of customers) {
      try {
        // Try to match to existing BuilderOrganization by Bolt ID or name
        let org = await (prisma as any).builderOrganization.findFirst({
          where: {
            OR: [
              { boltCustomerId: boltCust.customerId },
              { name: boltCust.name },
              { code: boltCust.code },
            ],
          },
        })

        if (org) {
          await (prisma as any).builderOrganization.update({
            where: { id: org.id },
            data: {
              boltCustomerId: boltCust.customerId,
              contactName: boltCust.contactName || org.contactName,
              email: boltCust.email || org.email,
              phone: boltCust.phone || org.phone,
              address: boltCust.address || org.address,
              city: boltCust.city || org.city,
              state: boltCust.state || org.state,
              zip: boltCust.zip || org.zip,
            },
          })
          updated++
        } else {
          // Create new organization from Bolt customer
          await (prisma as any).builderOrganization.create({
            data: {
              name: boltCust.name,
              code: boltCust.code || boltCust.name.substring(0, 10).toUpperCase().replace(/\s/g, ''),
              boltCustomerId: boltCust.customerId,
              contactName: boltCust.contactName,
              email: boltCust.email,
              phone: boltCust.phone,
              address: boltCust.address,
              city: boltCust.city,
              state: boltCust.state,
              zip: boltCust.zip,
              creditLimit: boltCust.creditLimit,
            },
          })
          created++
        }
      } catch (err) {
        failed++
        console.error(`Bolt customer sync error for ${boltCust.name}:`, err)
      }
    }

    const completedAt = new Date()
    await (prisma as any).syncLog.create({
      data: {
        provider: 'ECI_BOLT', syncType: 'customers', direction: 'PULL',
        status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
        recordsProcessed: created + updated + failed,
        recordsCreated: created, recordsUpdated: updated,
        recordsSkipped: 0, recordsFailed: failed,
        startedAt, completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    })

    return {
      provider: 'ECI_BOLT', syncType: 'customers', direction: 'PULL',
      status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
      recordsProcessed: created + updated + failed,
      recordsCreated: created, recordsUpdated: updated,
      recordsSkipped: 0, recordsFailed: failed,
      startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
  } catch (error: any) {
    return {
      provider: 'ECI_BOLT', syncType: 'customers', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: error.message,
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }
}

// ─── Order Sync ──────────────────────────────────────────────────────

export async function syncOrders(since?: Date): Promise<SyncResult> {
  const startedAt = new Date()
  const config = await getConfig()
  if (!config) {
    return {
      provider: 'ECI_BOLT', syncType: 'orders', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: 'ECI Bolt not configured',
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  let created = 0, updated = 0, failed = 0

  try {
    const sinceParam = since ? `&modifiedSince=${since.toISOString()}` : ''
    const data = await boltFetch(`/api/v1/orders?status=all${sinceParam}`, config)
    const orders: BoltOrder[] = data.orders || data

    for (const boltOrder of orders) {
      try {
        const existing = await (prisma as any).order.findFirst({
          where: { orderNumber: boltOrder.orderNumber },
        })

        if (existing) {
          // Update order status from Bolt
          await (prisma as any).order.update({
            where: { id: existing.id },
            data: {
              poNumber: boltOrder.poNumber || existing.poNumber,
              subtotal: boltOrder.subtotal,
              taxAmount: boltOrder.tax,
              total: boltOrder.total,
            },
          })
          updated++
        } else {
          // Find builder by Bolt customer ID
          const org = await (prisma as any).builderOrganization.findFirst({
            where: { boltCustomerId: boltOrder.customerId },
            include: { builders: { take: 1 } },
          })

          if (org?.builders?.[0]) {
            await (prisma as any).order.create({
              data: {
                builderId: org.builders[0].id,
                orderNumber: boltOrder.orderNumber,
                poNumber: boltOrder.poNumber,
                subtotal: boltOrder.subtotal,
                taxAmount: boltOrder.tax,
                total: boltOrder.total,
                paymentTerm: org.defaultPaymentTerm || 'NET_30',
                status: mapBoltOrderStatus(boltOrder.status),
              },
            })
            created++
          }
        }
      } catch (err) {
        failed++
        console.error(`Bolt order sync error for ${boltOrder.orderNumber}:`, err)
      }
    }

    const completedAt = new Date()
    return {
      provider: 'ECI_BOLT', syncType: 'orders', direction: 'PULL',
      status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
      recordsProcessed: created + updated + failed,
      recordsCreated: created, recordsUpdated: updated,
      recordsSkipped: 0, recordsFailed: failed,
      startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
  } catch (error: any) {
    return {
      provider: 'ECI_BOLT', syncType: 'orders', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: error.message,
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }
}

// ─── Invoice Sync ────────────────────────────────────────────────────

export async function syncInvoices(since?: Date): Promise<SyncResult> {
  const startedAt = new Date()
  const config = await getConfig()
  if (!config) {
    return {
      provider: 'ECI_BOLT', syncType: 'invoices', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: 'ECI Bolt not configured',
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  let updated = 0, failed = 0

  try {
    const sinceParam = since ? `&modifiedSince=${since.toISOString()}` : ''
    const data = await boltFetch(`/api/v1/invoices?${sinceParam}`, config)
    const invoices: BoltInvoice[] = data.invoices || data

    for (const boltInv of invoices) {
      try {
        const existing = await (prisma as any).invoice.findFirst({
          where: { invoiceNumber: boltInv.invoiceNumber },
        })

        if (existing) {
          await (prisma as any).invoice.update({
            where: { id: existing.id },
            data: {
              amountPaid: boltInv.amountPaid,
              balanceDue: boltInv.balance,
              status: mapBoltInvoiceStatus(boltInv.status),
              paidAt: boltInv.amountPaid >= boltInv.total ? new Date() : null,
            },
          })
          updated++
        }
      } catch (err) {
        failed++
      }
    }

    const completedAt = new Date()
    return {
      provider: 'ECI_BOLT', syncType: 'invoices', direction: 'PULL',
      status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
      recordsProcessed: updated + failed,
      recordsCreated: 0, recordsUpdated: updated,
      recordsSkipped: 0, recordsFailed: failed,
      startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
  } catch (error: any) {
    return {
      provider: 'ECI_BOLT', syncType: 'invoices', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: error.message,
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }
}

// ─── Work Order → Job Sync ──────────────────────────────────────────

export async function syncWorkOrders(since?: Date): Promise<SyncResult> {
  const startedAt = new Date()
  const config = await getConfig()
  if (!config) {
    return {
      provider: 'ECI_BOLT', syncType: 'work_orders', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: 'ECI Bolt not configured',
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  let created = 0, updated = 0, skipped = 0, failed = 0

  try {
    const sinceParam = since ? `&modifiedSince=${since.toISOString()}` : ''
    const data = await boltFetch(`/api/v1/work-orders?status=all${sinceParam}`, config)
    const workOrders = data.workOrders || data.work_orders || data || []

    for (const wo of workOrders) {
      try {
        // Check if we already have this bolt job
        const existing: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id", "status"::text as status FROM "Job" WHERE "boltJobId" = $1 LIMIT 1`,
          wo.workOrderId || wo.id
        )

        if (existing.length > 0) {
          // Update status if changed
          const newStatus = mapBoltWOStatus(wo.status)
          if (existing[0].status !== newStatus) {
            await prisma.$executeRawUnsafe(
              `UPDATE "Job" SET "status" = $1::"JobStatus", "updatedAt" = NOW() WHERE "id" = $2`,
              newStatus, existing[0].id
            )
            updated++
          } else {
            skipped++
          }
          continue
        }

        // Find the order if we have one linked
        let orderId: string | null = null
        let projectId: string | null = null
        let builderName = wo.customerName || wo.customer || 'Unknown'
        let builderContact: string | null = null
        let jobAddress = wo.address || wo.jobAddress || null

        if (wo.orderNumber) {
          const order: any[] = await prisma.$queryRawUnsafe(
            `SELECT o."id", o."projectId", o."builderId", b."companyName", b."email"
             FROM "Order" o
             JOIN "Builder" b ON b."id" = o."builderId"
             WHERE o."orderNumber" = $1 LIMIT 1`,
            wo.orderNumber
          )
          if (order.length > 0) {
            orderId = order[0].id
            projectId = order[0].projectId
            builderName = order[0].companyName
            builderContact = order[0].email
          }
        }

        // Create Job from Bolt WO. New naming convention is "<address> <code>"
        // (see src/lib/job-types.ts), but Bolt WOs don't carry a jobType, so
        // we use address-only when we have one. If no address exists fall
        // back to the legacy JOB-BOLT-* sentinel — the backfill script can
        // pick those up later. Per-suffix collision handling: if the address
        // collides with an existing job, append "-2", "-3", … so we don't
        // violate the unique constraint.
        const jobId = `job_bolt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
        const addrTrimmed = (jobAddress || '').trim().replace(/\s+/g, ' ')
        let jobNumber: string
        if (addrTrimmed) {
          jobNumber = addrTrimmed
          // Resolve uniqueness — the column has a UNIQUE constraint.
          let collision: any[] = await prisma.$queryRawUnsafe(
            `SELECT 1 FROM "Job" WHERE "jobNumber" = $1 LIMIT 1`,
            jobNumber,
          )
          let n = 2
          while (collision.length > 0 && n < 100) {
            jobNumber = `${addrTrimmed}-${n}`
            collision = await prisma.$queryRawUnsafe(
              `SELECT 1 FROM "Job" WHERE "jobNumber" = $1 LIMIT 1`,
              jobNumber,
            )
            n++
          }
        } else {
          jobNumber = `JOB-BOLT-${(wo.workOrderNumber || wo.woNumber || wo.id || '').toString().slice(-6).toUpperCase()}`
        }

        await prisma.$executeRawUnsafe(`
          INSERT INTO "Job" (
            "id", "jobNumber", "boltJobId", "orderId", "projectId",
            "builderName", "builderContact", "jobAddress",
            "community", "lotBlock",
            "scopeType", "status", "scheduledDate",
            "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8,
            $9, $10,
            'FULL_PACKAGE'::"ScopeType", $11::"JobStatus", $12,
            NOW(), NOW()
          )
        `,
          jobId, jobNumber, wo.workOrderId || wo.id, orderId, projectId,
          builderName, builderContact, jobAddress,
          wo.community || wo.subdivision || null,
          wo.lotBlock || wo.lot || null,
          mapBoltWOStatus(wo.status),
          wo.scheduledDate ? new Date(wo.scheduledDate) : null
        )
        created++
      } catch (err: any) {
        failed++
        console.error(`Bolt WO sync error for ${wo.workOrderId || wo.id}:`, err?.message)
      }
    }

    const completedAt = new Date()
    await prisma.$executeRawUnsafe(`
      INSERT INTO "SyncLog" ("id", "provider", "syncType", "direction", "status",
        "recordsProcessed", "recordsCreated", "recordsUpdated", "recordsSkipped", "recordsFailed",
        "startedAt", "completedAt", "durationMs")
      VALUES ($1, 'ECI_BOLT', 'work_orders', 'PULL', $2,
        $3, $4, $5, $6, $7, $8, $9, $10)
    `,
      `sync_${Date.now().toString(36)}`,
      failed > 0 ? 'PARTIAL' : 'SUCCESS',
      created + updated + skipped + failed,
      created, updated, skipped, failed,
      startedAt, completedAt,
      completedAt.getTime() - startedAt.getTime()
    )

    return {
      provider: 'ECI_BOLT', syncType: 'work_orders', direction: 'PULL',
      status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
      recordsProcessed: created + updated + skipped + failed,
      recordsCreated: created, recordsUpdated: updated,
      recordsSkipped: skipped, recordsFailed: failed,
      startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
  } catch (error: any) {
    return {
      provider: 'ECI_BOLT', syncType: 'work_orders', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: error.message,
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }
}

// ─── Connection Test ─────────────────────────────────────────────────

export async function testConnection(apiKey: string, baseUrl: string, companyId: string): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/customers?limit=1`, {
      headers: {
        'X-Api-Key': apiKey,
        'X-Company-Id': companyId,
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      return { success: false, message: `API returned ${response.status}: ${response.statusText}` }
    }

    return { success: true, message: 'Connected to ECI Bolt successfully' }
  } catch (error: any) {
    return { success: false, message: error.message }
  }
}

// ─── Status Mapping ──────────────────────────────────────────────────

function mapBoltWOStatus(boltStatus: string): string {
  const map: Record<string, string> = {
    'New': 'CREATED',
    'Scheduled': 'READINESS_CHECK',
    'MaterialsReady': 'MATERIALS_LOCKED',
    'InProduction': 'IN_PRODUCTION',
    'Staged': 'STAGED',
    'Loaded': 'LOADED',
    'InTransit': 'IN_TRANSIT',
    'Delivered': 'DELIVERED',
    'Installing': 'INSTALLING',
    'Complete': 'COMPLETE',
    'Cancelled': 'CANCELLED',
  }
  return map[boltStatus] || 'CREATED'
}

function mapBoltOrderStatus(boltStatus: string): string {
  const map: Record<string, string> = {
    'New': 'RECEIVED',
    'Confirmed': 'CONFIRMED',
    'InProduction': 'IN_PRODUCTION',
    'ReadyToShip': 'READY_TO_SHIP',
    'Shipped': 'SHIPPED',
    'Delivered': 'DELIVERED',
    'Complete': 'COMPLETE',
  }
  return map[boltStatus] || 'RECEIVED'
}

function mapBoltInvoiceStatus(boltStatus: string): string {
  const map: Record<string, string> = {
    'Draft': 'DRAFT',
    'Issued': 'ISSUED',
    'Sent': 'SENT',
    'PartiallyPaid': 'PARTIALLY_PAID',
    'Paid': 'PAID',
    'Overdue': 'OVERDUE',
    'Void': 'VOID',
  }
  return map[boltStatus] || 'ISSUED'
}
