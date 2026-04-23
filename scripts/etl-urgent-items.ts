/**
 * scripts/etl-urgent-items.ts
 *
 * Omnibus loader for today-actionable data. All targets are InboxItem with
 * distinct source tags; no other tables touched. Source tags:
 *
 *   BOISE_NEGOTIATION_APR2026      — 4/28 meeting prep items (SKU overpayment, margin issues)
 *   BOISE_INVOICES_DUE_APR20       — invoices currently due
 *   PO_RELEASE_TODAY_2026-04-22    — POs Nate wants to release today
 *   MATERIAL_TRIAGE_APR2026        — order-now SKUs + priority open SOs
 *
 * Idempotent on re-run (deterministic IDs from source tag + row fingerprint).
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const ROOT = path.resolve(__dirname, '..', '..')

function hashId(source: string, key: string): string {
  return 'ib_' + source.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) + '_' +
    crypto.createHash('sha256').update(`${source}::${key}`).digest('hex').slice(0, 16)
}

function normStr(v: unknown): string {
  return (v ?? '').toString().trim()
}
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,$%]/g, ''))
  return Number.isFinite(n) ? n : null
}

interface InboxData {
  id: string
  type: string
  source: string
  title: string
  description?: string
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  financialImpact?: number
  entityType?: string
  entityId?: string
  dueBy?: Date
}

// ---------------------------------------------------------------------------
// Boise SKU Pricing Analysis v2 (4/28 meeting prep)
// ---------------------------------------------------------------------------
function loadBoiseSkuAnalysis(): InboxData[] {
  const file = path.join(ROOT, 'Boise Cascade Negotiation Package', '02_SKU_Pricing_Analysis_v2.xlsx')
  const wb = XLSX.readFile(file)
  const out: InboxData[] = []
  const DUE = new Date('2026-04-28T12:00:00Z')
  const SRC = 'BOISE_NEGOTIATION_APR2026'

  // Pricing Proposal sheet — savings opportunities per SKU
  const prop = XLSX.utils.sheet_to_json<any>(wb.Sheets['Pricing Proposal'], { defval: null })
  for (const r of prop) {
    const sku = normStr(r.SKU)
    if (!sku || sku === 'SKU') continue
    const name = normStr(r['Product Name'])
    const spend = toNum(r['Total Spend']) ?? 0
    const current = toNum(r['Current Avg Price']) ?? 0
    const target = toNum(r['Target Price']) ?? 0
    const savings = toNum(r['Estimated Annual Savings']) ?? 0
    if (savings < 100) continue
    const priority = savings >= 10000 ? 'CRITICAL' : savings >= 2000 ? 'HIGH' : 'MEDIUM'
    out.push({
      id: hashId(SRC, `proposal:${sku}`),
      type: 'PO_APPROVAL',
      source: 'boise-negotiation',
      title: `[BOISE 4/28] Push ${sku} from $${current.toFixed(2)} → $${target.toFixed(2)} — save $${savings.toFixed(0)}/yr`,
      description: `${name}. Total Boise spend on this SKU: $${spend.toFixed(0)}. Target price $${target.toFixed(2)} vs. current avg $${current.toFixed(2)} = ${((current - target) / current * 100).toFixed(1)}% reduction. Estimated annual savings: $${savings.toFixed(0)}.`,
      priority,
      financialImpact: savings,
      dueBy: DUE,
    })
  }

  // Margin Issues sheet — negative or thin margins (parse past section headers)
  const marg = XLSX.utils.sheet_to_json<any>(wb.Sheets['Margin Issues'], { header: 1, defval: null }) as any[][]
  let inSection = ''
  for (const row of marg) {
    const c0 = normStr(row[0])
    if (!c0) continue
    if (c0.toLowerCase().startsWith('section')) { inSection = c0.slice(0, 40); continue }
    if (c0 === 'SKU' || c0 === '') continue
    if (!/^BC\d+/i.test(c0)) continue
    const sku = c0
    const name = normStr(row[1])
    const buy = toNum(row[2]) ?? 0
    const sell = toNum(row[3]) ?? 0
    const margin = toNum(row[4])
    if (margin === null) continue
    const pct = margin < 1 ? margin * 100 : margin
    const priority = pct < 0 ? 'CRITICAL' : pct < 10 ? 'HIGH' : 'MEDIUM'
    out.push({
      id: hashId(SRC, `margin:${sku}`),
      type: 'PO_APPROVAL',
      source: 'boise-negotiation',
      title: `[BOISE 4/28] ${sku} margin ${pct.toFixed(1)}% — buy $${buy.toFixed(2)} / sell $${sell.toFixed(2)}`,
      description: `${name}. ${inSection}. Costs us $${buy.toFixed(2)} from Boise, we sell at $${sell.toFixed(2)}. Either renegotiate Boise price or raise sell price to recover margin.`,
      priority,
      financialImpact: Math.max(0, (buy - sell) * 100),
      dueBy: DUE,
    })
  }

  // One meeting-wide summary item
  const summary = XLSX.utils.sheet_to_json<any>(wb.Sheets['Summary Dashboard'], { header: 1, defval: null }) as any[][]
  const totalSpend = summary.find((r) => normStr(r[0]) === 'Total Spend')?.[1]
  out.push({
    id: hashId(SRC, 'meeting-summary'),
    type: 'PO_APPROVAL',
    source: 'boise-negotiation',
    title: '[BOISE 4/28] Meeting prep: bring SKU pricing analysis + rebuttal doc',
    description: `Total Boise spend: ${totalSpend ?? '$1.88M'}. ${out.length} SKU-level asks queued. Supplier Claims Rebuttal doc is in the negotiation package — review before meeting. Bring Dawn's pricing report.`,
    priority: 'CRITICAL',
    dueBy: DUE,
  })

  return out
}

// ---------------------------------------------------------------------------
// Boise Invoices Due 04-20-2026
// ---------------------------------------------------------------------------
function loadBoiseInvoicesDue(): InboxData[] {
  const file = path.join(ROOT, 'Boise Cascade Negotiation Package', 'Boise_Cascade_Invoices_Due_04-20-2026.xlsx')
  const wb = XLSX.readFile(file)
  const SRC = 'BOISE_INVOICES_DUE_APR20'
  const ws = wb.Sheets['Due by 04-20-26']
  const rows = XLSX.utils.sheet_to_json<any>(ws, { header: 1, defval: null }) as any[][]

  // Find header row
  let hdrIdx = rows.findIndex((r) => r.some((c: any) => normStr(c).toLowerCase().includes('invoice')))
  if (hdrIdx < 0) return []
  const hdrs = (rows[hdrIdx] as any[]).map((h) => normStr(h))
  const invNoIdx = hdrs.findIndex((h) => h.toLowerCase().includes('invoice') && h.toLowerCase().includes('number'))
  const dateIdx = hdrs.findIndex((h) => h.toLowerCase().includes('date'))
  const amtIdx = hdrs.findIndex((h) => h.toLowerCase().match(/amount|total|due/))
  const poIdx = hdrs.findIndex((h) => h.toLowerCase().includes('po'))

  const out: InboxData[] = []
  let total = 0
  let count = 0
  for (const row of rows.slice(hdrIdx + 1)) {
    const invNo = invNoIdx >= 0 ? normStr(row[invNoIdx]) : ''
    const amt = amtIdx >= 0 ? toNum(row[amtIdx]) : null
    if (!invNo || !amt || amt <= 0) continue
    total += amt
    count++
  }
  if (count === 0) return []
  out.push({
    id: hashId(SRC, 'summary'),
    type: 'COLLECTION_ACTION',
    source: 'boise-ap',
    title: `[BOISE AP] ${count} invoices totaling $${total.toFixed(0)} due`,
    description: `Boise Cascade account ABELUGA 000 — ${count} invoices due by 2026-04-20. Total: $${total.toFixed(2)}. See Boise_Cascade_Invoices_Due_04-20-2026.xlsx for invoice-level detail.`,
    priority: total > 10000 ? 'CRITICAL' : 'HIGH',
    financialImpact: total,
    dueBy: new Date('2026-04-28T12:00:00Z'),
  })
  return out
}

// ---------------------------------------------------------------------------
// PO Release Today
// ---------------------------------------------------------------------------
function loadPoReleaseToday(): InboxData[] {
  const file = path.join(ROOT, 'Abel_Lumber_PO_Release_Today.xlsx')
  const wb = XLSX.readFile(file)
  const SRC = 'PO_RELEASE_TODAY_2026-04-22'
  const out: InboxData[] = []

  // "Release by Vendor" — each vendor's to-release summary
  const ws = wb.Sheets['Release by Vendor']
  const rows = XLSX.utils.sheet_to_json<any>(ws, { header: 1, defval: null }) as any[][]
  // Find header row (first row with "Vendor" in col 0)
  const hdrIdx = rows.findIndex((r) => normStr(r[0]).toLowerCase().includes('vendor'))
  if (hdrIdx < 0) return out
  for (const row of rows.slice(hdrIdx + 1)) {
    const vendor = normStr(row[0])
    if (!vendor || vendor.toLowerCase().includes('total')) continue
    const poCount = toNum(row[1])
    const totalDollars = toNum(row[2]) ?? toNum(row[3]) ?? 0
    if (poCount === null) continue
    out.push({
      id: hashId(SRC, `vendor:${vendor}`),
      type: 'PO_APPROVAL',
      source: 'po-release',
      title: `[RELEASE TODAY] ${vendor} — ${poCount} POs, $${totalDollars.toFixed(0)}`,
      description: `${poCount} POs ready for release to ${vendor}. Total $${totalDollars.toFixed(2)}. Review and issue today.`,
      priority: totalDollars > 10000 ? 'CRITICAL' : totalDollars > 2000 ? 'HIGH' : 'MEDIUM',
      financialImpact: totalDollars,
      dueBy: new Date('2026-04-23T23:00:00Z'), // end of today
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Material Triage — Order Now + Open SOs Priority
// ---------------------------------------------------------------------------
function loadMaterialTriage(): InboxData[] {
  const file = path.join(ROOT, 'Abel_Lumber_Material_Triage.xlsx')
  const wb = XLSX.readFile(file)
  const SRC = 'MATERIAL_TRIAGE_APR2026'
  const out: InboxData[] = []

  // Order Now — SKUs to order
  const ordWs = wb.Sheets['4. Order Now']
  const ordRows = XLSX.utils.sheet_to_json<any>(ordWs, { header: 1, defval: null }) as any[][]
  const ordHdr = ordRows.findIndex((r) => normStr(r[0]).toLowerCase() === 'sku' || normStr(r[0]).toLowerCase().includes('product'))
  let orderNowCount = 0
  let orderNowTotal = 0
  for (const row of ordRows.slice(Math.max(ordHdr, 0) + 1)) {
    const sku = normStr(row[0])
    if (!sku || !/^BC\d+/i.test(sku)) continue
    const qty = toNum(row[2]) ?? toNum(row[3]) ?? 0
    const cost = toNum(row[5]) ?? toNum(row[6]) ?? 0
    if (qty > 0 && cost > 0) { orderNowCount++; orderNowTotal += qty * cost }
  }
  if (orderNowCount > 0) {
    out.push({
      id: hashId(SRC, 'order-now-summary'),
      type: 'MRP_RECOMMENDATION',
      source: 'material-triage',
      title: `[TRIAGE] ${orderNowCount} SKUs to order now — $${orderNowTotal.toFixed(0)} estimated buy`,
      description: `Material Triage report (as of 2026-04-15) flags ${orderNowCount} SKUs needing immediate reorder. Estimated buy value: $${orderNowTotal.toFixed(2)}. See 'Order Now' sheet of Abel_Lumber_Material_Triage.xlsx for per-SKU detail.`,
      priority: 'HIGH',
      financialImpact: orderNowTotal,
    })
  }

  // Open SOs Priority — sales orders by priority
  const soWs = wb.Sheets['5. Open SOs Priority']
  const soRows = XLSX.utils.sheet_to_json<any>(soWs, { header: 1, defval: null }) as any[][]
  const soHdr = soRows.findIndex((r) => normStr(r[0]).toLowerCase().match(/sales order|so #|priority/))
  let p1 = 0, p2 = 0, p3 = 0
  for (const row of soRows.slice(Math.max(soHdr, 0) + 1)) {
    const v = normStr(row[0]).toLowerCase()
    if (!v) continue
    const priVal = (row.find((c: any) => /^P[123]$|priority/i.test(normStr(c))) ?? '').toString()
    if (priVal.includes('1') || v.includes('p1')) p1++
    else if (priVal.includes('2') || v.includes('p2')) p2++
    else if (priVal.includes('3') || v.includes('p3')) p3++
  }
  const totalSos = p1 + p2 + p3
  if (totalSos > 0) {
    out.push({
      id: hashId(SRC, 'open-sos-summary'),
      type: 'SCHEDULE_CHANGE',
      source: 'material-triage',
      title: `[TRIAGE] ${totalSos} open SOs awaiting material — P1:${p1} P2:${p2} P3:${p3}`,
      description: `${totalSos} open Sales Orders tracked in Material Triage. Priority 1 (30+ days): ${p1}. P2: ${p2}. P3: ${p3}. Focus P1s first.`,
      priority: p1 > 10 ? 'CRITICAL' : p1 > 0 ? 'HIGH' : 'MEDIUM',
    })
  }

  return out
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`ETL urgent items — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  const batches = [
    { name: 'Boise SKU Pricing', items: loadBoiseSkuAnalysis() },
    { name: 'Boise Invoices Due', items: loadBoiseInvoicesDue() },
    { name: 'PO Release Today', items: loadPoReleaseToday() },
    { name: 'Material Triage', items: loadMaterialTriage() },
  ]

  let total = 0
  for (const b of batches) {
    console.log(`  ${b.name}: ${b.items.length} items`)
    total += b.items.length
  }
  console.log(`Total: ${total} InboxItems to load`)
  console.log()

  const allItems = batches.flatMap((b) => b.items)
  const byPriority = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
  let totalImpact = 0
  for (const it of allItems) {
    byPriority[it.priority]++
    if (it.financialImpact) totalImpact += it.financialImpact
  }
  console.log('Priority mix:', byPriority)
  console.log(`Total $ impact across items: $${totalImpact.toFixed(0)}`)
  console.log()
  console.log('Sample (first 6):')
  allItems.slice(0, 6).forEach((it) => {
    console.log(`  [${it.priority.padEnd(8)}] ${it.title.slice(0, 90)}`)
  })
  console.log()

  if (DRY_RUN) { console.log('DRY-RUN — re-run with --commit.'); return }

  const prisma = new PrismaClient()
  let created = 0, updated = 0, failed = 0
  try {
    for (const it of allItems) {
      try {
        await prisma.inboxItem.upsert({
          where: { id: it.id },
          create: {
            id: it.id,
            type: it.type,
            source: it.source,
            title: it.title.slice(0, 240),
            description: it.description?.slice(0, 2000),
            priority: it.priority,
            status: 'PENDING',
            entityType: it.entityType,
            entityId: it.entityId,
            financialImpact: it.financialImpact,
            dueBy: it.dueBy,
          },
          update: {
            title: it.title.slice(0, 240),
            description: it.description?.slice(0, 2000),
            priority: it.priority,
            financialImpact: it.financialImpact,
            dueBy: it.dueBy,
          },
        })
        const existing = await prisma.inboxItem.findUnique({ where: { id: it.id }, select: { createdAt: true, updatedAt: true } })
        if (existing && existing.createdAt.getTime() === existing.updatedAt.getTime()) created++; else updated++
      } catch (e) {
        failed++
        console.error(`  FAIL ${it.id}:`, (e as Error).message.slice(0, 140))
      }
    }
    console.log(`Committed: created≈${created}, updated≈${updated}, failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
