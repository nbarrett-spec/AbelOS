export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { parseDollar } from '@/lib/hyphen/parse-dollar'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/import-hyphen — Import scraped Hyphen Solutions data
// ──────────────────────────────────────────────────────────────────────────
// Accepts JSON body with any combination of:
//   orders[]    - SupplyPro order search rows
//   payments[]  - Payment report rows (from hyphen-payments-export.json)
//
// Data format for orders (TSV/JSON):
//   { hyphId, refOrderId, jobId, builderOrderNum, supplierOrderNum, account,
//     subdivision, phase, group, lotBlockPlan, address, task, total, dates, status }
//
// Data format for payments (from scraped report):
//   Raw payment arrays from the Hyphen payments export file
// ──────────────────────────────────────────────────────────────────────────

const genId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/** Parse dates in common Hyphen formats: "m/d/yyyy", ISO, etc. */
function safeParseDate(s: string | null | undefined): string | null {
  if (!s) return null
  try {
    const trimmed = s.trim()
    if (trimmed.includes('T') || trimmed.match(/^\d{4}-\d{2}-\d{2}/)) {
      const d = new Date(trimmed)
      return isNaN(d.getTime()) ? null : d.toISOString()
    }
    const parts = trimmed.split(' ')[0].split('/')
    if (parts.length === 3) {
      const [m, d, y] = parts
      const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00Z`
      const date = new Date(iso)
      return isNaN(date.getTime()) ? null : date.toISOString()
    }
    const d = new Date(trimmed)
    return isNaN(d.getTime()) ? null : d.toISOString()
  } catch { return null }
}

// parseDollar extracted to '@/lib/hyphen/parse-dollar' — see that module for
// full semantics and unit tests. Always returns a non-negative magnitude;
// sign semantics are owned by the caller (e.g. paymentType = 'Void').

/** Parse Hyphen date pairs from the dates field: "RS: 5/3/2024\nRE: 5/3/2024\nAS: 5/3/2024\nAE: 5/3/2024" */
function parseDateField(dates: string | null | undefined): {
  requestedStart: string | null
  requestedEnd: string | null
  actualStart: string | null
  actualEnd: string | null
} {
  const result = { requestedStart: null as string | null, requestedEnd: null as string | null, actualStart: null as string | null, actualEnd: null as string | null }
  if (!dates) return result
  const lines = dates.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    const [key, val] = line.split(':').map(s => s?.trim())
    if (!key || !val) continue
    if (key === 'RS') result.requestedStart = safeParseDate(val)
    else if (key === 'RE') result.requestedEnd = safeParseDate(val)
    else if (key === 'AS') result.actualStart = safeParseDate(val)
    else if (key === 'AE') result.actualEnd = safeParseDate(val)
  }
  return result
}

/** Parse Hyphen status field: "O: Cancelled\nB: Cancelled" */
function parseStatusField(status: string | null | undefined): { orderStatus: string; builderStatus: string } {
  const result = { orderStatus: 'UNKNOWN', builderStatus: 'UNKNOWN' }
  if (!status) return result
  const lines = status.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    const [key, val] = line.split(':').map(s => s?.trim())
    if (!key || !val) continue
    if (key === 'O') result.orderStatus = val
    else if (key === 'B') result.builderStatus = val
  }
  return result
}

/** Map Hyphen account names to a normalized builder name */
function normalizeBuilderName(account: string): string {
  const lower = (account || '').toLowerCase()
  if (lower.includes('toll brothers') || lower.includes('toll ')) return 'Toll Brothers'
  if (lower.includes('brookfield')) return 'Brookfield Residential'
  if (lower.includes('shaddock')) return 'Shaddock Homes'
  // Fallback: clean up the raw account name
  return account?.split(' - ')[0]?.trim() || account || 'Unknown Builder'
}

/**
 * Normalize a street address to "<number> <first-street-word>" form so both sides
 * match regardless of suffix ("Drive", "Dr", "Mews", etc.) or trailing modifiers
 * ("- Trim 1", ", Frisco,TX"). See scripts/reconcile-hyphen-brookfield.mjs for
 * full rationale: Hyphen addresses carry ", City,ST" and Job addresses carry
 * " - <phase>" tails, so exact comparison always fails without this.
 */
function normalizeStreetKey(s: string | null | undefined): string {
  if (!s) return ''
  const head = String(s).toLowerCase().split(/,|\s-\s/)[0].trim()
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  const m = head.match(/^(\d+)\s+([a-z]+(?:\s+[a-z]+){0,3})/)
  if (!m) return head
  const suffix = /\s(drive|dr|lane|ln|street|st|road|rd|court|ct|mews|trail|tr|way|circle|cir|place|pl)$/
  let s2 = `${m[1]} ${m[2]}`
  while (suffix.test(s2)) s2 = s2.replace(suffix, '')
  return s2.trim()
}

async function ensureTables() {
  // HyphenOrder — stores all Hyphen SupplyPro order data
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "HyphenOrder" (
      "id"                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "hyphId"            TEXT UNIQUE,
      "refOrderId"        TEXT,
      "jobId"             TEXT,
      "builderOrderNum"   TEXT,
      "supplierOrderNum"  TEXT,
      "account"           TEXT,
      "builderName"       TEXT,
      "subdivision"       TEXT,
      "phase"             TEXT,
      "groupName"         TEXT,
      "lotBlockPlan"      TEXT,
      "address"           TEXT,
      "task"              TEXT,
      "total"             DOUBLE PRECISION DEFAULT 0,
      "requestedStart"    TIMESTAMPTZ,
      "requestedEnd"      TIMESTAMPTZ,
      "actualStart"       TIMESTAMPTZ,
      "actualEnd"         TIMESTAMPTZ,
      "orderStatus"       TEXT,
      "builderStatus"     TEXT,
      "rawDates"          TEXT,
      "rawStatus"         TEXT,
      "createdAt"         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // HyphenPayment — stores payment report data
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "HyphenPayment" (
      "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "builderAccount"  TEXT,
      "builderName"     TEXT,
      "orderNumber"     TEXT,
      "address"         TEXT,
      "subdivision"     TEXT,
      "lotBlockPlan"    TEXT,
      "supplierOrderNum" TEXT,
      "taskDescription" TEXT,
      "soNumber"        TEXT,
      "invoiceNumber"   TEXT,
      "checkNumber"     TEXT,
      "paymentDate"     TIMESTAMPTZ,
      "amount"          DOUBLE PRECISION DEFAULT 0,
      "paymentType"     TEXT,
      "createdAt"       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Index for faster lookups
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_hyphen_order_hyphId" ON "HyphenOrder" ("hyphId")
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_hyphen_order_builder" ON "HyphenOrder" ("builderName")
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_hyphen_payment_check" ON "HyphenPayment" ("checkNumber")
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_hyphen_payment_builder" ON "HyphenPayment" ("builderName")
  `)

  // HyphenCommunityMapping — canonical bridge from Hyphen subdivision labels
  // (which carry plan-tier variants like "The Grove Frisco 55s") to Aegis
  // Community rows. Populated by scripts/reconcile-hyphen-brookfield.mjs and
  // consumed below to backfill Job.communityId on import.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "HyphenCommunityMapping" (
      "id"                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "hyphenSubdivision" TEXT UNIQUE NOT NULL,
      "communityId"       TEXT NOT NULL,
      "builderId"         TEXT,
      "matchMethod"       TEXT,
      "matchScore"        DOUBLE PRECISION,
      "createdAt"         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_hyphen_map_community" ON "HyphenCommunityMapping" ("communityId")
  `)
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const startTime = Date.now()

  try {
    const body = await request.json()
    const { orders = [], payments } = body
    audit(request, 'IMPORT_HYPHEN', 'HyphenImport', undefined, {
      orderCount: orders?.length || 0,
      paymentCount: payments?.data?.length || 0,
    }, 'WARN').catch(() => {})

    const results: any = {
      orders: { created: 0, updated: 0, skipped: 0, errors: [] as string[] },
      payments: { created: 0, updated: 0, skipped: 0, errors: [] as string[] },
      jobs: { created: 0, updated: 0, errors: [] as string[] },
      builders: { created: 0, found: 0 },
    }

    await ensureTables()

    // ── 1. Import Orders ────────────────────────────────────────────────
    if (orders.length > 0) {
      // Ensure builders exist
      const builderCache: Record<string, string> = {}

      for (const order of orders) {
        try {
          const builderName = normalizeBuilderName(order.account)

          // Find or create builder
          if (!builderCache[builderName]) {
            const existing: any[] = await prisma.$queryRawUnsafe(
              `SELECT id FROM "Builder" WHERE LOWER("companyName") = LOWER($1) LIMIT 1`, builderName
            )
            if (existing.length > 0) {
              builderCache[builderName] = existing[0].id
              results.builders.found++
            } else {
              const created: any[] = await prisma.$queryRawUnsafe(
                `INSERT INTO "Builder" ("id", "companyName", "contactName", "email", "phone", "address", "city", "state", "zip", "active", "createdAt", "updatedAt")
                 VALUES (gen_random_uuid()::text, $1, $1, '', '', '', '', 'TX', '', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                 RETURNING id`,
                builderName
              )
              builderCache[builderName] = created[0].id
              results.builders.created++
            }
          }

          const hyphId = order.hyphId || order.hyphid
          if (!hyphId) {
            results.orders.skipped++
            continue
          }

          const dates = parseDateField(order.dates)
          const statuses = parseStatusField(order.status)
          const total = parseDollar(order.total)

          // Upsert into HyphenOrder
          await prisma.$executeRawUnsafe(
            `INSERT INTO "HyphenOrder" (
              "id", "hyphId", "refOrderId", "jobId", "builderOrderNum", "supplierOrderNum",
              "account", "builderName", "subdivision", "phase", "groupName", "lotBlockPlan",
              "address", "task", "total",
              "requestedStart", "requestedEnd", "actualStart", "actualEnd",
              "orderStatus", "builderStatus", "rawDates", "rawStatus",
              "createdAt", "updatedAt"
            ) VALUES (
              gen_random_uuid()::text, $1, $2, $3, $4, $5,
              $6, $7, $8, $9, $10, $11,
              $12, $13, $14,
              $15, $16, $17, $18,
              $19, $20, $21, $22,
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            ON CONFLICT ("hyphId") DO UPDATE SET
              "refOrderId" = EXCLUDED."refOrderId",
              "builderOrderNum" = EXCLUDED."builderOrderNum",
              "supplierOrderNum" = EXCLUDED."supplierOrderNum",
              "account" = EXCLUDED."account",
              "builderName" = EXCLUDED."builderName",
              "subdivision" = EXCLUDED."subdivision",
              "total" = EXCLUDED."total",
              "requestedStart" = EXCLUDED."requestedStart",
              "requestedEnd" = EXCLUDED."requestedEnd",
              "actualStart" = EXCLUDED."actualStart",
              "actualEnd" = EXCLUDED."actualEnd",
              "orderStatus" = EXCLUDED."orderStatus",
              "builderStatus" = EXCLUDED."builderStatus",
              "rawDates" = EXCLUDED."rawDates",
              "rawStatus" = EXCLUDED."rawStatus",
              "updatedAt" = CURRENT_TIMESTAMP`,
            hyphId,
            order.refOrderId || null,
            order.jobId || null,
            order.builderOrderNum || null,
            order.supplierOrderNum || null,
            order.account || null,
            builderName,
            order.subdivision || null,
            order.phase || null,
            order.group || order.groupName || null,
            order.lotBlockPlan || null,
            order.address || null,
            order.task || null,
            total,
            dates.requestedStart ? new Date(dates.requestedStart) : null,
            dates.requestedEnd ? new Date(dates.requestedEnd) : null,
            dates.actualStart ? new Date(dates.actualStart) : null,
            dates.actualEnd ? new Date(dates.actualEnd) : null,
            statuses.orderStatus,
            statuses.builderStatus,
            order.dates || null,
            order.status || null,
          )

          results.orders.created++

          // Also upsert into main Job table for cross-builder visibility
          const address = (order.address || '').replace(/\n/g, ' ').trim()
          const addressParts = address.match(/^(.+?)([A-Z][a-z]+.*?,\s*[A-Z]{2}\s*\d{5})$/)
          const streetAddress = addressParts ? addressParts[1].trim() : address
          const jobName = `${order.subdivision || 'Hyphen'} - ${order.lotBlockPlan || hyphId}`

          // Check if job exists by address or hyphen job ID.
          // We match on normalized street key (digits + first street word,
          // suffix-stripped) because raw address equality never hits — the
          // Hyphen side carries ", Frisco,TX" and the Aegis side carries
          // " - Trim 1". Previously this block only incremented `jobs.updated`
          // without actually linking; that's the 0/72 bug.
          const streetKey = normalizeStreetKey(streetAddress)
          const existingJob: any[] = streetKey
            ? await prisma.$queryRawUnsafe(
                `SELECT "id", "hyphenJobId", "communityId" FROM "Job"
                  WHERE LOWER("builderName") = LOWER($1)
                    AND "jobAddress" IS NOT NULL
                    AND regexp_replace(
                          regexp_replace(LOWER(split_part(split_part("jobAddress", ',', 1), ' - ', 1)), '[^a-z0-9 ]', ' ', 'g'),
                          '\\s+(drive|dr|lane|ln|street|st|road|rd|court|ct|mews|trail|tr|way|circle|cir|place|pl)\\s*$', ''
                        ) = $2
                  LIMIT 1`,
                builderName, streetKey,
              )
            : await prisma.$queryRawUnsafe(
                `SELECT "id", "hyphenJobId", "communityId" FROM "Job" WHERE "boltJobId" = $1 LIMIT 1`,
                `HYP-${hyphId}`,
              )

          if (existingJob.length > 0) {
            // Resolve community via HyphenCommunityMapping (populated by the
            // reconcile script). No mapping → leave communityId untouched.
            const mapRow: any[] = order.subdivision
              ? await prisma.$queryRawUnsafe(
                  `SELECT "communityId" FROM "HyphenCommunityMapping" WHERE "hyphenSubdivision" = $1 LIMIT 1`,
                  order.subdivision,
                )
              : []
            const communityId = mapRow[0]?.communityId || null
            await prisma.$executeRawUnsafe(
              `UPDATE "Job"
                  SET "hyphenJobId" = COALESCE("hyphenJobId", $1),
                      "communityId" = COALESCE("communityId", $2),
                      "updatedAt"   = CURRENT_TIMESTAMP
                WHERE "id" = $3`,
              hyphId, communityId, existingJob[0].id,
            )
            results.jobs.updated++
          } else if (streetAddress) {
            try {
              // Hyphen order end dates are the best proxy for scheduledDate.
              // Prefer the actual end date (the builder-confirmed target),
              // fall back to requested end. Prevents Job.scheduledDate from
              // landing null — see scripts/backfill-job-schedules.mjs for the
              // one-time patch of existing rows.
              const scheduledDate =
                dates.actualEnd ? new Date(dates.actualEnd) :
                dates.requestedEnd ? new Date(dates.requestedEnd) :
                null
              await prisma.$executeRawUnsafe(
                `INSERT INTO "Job" (
                  "id", "name", "builderName", "community", "address", "city", "state",
                  "status", "scope", "boltJobId", "scheduledDate",
                  "createdAt", "updatedAt"
                ) VALUES (
                  gen_random_uuid()::text, $1, $2, $3, $4, '', 'TX',
                  'CREATED'::"JobStatus", 'TRIM_ONLY'::"ScopeType", $5, $6,
                  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                ON CONFLICT DO NOTHING`,
                jobName, builderName, order.subdivision || null,
                streetAddress, `HYP-${hyphId}`,
                scheduledDate
              )
              results.jobs.created++
            } catch (err: any) {
              results.jobs.errors.push(`Job ${hyphId}: ${err.message?.substring(0, 100)}`)
            }
          }
        } catch (err: any) {
          results.orders.errors.push(`Order ${order.hyphId || '?'}: ${err.message?.substring(0, 100)}`)
        }
      }
    }

    // ── 2. Import Payments ──────────────────────────────────────────────
    // Payments come as the raw "data" array from the Hyphen export
    // Each payment row is an array: [account, orderInfo, subdivision, lotBlock, soNum, supplierOrder, taskDesc, ?, invoiceNum, checkNum, date, amount, payType]
    // Interspersed with "Total for Check XXXX:" summary rows and "Report Total:" row
    if (payments && payments.data && payments.data.length > 0) {
      let currentAccount = ''

      for (const row of payments.data) {
        try {
          // Skip summary rows
          if (!Array.isArray(row) || row.length < 5) continue
          if (typeof row[0] === 'string' && (row[0].startsWith('Total for Check') || row[0].startsWith('Report Total'))) continue
          if (row.length < 10) continue // Not a full data row

          // Determine account: non-empty first field = builder account header
          if (row[0] && typeof row[0] === 'string' && row[0].trim() !== '' && !row[0].startsWith('Total')) {
            currentAccount = row[0].trim()
          }

          // Parse the payment row fields
          const orderInfo = row[1] || ''
          const subdivision = row[2] || ''
          const lotBlockPlan = row[3] || ''
          const soNumber = row[4] || ''
          const supplierOrderNum = row[5] || ''
          const taskDescription = row[6] || ''
          // row[7] is usually empty
          const invoiceNumber = row[8] || ''
          const checkNumber = row[9] || ''
          const paymentDateStr = row[10] || ''
          const amountStr = row[11] || ''
          const paymentType = row[12] || ''

          // Skip if no check number and no amount (likely a non-data row)
          if (!checkNumber && !amountStr) continue

          const amount = parseDollar(amountStr)
          if (amount === 0 && !checkNumber) continue

          const paymentDate = safeParseDate(paymentDateStr)
          const builderName = normalizeBuilderName(currentAccount)

          // Extract address from orderInfo (format: "83360008 - 1415 Magnolia Trail - 0008/A\n1415 Magnolia TrailOak Point, TX 75068")
          const orderNum = orderInfo.split(' - ')[0]?.trim() || ''
          const addressMatch = orderInfo.match(/\n\s*(.+)$/)
          const address = addressMatch ? addressMatch[1].trim() : ''

          await prisma.$executeRawUnsafe(
            `INSERT INTO "HyphenPayment" (
              "id", "builderAccount", "builderName", "orderNumber", "address", "subdivision",
              "lotBlockPlan", "supplierOrderNum", "taskDescription", "soNumber",
              "invoiceNumber", "checkNumber", "paymentDate", "amount", "paymentType",
              "createdAt", "updatedAt"
            ) VALUES (
              gen_random_uuid()::text, $1, $2, $3, $4, $5,
              $6, $7, $8, $9,
              $10, $11, $12, $13, $14,
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )`,
            currentAccount, builderName, orderNum, address, subdivision,
            lotBlockPlan, supplierOrderNum, taskDescription, soNumber,
            invoiceNumber, checkNumber,
            paymentDate ? new Date(paymentDate) : null,
            amount, paymentType
          )

          results.payments.created++
        } catch (err: any) {
          results.payments.errors.push(`Payment row: ${err.message?.substring(0, 100)}`)
        }
      }
    }

    // ── 3. Generate revenue summary for cross-referencing with InFlow ──
    let revenueSummary: any[] = []
    try {
      revenueSummary = await prisma.$queryRawUnsafe(`
        SELECT
          "builderName",
          COUNT(*)::int as "paymentCount",
          SUM("amount")::float as "totalAmount",
          MIN("paymentDate") as "earliestPayment",
          MAX("paymentDate") as "latestPayment"
        FROM "HyphenPayment"
        GROUP BY "builderName"
        ORDER BY SUM("amount") DESC
      `)
    } catch { /* table might be empty */ }

    let orderSummary: any[] = []
    try {
      orderSummary = await prisma.$queryRawUnsafe(`
        SELECT
          "builderName",
          COUNT(*)::int as "orderCount",
          SUM("total")::float as "totalValue",
          COUNT(DISTINCT "subdivision")::int as "subdivisionCount"
        FROM "HyphenOrder"
        GROUP BY "builderName"
        ORDER BY SUM("total") DESC
      `)
    } catch { /* table might be empty */ }

    const elapsed = Date.now() - startTime

    return NextResponse.json({
      success: true,
      elapsed: `${elapsed}ms`,
      results,
      summary: {
        orders: orderSummary,
        payments: revenueSummary,
      },
    })
  } catch (error: any) {
    console.error('[import-hyphen] Error:', error)
    return NextResponse.json(
      { error: 'Import failed'},
      { status: 500 }
    )
  }
}

// ── GET: Check import status ──────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    let orderCount = 0, paymentCount = 0
    let orderSummary: any[] = [], paymentSummary: any[] = []

    try {
      const oc: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as c FROM "HyphenOrder"`)
      orderCount = oc[0]?.c || 0
      orderSummary = await prisma.$queryRawUnsafe(`
        SELECT "builderName", COUNT(*)::int as "orderCount", SUM("total")::float as "totalValue"
        FROM "HyphenOrder" GROUP BY "builderName" ORDER BY SUM("total") DESC
      `)
    } catch { /* table doesn't exist yet */ }

    try {
      const pc: any[] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as c FROM "HyphenPayment"`)
      paymentCount = pc[0]?.c || 0
      paymentSummary = await prisma.$queryRawUnsafe(`
        SELECT "builderName", COUNT(*)::int as "paymentCount", SUM("amount")::float as "totalAmount"
        FROM "HyphenPayment" GROUP BY "builderName" ORDER BY SUM("amount") DESC
      `)
    } catch { /* table doesn't exist yet */ }

    return NextResponse.json({
      status: 'ok',
      totals: { orders: orderCount, payments: paymentCount },
      orders: orderSummary,
      payments: paymentSummary,
    })
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}
