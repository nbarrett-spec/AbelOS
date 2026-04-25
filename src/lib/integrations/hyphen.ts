// ──────────────────────────────────────────────────────────────────────────
// Hyphen BuildPro / SupplyPro — Integration
// REST (JSON) + SOAP (xCBL 4.0) + FTP (CSV)
// Bidirectional: schedules, POs, change orders, payments from builders
// Used by: Pulte, Toll Brothers, Brookfield, and other national builders
// ──────────────────────────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma'
import type { HyphenScheduleUpdate, HyphenPurchaseOrder, HyphenPaymentNotification, SyncResult } from './types'

interface HyphenConfig {
  apiKey: string
  baseUrl: string
  supplierId: string
}

async function getConfig(): Promise<HyphenConfig | null> {
  const config = await (prisma as any).integrationConfig.findUnique({
    where: { provider: 'HYPHEN' },
  })
  if (!config || config.status !== 'CONNECTED' || !config.apiKey || !config.baseUrl) {
    return null
  }
  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    supplierId: config.companyId || '',
  }
}

async function hyphenFetch(path: string, config: HyphenConfig, options?: RequestInit) {
  const url = `${config.baseUrl}${path}`
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'X-Supplier-Id': config.supplierId,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options?.headers || {}),
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Hyphen API ${response.status}: ${text}`)
  }

  return response.json()
}

// ─── Schedule Updates Sync ──────────────────────────────────────────────

export async function syncScheduleUpdates(): Promise<SyncResult> {
  const startedAt = new Date()
  const config = await getConfig()
  if (!config) {
    return {
      provider: 'HYPHEN', syncType: 'schedule_updates', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: 'Hyphen not configured',
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  let updated = 0, skipped = 0, failed = 0

  try {
    const data = await hyphenFetch(`/api/v1/schedule-updates?supplierId=${config.supplierId}`, config)
    const updates: HyphenScheduleUpdate[] = data.updates || data

    for (const update of updates) {
      try {
        // Find Job by Hyphen event ID or by community/lot combination
        const existing: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id", "scheduledDate" FROM "Job" WHERE "hyphenJobId" = $1 OR ("community" = $2 AND "lotBlock" = $3) LIMIT 1`,
          update.eventId, update.communityName, update.lotBlock
        )

        if (existing.length > 0) {
          const job = existing[0]
          const newScheduledDate = new Date(update.scheduledDate)

          // Only update if date changed
          if (job.scheduledDate?.getTime() !== newScheduledDate.getTime()) {
            await prisma.$executeRawUnsafe(
              `UPDATE "Job" SET "scheduledDate" = $1, "hyphenJobId" = $2, "updatedAt" = NOW() WHERE "id" = $3`,
              newScheduledDate, update.eventId, job.id
            )
            updated++
          } else {
            skipped++
          }
        } else {
          skipped++
        }
      } catch (err: any) {
        failed++
        console.error(`Hyphen schedule update error for ${update.eventId}:`, err?.message)
      }
    }

    const completedAt = new Date()
    await (prisma as any).syncLog.create({
      data: {
        provider: 'HYPHEN', syncType: 'schedule_updates', direction: 'PULL',
        status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
        recordsProcessed: updated + skipped + failed,
        recordsCreated: 0, recordsUpdated: updated,
        recordsSkipped: skipped, recordsFailed: failed,
        startedAt, completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    })

    return {
      provider: 'HYPHEN', syncType: 'schedule_updates', direction: 'PULL',
      status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
      recordsProcessed: updated + skipped + failed,
      recordsCreated: 0, recordsUpdated: updated,
      recordsSkipped: skipped, recordsFailed: failed,
      startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
  } catch (error: any) {
    return {
      provider: 'HYPHEN', syncType: 'schedule_updates', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: error.message,
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }
}

// ─── Schedules Sync — Legacy pull builder schedules ──────────────────────

export async function syncSchedules(since?: Date): Promise<SyncResult> {
  const startedAt = new Date()
  const config = await getConfig()
  if (!config) {
    return {
      provider: 'HYPHEN', syncType: 'schedules', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: 'Hyphen not configured',
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  let created = 0, updated = 0, failed = 0

  try {
    const sinceParam = since ? `&modifiedSince=${since.toISOString()}` : ''
    const data = await hyphenFetch(`/api/v1/schedules?supplierId=${config.supplierId}${sinceParam}`, config)
    const schedules: HyphenScheduleUpdate[] = data.schedules || data

    for (const schedule of schedules) {
      try {
        // Find or create the community
        let community = await (prisma as any).community.findFirst({
          where: {
            OR: [
              { hyphenProjectId: schedule.projectId },
              { name: schedule.communityName },
            ],
          },
        })

        // Find matching job by lot/block and community
        let job = await (prisma as any).job.findFirst({
          where: {
            AND: [
              { lotBlock: schedule.lotBlock },
              {
                OR: [
                  { community: schedule.communityName },
                  { communityId: community?.id },
                ],
              },
            ],
          },
        })

        if (job) {
          // Update job with Hyphen schedule info
          await (prisma as any).job.update({
            where: { id: job.id },
            data: {
              hyphenJobId: schedule.eventId,
              scheduledDate: new Date(schedule.scheduledDate),
              communityId: community?.id || job.communityId,
            },
          })

          // Create/update schedule entry
          const existingEntry = await (prisma as any).scheduleEntry.findFirst({
            where: { jobId: job.id, title: { contains: schedule.activityType } },
          })

          if (existingEntry) {
            await (prisma as any).scheduleEntry.update({
              where: { id: existingEntry.id },
              data: {
                scheduledDate: new Date(schedule.scheduledDate),
                status: mapHyphenScheduleStatus(schedule.status),
                notes: schedule.notes,
              },
            })
            updated++
          } else {
            await (prisma as any).scheduleEntry.create({
              data: {
                jobId: job.id,
                entryType: mapHyphenActivityType(schedule.activityType),
                title: `${schedule.activityType} — ${schedule.communityName} ${schedule.lotBlock}`,
                scheduledDate: new Date(schedule.scheduledDate),
                status: mapHyphenScheduleStatus(schedule.status),
                notes: schedule.notes,
              },
            })
            created++
          }

          // Log as communication
          await (prisma as any).communicationLog.create({
            data: {
              channel: 'HYPHEN_NOTIFICATION',
              direction: 'INBOUND',
              subject: `Schedule Update: ${schedule.activityType} — ${schedule.communityName} ${schedule.lotBlock}`,
              body: `${schedule.activityType} scheduled for ${schedule.scheduledDate}. Status: ${schedule.status}. ${schedule.notes || ''}`,
              fromAddress: 'hyphen@system',
              toAddresses: [],
              ccAddresses: [],
              hyphenEventId: schedule.eventId,
              jobId: job.id,
              organizationId: community?.organizationId,
              sentAt: new Date(),
              status: 'LOGGED',
            },
          })
        } else {
          // No matching job — create a placeholder
          failed++
        }
      } catch (err) {
        failed++
        console.error(`Hyphen schedule sync error:`, err)
      }
    }

    const completedAt = new Date()
    await (prisma as any).syncLog.create({
      data: {
        provider: 'HYPHEN', syncType: 'schedules', direction: 'PULL',
        status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
        recordsProcessed: created + updated + failed,
        recordsCreated: created, recordsUpdated: updated,
        recordsSkipped: 0, recordsFailed: failed,
        startedAt, completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    })

    return {
      provider: 'HYPHEN', syncType: 'schedules', direction: 'PULL',
      status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
      recordsProcessed: created + updated + failed,
      recordsCreated: created, recordsUpdated: updated,
      recordsSkipped: 0, recordsFailed: failed,
      startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
  } catch (error: any) {
    return {
      provider: 'HYPHEN', syncType: 'schedules', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: error.message,
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }
}

// ─── Payment Sync ───────────────────────────────────────────────────────

export async function syncPayments(): Promise<SyncResult> {
  const startedAt = new Date()
  const config = await getConfig()
  if (!config) {
    return {
      provider: 'HYPHEN', syncType: 'payments', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: 'Hyphen not configured',
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  let updated = 0, failed = 0

  try {
    const data = await hyphenFetch(`/api/v1/payment-notifications?supplierId=${config.supplierId}`, config)
    const payments: HyphenPaymentNotification[] = data.notifications || data

    for (const payment of payments) {
      try {
        const invoice: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id", "total", "amountPaid", "balanceDue" FROM "Invoice" WHERE "invoiceNumber" = $1 LIMIT 1`,
          payment.invoiceNumber
        )

        if (invoice.length > 0) {
          const inv = invoice[0]
          const newAmountPaid = (Number(inv.amountPaid) || 0) + payment.amount
          const newBalanceDue = Math.max(0, (Number(inv.total) || 0) - newAmountPaid)
          const isPaid = newBalanceDue <= 0

          // Update invoice payment status. Backfill issuedAt — a Hyphen
          // payment notification implicitly issues a DRAFT invoice (audit
          // 2026-04-24).
          await prisma.$executeRawUnsafe(
            `UPDATE "Invoice" SET "amountPaid" = $1, "balanceDue" = $2, "status" = CASE WHEN $3 THEN 'PAID'::status ELSE "status" END, "paidAt" = CASE WHEN $3 THEN NOW() ELSE "paidAt" END, "issuedAt" = COALESCE("issuedAt", NOW()), "updatedAt" = NOW() WHERE "id" = $4`,
            newAmountPaid, newBalanceDue, isPaid, inv.id
          )

          // Create Payment record
          await prisma.$executeRawUnsafe(
            `INSERT INTO "Payment" ("id", "invoiceId", "amount", "method", "reference", "receivedAt", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
            `pay_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
            inv.id,
            payment.amount,
            mapHyphenPaymentMethod(payment.method),
            payment.reference || null,
            new Date(payment.paymentDate)
          )

          updated++
        }
      } catch (err: any) {
        failed++
        console.error(`Hyphen payment sync error for ${payment.paymentId}:`, err?.message)
      }
    }

    const completedAt = new Date()
    await (prisma as any).syncLog.create({
      data: {
        provider: 'HYPHEN', syncType: 'payments', direction: 'PULL',
        status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
        recordsProcessed: updated + failed,
        recordsCreated: updated, recordsUpdated: 0,
        recordsSkipped: 0, recordsFailed: failed,
        startedAt, completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    })

    return {
      provider: 'HYPHEN', syncType: 'payments', direction: 'PULL',
      status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
      recordsProcessed: updated + failed,
      recordsCreated: updated, recordsUpdated: 0,
      recordsSkipped: 0, recordsFailed: failed,
      startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
  } catch (error: any) {
    return {
      provider: 'HYPHEN', syncType: 'payments', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: error.message,
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }
}

// ─── Orders Sync ─────────────────────────────────────────────────────────

export async function syncOrders(): Promise<SyncResult> {
  const startedAt = new Date()
  const config = await getConfig()
  if (!config) {
    return {
      provider: 'HYPHEN', syncType: 'orders', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: 'Hyphen not configured',
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  let created = 0, updated = 0, failed = 0

  try {
    const data = await hyphenFetch(`/api/v1/purchase-orders?supplierId=${config.supplierId}`, config)
    const orders: HyphenPurchaseOrder[] = data.orders || data

    for (const hyphenPO of orders) {
      try {
        // Check if order already exists
        const existing: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id", "hyphenPoId" FROM "Order" WHERE "hyphenPoId" = $1 LIMIT 1`,
          hyphenPO.poId
        )

        if (existing.length > 0) {
          // Update existing order
          await prisma.$executeRawUnsafe(
            `UPDATE "Order" SET "status" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
            mapHyphenPOStatus(hyphenPO.status),
            existing[0].id
          )
          updated++
        } else {
          // Try to find matching Job by community and lot
          const job: any[] = await prisma.$queryRawUnsafe(
            `SELECT "id", "builderId" FROM "Job" WHERE "community" = $1 AND "lotBlock" = $2 LIMIT 1`,
            hyphenPO.communityName, hyphenPO.lotBlock
          )

          if (job.length > 0) {
            const jobId = job[0].id
            const builderId = job[0].builderId

            // Create new order
            const orderId = `order_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
            let subtotal = 0

            for (const item of hyphenPO.items) {
              subtotal += item.quantity * item.unitPrice
            }

            await prisma.$executeRawUnsafe(`
              INSERT INTO "Order" (
                "id", "builderId", "jobId", "orderNumber", "poNumber", "hyphenPoId",
                "subtotal", "taxAmount", "total", "status", "paymentTerm",
                "createdAt", "updatedAt"
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
            `,
              orderId, builderId, jobId, `PO-${hyphenPO.poNumber}`,
              hyphenPO.poNumber, hyphenPO.poId,
              subtotal, 0, subtotal,
              mapHyphenPOStatus(hyphenPO.status),
              'NET_30'
            )

            // Create order items
            for (const item of hyphenPO.items) {
              const itemId = `orderitem_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
              const lineTotal = item.quantity * item.unitPrice

              await prisma.$executeRawUnsafe(`
                INSERT INTO "OrderItem" (
                  "id", "orderId", "sku", "description", "quantity",
                  "unitPrice", "lineTotal", "createdAt", "updatedAt"
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
              `,
                itemId, orderId, item.sku, item.description,
                item.quantity, item.unitPrice, lineTotal
              )
            }

            created++
          }
        }
      } catch (err: any) {
        failed++
        console.error(`Hyphen order sync error for ${hyphenPO.poId}:`, err?.message)
      }
    }

    const completedAt = new Date()
    await (prisma as any).syncLog.create({
      data: {
        provider: 'HYPHEN', syncType: 'orders', direction: 'PULL',
        status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
        recordsProcessed: created + updated + failed,
        recordsCreated: created, recordsUpdated: updated,
        recordsSkipped: 0, recordsFailed: failed,
        startedAt, completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    })

    return {
      provider: 'HYPHEN', syncType: 'orders', direction: 'PULL',
      status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
      recordsProcessed: created + updated + failed,
      recordsCreated: created, recordsUpdated: updated,
      recordsSkipped: 0, recordsFailed: failed,
      startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
  } catch (error: any) {
    return {
      provider: 'HYPHEN', syncType: 'orders', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: error.message,
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }
}

// ─── Payment Notification Handler ────────────────────────────────────

export async function handlePaymentNotification(notification: HyphenPaymentNotification) {
  try {
    // Find matching invoice
    const invoice = await (prisma as any).invoice.findFirst({
      where: { invoiceNumber: notification.invoiceNumber },
    })

    if (invoice) {
      // Create payment record
      await (prisma as any).payment.create({
        data: {
          invoiceId: invoice.id,
          amount: notification.amount,
          method: mapHyphenPaymentMethod(notification.method),
          reference: notification.reference || notification.paymentId,
          receivedAt: new Date(notification.paymentDate),
          notes: `Via Hyphen — Payment ID: ${notification.paymentId}`,
        },
      })

      // Update invoice. Backfill issuedAt — a Hyphen payment notification
      // implicitly issues a DRAFT invoice (audit 2026-04-24).
      const newPaid = invoice.amountPaid + notification.amount
      const newBalance = invoice.total - newPaid
      await (prisma as any).invoice.update({
        where: { id: invoice.id },
        data: {
          amountPaid: newPaid,
          balanceDue: newBalance,
          status: newBalance <= 0 ? 'PAID' : 'PARTIALLY_PAID',
          paidAt: newBalance <= 0 ? new Date() : null,
          issuedAt: invoice.issuedAt ?? new Date(notification.paymentDate),
        },
      })

      // Log as communication
      await (prisma as any).communicationLog.create({
        data: {
          channel: 'HYPHEN_NOTIFICATION',
          direction: 'INBOUND',
          subject: `Payment Received: ${notification.invoiceNumber} — $${notification.amount.toFixed(2)}`,
          body: `Payment of $${notification.amount.toFixed(2)} received for invoice ${notification.invoiceNumber} via ${notification.method}.`,
          fromAddress: 'hyphen-payments@system',
          toAddresses: [],
          ccAddresses: [],
          hyphenEventId: notification.paymentId,
          builderId: invoice.builderId,
          sentAt: new Date(notification.paymentDate),
          status: 'LOGGED',
        },
      })
    }
  } catch (error) {
    console.error('Hyphen payment notification error:', error)
  }
}

// ─── PO Acknowledgment — Push to Hyphen ──────────────────────────────

export async function sendPOAcknowledgment(poNumber: string, status: 'ACCEPTED' | 'REJECTED', notes?: string) {
  const config = await getConfig()
  if (!config) throw new Error('Hyphen not configured')

  await hyphenFetch('/api/v1/purchase-orders/acknowledge', config, {
    method: 'POST',
    body: JSON.stringify({
      supplierId: config.supplierId,
      poNumber,
      status,
      acknowledgedAt: new Date().toISOString(),
      notes,
    }),
  })
}

// ─── Webhook Handler ─────────────────────────────────────────────────

export async function handleWebhook(eventType: string, payload: any) {
  switch (eventType) {
    case 'schedule.updated':
    case 'schedule.created':
      // Process as schedule sync for a single event
      await syncSchedules()
      break

    case 'payment.received':
      await handlePaymentNotification(payload as HyphenPaymentNotification)
      break

    case 'po.created':
    case 'po.updated':
      break

    case 'change_order.created':
      // Log change order as communication
      await (prisma as any).communicationLog.create({
        data: {
          channel: 'HYPHEN_NOTIFICATION',
          direction: 'INBOUND',
          subject: `Change Order: ${payload.description || 'New change order'}`,
          body: JSON.stringify(payload, null, 2),
          fromAddress: 'hyphen@system',
          toAddresses: [],
          ccAddresses: [],
          hyphenEventId: payload.changeOrderId,
          sentAt: new Date(),
          status: 'NEEDS_FOLLOW_UP',
        },
      })
      break

    default:
      break
  }
}

// ─── Connection Test ─────────────────────────────────────────────────

export async function testConnection(apiKey: string, baseUrl: string, supplierId: string): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/supplier/profile`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'X-Supplier-Id': supplierId,
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      return { success: false, message: `API returned ${response.status}: ${response.statusText}` }
    }

    return { success: true, message: 'Connected to Hyphen SupplyPro successfully' }
  } catch (error: any) {
    return { success: false, message: error.message }
  }
}

// ─── Status Mapping ──────────────────────────────────────────────────

function mapHyphenActivityType(activityType: string): string {
  const map: Record<string, string> = {
    'DOOR_HANG': 'INSTALLATION',
    'TRIM_INSTALL': 'INSTALLATION',
    'DELIVERY': 'DELIVERY',
    'INSPECTION': 'INSPECTION',
    'PICKUP': 'PICKUP',
  }
  return map[activityType] || 'DELIVERY'
}

function mapHyphenScheduleStatus(status: string): string {
  const map: Record<string, string> = {
    'Scheduled': 'FIRM',
    'Tentative': 'TENTATIVE',
    'InProgress': 'IN_PROGRESS',
    'Complete': 'COMPLETED',
    'Rescheduled': 'RESCHEDULED',
    'Cancelled': 'CANCELLED',
  }
  return map[status] || 'TENTATIVE'
}

function mapHyphenPaymentMethod(method: string): string {
  const map: Record<string, string> = {
    'Check': 'CHECK',
    'ACH': 'ACH',
    'Wire': 'WIRE',
    'CreditCard': 'CREDIT_CARD',
  }
  return map[method] || 'OTHER'
}

function mapHyphenPOStatus(hyphenStatus: string): string {
  const map: Record<string, string> = {
    'DRAFT': 'RECEIVED',
    'PENDING': 'RECEIVED',
    'CONFIRMED': 'CONFIRMED',
    'IN_PROGRESS': 'IN_PRODUCTION',
    'READY': 'READY_TO_SHIP',
    'SHIPPED': 'SHIPPED',
    'DELIVERED': 'DELIVERED',
    'COMPLETED': 'COMPLETE',
    'CANCELLED': 'CANCELLED',
  }
  return map[hyphenStatus] || 'RECEIVED'
}
