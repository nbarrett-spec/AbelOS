// ──────────────────────────────────────────────────────────────────────────
// Hyphen BuildPro / SupplyPro — Integration
// REST (JSON) + SOAP (xCBL 4.0) + FTP (CSV)
// Bidirectional: schedules, POs, change orders, payments from builders
// Used by: Pulte, Toll Brothers, Brookfield, and other national builders
// ──────────────────────────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma'
import { decryptCredential } from '@/lib/hyphen/crypto'
import type { HyphenScheduleUpdate, HyphenPurchaseOrder, HyphenPaymentNotification, SyncResult } from './types'

interface HyphenConfig {
  apiKey: string
  baseUrl: string
  supplierId: string
  // Multi-tenant additions (optional — back-compat with single-tenant getConfig).
  tenantId?: string
  builderName?: string
  username?: string
  password?: string
  // Incremental sync watermark — when present, sync calls add
  // `modifiedSince=<ISO>` to the Hyphen API request so we only pull
  // changed records. Null/undefined => full import (first run).
  // See A-PERF-4 (2026-05-05). Owned by the multi-tenant orchestrator.
  lastSyncAt?: Date | null
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

// ─── Multi-tenant: pull every active HyphenTenant row ──────────────────
//
// Each builder (Brookfield, Toll Brothers, Shaddock) has its own HyphenTenant
// row with its own credentials + baseUrl. The cron iterates these in turn.
//
// Falls back to legacy getConfig() if the HyphenTenant table is empty (so we
// don't black-hole single-tenant deploys).
export async function getAllTenants(): Promise<HyphenConfig[]> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "builderName", "baseUrl", "username", "password",
              "oauthAccessToken", "oauthExpiresAt", "lastSyncAt"
       FROM "HyphenTenant"
       WHERE "syncEnabled" = TRUE
       ORDER BY "builderName" ASC`
    )

    if (rows.length === 0) {
      const legacy = await getConfig()
      return legacy ? [legacy] : []
    }

    const tenants: HyphenConfig[] = []
    for (const r of rows) {
      // A-SEC-6: credential columns are AES-256-GCM-encrypted on disk.
      // decryptCredential() passes plaintext through unchanged so legacy
      // rows keep working until the one-shot migration runs.
      let username: string | null = null
      let password: string | null = null
      let oauthAccessToken: string | null = null
      try {
        username = decryptCredential(r.username)
        password = decryptCredential(r.password)
        oauthAccessToken = decryptCredential(r.oauthAccessToken)
      } catch (e: any) {
        console.warn(`HyphenTenant ${r.builderName} (${r.id}) credential decrypt failed — skipping: ${e?.message}`)
        continue
      }
      const apiKey = oauthAccessToken || password || ''
      const baseUrl = r.baseUrl || 'https://www.bldrconnect.com'
      if (!apiKey || !baseUrl) {
        console.warn(`HyphenTenant ${r.builderName} (${r.id}) missing apiKey/baseUrl — skipping`)
        continue
      }
      tenants.push({
        apiKey,
        baseUrl,
        supplierId: r.builderName || '',
        tenantId: r.id,
        builderName: r.builderName || undefined,
        username: username || undefined,
        password: password || undefined,
        lastSyncAt: r.lastSyncAt ? new Date(r.lastSyncAt) : null,
      })
    }
    return tenants
  } catch (err: any) {
    // Table not yet migrated (Phase 1 has additive migration pending). Fall
    // back to legacy single-tenant getConfig() so the cron still works.
    const msg = err?.message || String(err)
    if (/HyphenTenant|relation .* does not exist/i.test(msg)) {
      const legacy = await getConfig()
      return legacy ? [legacy] : []
    }
    throw err
  }
}

// Per-tenant sync-status writeback. Best-effort — never throws.
//
// IMPORTANT (A-PERF-4, 2026-05-05): this function deliberately does NOT
// advance "lastSyncAt". The watermark is the incremental-sync cursor —
// advancing it on a partial/failed run would silently drop the records
// in the missed window. Only `advanceTenantWatermark` (called by the
// cron when all three sync types succeed for a tenant) moves the cursor
// forward. Keeping these concerns split means status reflects the most
// recent attempt, while the watermark only moves when we're sure we
// got everything.
async function recordTenantSync(
  tenantId: string | undefined,
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED',
  error?: string,
) {
  if (!tenantId) return
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "HyphenTenant"
       SET "lastSyncStatus" = $1,
           "lastSyncError" = $2,
           "updatedAt" = NOW()
       WHERE "id" = $3`,
      status,
      error || null,
      tenantId,
    )
  } catch (e: any) {
    console.warn(`recordTenantSync failed for ${tenantId}:`, e?.message)
  }
}

/**
 * Advance HyphenTenant.lastSyncAt — the incremental-sync watermark.
 * The cron calls this once per tenant, ONLY when every sync type
 * (orders/payments/schedule) returned status === 'SUCCESS' for that
 * tenant. The supplied `at` should be the timestamp captured BEFORE
 * fetch began (so a record modified mid-sync doesn't get skipped on
 * the next run). Best-effort — never throws.
 */
export async function advanceTenantWatermark(
  tenantId: string | undefined,
  at: Date,
) {
  if (!tenantId) return
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "HyphenTenant"
       SET "lastSyncAt" = $1,
           "updatedAt" = NOW()
       WHERE "id" = $2`,
      at,
      tenantId,
    )
  } catch (e: any) {
    console.warn(`advanceTenantWatermark failed for ${tenantId}:`, e?.message)
  }
}

function emptyResult(syncType: 'schedule_updates' | 'payments' | 'orders', error: string, startedAt: Date): SyncResult {
  return {
    provider: 'HYPHEN', syncType, direction: 'PULL',
    status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
    recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
    errorMessage: error,
    startedAt, completedAt: new Date(),
    durationMs: Date.now() - startedAt.getTime(),
  }
}

// Aggregate N per-tenant SyncResult rows into a single SyncResult so
// callers/cron-observability that expect the original shape keep working.
function aggregateResults(syncType: 'schedule_updates' | 'payments' | 'orders', results: Array<{ tenant: string; result: SyncResult }>, startedAt: Date): SyncResult {
  const completedAt = new Date()
  if (results.length === 0) {
    return {
      provider: 'HYPHEN', syncType, direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: 'No active HyphenTenant rows configured',
      startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
  }
  let created = 0, updated = 0, skipped = 0, failed = 0
  const errors: string[] = []
  let anySuccess = false, anyFailed = false
  for (const { tenant, result } of results) {
    created += result.recordsCreated
    updated += result.recordsUpdated
    skipped += result.recordsSkipped
    failed += result.recordsFailed
    if (result.status === 'FAILED') {
      anyFailed = true
      errors.push(`${tenant}: ${result.errorMessage || 'unknown'}`)
    } else {
      anySuccess = true
    }
  }
  const status: SyncResult['status'] = anyFailed && anySuccess ? 'PARTIAL' : anyFailed ? 'FAILED' : 'SUCCESS'
  return {
    provider: 'HYPHEN', syncType, direction: 'PULL',
    status,
    recordsProcessed: created + updated + skipped + failed,
    recordsCreated: created, recordsUpdated: updated,
    recordsSkipped: skipped, recordsFailed: failed,
    errorMessage: errors.length > 0 ? errors.join(' | ') : undefined,
    startedAt, completedAt,
    durationMs: completedAt.getTime() - startedAt.getTime(),
  }
}

// Build a `&modifiedSince=<ISO>` suffix for an existing query string,
// or return '' when this is the first run for the tenant. Hyphen's REST
// surface accepts modifiedSince on schedule-updates, payment-notifications,
// and purchase-orders endpoints (already used by the legacy syncSchedules
// path). Falls back gracefully if the API ignores the param.
function modifiedSinceParam(config: HyphenConfig): string {
  if (!config.lastSyncAt) return ''
  return `&modifiedSince=${encodeURIComponent(config.lastSyncAt.toISOString())}`
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

export async function syncScheduleUpdates(tenantOverride?: HyphenConfig): Promise<SyncResult> {
  // Multi-tenant orchestrator: if no override given, iterate every active
  // HyphenTenant and aggregate. Per-tenant failures are isolated.
  if (!tenantOverride) {
    const startedAt = new Date()
    const tenants = await getAllTenants()
    if (tenants.length === 0) {
      return emptyResult('schedule_updates', 'Hyphen not configured', startedAt)
    }
    const results: Array<{ tenant: string; result: SyncResult }> = []
    for (const t of tenants) {
      try {
        const r = await syncScheduleUpdates(t)
        results.push({ tenant: t.builderName || t.tenantId || 'unknown', result: r })
        await recordTenantSync(t.tenantId, r.status === 'FAILED' ? 'FAILED' : (r.recordsFailed > 0 ? 'PARTIAL' : 'SUCCESS'), r.errorMessage)
      } catch (err: any) {
        const failResult = emptyResult('schedule_updates', err?.message || String(err), startedAt)
        results.push({ tenant: t.builderName || t.tenantId || 'unknown', result: failResult })
        await recordTenantSync(t.tenantId, 'FAILED', err?.message || String(err))
      }
    }
    return aggregateResults('schedule_updates', results, startedAt)
  }

  const config = tenantOverride
  const startedAt = new Date()

  let updated = 0, skipped = 0, failed = 0

  try {
    const data = await hyphenFetch(
      `/api/v1/schedule-updates?supplierId=${config.supplierId}${modifiedSinceParam(config)}`,
      config,
    )
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

export async function syncPayments(tenantOverride?: HyphenConfig): Promise<SyncResult> {
  if (!tenantOverride) {
    const startedAt = new Date()
    const tenants = await getAllTenants()
    if (tenants.length === 0) {
      return emptyResult('payments', 'Hyphen not configured', startedAt)
    }
    const results: Array<{ tenant: string; result: SyncResult }> = []
    for (const t of tenants) {
      try {
        const r = await syncPayments(t)
        results.push({ tenant: t.builderName || t.tenantId || 'unknown', result: r })
        await recordTenantSync(t.tenantId, r.status === 'FAILED' ? 'FAILED' : (r.recordsFailed > 0 ? 'PARTIAL' : 'SUCCESS'), r.errorMessage)
      } catch (err: any) {
        const failResult = emptyResult('payments', err?.message || String(err), startedAt)
        results.push({ tenant: t.builderName || t.tenantId || 'unknown', result: failResult })
        await recordTenantSync(t.tenantId, 'FAILED', err?.message || String(err))
      }
    }
    return aggregateResults('payments', results, startedAt)
  }

  const config = tenantOverride
  const startedAt = new Date()

  let updated = 0, failed = 0

  try {
    const data = await hyphenFetch(
      `/api/v1/payment-notifications?supplierId=${config.supplierId}${modifiedSinceParam(config)}`,
      config,
    )
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

export async function syncOrders(tenantOverride?: HyphenConfig): Promise<SyncResult> {
  if (!tenantOverride) {
    const startedAt = new Date()
    const tenants = await getAllTenants()
    if (tenants.length === 0) {
      return emptyResult('orders', 'Hyphen not configured', startedAt)
    }
    const results: Array<{ tenant: string; result: SyncResult }> = []
    for (const t of tenants) {
      try {
        const r = await syncOrders(t)
        results.push({ tenant: t.builderName || t.tenantId || 'unknown', result: r })
        await recordTenantSync(t.tenantId, r.status === 'FAILED' ? 'FAILED' : (r.recordsFailed > 0 ? 'PARTIAL' : 'SUCCESS'), r.errorMessage)
      } catch (err: any) {
        const failResult = emptyResult('orders', err?.message || String(err), startedAt)
        results.push({ tenant: t.builderName || t.tenantId || 'unknown', result: failResult })
        await recordTenantSync(t.tenantId, 'FAILED', err?.message || String(err))
      }
    }
    return aggregateResults('orders', results, startedAt)
  }

  const config = tenantOverride
  const startedAt = new Date()

  let created = 0, updated = 0, failed = 0

  try {
    const data = await hyphenFetch(
      `/api/v1/purchase-orders?supplierId=${config.supplierId}${modifiedSinceParam(config)}`,
      config,
    )
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
