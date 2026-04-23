/**
 * scripts/etl-po-release-today.ts
 *
 * Loads `Abel_Lumber_PO_Release_Today.xlsx` → `InboxItem` rows tagged
 * with source `PO_RELEASE_TODAY_2026-04-22`.
 *
 * The file has no PO-number column (vendor bundles only). So we emit
 * ONE InboxItem per vendor bundle ("release this vendor's POs now").
 * Line detail is attached inside `actionData.lines` for full drill-down.
 *
 * type = "PO_APPROVAL", one item per vendor.
 *
 * Priority derived from Status column + dollar magnitude:
 *   - RELEASE NOW and total >= $50k          → CRITICAL
 *   - RELEASE NOW and total >= $10k          → HIGH
 *   - RELEASE NOW                            → MEDIUM
 *   - OVERDUE (already released but late)    → MEDIUM (awareness only)
 *   - otherwise                              → LOW
 *
 * Entity linkage: we attempt to find matching DRAFT POs in Aegis by vendor
 * name (fuzzy: case-insensitive, trimmed, remove trailing punctuation).
 * If exactly one DRAFT PO matches that vendor, we link via
 * entityType="PurchaseOrder" + entityId. Otherwise entityType="Vendor"
 * bundle marker and a note in description. We never mutate the PO row.
 *
 * financialImpact: vendor "Total Cost" from the Release-by-Vendor sheet.
 *
 * Idempotency: `actionData.key` = "PO_RELEASE_TODAY_2026-04-22:<vendor-slug>".
 * On each run we deleteMany({ source: SOURCE_TAG }) then re-create.
 *
 * Modes:
 *   (default)  DRY-RUN
 *   --commit   actually write
 *
 * Constraints:
 *   - Writes ONLY to InboxItem with source = PO_RELEASE_TODAY_2026-04-22
 *   - Never modifies PurchaseOrder, Vendor, or any other table.
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const SOURCE_TAG = 'PO_RELEASE_TODAY_2026-04-22'
const DRY_RUN = !process.argv.includes('--commit')
const FILE = path.resolve(__dirname, '..', '..', 'Abel_Lumber_PO_Release_Today.xlsx')

const prisma = new PrismaClient()

type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

interface VendorBundle {
  vendor: string
  lines: number
  totalCost: number
  overdueAmt: number
  maxDaysLate: number
  status: string
  lineDetail: LineRow[]
}

interface LineRow {
  sku: string
  product: string
  qty: number
  unitPrice: number
  lineTotal: number
  needBy: string
  daysLate: number
  status: string
}

interface InboxPayload {
  type: string
  source: string
  title: string
  description: string
  priority: Priority
  entityType: string | null
  entityId: string | null
  financialImpact: number | null
  actionData: Record<string, unknown>
}

function readSheetAsArrays(file: string, sheetName: string): unknown[][] {
  const wb = XLSX.readFile(file)
  const ws = wb.Sheets[sheetName]
  if (!ws) throw new Error(`Sheet not found: ${sheetName}`)
  return XLSX.utils.sheet_to_json(ws, { defval: null, header: 1 }) as unknown[][]
}

function readSheetAsObjects(file: string, sheetName: string): Record<string, unknown>[] {
  const wb = XLSX.readFile(file)
  const ws = wb.Sheets[sheetName]
  if (!ws) throw new Error(`Sheet not found: ${sheetName}`)
  return XLSX.utils.sheet_to_json(ws, { defval: null }) as Record<string, unknown>[]
}

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function toStr(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim()
}

function excelSerialToDate(serial: number): string {
  // Excel epoch: 1899-12-30. Works for post-1900 dates.
  if (!Number.isFinite(serial) || serial <= 0) return ''
  const ms = (serial - 25569) * 86400 * 1000
  const d = new Date(ms)
  if (isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function normalizeVendor(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function buildBundles(): VendorBundle[] {
  // Sheet 1: Release by Vendor
  // Layout: row 0 title, 1 subtitle, 2 blank, 3 header, 4..N vendor rows,
  // then blank + TOTAL + blank + warning note.
  const rows = readSheetAsArrays(FILE, 'Release by Vendor')
  const bundles: VendorBundle[] = []
  let headerIdx = -1
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (toStr(rows[i]?.[0]) === 'Vendor') {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) throw new Error('Release by Vendor: header row not found')

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r) continue
    const vendor = toStr(r[0])
    if (!vendor || vendor === 'TOTAL') continue
    if (r.every((c) => c === null || c === '')) continue
    bundles.push({
      vendor,
      lines: toNum(r[1]),
      totalCost: toNum(r[2]),
      overdueAmt: toNum(r[3]),
      maxDaysLate: toNum(r[4]),
      status: toStr(r[5]),
      lineDetail: [],
    })
  }

  // Sheet 2: Line Detail — columns are named nicely (first row is already headers)
  const lineObjs = readSheetAsObjects(FILE, 'Line Detail')
  const byVendor = new Map<string, LineRow[]>()
  for (const o of lineObjs) {
    const v = toStr(o['Vendor'])
    if (!v) continue
    const line: LineRow = {
      sku: toStr(o['SKU']),
      product: toStr(o['Product']),
      qty: toNum(o['Qty']),
      unitPrice: toNum(o['Unit Price']),
      lineTotal: toNum(o['Line Total']),
      needBy: (() => {
        const raw = o['Need By']
        if (typeof raw === 'number') return excelSerialToDate(raw)
        return toStr(raw)
      })(),
      daysLate: toNum(o['Days Late']),
      status: toStr(o['Status']),
    }
    const key = normalizeVendor(v)
    if (!byVendor.has(key)) byVendor.set(key, [])
    byVendor.get(key)!.push(line)
  }
  for (const b of bundles) {
    b.lineDetail = byVendor.get(normalizeVendor(b.vendor)) || []
  }
  return bundles
}

function pickPriority(b: VendorBundle): Priority {
  const statusUpper = b.status.toUpperCase()
  if (statusUpper.includes('RELEASE NOW')) {
    if (b.totalCost >= 50000) return 'CRITICAL'
    if (b.totalCost >= 10000) return 'HIGH'
    return 'MEDIUM'
  }
  if (statusUpper.includes('OVERDUE')) return 'MEDIUM'
  return 'LOW'
}

async function resolveEntity(vendorName: string): Promise<{
  entityType: string | null
  entityId: string | null
  linkedPoNumbers: string[]
  linkNote: string
}> {
  // Find vendor(s) by fuzzy match, then find DRAFT POs. If exactly one DRAFT PO
  // matches, link to it. Otherwise bundle-level.
  const norm = normalizeVendor(vendorName)
  // Pull vendor candidates (small table, simple contains)
  const vendors = await prisma.vendor.findMany({
    where: {
      OR: [
        { name: { equals: vendorName, mode: 'insensitive' } },
        { name: { contains: vendorName, mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true },
    take: 20,
  })
  const matchingVendors = vendors.filter(
    (v) => normalizeVendor(v.name) === norm || normalizeVendor(v.name).includes(norm) || norm.includes(normalizeVendor(v.name))
  )
  if (matchingVendors.length === 0) {
    return { entityType: null, entityId: null, linkedPoNumbers: [], linkNote: 'PO not in Aegis (no vendor match)' }
  }
  const vendorIds = matchingVendors.map((v) => v.id)
  const draftPOs = await prisma.purchaseOrder.findMany({
    where: { vendorId: { in: vendorIds }, status: 'DRAFT' },
    select: { id: true, poNumber: true, total: true, vendorId: true },
    take: 50,
  })
  if (draftPOs.length === 1) {
    return {
      entityType: 'PurchaseOrder',
      entityId: draftPOs[0].id,
      linkedPoNumbers: [draftPOs[0].poNumber],
      linkNote: `Linked PO ${draftPOs[0].poNumber}`,
    }
  }
  if (draftPOs.length > 1) {
    return {
      entityType: 'Vendor',
      entityId: matchingVendors[0].id,
      linkedPoNumbers: draftPOs.map((p) => p.poNumber),
      linkNote: `${draftPOs.length} DRAFT POs for this vendor — pick in Aegis`,
    }
  }
  return {
    entityType: 'Vendor',
    entityId: matchingVendors[0].id,
    linkedPoNumbers: [],
    linkNote: 'PO not in Aegis (vendor matched, no DRAFT POs)',
  }
}

async function buildItems(bundles: VendorBundle[]): Promise<{
  items: InboxPayload[]
  unresolved: string[]
}> {
  const items: InboxPayload[] = []
  const unresolved: string[] = []
  for (const b of bundles) {
    const priority = pickPriority(b)
    const link = await resolveEntity(b.vendor)
    if (link.linkedPoNumbers.length === 0) unresolved.push(b.vendor)

    const key = `${SOURCE_TAG}:${slug(b.vendor)}`
    const dollars = `$${b.totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    const overdue = `$${b.overdueAmt.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    const title = `[PO Release] ${b.vendor} · ${b.lines} line${b.lines === 1 ? '' : 's'} · ${dollars}`
    const descriptionParts = [
      `Vendor: ${b.vendor}`,
      `Total: ${dollars} · Overdue: ${overdue} · Max days late: ${b.maxDaysLate}`,
      `Status: ${b.status}`,
      link.linkNote,
    ]
    if (link.linkedPoNumbers.length > 1) {
      descriptionParts.push(`DRAFT POs: ${link.linkedPoNumbers.join(', ')}`)
    }
    if (/novo/i.test(b.vendor)) {
      descriptionParts.push(
        '⚠ Novo Building Products account is ON HOLD — only release if hold resolved. Metrie swap list with Thomas.'
      )
    }
    const description = descriptionParts.join('\n')

    items.push({
      type: 'PO_APPROVAL',
      source: SOURCE_TAG,
      title,
      description,
      priority,
      entityType: link.entityType,
      entityId: link.entityId,
      financialImpact: b.totalCost || null,
      actionData: {
        key,
        stream: 'PO_RELEASE',
        vendor: b.vendor,
        lines: b.lines,
        totalCost: b.totalCost,
        overdueAmt: b.overdueAmt,
        maxDaysLate: b.maxDaysLate,
        status: b.status,
        linkedPoNumbers: link.linkedPoNumbers,
        lineDetail: b.lineDetail,
      },
    })
  }
  return { items, unresolved }
}

function summarize(items: InboxPayload[], label: string) {
  const priCounts: Record<Priority, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
  let totalImpact = 0
  for (const it of items) {
    priCounts[it.priority]++
    totalImpact += it.financialImpact || 0
  }
  console.log(
    `  ${label}: ${items.length} items · CRIT=${priCounts.CRITICAL} HIGH=${priCounts.HIGH} MED=${priCounts.MEDIUM} LOW=${priCounts.LOW} · $${totalImpact.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  )
}

async function main() {
  console.log(`\n== etl-po-release-today  ${DRY_RUN ? '[DRY-RUN]' : '[COMMIT]'}`)
  console.log(`   source: ${FILE}`)
  console.log(`   tag:    ${SOURCE_TAG}\n`)

  const bundles = buildBundles()
  console.log(`Parsed ${bundles.length} vendor bundle(s).`)
  const { items, unresolved } = await buildItems(bundles)
  summarize(items, 'PO release bundles')

  if (unresolved.length) {
    console.log(`\nVendors with no linkable DRAFT PO in Aegis (${unresolved.length}):`)
    for (const v of unresolved) console.log(`   - ${v}`)
  }

  if (DRY_RUN) {
    console.log('\nSample items (first 5):')
    for (const it of items.slice(0, 5)) {
      console.log(`  [${it.priority}] ${it.title} → entity=${it.entityType}/${it.entityId ?? '—'}`)
    }
    console.log('\nDRY-RUN — no database writes. Re-run with --commit.\n')
    await prisma.$disconnect()
    return
  }

  const existing = await prisma.inboxItem.count({ where: { source: SOURCE_TAG } })
  console.log(`\nDeleting ${existing} existing InboxItem(s) with source=${SOURCE_TAG}...`)
  await prisma.inboxItem.deleteMany({ where: { source: SOURCE_TAG } })

  console.log(`Creating ${items.length} InboxItem(s)...`)
  let created = 0
  for (const it of items) {
    await prisma.inboxItem.create({
      data: {
        type: it.type,
        source: it.source,
        title: it.title,
        description: it.description,
        priority: it.priority,
        status: 'PENDING',
        entityType: it.entityType,
        entityId: it.entityId,
        financialImpact: it.financialImpact,
        actionData: it.actionData as never,
      },
    })
    created++
  }
  console.log(`Done. Created ${created} InboxItem(s).`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
