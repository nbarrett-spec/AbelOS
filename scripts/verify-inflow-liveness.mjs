#!/usr/bin/env node
/**
 * scripts/verify-inflow-liveness.mjs
 *
 * Proves (or refutes) that the InFlow <-> Aegis sync is live.
 *
 * 1) Cron health:     last 30 CronRun rows for inflow-sync — success rate,
 *                     avg duration, last success, last failure message.
 * 2) Data freshness:  MAX(updatedAt) for InventoryItem and Order, plus
 *                     MAX(orderDate) on Order. Sub-24h = alive.
 * 3) API reachability: calls InFlow /products with current creds, pulls
 *                     totalCount, compares to Aegis Product + InventoryItem.
 * 4) Recent SyncLog:  last 5 InFlow SyncLog rows per syncType.
 *
 * Read-only. Does not mutate anything.
 *
 * Usage:
 *   node scripts/verify-inflow-liveness.mjs
 */

import { neon } from '@neondatabase/serverless'
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load .env from project root
config({ path: join(__dirname, '..', '.env') })

const DATABASE_URL = process.env.DATABASE_URL
const INFLOW_API_KEY = process.env.INFLOW_API_KEY
const INFLOW_COMPANY_ID = process.env.INFLOW_COMPANY_ID

if (!DATABASE_URL) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

const sql = neon(DATABASE_URL)

const INFLOW_BASE = 'https://cloudapi.inflowinventory.com'

function fmtDate(d) {
  if (!d) return 'never'
  const date = new Date(d)
  const now = Date.now()
  const ageMs = now - date.getTime()
  const ageMin = Math.round(ageMs / 60000)
  const ageH = (ageMin / 60).toFixed(1)
  const ageD = (ageMin / 1440).toFixed(1)
  const ageStr =
    ageMin < 60 ? `${ageMin}m ago` :
    ageMin < 1440 ? `${ageH}h ago` :
    `${ageD}d ago`
  return `${date.toISOString()} (${ageStr})`
}

async function cronHealth() {
  console.log('\n== 1. Cron health (inflow-sync, last 30 runs) ==')
  const rows = await sql`
    SELECT "id", "name", "status", "startedAt", "finishedAt", "durationMs", "error"
    FROM "CronRun"
    WHERE LOWER("name") LIKE '%inflow%'
    ORDER BY "startedAt" DESC
    LIMIT 30
  `
  if (rows.length === 0) {
    console.log('  NO CronRun rows found matching %inflow%. Cron may never have executed, or the table is empty.')
    return { ran: false }
  }
  const total = rows.length
  const success = rows.filter(r => r.status === 'SUCCESS').length
  const failure = rows.filter(r => r.status === 'FAILURE').length
  const running = rows.filter(r => r.status === 'RUNNING').length
  const durations = rows.filter(r => r.durationMs).map(r => r.durationMs)
  const avgMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0

  const lastSuccess = rows.find(r => r.status === 'SUCCESS')
  const lastFailure = rows.find(r => r.status === 'FAILURE')

  console.log(`  Runs found: ${total}`)
  console.log(`  Success: ${success}   Failure: ${failure}   Running: ${running}`)
  console.log(`  Success rate: ${((success / total) * 100).toFixed(1)}%`)
  console.log(`  Avg duration: ${(avgMs / 1000).toFixed(1)}s`)
  console.log(`  Newest run:     ${fmtDate(rows[0].startedAt)}  [${rows[0].status}]`)
  console.log(`  Last SUCCESS:   ${lastSuccess ? fmtDate(lastSuccess.startedAt) : 'NONE'}`)
  console.log(`  Last FAILURE:   ${lastFailure ? fmtDate(lastFailure.startedAt) : 'NONE'}`)
  if (lastFailure?.error) {
    const err = String(lastFailure.error).slice(0, 300)
    console.log(`  Last error:     ${err}`)
  }
  return {
    ran: true,
    total, success, failure,
    successRate: success / total,
    avgMs,
    lastSuccess: lastSuccess?.startedAt,
    lastFailure: lastFailure?.startedAt,
    lastError: lastFailure?.error || null,
  }
}

async function freshness() {
  console.log('\n== 2. Data freshness ==')
  const inv = await sql`SELECT MAX("updatedAt") AS "maxUpdated", COUNT(*)::int AS "count" FROM "InventoryItem"`
  const ord = await sql`SELECT MAX("updatedAt") AS "maxUpdated", MAX("createdAt") AS "maxCreated", COUNT(*)::int AS "count" FROM "Order"`
  const prod = await sql`SELECT MAX("updatedAt") AS "maxUpdated", MAX("lastSyncedAt") AS "maxSynced", COUNT(*)::int AS "count" FROM "Product"`

  console.log(`  InventoryItem:  count=${inv[0].count}  MAX(updatedAt)=${fmtDate(inv[0].maxUpdated)}`)
  console.log(`  Order:          count=${ord[0].count}  MAX(updatedAt)=${fmtDate(ord[0].maxUpdated)}  MAX(createdAt)=${fmtDate(ord[0].maxCreated)}`)
  console.log(`  Product:        count=${prod[0].count}  MAX(updatedAt)=${fmtDate(prod[0].maxUpdated)}  MAX(lastSyncedAt)=${fmtDate(prod[0].maxSynced)}`)

  return {
    inventoryCount: inv[0].count,
    inventoryMaxUpdated: inv[0].maxUpdated,
    orderCount: ord[0].count,
    orderMaxUpdated: ord[0].maxUpdated,
    productCount: prod[0].count,
    productMaxUpdated: prod[0].maxUpdated,
    productLastSynced: prod[0].maxSynced,
  }
}

async function recentSyncLog() {
  console.log('\n== 3. Recent InFlow SyncLog rows ==')
  try {
    const rows = await sql`
      SELECT "syncType", "status", "recordsProcessed", "recordsCreated", "recordsUpdated",
             "recordsFailed", "durationMs", "startedAt", "errorMessage"
      FROM "SyncLog"
      WHERE "provider" = 'INFLOW'
      ORDER BY "startedAt" DESC
      LIMIT 12
    `
    if (rows.length === 0) {
      console.log('  NO SyncLog rows for INFLOW. Sync functions have never completed a logged run.')
      return
    }
    for (const r of rows) {
      const err = r.errorMessage ? ` err=${String(r.errorMessage).slice(0, 120)}` : ''
      console.log(
        `  ${r.startedAt?.toISOString?.() || r.startedAt}  ${r.syncType.padEnd(16)} ${r.status.padEnd(8)} ` +
        `proc=${r.recordsProcessed} created=${r.recordsCreated} updated=${r.recordsUpdated} failed=${r.recordsFailed} ` +
        `(${(r.durationMs / 1000).toFixed(1)}s)${err}`
      )
    }
  } catch (e) {
    console.log(`  Could not read SyncLog: ${e.message}`)
  }
}

async function apiReachability() {
  console.log('\n== 4. InFlow API reachability + page walk ==')
  if (!INFLOW_API_KEY || !INFLOW_COMPANY_ID) {
    console.log('  INFLOW_API_KEY or INFLOW_COMPANY_ID not set — skipping.')
    return { ok: false }
  }
  const headers = {
    Authorization: `Bearer ${INFLOW_API_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json;version=2026-02-24',
  }
  // First, a quick single-page ping for reachability + latency.
  try {
    const url = `${INFLOW_BASE}/${INFLOW_COMPANY_ID}/products?count=1`
    const t0 = Date.now()
    const res = await fetch(url, { headers })
    const tMs = Date.now() - t0
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200)
      console.log(`  Ping FAILED: ${res.status} ${res.statusText} (${tMs}ms) body=${body}`)
      return { ok: false, status: res.status }
    }
    const sample = await res.json()
    const arr = Array.isArray(sample) ? sample : (sample.data || [])
    console.log(`  Ping OK (${tMs}ms). Sample shape keys: ${Object.keys(arr[0] || {}).slice(0, 12).join(',')}`)
  } catch (e) {
    console.log(`  Ping threw: ${e.message}`)
    return { ok: false, error: e.message }
  }

  // Walk pages to get a true InFlow server-side count.
  // Use small pageSize to avoid triggering the rate limiter the cron hits.
  const pageSize = 100
  let total = 0
  let page = 1
  const MAX_PAGES = 200 // 200 * 100 = 20,000 — safety cap
  const t0 = Date.now()
  try {
    while (page <= MAX_PAGES) {
      const url = `${INFLOW_BASE}/${INFLOW_COMPANY_ID}/products?count=${pageSize}&after=${(page - 1) * pageSize}`
      const res = await fetch(url, { headers })
      if (res.status === 429) {
        console.log(`  Page ${page}: 429 rate limited — stopping walk.`)
        break
      }
      if (!res.ok) {
        console.log(`  Page ${page}: ${res.status} ${res.statusText} — stopping walk.`)
        break
      }
      const json = await res.json()
      const products = Array.isArray(json) ? json : (json.data || [])
      total += products.length
      if (products.length < pageSize) break
      page++
      await new Promise((r) => setTimeout(r, 250)) // gentle rate throttling
    }
  } catch (e) {
    console.log(`  Walk threw on page ${page}: ${e.message}`)
  }
  const walkMs = Date.now() - t0
  console.log(`  Walked ${page} pages in ${(walkMs / 1000).toFixed(1)}s — server-side product count = ${total}`)
  return { ok: true, serverCount: total, pagesWalked: page }
}

async function main() {
  console.log('InFlow Liveness Verification')
  console.log(`Run at: ${new Date().toISOString()}`)

  const cron = await cronHealth()
  const fresh = await freshness()
  await recentSyncLog()
  const api = await apiReachability()

  console.log('\n== Summary ==')
  if (cron.ran) {
    console.log(`  Cron success rate: ${(cron.successRate * 100).toFixed(1)}%  (${cron.success}/${cron.total})`)
    console.log(`  Last cron success: ${fmtDate(cron.lastSuccess)}`)
    console.log(`  Avg cron duration: ${(cron.avgMs / 1000).toFixed(1)}s`)
  } else {
    console.log(`  Cron has NEVER run (no CronRun rows).`)
  }
  console.log(`  InventoryItem max updatedAt: ${fmtDate(fresh.inventoryMaxUpdated)}`)
  console.log(`  Order max updatedAt:         ${fmtDate(fresh.orderMaxUpdated)}`)
  console.log(`  Product max updatedAt:       ${fmtDate(fresh.productMaxUpdated)}`)
  console.log(`  Product lastSyncedAt:        ${fmtDate(fresh.productLastSynced)}`)
  if (api.ok) {
    const delta = api.serverCount != null ? api.serverCount - fresh.productCount : null
    const pct = api.serverCount ? ((delta / api.serverCount) * 100).toFixed(1) : null
    console.log(`  API reachable.  Aegis Product count=${fresh.productCount}  InFlow totalCount=${api.serverCount}  delta=${delta} (${pct}%)`)
  } else {
    console.log(`  API NOT reachable with current creds.`)
  }
}

main()
  .catch((e) => {
    console.error('FATAL:', e)
    process.exit(1)
  })
  .finally(() => process.exit(0))
