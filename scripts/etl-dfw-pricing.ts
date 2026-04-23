/**
 * scripts/etl-dfw-pricing.ts
 *
 * Extracts actionable pricing data from the DFW Box Export archive
 * (`Abel Door & Trim_ DFW Box Export/`). Creates pointer InboxItems
 * for historical rate cards AND flags gaps vs. the live BuilderPricing
 * table for Brookfield, Toll Brothers, and Pulte.
 *
 * IMPORTANT: This loader does NOT write to BuilderPricing / Product /
 * Builder. Flag-only. Nate must review findings and run a separate
 * pricing-import once approved.
 *
 * Target folders (Lisa's Bids is handled by a separate agent):
 *   - DFW/PRICING/ (exterior door supplier catalog — Hoelscher 2025)
 *   - DFW/Project Management/Builder Accounts/Brookfield Homes/Pricing/
 *   - DFW/Project Management/Builder Accounts/Pulte/
 *   - DFW/Project Management/Builder Accounts/Toll Brothers/
 *   - DFW/Purchasing/Trim Pricing/
 *
 * File classification:
 *   TURNKEY_BID       — current turnkey / price book (e.g. Brookfield 10.1.2025)
 *   SCHEDULE_A        — Pulte Schedule A backup — may be stale (Pulte account LOST 4/20)
 *   AUDIT             — Brookfield Price Audit (variance analysis)
 *   SUPPLIER_CATALOG  — Hoelscher exterior door catalog (vendor price list)
 *   PLAN_LIST         — Toll plan master list (non-pricing, but referenced)
 *   HISTORICAL        — archived / old pricing — pointer only
 *
 * Constraints:
 *   - Skip PDFs/images.
 *   - Skip files > 10 MB (statSync first — OneDrive rehydration).
 *   - Process at most 20 XLSX/CSV files; prioritize by size.
 *   - 3-minute wall-clock budget for file scanning.
 *   - Cap 10 InboxItems created.
 *   - FORBIDDEN: BuilderPricing writes.
 *
 * Idempotency: deterministic ids `dfw-pricing-<slug>`, upsert pattern.
 *
 * Source tag: DFW_EXPORT_PRICING
 *
 * Usage:
 *   npx tsx scripts/etl-dfw-pricing.ts           # dry run (default)
 *   npx tsx scripts/etl-dfw-pricing.ts --commit  # write
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'

const DRY_RUN = !process.argv.includes('--commit')
const SOURCE_TAG = 'DFW_EXPORT_PRICING'
const MAX_INBOX_ITEMS = 10
const MAX_XLSX_PROCESSED = 20
const MAX_FILE_BYTES = 10 * 1024 * 1024
const SCAN_BUDGET_MS = 180_000 // 3 min

const EXPORT_ROOT =
  'C:/Users/natha/OneDrive/Abel Lumber/Abel Door & Trim_ DFW Box Export/Abel Door & Trim_ DFW'

const TARGET_DIRS = [
  `${EXPORT_ROOT}/PRICING`,
  `${EXPORT_ROOT}/Project Management/Builder Accounts/Brookfield Homes/Pricing`,
  `${EXPORT_ROOT}/Project Management/Builder Accounts/Brookfield Homes/Audit`,
  `${EXPORT_ROOT}/Project Management/Builder Accounts/Pulte/Schedule A`,
  `${EXPORT_ROOT}/Project Management/Builder Accounts/Pulte/Pricing`,
  `${EXPORT_ROOT}/Project Management/Builder Accounts/Toll Brothers/Pricing`,
  `${EXPORT_ROOT}/Project Management/Builder Accounts/Toll Brothers/Plans`,
  `${EXPORT_ROOT}/Project Management/Builder Accounts/Toll Brothers/The Ranch at Uptown`,
  `${EXPORT_ROOT}/Purchasing/Trim Pricing`,
]

const prisma = new PrismaClient()

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ClassifiedFile = {
  abs: string
  rel: string
  size: number
  kind:
    | 'TURNKEY_BID'
    | 'SCHEDULE_A'
    | 'AUDIT'
    | 'SUPPLIER_CATALOG'
    | 'PLAN_LIST'
    | 'HISTORICAL'
    | 'UNKNOWN'
  builder: 'Brookfield' | 'Pulte' | 'Toll' | 'Bloomfield' | 'Supplier' | null
}

type SheetSummary = {
  sheet: string
  rows: number
  ref: string
  head: string[]
}

type FileReport = {
  file: ClassifiedFile
  sheets: SheetSummary[]
  priceRowsApprox: number // best-effort count of rows that look like priced line-items
  error?: string
}

// ---------------------------------------------------------------------------
// Walk & classify
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[], deadline: number) {
  if (Date.now() > deadline) return
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (Date.now() > deadline) return
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      walk(p, out, deadline)
    } else if (e.isFile()) {
      const lower = e.name.toLowerCase()
      if (lower.endsWith('.xlsx') || lower.endsWith('.csv') || lower.endsWith('.xls')) {
        out.push(p)
      }
    }
  }
}

function classify(abs: string): ClassifiedFile {
  const rel = abs.replace(EXPORT_ROOT + path.sep, '').replace(/\\/g, '/')
  let size = 0
  try {
    size = fs.statSync(abs).size
  } catch {}

  const lowerPath = rel.toLowerCase()
  const name = path.basename(rel)

  let builder: ClassifiedFile['builder'] = null
  if (/brookfield/i.test(lowerPath)) builder = 'Brookfield'
  else if (/pulte/i.test(lowerPath)) builder = 'Pulte'
  else if (/toll/i.test(lowerPath)) builder = 'Toll'
  else if (/bloomfield/i.test(lowerPath)) builder = 'Bloomfield'
  else if (/pricing\/exterior|hoelscher|masonite|therma/i.test(lowerPath)) builder = 'Supplier'

  let kind: ClassifiedFile['kind'] = 'UNKNOWN'
  if (/archived|old pricing|archive\//i.test(lowerPath)) kind = 'HISTORICAL'
  else if (/schedule\s*a/i.test(name)) kind = 'SCHEDULE_A'
  else if (/audit/i.test(lowerPath) && /price/i.test(name)) kind = 'AUDIT'
  else if (/turnkey/i.test(name) || (/pricing/i.test(lowerPath) && /bid|turnkey|pricing/i.test(name))) kind = 'TURNKEY_BID'
  else if (/hoelscher|masonite|therma|supplier|catalog|price.?list/i.test(name)) kind = 'SUPPLIER_CATALOG'
  else if (/plan.?master|plan.?list/i.test(name)) kind = 'PLAN_LIST'
  else if (/pricing/i.test(lowerPath)) kind = 'TURNKEY_BID'
  else if (/schedule/i.test(lowerPath)) kind = 'SCHEDULE_A'

  return { abs, rel, size, kind, builder }
}

// ---------------------------------------------------------------------------
// Sheet inspection (cursory — first 5 sheets only)
// ---------------------------------------------------------------------------

const PRICE_HEADER_RE = /^(price|cost|amount|total|unit|retail|net|extended|ext\.?|each)$/i

function inspectFile(cf: ClassifiedFile): FileReport {
  const report: FileReport = { file: cf, sheets: [], priceRowsApprox: 0 }
  try {
    // re-verify size just before reading (OneDrive rehydration)
    const st = fs.statSync(cf.abs)
    if (st.size > MAX_FILE_BYTES) {
      report.error = `skipped: ${(st.size / 1e6).toFixed(1)}MB > ${MAX_FILE_BYTES / 1e6}MB`
      return report
    }
    const wb = XLSX.readFile(cf.abs, { cellDates: true, bookDeps: false, bookProps: false })
    const sheets = wb.SheetNames.slice(0, 5)
    for (const name of sheets) {
      const s = wb.Sheets[name]
      const ref = s['!ref'] || ''
      const rows = XLSX.utils.sheet_to_json<any>(s, { header: 1, defval: null, blankrows: false }) as any[][]
      const head0 = rows[0] ? rows[0].slice(0, 12).map((v) => (v == null ? '' : String(v).slice(0, 40))) : []

      // count rows where a price-like column has a numeric > 0
      // heuristic: scan rows 0..min(rows.length,500). If any row has a
      // numeric $-looking cell with value 1-100000 AND SKU-ish adjacent cell,
      // count it.
      let priced = 0
      const scan = Math.min(rows.length, 500)
      for (let i = 1; i < scan; i++) {
        const r = rows[i]
        if (!r || !Array.isArray(r)) continue
        let hasMoney = false
        let hasText = false
        for (const v of r) {
          if (typeof v === 'number' && v > 0.5 && v < 100000) hasMoney = true
          if (typeof v === 'string' && v.trim().length >= 3) hasText = true
          if (hasMoney && hasText) break
        }
        if (hasMoney && hasText) priced++
      }
      report.sheets.push({ sheet: name, rows: rows.length, ref, head: head0 })
      report.priceRowsApprox += priced
    }
  } catch (e: any) {
    report.error = e?.message ?? String(e)
  }
  return report
}

// ---------------------------------------------------------------------------
// InboxItem writer
// ---------------------------------------------------------------------------

async function upsertInbox(
  id: string,
  data: {
    title: string
    description: string
    priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
    entityType: string
    entityId: string
    actionData: any
  },
) {
  if (DRY_RUN) {
    console.log(`\n[dry] InboxItem ${id} (${data.priority})`)
    console.log(`  title: ${data.title}`)
    console.log(`  desc[0..240]: ${data.description.slice(0, 240).replace(/\n/g, ' / ')}`)
    return
  }
  await prisma.inboxItem.upsert({
    where: { id },
    create: {
      id,
      type: 'AGENT_TASK',
      source: SOURCE_TAG,
      title: data.title,
      description: data.description,
      priority: data.priority,
      status: 'PENDING',
      entityType: data.entityType,
      entityId: data.entityId,
      actionData: data.actionData,
    },
    update: {
      title: data.title,
      description: data.description,
      priority: data.priority,
      status: 'PENDING',
      actionData: data.actionData,
    },
  })
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

// ---------------------------------------------------------------------------
// DB snapshot (for gap-analysis)
// ---------------------------------------------------------------------------

async function getBuilderPricingCounts() {
  const builders = await prisma.builder.findMany({
    where: {
      OR: [
        { companyName: { contains: 'Brookfield', mode: 'insensitive' } },
        { companyName: { contains: 'Toll', mode: 'insensitive' } },
        { companyName: { contains: 'Pulte', mode: 'insensitive' } },
        { companyName: { contains: 'Bloomfield', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      companyName: true,
      _count: { select: { customPricing: true } },
    },
  })
  return builders
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`[etl-dfw-pricing] ${DRY_RUN ? 'DRY RUN' : 'COMMIT'}`)
  console.log(`[etl-dfw-pricing] source tag: ${SOURCE_TAG}`)
  console.log(`[etl-dfw-pricing] cap: ${MAX_INBOX_ITEMS} inbox items, ${MAX_XLSX_PROCESSED} files\n`)

  // 1. Walk all target dirs → all XLSX/CSV candidates
  const deadline = Date.now() + SCAN_BUDGET_MS
  const all: string[] = []
  for (const d of TARGET_DIRS) {
    if (!fs.existsSync(d)) continue
    walk(d, all, deadline)
  }
  console.log(`[scan] discovered ${all.length} XLSX/CSV candidate(s) across ${TARGET_DIRS.length} target dir(s)`)

  // 2. Classify + filter out Lisa's Bids (defensive) + statSync size, skip > 10MB
  const classified: ClassifiedFile[] = []
  for (const p of all) {
    if (/Lisa's Bids/i.test(p)) continue
    const cf = classify(p)
    if (cf.size === 0) continue
    classified.push(cf)
  }

  // 3. Sort by size desc (biggest/most-valuable first), cap at MAX_XLSX_PROCESSED.
  classified.sort((a, b) => b.size - a.size)
  const sized = classified.filter((f) => f.size <= MAX_FILE_BYTES)
  const oversize = classified.filter((f) => f.size > MAX_FILE_BYTES)
  const toProcess = sized.slice(0, MAX_XLSX_PROCESSED)
  const deferred = sized.slice(MAX_XLSX_PROCESSED)

  console.log(`[scan] ${sized.length} under size cap, ${oversize.length} over, processing ${toProcess.length}`)

  // 4. Inspect each
  const reports: FileReport[] = []
  for (const cf of toProcess) {
    if (Date.now() > deadline) {
      console.log(`[scan] hit time budget — stopping at ${reports.length} files`)
      break
    }
    const r = inspectFile(cf)
    reports.push(r)
    console.log(
      `  [${cf.kind}] ${cf.builder ?? '-'} ${cf.rel} (${(cf.size / 1e6).toFixed(2)}MB) — ` +
        (r.error
          ? `ERR ${r.error}`
          : `${r.sheets.length} sheets, ~${r.priceRowsApprox} price-ish rows`),
    )
  }

  // 5. Current BuilderPricing DB snapshot
  const dbCounts = await getBuilderPricingCounts()
  const bpByName: Record<string, { id: string; rows: number }> = {}
  for (const b of dbCounts) {
    const key = (b.companyName ?? '').toUpperCase()
    if (!bpByName[key] || bpByName[key].rows < b._count.customPricing) {
      bpByName[key] = { id: b.id, rows: b._count.customPricing }
    }
  }
  const brookfieldRows = bpByName['BROOKFIELD']?.rows ?? 0
  const tollRows = dbCounts.filter((b) => /toll/i.test(b.companyName ?? '')).reduce((a, b) => Math.max(a, b._count.customPricing), 0)
  const pulteRows = dbCounts.filter((b) => /pulte/i.test(b.companyName ?? '')).reduce((a, b) => Math.max(a, b._count.customPricing), 0)
  const bloomfieldRows = dbCounts.filter((b) => /bloomfield/i.test(b.companyName ?? '')).reduce((a, b) => Math.max(a, b._count.customPricing), 0)

  console.log(`\n[db] Brookfield BP rows=${brookfieldRows} | Toll=${tollRows} | Pulte=${pulteRows} | Bloomfield=${bloomfieldRows}`)

  // 6. Build InboxItems — top-value findings first
  let remaining = MAX_INBOX_ITEMS
  const items: Array<{ id: string; data: Parameters<typeof upsertInbox>[1] }> = []

  // 6a. Summary item — always first
  const byKind: Record<string, number> = {}
  const byBuilder: Record<string, number> = {}
  for (const r of reports) {
    byKind[r.file.kind] = (byKind[r.file.kind] ?? 0) + 1
    if (r.file.builder) byBuilder[r.file.builder] = (byBuilder[r.file.builder] ?? 0) + 1
  }
  items.push({
    id: 'dfw-pricing-summary',
    data: {
      title: 'DFW Box Export — pricing archive scan summary',
      description:
        `Scanned ${all.length} XLSX/CSV files in DFW Box Export pricing folders (Lisa's Bids excluded).\n` +
        `Under 10MB cap: ${sized.length}. Processed top ${reports.length} by size.\n` +
        `By kind: ${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(', ')}.\n` +
        `By builder: ${Object.entries(byBuilder).map(([k, v]) => `${k}=${v}`).join(', ')}.\n` +
        `Live BuilderPricing rows: Brookfield=${brookfieldRows}, Toll=${tollRows}, Pulte=${pulteRows}, Bloomfield=${bloomfieldRows}.\n` +
        `${oversize.length} oversize files deferred. ${deferred.length} under-cap files deferred past scan cap.`,
      priority: 'HIGH',
      entityType: 'PricingArchive',
      entityId: SOURCE_TAG,
      actionData: {
        candidateCount: all.length,
        processedCount: reports.length,
        byKind,
        byBuilder,
        dbCounts: { brookfieldRows, tollRows, pulteRows, bloomfieldRows },
      },
    },
  })
  remaining--

  // 6b. Top Brookfield turnkey pricing — the current price book
  const brookTurnkey = reports
    .filter((r) => r.file.builder === 'Brookfield' && r.file.kind === 'TURNKEY_BID' && !/archive/i.test(r.file.rel))
    .sort((a, b) => b.file.size - a.file.size)[0]
  if (brookTurnkey && remaining > 0) {
    items.push({
      id: 'dfw-pricing-brookfield-turnkey-10-1-2025',
      data: {
        title: 'Brookfield Turnkey Pricing 10.1.2025 — cross-check vs live BuilderPricing',
        description:
          `File: ${brookTurnkey.file.rel} (${(brookTurnkey.file.size / 1e6).toFixed(2)}MB).\n` +
          `Sheets: ${brookTurnkey.sheets.map((s) => `${s.sheet}(${s.rows}r)`).join(', ')}.\n` +
          `Approx priced rows across first 5 sheets: ${brookTurnkey.priceRowsApprox}.\n` +
          `Live BuilderPricing for BROOKFIELD = ${brookfieldRows} rows. ` +
          `This Oct-2025 turnkey workbook is the freshest Brookfield price book in the archive — ` +
          `validate that any Rev 4 Plan Breakdown unit costs (Value-engineering pitch sent to Amanda Barham 4/20) ` +
          `match or supersede these numbers. Do NOT auto-import — flag-only.`,
        priority: 'CRITICAL',
        entityType: 'BuilderPricing',
        entityId: bpByName['BROOKFIELD']?.id ?? 'BROOKFIELD',
        actionData: {
          file: brookTurnkey.file.rel,
          sheets: brookTurnkey.sheets,
          liveBPRows: brookfieldRows,
          action: 'review and reconcile with Rev 4 value-engineering proposal',
        },
      },
    })
    remaining--
  }

  // 6c. Brookfield Price Audit — variance analysis
  const brookAudit = reports.find((r) => r.file.builder === 'Brookfield' && r.file.kind === 'AUDIT')
  if (brookAudit && remaining > 0) {
    items.push({
      id: 'dfw-pricing-brookfield-price-audit',
      data: {
        title: 'Brookfield Price Audit Revised — variance between original pricing and paid',
        description:
          `File: ${brookAudit.file.rel} (${(brookAudit.file.size / 1e3).toFixed(0)}KB).\n` +
          `Sheets: ${brookAudit.sheets.map((s) => `${s.sheet}(${s.rows}r)`).join(', ')}.\n` +
          `Per-address audit showing Original Pricing vs Paid vs Difference. If Diff columns show ` +
          `systematic underpayment, roll findings into the AR/collections queue. Cross-link to live ` +
          `Brookfield builder id ${bpByName['BROOKFIELD']?.id ?? 'N/A'}.`,
        priority: 'HIGH',
        entityType: 'BuilderPriceAudit',
        entityId: 'brookfield-audit',
        actionData: {
          file: brookAudit.file.rel,
          sheets: brookAudit.sheets,
          nextStep: 'sum diff column per address, compare to AR aging',
        },
      },
    })
    remaining--
  }

  // 6d. Pulte Schedule A — recent file (Nov 2025 Treeline)
  const pulteRecent = reports
    .filter((r) => r.file.builder === 'Pulte' && r.file.kind === 'SCHEDULE_A' && /2025-1[01]|2025-11/.test(r.file.rel))
    .sort((a, b) => b.file.size - a.file.size)[0]
  if (pulteRecent && remaining > 0) {
    items.push({
      id: 'dfw-pricing-pulte-schedule-a-nov-2025',
      data: {
        title: 'Pulte Schedule A Nov-2025 (Treeline) — reference only, account LOST 4/20',
        description:
          `File: ${pulteRecent.file.rel} (${(pulteRecent.file.size / 1e3).toFixed(0)}KB).\n` +
          `Sheets: ${pulteRecent.sheets.map((s) => `${s.sheet}(${s.rows}r)`).join(', ')}.\n` +
          `Pulte account was lost to 84 Lumber on 2026-04-20. Live BuilderPricing for Pulte = ${pulteRows} rows. ` +
          `Preserve this Schedule A as a HISTORICAL reference for what Pulte was paying at peak ` +
          `(useful for Brookfield / Bloomfield negotiations). Do NOT re-import into BuilderPricing.`,
        priority: 'MEDIUM',
        entityType: 'HistoricalPricing',
        entityId: 'pulte-schedule-a-202511',
        actionData: {
          file: pulteRecent.file.rel,
          sheets: pulteRecent.sheets,
          status: 'HISTORICAL_REFERENCE',
          accountLostOn: '2026-04-20',
        },
      },
    })
    remaining--
  }

  // 6e. Toll Brothers Ranch at Uptown — per-home TOCs (turnkey bid detail)
  const tollRanch = reports
    .filter((r) => r.file.builder === 'Toll' && /ladybug|ranch at uptown/i.test(r.file.rel) && /toc/i.test(r.file.rel))
    .sort((a, b) => b.file.size - a.file.size)[0]
  if (tollRanch && remaining > 0) {
    items.push({
      id: 'dfw-pricing-toll-ranch-uptown-tocs',
      data: {
        title: 'Toll Brothers Ranch at Uptown — per-home TOC workbooks (priced takeoffs)',
        description:
          `Example file: ${tollRanch.file.rel} (${(tollRanch.file.size / 1e3).toFixed(0)}KB).\n` +
          `Sheets typical: SPECS / EXT DOORS / INT DOORS / INT TRIM / TRIM LABOR.\n` +
          `Multiple model homes (Ladybug Trail 629/701/705/etc) each have a Takeoff-of-Cost sheet. ` +
          `Live BuilderPricing for Toll = ${tollRows} rows. These TOCs contain per-home labor + material ` +
          `that can backfill margin-by-plan if Toll becomes a top-3 builder post-Pulte loss. Flag-only.`,
        priority: 'MEDIUM',
        entityType: 'BuilderPricing',
        entityId: 'toll-brothers',
        actionData: {
          exampleFile: tollRanch.file.rel,
          liveBPRows: tollRows,
          relatedFiles: reports
            .filter((r) => r.file.builder === 'Toll' && /toc/i.test(r.file.rel))
            .map((r) => r.file.rel),
        },
      },
    })
    remaining--
  }

  // 6f. Hoelscher exterior door catalog — supplier-side rate card
  const hoelscher = reports.find((r) => /hoelscher/i.test(r.file.rel))
  if (hoelscher && remaining > 0) {
    items.push({
      id: 'dfw-pricing-hoelscher-2025-catalog',
      data: {
        title: 'Hoelscher 2025 Dealer Pricing + Catalog — front-door supplier rate card',
        description:
          `File: ${hoelscher.file.rel} (${(hoelscher.file.size / 1e6).toFixed(2)}MB).\n` +
          `Sheets: ${hoelscher.sheets.map((s) => `${s.sheet}(${s.rows}r)`).join(', ')}.\n` +
          `2025 Hoelscher dealer price list (~449 parsed line items + embedded catalog). ` +
          `Used for FINAL FRONTS builds. Pointer InboxItem only — treat as reference rate card ` +
          `until Nate reviews whether Hoelscher product SKUs exist in the live Product catalog.`,
        priority: 'MEDIUM',
        entityType: 'SupplierCatalog',
        entityId: 'hoelscher-2025',
        actionData: {
          file: hoelscher.file.rel,
          sheets: hoelscher.sheets,
          approxLineItems: hoelscher.priceRowsApprox,
        },
      },
    })
    remaining--
  }

  // 6g. Brookfield Mantels — separate pricing file
  const brookMantels = reports.find((r) => r.file.builder === 'Brookfield' && /mantle|mantel/i.test(r.file.rel))
  if (brookMantels && remaining > 0) {
    items.push({
      id: 'dfw-pricing-brookfield-mantels',
      data: {
        title: 'Brookfield Mantels — separate pricing workbook (not in turnkey master)',
        description:
          `File: ${brookMantels.file.rel} (${(brookMantels.file.size / 1e6).toFixed(2)}MB).\n` +
          `Standalone mantels price book. Verify whether Mantel SKUs exist in Brookfield's 302 ` +
          `live BuilderPricing rows — missing mantels are likely an upgrade-revenue gap.`,
        priority: 'HIGH',
        entityType: 'BuilderPricing',
        entityId: bpByName['BROOKFIELD']?.id ?? 'BROOKFIELD',
        actionData: {
          file: brookMantels.file.rel,
          gap: 'mantel SKUs possibly missing from live BuilderPricing',
        },
      },
    })
    remaining--
  }

  // 6h. Bloomfield gap — zero live BP rows but memory file notes active account
  if (remaining > 0 && bloomfieldRows === 0) {
    const bloomId = dbCounts.find((b) => /bloomfield/i.test(b.companyName ?? ''))?.id ?? 'bloomfield'
    items.push({
      id: 'dfw-pricing-bloomfield-gap',
      data: {
        title: 'Bloomfield Homes — zero BuilderPricing rows despite active account',
        description:
          `DB snapshot: Bloomfield has 0 rows in BuilderPricing. Per CLAUDE.md Bloomfield is an ` +
          `active account with folder populated 4/20. No pricing workbooks were found under ` +
          `DFW Box Export for Bloomfield (check is limited — may live elsewhere in OneDrive). ` +
          `Priority: confirm Bloomfield pricing exists somewhere, then build BuilderPricing import.`,
        priority: 'CRITICAL',
        entityType: 'BuilderPricing',
        entityId: bloomId,
        actionData: {
          liveBPRows: 0,
          action: 'locate Bloomfield pricing source and stage import',
        },
      },
    })
    remaining--
  }

  // 6i. Oversize / deferred files summary
  if (remaining > 0 && (oversize.length > 0 || deferred.length > 0)) {
    const previewOver = oversize.slice(0, 5).map((f) => `  - ${f.rel} (${(f.size / 1e6).toFixed(1)}MB)`).join('\n')
    const previewDef = deferred.slice(0, 10).map((f) => `  - ${f.rel} (${(f.size / 1e3).toFixed(0)}KB)`).join('\n')
    items.push({
      id: 'dfw-pricing-deferred-files',
      data: {
        title: `DFW pricing files deferred (${oversize.length} oversize + ${deferred.length} beyond cap)`,
        description:
          `Oversize (>10MB, OneDrive rehydration risk), skipped:\n${previewOver || '  (none)'}\n\n` +
          `Within size cap but past 20-file processing budget:\n${previewDef || '  (none)'}`,
        priority: 'LOW',
        entityType: 'PricingArchive',
        entityId: SOURCE_TAG,
        actionData: {
          oversize: oversize.map((f) => ({ rel: f.rel, size: f.size })),
          deferred: deferred.map((f) => ({ rel: f.rel, size: f.size, kind: f.kind, builder: f.builder })),
        },
      },
    })
    remaining--
  }

  // 7. Write
  for (const it of items.slice(0, MAX_INBOX_ITEMS)) {
    await upsertInbox(it.id, it.data)
  }

  // 8. Summary
  console.log(`\n[summary]`)
  console.log(`  Folders scanned:    ${TARGET_DIRS.length}`)
  console.log(`  XLSX/CSV discovered:${all.length}`)
  console.log(`  Processed:          ${reports.length}`)
  console.log(`  InboxItems written: ${Math.min(items.length, MAX_INBOX_ITEMS)}`)
  console.log(`  Mode:               ${DRY_RUN ? 'DRY RUN (no writes)' : 'COMMITTED'}`)
  if (DRY_RUN) console.log(`\n  Re-run with --commit to persist.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
