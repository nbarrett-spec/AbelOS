// ──────────────────────────────────────────────────────────────────────────
// InFlow Inventory — Live API Integration
// REST API: https://cloudapi.inflowinventory.com/{companyId}/
// Auth: API Key in header
// Rate limit: 60 requests/minute
// ──────────────────────────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma'
import type { InflowProduct, InflowPurchaseOrder, SyncResult } from './types'

const INFLOW_BASE = 'https://cloudapi.inflowinventory.com'
const RATE_LIMIT_DELAY = 400 // Inter-page sleep. InFlow quota is 60 req/min; 400ms = ~2.5 req/sec, safe headroom.

interface InflowConfig {
  apiKey: string
  companyId: string
}

async function getConfig(): Promise<InflowConfig | null> {
  // Try database first
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "apiKey", "companyId", "status"::text as "status" FROM "IntegrationConfig" WHERE "provider" = 'INFLOW' LIMIT 1`
    )
    const config = rows[0]
    if (config?.apiKey && config?.companyId && config.status === 'CONNECTED') {
      return { apiKey: config.apiKey, companyId: config.companyId }
    }
  } catch {
    // Table may not exist yet — fall through to env vars
  }

  // Fall back to environment variables
  const apiKey = process.env.INFLOW_API_KEY
  const companyId = process.env.INFLOW_COMPANY_ID
  if (apiKey && companyId) {
    return { apiKey, companyId }
  }

  return null
}

// ──────────────────────────────────────────────────────────────────────────
// fetchWithBackoff — retry helper shared by every InFlow call.
//
// Policy (matches Wave-1 A4 spec, 2026-04-23):
//   • Max 5 retries per call (6 total attempts including the initial try).
//   • Retry on 429 and any 5xx. Non-retryable on 4xx other than 429.
//   • Backoff schedule: 500ms, 1s, 2s, 4s, 8s — with ±20% jitter.
//   • Honor `Retry-After` header when server sends one (clamped to at least
//     the computed backoff so we never retry faster than planned).
//   • Per-attempt duration logging: endpoint, status, attempts, ms.
//   • Final failure throws an Error with full context (status, URL, body
//     snippet ≤ 512 chars) so the cron log and Sentry can attribute blame.
//   • Network/DNS errors (fetch throws) are retried the same as 5xx.
//
// Also drives the consecutive-failure circuit breaker used by the cron
// route — see `recordEndpointFailure`/`resetEndpointFailure` below.
// ──────────────────────────────────────────────────────────────────────────

export interface FetchWithBackoffOptions {
  /** Max retries AFTER the initial attempt. Default 5 → up to 6 total tries. */
  maxRetries?: number
  /** Base delay in ms for attempt 0's backoff. Default 500. Schedule = base * 2^n. */
  baseMs?: number
  /** Upper cap on any single backoff sleep. Default 30s — protects Vercel timeout. */
  capMs?: number
  /** For testability: force a 429 on the first N attempts (helper mocks rate-limit). */
  forceRetryAttempts?: number
}

interface FetchWithBackoffResult<T> {
  data: T
  attempts: number
  durationMs: number
  status: number
}

function jitter(ms: number): number {
  // ±20% jitter. Random in [0.8, 1.2].
  const factor = 0.8 + Math.random() * 0.4
  return Math.round(ms * factor)
}

function normalizeEndpoint(path: string): string {
  // Strip query so circuit-breaker + logs bucket by endpoint, not by page number.
  // `/products?page=1&pageSize=100` → `/products`.
  const qIdx = path.indexOf('?')
  return qIdx === -1 ? path : path.slice(0, qIdx)
}

export async function fetchWithBackoff<T = any>(
  url: string,
  init: RequestInit,
  opts: FetchWithBackoffOptions & { endpoint?: string } = {}
): Promise<FetchWithBackoffResult<T>> {
  const maxRetries = opts.maxRetries ?? 5
  const baseMs = opts.baseMs ?? 500
  const capMs = opts.capMs ?? 30_000
  const endpoint = opts.endpoint ?? url
  const startedAt = Date.now()
  let attempt = 0
  let lastStatus = 0
  let lastBody = ''

  while (attempt <= maxRetries) {
    const attemptStart = Date.now()
    let response: Response | null = null
    let threwNetwork = false
    let networkErr: any = null

    try {
      // forceRetryAttempts is a test hook — simulates a 429 for the first N
      // attempts so we can verify the helper retries without hitting the live
      // API. See `__mockRateLimitedFetch` below for manual-run usage.
      if (opts.forceRetryAttempts && attempt < opts.forceRetryAttempts) {
        response = new Response('{"error":"rate limit (forced)"}', {
          status: 429,
          headers: { 'Retry-After': '0' },
        })
      } else {
        response = await fetch(url, init)
      }
    } catch (err: any) {
      threwNetwork = true
      networkErr = err
    }

    const attemptMs = Date.now() - attemptStart

    // Success path.
    if (response && response.ok) {
      const data = (await response.json()) as T
      const totalMs = Date.now() - startedAt
      console.log(`[InFlow] ${endpoint} ok status=${response.status} attempts=${attempt + 1} ms=${totalMs}`)
      resetEndpointFailure(normalizeEndpoint(endpoint))
      return { data, attempts: attempt + 1, durationMs: totalMs, status: response.status }
    }

    // Figure out whether to retry.
    const status = response?.status ?? 0
    lastStatus = status
    const retryable = threwNetwork || status === 429 || (status >= 500 && status <= 599)

    // Capture body snippet for error context (best-effort; bodies can be huge).
    if (response) {
      try {
        lastBody = (await response.text()).slice(0, 512)
      } catch {
        lastBody = ''
      }
    } else if (threwNetwork) {
      lastBody = `network error: ${networkErr?.message || String(networkErr)}`
    }

    if (!retryable || attempt >= maxRetries) {
      // Give up.
      const totalMs = Date.now() - startedAt
      console.warn(`[InFlow] ${endpoint} fail status=${status} attempts=${attempt + 1} ms=${totalMs} body="${lastBody.slice(0, 120)}"`)
      recordEndpointFailure(normalizeEndpoint(endpoint))
      const err: any = new Error(
        `InFlow API ${status || 'ERR'} on ${endpoint} after ${attempt + 1} attempts: ${lastBody}`
      )
      err.status = status
      err.url = url
      err.endpoint = endpoint
      err.attempts = attempt + 1
      err.bodySnippet = lastBody
      throw err
    }

    // Compute backoff. Schedule = base * 2^attempt with ±20% jitter.
    // Retry-After (seconds) takes precedence, but we never go below the
    // computed floor so a buggy `Retry-After: 0` can't cause a tight loop.
    const expMs = Math.min(baseMs * Math.pow(2, attempt), capMs)
    let backoffMs = jitter(expMs)
    const retryAfterHeader = response?.headers.get('Retry-After')
    if (retryAfterHeader) {
      const secs = parseInt(retryAfterHeader, 10)
      if (Number.isFinite(secs) && secs > 0) {
        backoffMs = Math.max(secs * 1000, backoffMs)
      }
    }
    backoffMs = Math.min(backoffMs, capMs)

    console.warn(
      `[InFlow] ${endpoint} retry status=${status || 'net-err'} attempt=${attempt + 1}/${maxRetries + 1} ms=${attemptMs} backoff=${backoffMs}ms retry-after=${retryAfterHeader || 'none'}`
    )
    await new Promise(r => setTimeout(r, backoffMs))
    attempt++
  }

  // Unreachable — the while body always either returns or throws.
  const totalMs = Date.now() - startedAt
  recordEndpointFailure(normalizeEndpoint(endpoint))
  throw new Error(`InFlow API ${lastStatus}: exhausted ${maxRetries + 1} attempts on ${endpoint} (total ${totalMs}ms): ${lastBody}`)
}

// ──────────────────────────────────────────────────────────────────────────
// Circuit breaker: track consecutive failures per normalized endpoint.
// The cron route uses this to bail early and mark the run degraded when a
// single InFlow endpoint is chronically broken — no thrash, no false PARTIAL
// successes — see `consecutiveFailuresForAnyEndpoint` / `degradedEndpoint`.
// ──────────────────────────────────────────────────────────────────────────

const endpointFailureCount = new Map<string, number>()

function recordEndpointFailure(endpoint: string) {
  endpointFailureCount.set(endpoint, (endpointFailureCount.get(endpoint) ?? 0) + 1)
}

function resetEndpointFailure(endpoint: string) {
  if (endpointFailureCount.has(endpoint)) {
    endpointFailureCount.delete(endpoint)
  }
}

/** Returns the endpoint that has tripped the threshold, or null. */
export function degradedEndpoint(threshold = 10): string | null {
  for (const [endpoint, count] of endpointFailureCount.entries()) {
    if (count >= threshold) return endpoint
  }
  return null
}

/** Clears the in-memory circuit breaker state. Call at the top of each cron run. */
export function resetDegradedTracker() {
  endpointFailureCount.clear()
}

async function inflowFetch(path: string, config: InflowConfig, options?: RequestInit) {
  const url = `${INFLOW_BASE}/${config.companyId}${path}`
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json;version=2026-02-24',
  }

  const merged: RequestInit = {
    ...options,
    headers: {
      ...headers,
      ...(options?.headers || {}),
    },
  }

  const { data } = await fetchWithBackoff<any>(url, merged, {
    maxRetries: 5,
    baseMs: 500,
    capMs: 30_000,
    endpoint: path,
  })
  return data
}

// ─── Shared: write SyncLog via raw SQL (never use Prisma client for this) ──

async function writeSyncLog(data: {
  provider: string; syncType: string; direction: string; status: string;
  recordsProcessed: number; recordsCreated: number; recordsUpdated: number;
  recordsSkipped: number; recordsFailed: number; errorMessage?: string | null;
  startedAt: Date; completedAt: Date; durationMs: number;
}) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "SyncLog" (
      "id", "provider", "syncType", "direction", "status",
      "recordsProcessed", "recordsCreated", "recordsUpdated",
      "recordsSkipped", "recordsFailed", "errorMessage",
      "startedAt", "completedAt", "durationMs", "createdAt"
    ) VALUES (
      gen_random_uuid()::text, $1, $2, $3, $4,
      $5, $6, $7, $8, $9, $10,
      $11, $12, $13, CURRENT_TIMESTAMP
    )`,
    data.provider, data.syncType, data.direction, data.status,
    data.recordsProcessed, data.recordsCreated, data.recordsUpdated,
    data.recordsSkipped, data.recordsFailed, data.errorMessage || null,
    data.startedAt, data.completedAt, data.durationMs
  )
}

// ─── Product Sync ────────────────────────────────────────────────────

export async function syncProducts(): Promise<SyncResult> {
  const startedAt = new Date()
  const config = await getConfig()
  if (!config) {
    return {
      provider: 'INFLOW',
      syncType: 'products',
      direction: 'PULL',
      status: 'FAILED',
      recordsProcessed: 0, recordsCreated: 0, recordsUpdated: 0,
      recordsSkipped: 0, recordsFailed: 0,
      errorMessage: 'InFlow not configured or not connected',
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  let created = 0, updated = 0, skipped = 0, failed = 0
  let page = 1
  // Safety cap: 300 * 100 = 30,000 products max. InFlow currently has ~6,800.
  // Previous implementation died at page 61 with 429s because `inflowFetch` only
  // retried 3 times. Fixed by: (a) 6-retry exponential backoff in inflowFetch,
  // (b) 400ms inter-page sleep (was 200ms), (c) honor Retry-After header.
  const MAX_PAGES = 300
  const PAGE_SIZE = 100

  try {
    while (page <= MAX_PAGES) {
      const data = await inflowFetch(`/products?page=${page}&pageSize=${PAGE_SIZE}&includeInactive=false`, config)
      const products: InflowProduct[] = data.data || data

      if (!products.length) break

      // Log first-page shape for debugging
      if (page === 1 && products.length > 0) {
        console.log('[InFlow Product Sync] First record keys:', Object.keys(products[0]).join(', '))
      }

      for (const ifProduct of products) {
        try {
          // InFlow Cloud API uses 'productId' (UUID), NOT 'id'
          const inflowProductId = String(ifProduct.productId || ifProduct.id || '')
          if (!inflowProductId || inflowProductId === 'undefined') {
            skipped++
            continue
          }

          // Find existing product by inflowId or SKU using raw SQL
          const existing: any[] = await prisma.$queryRawUnsafe(
            `SELECT "id", "description", "inflowCategory", "cost", "basePrice" FROM "Product"
             WHERE "inflowId" = $1 OR "sku" = $2
             LIMIT 1`,
            inflowProductId, ifProduct.sku || ''
          )

          // InFlow listing endpoint doesn't include cost/price/qty.
          // Only overwrite if InFlow actually provides them; otherwise keep existing values.
          const hasCost = ifProduct.cost !== undefined && ifProduct.cost !== null
          const hasPrice = ifProduct.price !== undefined && ifProduct.price !== null
          const hasQty = ifProduct.quantityOnHand !== undefined && ifProduct.quantityOnHand !== null

          if (existing.length > 0) {
            await prisma.$executeRawUnsafe(
              `UPDATE "Product" SET
                "name" = $1, "description" = COALESCE(NULLIF($2, ''), "description"),
                "cost" = CASE WHEN $3::boolean THEN $4 ELSE "cost" END,
                "basePrice" = CASE WHEN $5::boolean THEN $6 ELSE "basePrice" END,
                "active" = $7,
                "inStock" = CASE WHEN $8::boolean THEN $9 ELSE "inStock" END,
                "inflowId" = $10,
                "inflowCategory" = COALESCE(NULLIF($11, ''), "inflowCategory"),
                "lastSyncedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
              WHERE "id" = $12`,
              (ifProduct.name || '').trim(),
              ifProduct.description || '',
              hasCost, ifProduct.cost || 0,
              hasPrice, ifProduct.price || 0,
              ifProduct.isActive !== false,
              hasQty, hasQty ? ((ifProduct.quantityOnHand || 0) > 0) : false,
              inflowProductId,
              ifProduct.category || '',
              existing[0].id
            )
            updated++
          } else {
            await prisma.$executeRawUnsafe(
              `INSERT INTO "Product" (
                "id", "sku", "name", "description", "category", "subcategory",
                "cost", "basePrice", "active", "inStock",
                "inflowId", "inflowCategory", "lastSyncedAt",
                "createdAt", "updatedAt"
              ) VALUES (
                gen_random_uuid()::text, $1, $2, $3, $4, $5,
                $6, $7, $8, $9,
                $10, $11, CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
              )`,
              ifProduct.sku || `IF-${inflowProductId.substring(0, 8)}`,
              (ifProduct.name || 'Unknown Product').trim(),
              ifProduct.description || null,
              ifProduct.category || 'Miscellaneous',
              ifProduct.subcategory || null,
              ifProduct.cost || 0, ifProduct.price || 0,
              ifProduct.isActive !== false,
              hasQty ? ((ifProduct.quantityOnHand || 0) > 0) : false,
              inflowProductId, ifProduct.category || null
            )
            created++
          }
        } catch (err) {
          failed++
          console.error(`InFlow product sync error for SKU ${ifProduct.sku}:`, err)
        }
      }

      page++
      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY))
    }

    const completedAt = new Date()
    const result: SyncResult = {
      provider: 'INFLOW',
      syncType: 'products',
      direction: 'PULL',
      status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
      recordsProcessed: created + updated + skipped + failed,
      recordsCreated: created,
      recordsUpdated: updated,
      recordsSkipped: skipped,
      recordsFailed: failed,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }

    await writeSyncLog(result)
    return result
  } catch (error: any) {
    const completedAt = new Date()
    const result: SyncResult = {
      provider: 'INFLOW',
      syncType: 'products',
      direction: 'PULL',
      status: 'FAILED',
      recordsProcessed: created + updated + skipped + failed,
      recordsCreated: created,
      recordsUpdated: updated,
      recordsSkipped: skipped,
      recordsFailed: failed,
      errorMessage: error.message,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
    await writeSyncLog(result).catch(() => {})
    throw error
  }
}

// ─── Inventory Sync ──────────────────────────────────────────────────

export async function syncInventory(): Promise<SyncResult> {
  const startedAt = new Date()
  const config = await getConfig()
  if (!config) {
    return {
      provider: 'INFLOW', syncType: 'inventory', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: 'InFlow not configured',
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  let created = 0, updated = 0, skipped = 0, failed = 0
  const errors: string[] = []

  try {
    let page = 1
    const MAX_PAGES = 300

    while (page <= MAX_PAGES) {
      const data = await inflowFetch(`/products?page=${page}&pageSize=200&includeInactive=false`, config)
      const products: InflowProduct[] = data.data || data

      if (!products.length) break

      for (const ifProduct of products) {
        try {
          // Find the Product record by inflowId or SKU (InFlow uses 'productId' not 'id')
          const inflowProdId = String(ifProduct.productId || ifProduct.id || '')
          const productRows: any[] = await prisma.$queryRawUnsafe(
            `SELECT "id" FROM "Product" WHERE "inflowId" = $1 OR "sku" = $2 LIMIT 1`,
            inflowProdId, ifProduct.sku || ''
          )

          if (!productRows.length) {
            skipped++
            continue
          }

          const productId = productRows[0].id

          // Compute inventory values (default to 0 if field missing from API)
          const onHand = ifProduct.quantityOnHand ?? 0
          const onOrder = ifProduct.quantityOnOrder ?? 0
          const committed = ifProduct.quantityCommitted ?? 0
          const available = onHand - committed

          // Upsert: create InventoryItem if it doesn't exist, update if it does
          const existingInv: any[] = await prisma.$queryRawUnsafe(
            `SELECT "id" FROM "InventoryItem" WHERE "productId" = $1 LIMIT 1`, productId
          )

          if (existingInv.length > 0) {
            await prisma.$executeRawUnsafe(
              `UPDATE "InventoryItem" SET
                "onHand" = $1, "onOrder" = $2, "committed" = $3, "available" = $4,
                "updatedAt" = CURRENT_TIMESTAMP
              WHERE "id" = $5`,
              onHand, onOrder, committed, available, existingInv[0].id
            )
            updated++
          } else {
            // InventoryItem has no "createdAt" column — only "updatedAt".
            // Writing "createdAt" triggers Postgres 42703 and fails the upsert for every new row.
            await prisma.$executeRawUnsafe(
              `INSERT INTO "InventoryItem" ("id", "productId", "onHand", "onOrder", "committed", "available", "updatedAt")
               VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
              productId, onHand, onOrder, committed, available
            )
            created++
          }
        } catch (err: any) {
          failed++
          const errMsg = `SKU ${ifProduct.sku || ifProduct.id}: ${err.message}`
          errors.push(errMsg)
          console.error(`InFlow inventory sync error:`, errMsg)
        }
      }

      // InFlow API may return fewer items than requested pageSize — keep going until empty
      page++

      // Rate limiting between pages
      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY))
    } // end while

    const completedAt = new Date()
    const totalProcessed = created + updated + skipped + failed

    const result: SyncResult = {
      provider: 'INFLOW', syncType: 'inventory', direction: 'PULL',
      status: failed > 0 ? (updated > 0 || created > 0 ? 'PARTIAL' : 'FAILED') : 'SUCCESS',
      recordsProcessed: totalProcessed,
      recordsCreated: created, recordsUpdated: updated,
      recordsSkipped: skipped, recordsFailed: failed,
      errorMessage: errors.length > 0 ? errors.slice(0, 5).join('; ') : undefined,
      startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
    await writeSyncLog(result)
    return result
  } catch (error: any) {
    const completedAt = new Date()
    const result: SyncResult = {
      provider: 'INFLOW', syncType: 'inventory', direction: 'PULL',
      status: 'FAILED', recordsProcessed: created + updated + skipped + failed,
      recordsCreated: created, recordsUpdated: updated,
      recordsSkipped: skipped, recordsFailed: failed,
      errorMessage: error.message,
      startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
    await writeSyncLog(result).catch(() => {})
    return result
  }
}

// ─── Sync Mode Helper ────────────────────────────────────────────────

export type SyncMode = 'MIRROR' | 'BIDIRECTIONAL' | 'AEGIS_PRIMARY'

export async function getSyncMode(): Promise<SyncMode> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "metadata" FROM "IntegrationConfig" WHERE "provider" = 'INFLOW' LIMIT 1`
    )
    return (rows[0]?.metadata?.syncMode as SyncMode) || 'MIRROR'
  } catch {
    return 'MIRROR'
  }
}

// ─── Webhook Handler ─────────────────────────────────────────────────
// Respects sync mode: in AEGIS_PRIMARY mode, incoming InFlow webhooks
// are ignored because Aegis owns the data.

export async function handleInflowWebhook(eventType: string, payload: any) {
  // In AEGIS_PRIMARY mode, InFlow changes are ignored
  const mode = await getSyncMode()
  if (mode === 'AEGIS_PRIMARY') {
    console.log(`[InFlow Webhook] Ignoring ${eventType} — Aegis is primary`)
    return
  }

  switch (eventType) {
    case 'product.updated':
    case 'product.created': {
      const ifProduct = payload as InflowProduct
      await prisma.$executeRawUnsafe(
        `UPDATE "Product" SET
          "name" = $1, "cost" = $2, "basePrice" = $3,
          "active" = $4, "inStock" = $5,
          "lastSyncedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "inflowId" = $6`,
        ifProduct.name, ifProduct.cost || 0, ifProduct.price || 0,
        ifProduct.isActive !== false, (ifProduct.quantityOnHand || 0) > 0,
        String(ifProduct.productId || ifProduct.id)
      )
      break
    }

    case 'inventory.adjusted': {
      const { productId, newQuantity } = payload
      const products: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Product" WHERE "inflowId" = $1 LIMIT 1`, String(productId)
      )
      if (products.length > 0) {
        await prisma.$executeRawUnsafe(
          `UPDATE "InventoryItem" SET "onHand" = $1, "available" = $1, "updatedAt" = CURRENT_TIMESTAMP
           WHERE "productId" = $2`,
          newQuantity, products[0].id
        )
      }
      break
    }

    case 'purchaseorder.received': {
      const { items: poItems } = payload
      if (poItems && Array.isArray(poItems)) {
        for (const poItem of poItems) {
          try {
            const products: any[] = await prisma.$queryRawUnsafe(
              `SELECT "id" FROM "Product" WHERE "inflowId" = $1 OR "sku" = $2 LIMIT 1`,
              String(poItem.productId || ''), poItem.sku || ''
            )
            if (products.length > 0) {
              await prisma.$executeRawUnsafe(
                `UPDATE "InventoryItem" SET "onHand" = $1, "updatedAt" = CURRENT_TIMESTAMP
                 WHERE "productId" = $2`,
                poItem.quantityReceived || poItem.quantity, products[0].id
              )
            }
          } catch (err) {
            console.error(`PO item sync error:`, err)
          }
        }
      }
      break
    }

    case 'order.statusChanged': {
      // Handle order status updates from InFlow
      const { orderNumber, newStatus } = payload
      const statusMap: Record<string, string> = {
        'Confirmed': 'CONFIRMED',
        'In Production': 'IN_PRODUCTION',
        'Ready': 'READY_TO_SHIP',
        'Shipped': 'SHIPPED',
        'Delivered': 'DELIVERED',
        'Complete': 'COMPLETE',
      }
      const mappedStatus = statusMap[newStatus] || newStatus
      if (orderNumber) {
        await prisma.$queryRawUnsafe(
          `UPDATE "Order" SET "status" = $1::"OrderStatus", "updatedAt" = CURRENT_TIMESTAMP WHERE "orderNumber" = $2`,
          mappedStatus, orderNumber
        )
      }
      break
    }

    default:
      break
  }
}

// ─── Connection Test ─────────────────────────────────────────────────

export async function testConnection(apiKey: string, companyId: string): Promise<{ success: boolean; message: string; productCount?: number }> {
  try {
    const response = await fetch(`${INFLOW_BASE}/${companyId}/products?page=1&pageSize=1`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json;version=2026-02-24',
      },
    })

    if (!response.ok) {
      return { success: false, message: `API returned ${response.status}: ${response.statusText}` }
    }

    const data = await response.json()
    return {
      success: true,
      message: 'Connected to InFlow successfully',
      productCount: data.totalCount || data.length,
    }
  } catch (error: any) {
    return { success: false, message: error.message }
  }
}

// ─── Purchase Order Sync ────────────────────────────────────────────

export async function syncPurchaseOrders(): Promise<SyncResult> {
  const startedAt = new Date()
  const config = await getConfig()
  if (!config) {
    return {
      provider: 'INFLOW', syncType: 'purchaseOrders', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: 'InFlow not configured',
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  let created = 0, updated = 0, skipped = 0, failed = 0
  const errors: string[] = []

  try {
    // Get a default staff ID for createdBy on new POs
    const admins: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "Staff" WHERE role::text = 'ADMIN' LIMIT 1`
    )
    const defaultStaffId = admins[0]?.id
    if (!defaultStaffId) {
      throw new Error('No admin staff found for PO sync — need a createdById')
    }

    let page = 1
    // Safety cap: 25 pages × 100 = 2,500 POs max per run (keeps within Vercel 60s timeout)
    const MAX_PAGES = 25

    while (page <= MAX_PAGES) {
      let poList: any
      try {
        poList = await inflowFetch(`/purchase-orders?page=${page}&pageSize=100`, config)
      } catch (apiErr: any) {
        // If the endpoint doesn't exist, try alternate paths
        if (apiErr.message?.includes('404') || apiErr.message?.includes('Not Found')) {
          try {
            poList = await inflowFetch(`/purchaseorders?page=${page}&pageSize=100`, config)
          } catch {
            try {
              poList = await inflowFetch(`/purchaseOrders?page=${page}&pageSize=100`, config)
            } catch {
              throw new Error(`InFlow PO endpoint not found — tried /purchase-orders, /purchaseorders, /purchaseOrders. Last error: ${apiErr.message}`)
            }
          }
        } else {
          throw apiErr
        }
      }

      const orders: any[] = Array.isArray(poList) ? poList : (poList.data || [])
      if (orders.length === 0) break

      // Log first-page shape for debugging
      if (page === 1 && orders.length > 0) {
        console.log('[InFlow PO Sync] First record keys:', Object.keys(orders[0]).join(', '))
        console.log('[InFlow PO Sync] First record sample:', JSON.stringify(orders[0]).substring(0, 500))
      }

      for (const ifPO of orders) {
        try {
          // Defensive field access — InFlow may use different key names
          const inflowId = String(ifPO.purchaseOrderId || ifPO.id || ifPO.purchaseOrderNumber || '')
          if (!inflowId) { skipped++; continue }

          const poNumber = ifPO.orderNumber || ifPO.purchaseOrderNumber || ifPO.number || `IF-PO-${inflowId.substring(0, 8)}`

          // Map inFlow status to POStatus
          const poStatus = mapInflowPOStatus(ifPO)

          // Defensive vendor ID access
          const rawVendorId = ifPO.vendorId || ifPO.vendor?.id || ifPO.supplierId || null
          const rawVendorName = ifPO.shipToCompanyName || ifPO.vendorName || ifPO.vendor?.name || ifPO.vendor?.contactName || null

          // Find or create vendor
          const vendorId = await findOrCreateVendor(rawVendorId, rawVendorName, config)

          if (!vendorId) {
            skipped++
            errors.push(`PO ${poNumber}: no vendor (vendorId=${rawVendorId}, name=${rawVendorName})`)
            continue
          }

          // Ensure poNumber is unique — append inflowId if needed
          const existingPONum: any[] = await prisma.$queryRawUnsafe(
            `SELECT id FROM "PurchaseOrder" WHERE "poNumber" = $1 AND "inflowId" != $2 LIMIT 1`,
            poNumber, inflowId
          )
          const finalPoNumber = existingPONum.length > 0 ? `${poNumber}-${inflowId.substring(0, 6)}` : poNumber

          // Check if PO already exists by inflowId
          const existing: any[] = await prisma.$queryRawUnsafe(
            `SELECT id FROM "PurchaseOrder" WHERE "inflowId" = $1 LIMIT 1`, inflowId
          )

          // Defensive money parsing
          const subtotal = parseFloat(ifPO.subTotal || ifPO.subtotal || ifPO.amount || 0) || 0
          const total = parseFloat(ifPO.total || ifPO.grandTotal || ifPO.totalAmount || 0) || 0
          const shipping = parseFloat(ifPO.freight || ifPO.shippingCost || 0) || 0

          if (existing.length > 0) {
            await prisma.$executeRawUnsafe(
              `UPDATE "PurchaseOrder" SET
                "status" = $1::"POStatus",
                "subtotal" = $2, "total" = $3,
                "expectedDate" = $4,
                "notes" = $5,
                "updatedAt" = CURRENT_TIMESTAMP
              WHERE "inflowId" = $6`,
              poStatus, subtotal, total,
              ifPO.dueDate || ifPO.expectedDate ? new Date(ifPO.dueDate || ifPO.expectedDate) : null,
              ifPO.orderRemarks || ifPO.remarks || ifPO.notes || null,
              inflowId
            )
            updated++
          } else {
            await prisma.$executeRawUnsafe(
              `INSERT INTO "PurchaseOrder" (
                "id", "poNumber", "vendorId", "createdById", "status",
                "subtotal", "shippingCost", "total",
                "orderedAt", "expectedDate", "notes",
                "inflowId", "inflowVendorId", "source",
                "createdAt", "updatedAt"
              ) VALUES (
                gen_random_uuid()::text, $1, $2, $3, $4::"POStatus",
                $5, $6, $7,
                $8, $9, $10,
                $11, $12, 'INFLOW',
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
              )`,
              finalPoNumber, vendorId, defaultStaffId, poStatus,
              subtotal, shipping, total,
              ifPO.orderDate || ifPO.date ? new Date(ifPO.orderDate || ifPO.date) : new Date(),
              ifPO.dueDate || ifPO.expectedDate ? new Date(ifPO.dueDate || ifPO.expectedDate) : null,
              ifPO.orderRemarks || ifPO.remarks || ifPO.notes || null,
              inflowId, rawVendorId || null
            )
            created++
          }
        } catch (err: any) {
          failed++
          const poRef = ifPO.orderNumber || ifPO.purchaseOrderNumber || ifPO.id || 'unknown'
          errors.push(`PO ${poRef}: ${err.message}`)
          console.error('InFlow PO sync error:', err.message)
        }
      }

      page++
      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY))
    }

    const completedAt = new Date()
    const totalProcessed = created + updated + skipped + failed

    const result: SyncResult = {
      provider: 'INFLOW', syncType: 'purchaseOrders', direction: 'PULL',
      status: failed > 0 ? (created > 0 || updated > 0 ? 'PARTIAL' : 'FAILED') : (totalProcessed === 0 ? 'SUCCESS' : 'SUCCESS'),
      recordsProcessed: totalProcessed, recordsCreated: created,
      recordsUpdated: updated, recordsSkipped: skipped, recordsFailed: failed,
      errorMessage: errors.length > 0 ? errors.slice(0, 10).join('; ') : undefined,
      startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
    await writeSyncLog(result)
    return result
  } catch (error: any) {
    const completedAt = new Date()
    console.error('[InFlow PO Sync] Fatal error:', error.message)
    const result: SyncResult = {
      provider: 'INFLOW', syncType: 'purchaseOrders', direction: 'PULL',
      status: 'FAILED', recordsProcessed: created + updated + skipped + failed,
      recordsCreated: created, recordsUpdated: updated,
      recordsSkipped: skipped, recordsFailed: failed,
      errorMessage: error.message, startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
    await writeSyncLog(result).catch(() => {})
    return result
  }
}

function mapInflowPOStatus(ifPO: any): string {
  if (ifPO.isCancelled) return 'CANCELLED'
  if (ifPO.inventoryStatus === 'fulfilled') return 'RECEIVED'
  if (ifPO.inventoryStatus === 'partiallyFulfilled') return 'PARTIALLY_RECEIVED'
  if (ifPO.isCompleted) return 'RECEIVED'
  if (ifPO.paymentStatus === 'paid') return 'APPROVED'
  return 'SENT_TO_VENDOR'
}

async function findOrCreateVendor(inflowVendorId: string | null, companyName: string | null, config?: InflowConfig | null): Promise<string | null> {
  if (!inflowVendorId) return null

  // Try to find by inflowVendorId first
  const byInflow: any[] = await prisma.$queryRawUnsafe(
    `SELECT id FROM "Vendor" WHERE "inflowVendorId" = $1 LIMIT 1`, inflowVendorId
  )
  if (byInflow.length > 0) return byInflow[0].id

  // Fetch vendor name from inFlow API if we don't have a company name
  let resolvedName = companyName
  if (!resolvedName && config) {
    try {
      const vendorData = await inflowFetch(`/vendors/${inflowVendorId}`, config)
      resolvedName = vendorData?.contactName || vendorData?.name || null
    } catch { /* vendor lookup failed, continue with fallback */ }
  }

  // Try to match by company name
  if (resolvedName) {
    const byName: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "Vendor" WHERE LOWER("name") = LOWER($1) LIMIT 1`, resolvedName
    )
    if (byName.length > 0) {
      // Link existing vendor to inFlow
      await prisma.$executeRawUnsafe(
        `UPDATE "Vendor" SET "inflowVendorId" = $1 WHERE "id" = $2`, inflowVendorId, byName[0].id
      )
      return byName[0].id
    }
  }

  // Create a new vendor with the resolved name
  const vendorName = resolvedName || `InFlow Vendor ${inflowVendorId.substring(0, 8)}`
  const code = vendorName.substring(0, 10).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'IF' + Date.now()

  // Ensure unique code
  const codeExists: any[] = await prisma.$queryRawUnsafe(
    `SELECT id FROM "Vendor" WHERE "code" = $1 LIMIT 1`, code
  )
  const finalCode = codeExists.length > 0 ? code + Date.now().toString().slice(-4) : code

  const result: any[] = await prisma.$queryRawUnsafe(
    `INSERT INTO "Vendor" ("id", "name", "code", "inflowVendorId", "active", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING "id"`,
    vendorName, finalCode, inflowVendorId
  )
  return result[0]?.id || null
}

// ─── Sales Order Sync ───────────────────────────────────────────────

export async function syncSalesOrders(): Promise<SyncResult> {
  const startedAt = new Date()
  const config = await getConfig()
  if (!config) {
    return {
      provider: 'INFLOW', syncType: 'salesOrders', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: 'InFlow not configured',
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  let created = 0, updated = 0, skipped = 0, failed = 0
  const errors: string[] = []

  try {
    // Get or create "Unmatched InFlow Customers" builder for orders we can't match
    let unmatchedBuilder: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "Builder" WHERE "companyName" = 'Unmatched InFlow Customers' LIMIT 1`
    )
    if (unmatchedBuilder.length === 0) {
      unmatchedBuilder = await prisma.$queryRawUnsafe(
        `INSERT INTO "Builder" (id, "companyName", "contactName", email, "passwordHash", phone, status, "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, 'Unmatched InFlow Customers', 'Auto-Created by Sync', 'datafix@abellumber.com', 'NOLOGIN', '', 'ACTIVE'::"AccountStatus", NOW(), NOW())
         RETURNING id`
      )
    }
    const defaultBuilderId = unmatchedBuilder[0]?.id
    if (!defaultBuilderId) {
      throw new Error('No builders found — need at least one for sales order sync')
    }

    // Check if we need a full backload or just incremental sync
    const inflowOrderCount: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "Order" WHERE "inflowOrderId" IS NOT NULL`
    )
    const needsFullSync = (inflowOrderCount[0]?.count || 0) < 50

    let modifiedSince = ''
    if (!needsFullSync) {
      try {
        const lastSync: any[] = await prisma.$queryRawUnsafe(
          `SELECT "completedAt" FROM "SyncLog"
           WHERE provider = 'INFLOW' AND "syncType" = 'salesOrders' AND status IN ('SUCCESS', 'PARTIAL')
           ORDER BY "completedAt" DESC LIMIT 1`
        )
        if (lastSync.length > 0 && lastSync[0].completedAt) {
          const since = new Date(lastSync[0].completedAt)
          since.setHours(since.getHours() - 2)
          modifiedSince = `&modifiedSince=${since.toISOString()}`
        }
      } catch (e: any) {
        console.warn('[InFlow SO Sync] Could not fetch last sync time, pulling all:', e?.message)
      }
    } else {
      console.log('[InFlow SO Sync] Full backload: only', inflowOrderCount[0]?.count, 'orders linked — pulling all from InFlow')
    }

    let page = 1
    // Safety cap: 25 pages to stay within Vercel timeout
    const MAX_PAGES = 25

    while (page <= MAX_PAGES) {
      let soList: any
      try {
        soList = await inflowFetch(`/sales-orders?page=${page}&pageSize=100${modifiedSince}`, config)
      } catch (apiErr: any) {
        // Try alternate endpoint paths
        if (apiErr.message?.includes('404') || apiErr.message?.includes('Not Found')) {
          try {
            soList = await inflowFetch(`/salesorders?page=${page}&pageSize=100${modifiedSince}`, config)
          } catch {
            try {
              soList = await inflowFetch(`/salesOrders?page=${page}&pageSize=100${modifiedSince}`, config)
            } catch {
              throw new Error(`InFlow SO endpoint not found — tried /sales-orders, /salesorders, /salesOrders. Last error: ${apiErr.message}`)
            }
          }
        } else {
          throw apiErr
        }
      }

      const orders: any[] = Array.isArray(soList) ? soList : (soList.data || [])
      if (orders.length === 0) break

      // Log first-page shape for debugging
      if (page === 1 && orders.length > 0) {
        console.log('[InFlow SO Sync] First record keys:', Object.keys(orders[0]).join(', '))
        console.log('[InFlow SO Sync] First record sample:', JSON.stringify(orders[0]).substring(0, 500))
      }

      for (const ifSO of orders) {
        try {
          // Defensive field access — InFlow may use different key names
          const inflowOrderId = String(ifSO.salesOrderId || ifSO.id || ifSO.salesOrderNumber || '')
          if (!inflowOrderId) { skipped++; continue }

          const rawOrderNum = ifSO.orderNumber || ifSO.salesOrderNumber || ifSO.number || inflowOrderId.substring(0, 8)
          const orderNumber = rawOrderNum.startsWith('IF-') ? rawOrderNum : `IF-${rawOrderNum}`

          // Map inFlow status to OrderStatus
          const orderStatus = mapInflowSOStatus(ifSO)
          const paymentStatus = mapInflowPaymentStatus(ifSO.paymentStatus)

          // Defensive customer ID access
          const rawCustomerId = ifSO.customerId || ifSO.customer?.id || null
          const rawContactName = ifSO.contactName || ifSO.customerName || ifSO.customer?.name || ifSO.customer?.contactName || null

          // Try to find a matching builder by customerId
          const builderId = await findBuilderByInflowCustomer(rawCustomerId, rawContactName) || defaultBuilderId

          // Ensure orderNumber is unique
          const existingOrdNum: any[] = await prisma.$queryRawUnsafe(
            `SELECT id FROM "Order" WHERE "orderNumber" = $1 AND "inflowOrderId" != $2 LIMIT 1`,
            orderNumber, inflowOrderId
          )
          const finalOrderNumber = existingOrdNum.length > 0 ? `${orderNumber}-${inflowOrderId.substring(0, 6)}` : orderNumber

          // Check if SO already exists
          const existing: any[] = await prisma.$queryRawUnsafe(
            `SELECT id FROM "Order" WHERE "inflowOrderId" = $1 LIMIT 1`, inflowOrderId
          )

          // Defensive money parsing
          const subtotal = parseFloat(ifSO.subTotal || ifSO.subtotal || ifSO.amount || 0) || 0
          const total = parseFloat(ifSO.total || ifSO.grandTotal || ifSO.totalAmount || 0) || 0
          const tax = parseFloat(ifSO.tax1 || ifSO.tax || ifSO.taxAmount || 0) || 0
          const shipping = parseFloat(ifSO.orderFreight || ifSO.freight || ifSO.shippingCost || 0) || 0

          // Extract shipping/delivery address from InFlow SO
          // InFlow may send address as: shipTo, shippingAddress, location, deliveryAddress, or flat fields
          const shipTo = ifSO.shipTo || ifSO.shippingAddress || ifSO.deliveryAddress || ifSO.location || {}
          const jobAddress = (typeof shipTo === 'string' ? shipTo : null) ||
            [
              shipTo.address || shipTo.street || shipTo.address1 || ifSO.shipToAddress || ifSO.deliveryAddr || null,
              shipTo.city || ifSO.shipToCity || null,
              shipTo.state || shipTo.stateCode || ifSO.shipToState || null,
              shipTo.zip || shipTo.postalCode || ifSO.shipToZip || null,
            ].filter(Boolean).join(', ') || null
          const jobCommunity = ifSO.community || ifSO.subdivision || shipTo.subdivision || shipTo.community || null
          const jobLotBlock = ifSO.lotBlock || ifSO.lot || shipTo.lot || shipTo.lotBlock || null

          if (existing.length > 0) {
            await prisma.$executeRawUnsafe(
              `UPDATE "Order" SET
                "status" = $1::"OrderStatus",
                "paymentStatus" = $2::"PaymentStatus",
                "subtotal" = $3, "total" = $4,
                "deliveryNotes" = $5,
                "updatedAt" = CURRENT_TIMESTAMP
              WHERE "inflowOrderId" = $6`,
              orderStatus, paymentStatus,
              subtotal, total,
              ifSO.orderRemarks || ifSO.remarks || ifSO.notes || null,
              inflowOrderId
            )
            updated++
          } else {
            await prisma.$executeRawUnsafe(
              `INSERT INTO "Order" (
                "id", "builderId", "orderNumber", "poNumber",
                "subtotal", "taxAmount", "shippingCost", "total",
                "paymentTerm", "paymentStatus", "status",
                "deliveryDate", "deliveryNotes",
                "inflowOrderId", "inflowCustomerId",
                "createdAt", "updatedAt"
              ) VALUES (
                gen_random_uuid()::text, $1, $2, $3,
                $4, $5, $6, $7,
                $8::"PaymentTerm", $9::"PaymentStatus", $10::"OrderStatus",
                $11, $12,
                $13, $14,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
              )`,
              builderId, finalOrderNumber, ifSO.poNumber || ifSO.customerPO || null,
              subtotal, tax, shipping, total,
              'PAY_ON_DELIVERY', paymentStatus, orderStatus,
              ifSO.requestedShipDate || ifSO.requiredDate || ifSO.deliveryDate
                ? new Date(ifSO.requestedShipDate || ifSO.requiredDate || ifSO.deliveryDate)
                : null,
              ifSO.orderRemarks || ifSO.remarks || ifSO.notes || null,
              inflowOrderId, rawCustomerId || null
            )
            created++
          }

          // Enrich linked Job records with address from InFlow SO
          if (jobAddress && jobAddress.length > 3) {
            // Find the order we just created/updated to get its ID
            const orderRow: any[] = await prisma.$queryRawUnsafe(
              `SELECT "id" FROM "Order" WHERE "inflowOrderId" = $1 LIMIT 1`,
              inflowOrderId
            )
            if (orderRow.length > 0) {
              // Update any Jobs linked to this order that don't have an address
              await prisma.$executeRawUnsafe(
                `UPDATE "Job" SET
                  "jobAddress" = COALESCE(NULLIF("jobAddress", ''), $1),
                  "community" = COALESCE(NULLIF("community", ''), $2),
                  "lotBlock" = COALESCE(NULLIF("lotBlock", ''), $3),
                  "updatedAt" = NOW()
                WHERE "orderId" = $4
                  AND ("jobAddress" IS NULL OR "jobAddress" = '')`,
                jobAddress,
                jobCommunity,
                jobLotBlock,
                orderRow[0].id
              )
            }
          }
        } catch (err: any) {
          failed++
          const soRef = ifSO.orderNumber || ifSO.salesOrderNumber || ifSO.id || 'unknown'
          errors.push(`SO ${soRef}: ${err.message}`)
          console.error('InFlow SO sync error:', err.message)
        }
      }

      page++
      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY))
    }

    const completedAt = new Date()
    const totalProcessed = created + updated + skipped + failed

    const result: SyncResult = {
      provider: 'INFLOW', syncType: 'salesOrders', direction: 'PULL',
      status: failed > 0 ? (created > 0 || updated > 0 ? 'PARTIAL' : 'FAILED') : 'SUCCESS',
      recordsProcessed: totalProcessed, recordsCreated: created,
      recordsUpdated: updated, recordsSkipped: skipped, recordsFailed: failed,
      errorMessage: errors.length > 0 ? errors.slice(0, 10).join('; ') : undefined,
      startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
    await writeSyncLog(result)
    return result
  } catch (error: any) {
    const completedAt = new Date()
    console.error('[InFlow SO Sync] Fatal error:', error.message)
    const result: SyncResult = {
      provider: 'INFLOW', syncType: 'salesOrders', direction: 'PULL',
      status: 'FAILED', recordsProcessed: created + updated + skipped + failed,
      recordsCreated: created, recordsUpdated: updated,
      recordsSkipped: skipped, recordsFailed: failed,
      errorMessage: error.message, startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
    await writeSyncLog(result).catch(() => {})
    return result
  }
}

function mapInflowSOStatus(ifSO: any): string {
  if (ifSO.isCancelled) return 'CANCELLED'
  if (ifSO.inventoryStatus === 'fulfilled' && ifSO.isCompleted) return 'COMPLETE'
  if (ifSO.inventoryStatus === 'fulfilled') return 'DELIVERED'
  if (ifSO.inventoryStatus === 'partiallyFulfilled') return 'SHIPPED'
  if (ifSO.isInvoiced) return 'CONFIRMED'
  return 'RECEIVED'
}

function mapInflowPaymentStatus(status: string | null): string {
  if (!status) return 'PENDING'
  switch (status.toLowerCase()) {
    case 'paid': return 'PAID'
    case 'partial': return 'INVOICED'
    case 'overdue': return 'OVERDUE'
    default: return 'PENDING'
  }
}

// Hardcoded customer → builder ID map from scripts/customer_builder_map.json
// Loaded once at module scope. Provides deterministic mapping for InFlow customer names.
const CUSTOMER_BUILDER_MAP: Record<string, string> = {
  "Joseph Paul Homes": "cmntqir6q0015q3287m7thy1f",
  "AGD Homes": "cmntqiptc000hq328ijf250o3",
  "NEWPORT HOMEBUILDERS": "cmmzrun0v029393opnztcg7wa",
  "TRUTH CONSTRUCTION": "cmmzruodk029r93op0j00ax4o",
  "MILLCREEK AMAVI CELINA": "cmmzrumvu029093opi1m6bax6",
  "Beechwood Custom Homes": "cmntqiq1k000lq328ezrcbctj",
  "TOLL BROTHERS": "cmmzruo7q029o93oppxwad5zs",
  "Pulte Homes": "cmmzrun6g029693opxsz3wu2t",
  "FIG TREE HOMES": "cmmzrulpd028a93opehwtn9vt",
  "James Lancaster": "cmmzrum6u028l93oprtyjqx5k",
  "First Texas Homes": "cmntqiqof000wq328sz1hzcpe",
  "GH HOMES": "cmmzrulud028d93opuo968cjv",
  "Villa-May Construction": "cmmzruoho029t93opz481wi5n",
  "STONEHOLLOW": "cmmzrunvz029i93op3ytcgkl8",
  "Stately Design and Renovation": "cmmzruntx029h93op6onuxcds",
  "Country Road Homebuilders": "cmntqiqbl000qq328orqh0u2n",
  "DFW Installations": "cmn96ibm40011q67b7lnknviz",
  "BROOKFIELD": "cmmzrukex027i93op82wtbgg4",
  "Josh Barrett": "cmmzrumda028p93ophz3jh98r",
  "JASON & SHELBY LAMB": "cmmzrum8n028m93opmsbomu5b",
  "Lia Gravley": "cmmzrumlm028u93op8pa8ic6o",
  "Forward Builders": "cmmzrulsm028c93op7a36c4d4",
  "Clinton Calmes": "cmmzrukot027o93opmi2drsdr",
  "Donna Bursell": "cmmzrukd3027h93op2wqezsw3",
  "De La Rosa Doors & Trim": "cmmzrulfc028493opr5jo117e",
  "Cudd Realty & iTxProp Management": "cmmzrul1u027w93opft39r7mv",
  "Davenport Development": "cmmzrulak028193oprycz7r67",
  "Bloomfield Homes": "cmmzrukir027l93opi3p2sj0h",
  "PINNACLE": "cmmzrunlz029d93opxn4x4xfk",
  "GRAND HOMES": "cmmzrulx0028e93op2pf7g12w",
  "MCGUYER HOMEBUILDERS INC": "cmmzrumqh028y93op20g16pnm",
  "JDS HOMES": "cmmzrumcz028o93opa1kqcqfv",
  "K Hovnanian Homes": "cmntqir0h0013q328dtmccmcv",
  "DR HORTON": "cmmzrulfv028593opikqrcfsh",
  "Venture Homes": "cmmzruohl029u93opxo3jpdea",
  "James Pence Homes": "cmntqiqjp000tq328t3x9ihx9",
  "KB HOME": "cmmzrum9q028n93opu4vwqaog",
  "LANDON HOMES": "cmmzrumkt028t93opsh4ky8ng",
  "LENNAR": "cmmzrumo0028w93opoy2ntqdn",
  "Taylor Morrison": "cmntqirc40019q328b1hncl9k",
  "ASHTON WOODS": "cmmzruk8r027f93opzjnrpjn2",
  "PERRY HOMES": "cmmzruniq029c93op4f0hh1ug",
  "HIGHLAND HOMES": "cmmzrum2d028i93opj2q4exrz",
  "MERITAGE HOMES": "cmmzrumsd028z93opicdmjz0y",
  "TROPHY SIGNATURE HOMES": "cmmzruob9029n93opc73dpnny",
  "Tommy Richardson": "cmmzruo6n029m93opfv2s3yjb",
  "SOUTHGATE HOMES": "cmmzrunp2029f93opu94g7uh2",
  "Kera Miller": "cmmzrumhh028r93opsfzaopba",
  "Kindred Homes": "cmntqiqsq000yq3283gzq6bwc",
  "Mattamy Homes": "cmntqiqwn0011q3283gxgbmmv",
  "Shaddock Homes": "cmntqir8j0017q3283j66b8fg",
  "PACESETTER HOMES": "cmmzrunet029a93opg2f2fkhm",
  "PLANTATION HOMES": "cmmzrunow029e93opwojhg1ar",
  "RENDITION HOMES": "cmmzrunsa029g93opj5a6hxcj",
  "SAXONY HOMES": "cmmzrunxs029j93op6eqwskgb",
  "DREAM FINDERS HOMES": "cmmzrulhp028693opiylbxhz3",
}

async function findBuilderByInflowCustomer(customerId: string | null, contactName: string | null): Promise<string | null> {
  if (!customerId) return null

  // Tier 1: Check hardcoded customer→builder map (deterministic, fastest)
  if (contactName) {
    const normalizedName = contactName.trim()
    // Exact match
    if (CUSTOMER_BUILDER_MAP[normalizedName]) {
      return CUSTOMER_BUILDER_MAP[normalizedName]
    }
    // Case-insensitive match
    const upperName = normalizedName.toUpperCase()
    for (const [key, builderId] of Object.entries(CUSTOMER_BUILDER_MAP)) {
      if (key.toUpperCase() === upperName) return builderId
    }
  }

  // Tier 2: Check existing orders for this InFlow customer ID (learns from past syncs)
  const byInflow: any[] = await prisma.$queryRawUnsafe(
    `SELECT "builderId" FROM "Order" WHERE "inflowCustomerId" = $1 LIMIT 1`, customerId
  )
  if (byInflow.length > 0) return byInflow[0].builderId

  // Tier 3: Fuzzy match by contact name against builder company/contact
  if (contactName) {
    const byName: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "Builder" WHERE LOWER("companyName") ILIKE $1 OR LOWER("contactName") ILIKE $1 LIMIT 1`,
      `%${contactName.toLowerCase()}%`
    )
    if (byName.length > 0) return byName[0].id
  }

  return null
}

// ─── Push Order to InFlow ───────────────────────────────────────────

export async function pushOrderToInflow(orderId: string): Promise<{ success: boolean; message: string; inflowOrderId?: string }> {
  // Block pushes in MIRROR mode — InFlow is source of truth, no writes allowed
  const mode = await getSyncMode()
  if (mode === 'MIRROR') {
    return { success: false, message: 'Push disabled — sync mode is MIRROR (pull-only). Switch to BIDIRECTIONAL to enable pushes.' }
  }

  const config = await getConfig()
  if (!config) return { success: false, message: 'InFlow not configured' }

  try {
    // Fetch order with builder info
    const orders: any[] = await prisma.$queryRawUnsafe(
      `SELECT o."id", o."orderNumber", o."deliveryDate", o."createdAt",
              b."companyName" as "builderName"
       FROM "Order" o
       LEFT JOIN "Builder" b ON o."builderId" = b."id"
       WHERE o."id" = $1 LIMIT 1`, orderId
    )
    const order = orders[0]
    if (!order) return { success: false, message: 'Order not found' }

    // Fetch order items with product info
    const items: any[] = await prisma.$queryRawUnsafe(
      `SELECT oi."quantity", oi."unitPrice", oi."description",
              p."sku", p."name" as "productName"
       FROM "OrderItem" oi
       LEFT JOIN "Product" p ON oi."productId" = p."id"
       WHERE oi."orderId" = $1`, orderId
    )

    // Map to InFlow sales order format
    const inflowOrder = {
      orderNumber: order.orderNumber,
      customerName: order.builderName || 'Unknown',
      orderDate: order.createdAt,
      requiredDate: order.deliveryDate,
      remarks: `Synced from Aegis`,
      items: items.map((item: any) => ({
        productSku: item.sku,
        description: item.description || item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    }

    const result = await inflowFetch('/salesorders', config, {
      method: 'POST',
      body: JSON.stringify(inflowOrder),
    })

    // Store InFlow order ID back in our system
    if (result?.id) {
      await prisma.$queryRawUnsafe(
        `UPDATE "Order" SET "inflowOrderId" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $2`,
        String(result.id), orderId
      )
    }

    return {
      success: true,
      message: `Order ${order.orderNumber} pushed to InFlow`,
      inflowOrderId: result?.id ? String(result.id) : undefined,
    }
  } catch (error: any) {
    return { success: false, message: error.message }
  }
}

// ─── Push Inventory Adjustment to InFlow ────────────────────────────

export async function pushInventoryAdjustment(
  productId: string,
  newQuantity: number,
  reason?: string
): Promise<{ success: boolean; message: string }> {
  const mode = await getSyncMode()
  if (mode === 'MIRROR') {
    return { success: false, message: 'Cannot push to InFlow in MIRROR mode — InFlow is source of truth' }
  }

  const config = await getConfig()
  if (!config) return { success: false, message: 'InFlow not configured' }

  try {
    // Look up the InFlow product ID
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "inflowId", "sku", "name" FROM "Product" WHERE "id" = $1 LIMIT 1`, productId
    )
    const product = rows[0]
    if (!product?.inflowId) {
      return { success: false, message: 'Product not linked to InFlow' }
    }

    await inflowFetch(`/products/${product.inflowId}/inventory-adjustments`, config, {
      method: 'POST',
      body: JSON.stringify({
        quantityAdjusted: newQuantity,
        reason: reason || 'Adjusted from Aegis',
        date: new Date().toISOString(),
      }),
    })

    return { success: true, message: `Inventory adjustment pushed for ${product.sku}` }
  } catch (error: any) {
    return { success: false, message: error.message }
  }
}
