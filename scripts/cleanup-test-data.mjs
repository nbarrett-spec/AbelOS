#!/usr/bin/env node
/**
 * cleanup-test-data.mjs — Purge E2E / audit / probe test rows that are
 * polluting manager KPIs (exec dashboard, AR heatmap, revenue roll-ups).
 *
 * What it targets (union across all scoped tables):
 *   - id LIKE 'test-audit-%'
 *   - id LIKE 'test-probe-%'
 *   - id LIKE 'test-%'
 *   - id LIKE 'audit-test-%'
 *   - Builder.companyName ILIKE '%E2E Probe%' or '%Audit Test%'
 *   - (narrow) companyName or name containing 'Probe' / 'Test' only when the
 *     id also matches a test-prefix pattern — we do NOT blindly match on "Test"
 *     because production data contains many legitimate "Test" substrings.
 *
 * Usage:
 *   node scripts/cleanup-test-data.mjs                 # dry run (no deletes)
 *   node scripts/cleanup-test-data.mjs --apply         # wrap in a tx and delete
 *
 * Safety:
 *   - Dry run by default. Prints per-table counts and sample IDs.
 *   - --apply wraps everything in a single BEGIN / COMMIT.
 *   - Before any delete, archives every targeted row to a timestamped JSON
 *     under scripts/.backups/.
 *   - AuditLog rows are left alone on purpose — they are the record of the
 *     probe and ops may want to retain them.
 *   - Builder rows with surviving REAL (non-test) Orders/Invoices/Jobs are
 *     flagged for manual review and skipped from the delete. They are printed
 *     at the end so you can dedup by hand.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

// ── Load DATABASE_URL from .env ──────────────────────────────────────
function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envPath = join(REPO_ROOT, '.env')
  const text = readFileSync(envPath, 'utf-8')
  const m = text.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m)
  if (!m) throw new Error('DATABASE_URL not found in .env')
  return m[1]
}

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = loadDatabaseUrl()

const { neon } = await import('@neondatabase/serverless')
const sql = neon(DATABASE_URL)

// ── Scope definition ────────────────────────────────────────────────
// WHERE clauses split into "byId" (id prefix only) and "byIdOrName"
// (id prefix OR companyName match) for the Builder special case.
const ID_PATTERNS = `(id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%')`
const BUILDER_MATCH = `(
   id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%'
   OR "companyName" ILIKE '%E2E Probe%' OR "companyName" ILIKE '%Audit Test%'
 )`

// FK-safe delete order: children first, then parents.
// Each entry:
//   table        — quoted table name
//   whereChild   — WHERE clause that references parent id via subquery; null for leaf/entity rows
//   whereSelf    — WHERE clause on the table's own id (or null for child-only tables)
//
// Note: for tables whose rows we ONLY want to delete when their parent is
// being deleted (not on their own id), whereSelf is null. For tables where
// the id on that table itself may match test patterns, whereSelf is set.
const STEPS = [
  // Invoice children
  { table: 'Payment',        whereChild: `"invoiceId" IN (SELECT id FROM "Invoice" WHERE ${ID_PATTERNS})`, whereSelf: ID_PATTERNS },
  { table: 'InvoiceItem',    whereChild: `"invoiceId" IN (SELECT id FROM "Invoice" WHERE ${ID_PATTERNS})`, whereSelf: ID_PATTERNS },
  { table: 'CollectionAction',whereChild:`"invoiceId" IN (SELECT id FROM "Invoice" WHERE ${ID_PATTERNS})`, whereSelf: ID_PATTERNS },
  { table: 'Invoice',        whereChild: null, whereSelf: ID_PATTERNS },

  // PurchaseOrder children
  { table: 'PurchaseOrderItem', whereChild: `"purchaseOrderId" IN (SELECT id FROM "PurchaseOrder" WHERE ${ID_PATTERNS})`, whereSelf: ID_PATTERNS },
  { table: 'PurchaseOrder',    whereChild: null, whereSelf: ID_PATTERNS },

  // Delivery children
  { table: 'DeliveryTracking', whereChild: `"deliveryId" IN (SELECT id FROM "Delivery" WHERE ${ID_PATTERNS})`, whereSelf: ID_PATTERNS },
  { table: 'Delivery',         whereChild: null, whereSelf: ID_PATTERNS },

  // Job children
  { table: 'DecisionNote',  whereChild: `"jobId" IN (SELECT id FROM "Job" WHERE ${ID_PATTERNS})`, whereSelf: ID_PATTERNS },
  { table: 'MaterialPick',  whereChild: `"jobId" IN (SELECT id FROM "Job" WHERE ${ID_PATTERNS})`, whereSelf: ID_PATTERNS },
  { table: 'QualityCheck',  whereChild: `"jobId" IN (SELECT id FROM "Job" WHERE ${ID_PATTERNS})`, whereSelf: ID_PATTERNS },
  { table: 'Installation',  whereChild: `"jobId" IN (SELECT id FROM "Job" WHERE ${ID_PATTERNS})`, whereSelf: ID_PATTERNS },
  { table: 'Task',          whereChild: `"jobId" IN (SELECT id FROM "Job" WHERE ${ID_PATTERNS})`, whereSelf: ID_PATTERNS },
  { table: 'Activity',      whereChild: `"jobId" IN (SELECT id FROM "Job" WHERE ${ID_PATTERNS})`, whereSelf: ID_PATTERNS },
  { table: 'ScheduleEntry', whereChild: `"jobId" IN (SELECT id FROM "Job" WHERE ${ID_PATTERNS})`, whereSelf: ID_PATTERNS },
  { table: 'JobPhase',      whereChild: `"jobId" IN (SELECT id FROM "Job" WHERE ${ID_PATTERNS})`, whereSelf: ID_PATTERNS },
  { table: 'Job',           whereChild: null, whereSelf: ID_PATTERNS },

  // Order children
  { table: 'OrderItem',  whereChild: `"orderId" IN (SELECT id FROM "Order" WHERE ${ID_PATTERNS})`, whereSelf: ID_PATTERNS },
  { table: 'Order',      whereChild: null, whereSelf: ID_PATTERNS },

  // Quote children
  { table: 'QuoteItem',  whereChild: `"quoteId" IN (SELECT id FROM "Quote" WHERE ${ID_PATTERNS})`, whereSelf: ID_PATTERNS },
  { table: 'Quote',      whereChild: null, whereSelf: ID_PATTERNS },

  // Takeoff / Blueprint
  { table: 'TakeoffItem', whereChild: `"takeoffId" IN (SELECT id FROM "Takeoff" WHERE ${ID_PATTERNS})`, whereSelf: ID_PATTERNS },
  { table: 'Takeoff',     whereChild: null, whereSelf: ID_PATTERNS },
  { table: 'Blueprint',   whereChild: null, whereSelf: ID_PATTERNS },

  // Project
  { table: 'Project',     whereChild: null, whereSelf: ID_PATTERNS },

  // Builder — handled separately (see below) because we also want to
  // catch "E2E Probe Builder" companyName even when id is legit.
]

// Pretty log helpers
function line(...x) { console.log(...x) }
function header(s) { line(`\n── ${s} ──`) }

async function count(table, where) {
  const rows = await sql.query(`SELECT COUNT(*)::int AS c FROM "${table}" WHERE ${where}`)
  return rows[0].c
}
async function sample(table, where, cols = ['id'], limit = 5) {
  const colList = cols.map(c => `"${c}"`).join(', ')
  return sql.query(`SELECT ${colList} FROM "${table}" WHERE ${where} ORDER BY "${cols[0]}" LIMIT ${limit}`)
}

// Archive rows before delete
async function archive(table, where, cols = null) {
  if (!cols) {
    // Select all columns — simplest
    const rows = await sql.query(`SELECT * FROM "${table}" WHERE ${where}`)
    return rows
  }
  const colList = cols.map(c => `"${c}"`).join(', ')
  return sql.query(`SELECT ${colList} FROM "${table}" WHERE ${where}`)
}

// ── 1. Survey ───────────────────────────────────────────────────────
header(`Survey ${APPLY ? '(APPLY)' : '(DRY RUN — add --apply to delete)'}`)

// Builder special-case survey first — needs cross-check against real
// downstream rows.
const builderCandidates = await sql.query(
  `SELECT id, "companyName", email, "createdAt"
     FROM "Builder"
    WHERE ${BUILDER_MATCH}
    ORDER BY "companyName", "createdAt"`
)
line(`Builder candidates: ${builderCandidates.length}`)

// For each candidate, decide: is the builder itself a test shell, or might
// it have legitimate production activity that we'd wipe out?
//
// Rule: a builder whose id matches a test prefix (test-audit-, test-probe-,
// test-, audit-test-) is a test shell by definition — any children are
// audit pollution regardless of the child's own id scheme, because the
// parent isn't a real customer. Purge them all.
//
// A builder whose id does NOT match a test prefix but whose companyName
// contains "E2E Probe" or "Audit Test" is a "dupe survivor" — we check
// whether anything substantive hangs off it. If there are linked Payments
// or POs or a populated AR balance, flag for manual review. Otherwise,
// safe to delete.
const flagged = []
const safeToDeleteBuilderIds = []
for (const b of builderCandidates) {
  const isTestPrefix =
    b.id.startsWith('test-audit-') ||
    b.id.startsWith('test-probe-') ||
    b.id.startsWith('test-') ||
    b.id.startsWith('audit-test-')
  if (isTestPrefix) {
    // Definitely test data — children are pollution by inheritance.
    safeToDeleteBuilderIds.push(b.id)
    continue
  }
  // Non-test id but name-matches "E2E Probe" / "Audit Test". Check for
  // signs of real activity: payments received, accountBalance > 0, linked
  // PurchaseOrders (Abel buying for this builder, not from them).
  const [ord, inv, prj, pay] = await Promise.all([
    sql.query(`SELECT COUNT(*)::int AS c FROM "Order"   WHERE "builderId" = $1`, [b.id]),
    sql.query(`SELECT COUNT(*)::int AS c FROM "Invoice" WHERE "builderId" = $1`, [b.id]),
    sql.query(`SELECT COUNT(*)::int AS c FROM "Project" WHERE "builderId" = $1`, [b.id]),
    sql.query(
      `SELECT COUNT(*)::int AS c FROM "Payment" p
         JOIN "Invoice" i ON i.id = p."invoiceId"
        WHERE i."builderId" = $1`, [b.id]),
  ])
  const realOrder = ord[0].c, realInvoice = inv[0].c, realProject = prj[0].c, realPayment = pay[0].c
  // If there's a real payment or a real balance on the account, don't touch.
  const hasRealActivity = realPayment > 0 || (b.accountBalance && Number(b.accountBalance) !== 0)
  if (hasRealActivity) {
    flagged.push({
      id: b.id, companyName: b.companyName, email: b.email,
      realOrder, realInvoice, realProject, realPayment,
      reason: realPayment > 0 ? 'has payments' : 'non-zero accountBalance'
    })
  } else {
    safeToDeleteBuilderIds.push(b.id)
  }
}

line(`  safe to delete:  ${safeToDeleteBuilderIds.length}`)
line(`  flagged (real deps): ${flagged.length}`)
if (flagged.length) {
  line(`  ── Flagged Builders (manual review) ──`)
  for (const f of flagged) {
    line(`   [keep] ${f.id} "${f.companyName}" <${f.email || ''}> orders=${f.realOrder} invoices=${f.realInvoice} projects=${f.realProject} payments=${f.realPayment} reason=${f.reason}`)
  }
}

// Survey child tables that key off these builders (they'll be purged via
// their own id prefix checks; but also anything linked to safe-to-delete
// builder ids that DOESN'T match a prefix should be purged).
const builderIdArr = safeToDeleteBuilderIds

// ── 2. Count per step table ────────────────────────────────────────
header(`Per-table counts (dry)`)
const perTable = []

for (const step of STEPS) {
  if (!step.whereSelf) continue
  const c = await count(step.table, step.whereSelf)
  const s = c > 0 ? await sample(step.table, step.whereSelf) : []
  perTable.push({ table: step.table, count: c, samples: s.map(r => r.id) })
  line(`  ${step.table.padEnd(22)} ${String(c).padStart(5)} ${c > 0 ? ' e.g. ' + s.slice(0,3).map(r=>r.id).join(', ') : ''}`)
}

// Builder rows (separate count — includes companyName match)
const builderCount = builderCandidates.length
line(`  ${'Builder'.padEnd(22)} ${String(builderCount).padStart(5)} (${safeToDeleteBuilderIds.length} safe to delete, ${flagged.length} flagged)`)

// Rows linked to safe-to-delete builders whose own id doesn't match a
// test prefix (e.g., Invoices with inv_* ids, Jobs with UUIDs, Orders).
// These are still test data — their parent builder is a test shell.
const builderCompanyNames = builderCandidates
  .filter(b => safeToDeleteBuilderIds.includes(b.id))
  .map(b => b.companyName)
let linkedOrderCount = 0, linkedInvoiceCount = 0, linkedProjectCount = 0, linkedActivityCount = 0, linkedJobCount = 0
if (builderIdArr.length > 0) {
  const arrSQL = `ARRAY[${builderIdArr.map(id => `'${id.replace(/'/g, "''")}'`).join(',')}]::text[]`
  const nameArrSQL = builderCompanyNames.length > 0
    ? `ARRAY[${builderCompanyNames.map(n => `'${n.replace(/'/g, "''")}'`).join(',')}]::text[]`
    : `ARRAY[]::text[]`
  ;[linkedOrderCount, linkedInvoiceCount, linkedProjectCount, linkedActivityCount, linkedJobCount] = await Promise.all([
    count('Order',    `"builderId" = ANY(${arrSQL})`),
    count('Invoice',  `"builderId" = ANY(${arrSQL})`),
    count('Project',  `"builderId" = ANY(${arrSQL})`),
    count('Activity', `"builderId" = ANY(${arrSQL})`),
    count('Job',      `"builderName" = ANY(${nameArrSQL})`),
  ])
  if (linkedOrderCount || linkedInvoiceCount || linkedProjectCount || linkedActivityCount || linkedJobCount) {
    line(`  ── Also linked to test builders (non-test-prefixed ids) ──`)
    line(`   Order:    ${linkedOrderCount}`)
    line(`   Invoice:  ${linkedInvoiceCount}`)
    line(`   Project:  ${linkedProjectCount}`)
    line(`   Activity: ${linkedActivityCount}`)
    line(`   Job:      ${linkedJobCount}`)
  }
}

// ── 3. AuditLog note ───────────────────────────────────────────────
const auditLogCount = await count('AuditLog',
  `id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%' OR "entityId" LIKE 'test-audit-%' OR "entityId" LIKE 'test-probe-%'`)
line(`\nAuditLog rows that reference/are test data: ${auditLogCount} (LEFT INTACT — ops may want this trail)`)

// ── 4. Archive + Delete if --apply ──────────────────────────────────
if (!APPLY) {
  line(`\nDry run complete. Re-run with --apply to delete.`)
  process.exit(0)
}

header('Archiving rows to JSON backup')
const backupDir = join(__dirname, '.backups')
if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupFile = join(backupDir, `cleanup-test-data-${stamp}.json`)

const archive_payload = { generatedAt: new Date().toISOString(), tables: {}, flagged }
for (const step of STEPS) {
  if (!step.whereSelf) continue
  const rows = await archive(step.table, step.whereSelf)
  if (rows.length) archive_payload.tables[step.table] = rows
}
if (builderCandidates.length)  archive_payload.tables['Builder'] = builderCandidates
if (builderIdArr.length) {
  const arrSQL = `ARRAY[${builderIdArr.map(id => `'${id.replace(/'/g, "''")}'`).join(',')}]::text[]`
  const nameArrSQL = builderCompanyNames.length > 0
    ? `ARRAY[${builderCompanyNames.map(n => `'${n.replace(/'/g, "''")}'`).join(',')}]::text[]`
    : `ARRAY[]::text[]`
  const linkedOrders   = await sql.query(`SELECT * FROM "Order"    WHERE "builderId" = ANY(${arrSQL})`)
  const linkedInvoices = await sql.query(`SELECT * FROM "Invoice"  WHERE "builderId" = ANY(${arrSQL})`)
  const linkedProjects = await sql.query(`SELECT * FROM "Project"  WHERE "builderId" = ANY(${arrSQL})`)
  const linkedActs     = await sql.query(`SELECT * FROM "Activity" WHERE "builderId" = ANY(${arrSQL})`)
  const linkedJobs     = await sql.query(`SELECT * FROM "Job"      WHERE "builderName" = ANY(${nameArrSQL})`)
  if (linkedOrders.length)   archive_payload.tables['Order_linked']    = linkedOrders
  if (linkedInvoices.length) archive_payload.tables['Invoice_linked']  = linkedInvoices
  if (linkedProjects.length) archive_payload.tables['Project_linked']  = linkedProjects
  if (linkedActs.length)     archive_payload.tables['Activity_linked'] = linkedActs
  if (linkedJobs.length)     archive_payload.tables['Job_linked']      = linkedJobs
}

writeFileSync(backupFile, JSON.stringify(archive_payload, null, 2))
line(`Backup written → ${backupFile}`)

// Verify writability after write
const bytes = readFileSync(backupFile).length
if (bytes < 100) throw new Error('Backup file is suspiciously small; aborting before delete.')
line(`Backup size: ${bytes} bytes`)

// ── 5. Delete (single transaction) ─────────────────────────────────
header('Deleting (transaction)')
const purged = {}

try {
  await sql.query('BEGIN')

  // First, clear child rows that reference prefix-matching parents
  for (const step of STEPS) {
    if (!step.whereChild) continue
    const before = await count(step.table, step.whereChild)
    if (before > 0) {
      await sql.query(`DELETE FROM "${step.table}" WHERE ${step.whereChild}`)
      purged[step.table] = (purged[step.table] || 0) + before
      line(`  ${step.table.padEnd(22)} deleted ${before} (via parent)`)
    }
  }

  // Then, clear linked rows for safe-to-delete companyName-matched builders
  // so the Builder DELETE at the end won't fail on FK restriction.
  if (builderIdArr.length > 0) {
    const arrSQL = `ARRAY[${builderIdArr.map(id => `'${id.replace(/'/g, "''")}'`).join(',')}]::text[]`

    // Order children linked to these builders, then Orders
    const linkedOrderIds = await sql.query(
      `SELECT id FROM "Order" WHERE "builderId" = ANY(${arrSQL})`
    )
    if (linkedOrderIds.length > 0) {
      const ordIdArr = `ARRAY[${linkedOrderIds.map(r => `'${r.id.replace(/'/g, "''")}'`).join(',')}]::text[]`
      const oiCount = await count('OrderItem', `"orderId" = ANY(${ordIdArr})`)
      if (oiCount > 0) {
        await sql.query(`DELETE FROM "OrderItem" WHERE "orderId" = ANY(${ordIdArr})`)
        purged['OrderItem'] = (purged['OrderItem'] || 0) + oiCount
        line(`  OrderItem              deleted ${oiCount} (via builder-linked order)`)
      }
      const oCount = linkedOrderIds.length
      await sql.query(`DELETE FROM "Order" WHERE id = ANY(${ordIdArr})`)
      purged['Order'] = (purged['Order'] || 0) + oCount
      line(`  Order                  deleted ${oCount} (via builder)`)
    }

    const extraInvoice = await count('Invoice', `"builderId" = ANY(${arrSQL})`)
    if (extraInvoice > 0) {
      await sql.query(`DELETE FROM "Payment"     WHERE "invoiceId" IN (SELECT id FROM "Invoice" WHERE "builderId" = ANY(${arrSQL}))`)
      await sql.query(`DELETE FROM "InvoiceItem" WHERE "invoiceId" IN (SELECT id FROM "Invoice" WHERE "builderId" = ANY(${arrSQL}))`)
      await sql.query(`DELETE FROM "CollectionAction" WHERE "invoiceId" IN (SELECT id FROM "Invoice" WHERE "builderId" = ANY(${arrSQL}))`)
      await sql.query(`DELETE FROM "Invoice"     WHERE "builderId" = ANY(${arrSQL})`)
      purged['Invoice'] = (purged['Invoice'] || 0) + extraInvoice
      line(`  Invoice                deleted ${extraInvoice} (via builder)`)
    }

    const extraProj = await count('Project', `"builderId" = ANY(${arrSQL})`)
    if (extraProj > 0) {
      await sql.query(`DELETE FROM "Project" WHERE "builderId" = ANY(${arrSQL})`)
      purged['Project'] = (purged['Project'] || 0) + extraProj
      line(`  Project                deleted ${extraProj} (via builder)`)
    }

    const extraAct = await count('Activity', `"builderId" = ANY(${arrSQL})`)
    if (extraAct > 0) {
      await sql.query(`DELETE FROM "Activity" WHERE "builderId" = ANY(${arrSQL})`)
      purged['Activity'] = (purged['Activity'] || 0) + extraAct
      line(`  Activity               deleted ${extraAct} (via builder)`)
    }

    // Jobs linked by builderName (Job has no builderId FK)
    if (builderCompanyNames.length > 0) {
      const nameArrSQL = `ARRAY[${builderCompanyNames.map(n => `'${n.replace(/'/g, "''")}'`).join(',')}]::text[]`
      const linkedJobIds = await sql.query(
        `SELECT id FROM "Job" WHERE "builderName" = ANY(${nameArrSQL})`
      )
      if (linkedJobIds.length > 0) {
        const jIdArr = `ARRAY[${linkedJobIds.map(r => `'${r.id.replace(/'/g, "''")}'`).join(',')}]::text[]`
        // Clear Job children in FK-safe order
        for (const childTable of ['DecisionNote', 'MaterialPick', 'QualityCheck',
                                   'Installation', 'Task', 'Activity',
                                   'ScheduleEntry', 'JobPhase']) {
          const c = await count(childTable, `"jobId" = ANY(${jIdArr})`)
          if (c > 0) {
            await sql.query(`DELETE FROM "${childTable}" WHERE "jobId" = ANY(${jIdArr})`)
            purged[childTable] = (purged[childTable] || 0) + c
            line(`  ${childTable.padEnd(22)} deleted ${c} (via job builderName)`)
          }
        }
        // Deliveries hang off Job too
        const delCount = await count('Delivery', `"jobId" = ANY(${jIdArr})`)
        if (delCount > 0) {
          await sql.query(`DELETE FROM "DeliveryTracking" WHERE "deliveryId" IN (SELECT id FROM "Delivery" WHERE "jobId" = ANY(${jIdArr}))`)
          await sql.query(`DELETE FROM "Delivery" WHERE "jobId" = ANY(${jIdArr})`)
          purged['Delivery'] = (purged['Delivery'] || 0) + delCount
          line(`  Delivery               deleted ${delCount} (via job builderName)`)
        }
        // Finally, the jobs themselves
        await sql.query(`DELETE FROM "Job" WHERE id = ANY(${jIdArr})`)
        purged['Job'] = (purged['Job'] || 0) + linkedJobIds.length
        line(`  Job                    deleted ${linkedJobIds.length} (via builderName)`)
      }
    }
  }

  // Then, clear the entity rows themselves
  for (const step of STEPS) {
    if (!step.whereSelf) continue
    const before = await count(step.table, step.whereSelf)
    if (before > 0) {
      await sql.query(`DELETE FROM "${step.table}" WHERE ${step.whereSelf}`)
      purged[step.table] = (purged[step.table] || 0) + before
      line(`  ${step.table.padEnd(22)} deleted ${before}`)
    }
  }

  // Finally, delete the safe-to-delete Builders
  if (safeToDeleteBuilderIds.length > 0) {
    const arrSQL = `ARRAY[${safeToDeleteBuilderIds.map(id => `'${id.replace(/'/g, "''")}'`).join(',')}]::text[]`
    await sql.query(`DELETE FROM "Builder" WHERE id = ANY(${arrSQL})`)
    purged['Builder'] = safeToDeleteBuilderIds.length
    line(`  Builder                deleted ${safeToDeleteBuilderIds.length}`)
  }

  await sql.query('COMMIT')
  line(`\nCOMMIT ok`)
} catch (e) {
  await sql.query('ROLLBACK').catch(() => {})
  console.error(`\n[FATAL] ${e.message}`)
  console.error(`Transaction ROLLED BACK. No rows deleted.`)
  console.error(`Backup left intact at: ${backupFile}`)
  process.exit(1)
}

// ── 6. Summary ─────────────────────────────────────────────────────
header('Summary')
let totalPurged = 0
for (const [tbl, n] of Object.entries(purged).sort((a,b)=>b[1]-a[1])) {
  line(`  ${tbl.padEnd(22)} ${String(n).padStart(5)}`)
  totalPurged += n
}
line(`  ${'TOTAL'.padEnd(22)} ${String(totalPurged).padStart(5)}`)
if (flagged.length) {
  line(`\nFlagged for manual review: ${flagged.length}`)
  for (const f of flagged) {
    line(`  [review] ${f.id} "${f.companyName}" orders=${f.realOrder} invoices=${f.realInvoice} projects=${f.realProject} payments=${f.realPayment} reason=${f.reason}`)
  }
}
line(`\nBackup file: ${backupFile}`)
line(`AuditLog: ${auditLogCount} rows left intact (ops trail)`)
