/**
 * scripts/etl-urgent-v2.ts
 *
 * Follow-up omnibus covering items deferred from v1:
 *   - BOISE_INVOICES_DUE_APR20   — fixed parser (v1 hit 0 rows)
 *   - BOISE_STATEMENT_AUDIT      — statement vs InFlow receipt variances
 *   - MATERIAL_TRIAGE_PO_AGING   — 235 aged POs
 *   - MATERIAL_TRIAGE_WB_DETAIL  — 526-line whiteboard summary
 *   - NFC_HARDWARE_LIST          — NFC door-tagging hardware shopping list
 *
 * All writes are InboxItem rows with distinct source tags.
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const ROOT = path.resolve(__dirname, '..', '..')

function hashId(tag: string, k: string): string {
  return 'ib_u2_' + crypto.createHash('sha256').update(`${tag}::${k}`).digest('hex').slice(0, 18)
}
function normStr(v: unknown): string { return (v ?? '').toString().trim() }
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,$%()]/g, ''))
  return Number.isFinite(n) ? n : null
}

interface Item {
  id: string; type: string; source: string; title: string; description?: string
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  financialImpact?: number | null
  dueBy?: Date
}

// ---------- 1. Boise Invoices Due (fixed parser) ----------
function loadBoiseInvoicesDue(): Item[] {
  const file = path.join(ROOT, 'Boise Cascade Negotiation Package', 'Boise_Cascade_Invoices_Due_04-20-2026.xlsx')
  const wb = XLSX.readFile(file)
  const ws = wb.Sheets['Due by 04-20-26']
  const rows = XLSX.utils.sheet_to_json<any>(ws, { header: 1, defval: null }) as any[][]
  const SRC = 'BOISE_INVOICES_DUE_APR20'

  // Find a header row by looking for cells that exactly equal common header tokens
  let hdrIdx = -1
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = rows[i].map((c) => normStr(c).toLowerCase())
    if (cells.includes('invoice #') || cells.includes('invoice number') || cells.includes('invoice date') || cells.includes('amount due')) {
      hdrIdx = i; break
    }
  }
  if (hdrIdx < 0) return []
  const hdrs = rows[hdrIdx].map((h) => normStr(h).toLowerCase())
  const col = (match: RegExp) => hdrs.findIndex((h) => match.test(h))
  const cInv = col(/invoice\s*(#|number|no)/)
  const cDate = col(/invoice\s*date|date$/)
  const cAmt = col(/amount\s*due|total|balance|amount$/)
  const cPo = col(/po/)

  const out: Item[] = []
  let count = 0, total = 0
  const invoices: Array<{ inv: string; amt: number; date: string; po: string }> = []
  for (const row of rows.slice(hdrIdx + 1)) {
    const inv = cInv >= 0 ? normStr(row[cInv]) : ''
    const amt = cAmt >= 0 ? toNum(row[cAmt]) : null
    if (!inv || !amt || amt <= 0) continue
    invoices.push({
      inv, amt,
      date: cDate >= 0 ? normStr(row[cDate]) : '',
      po: cPo >= 0 ? normStr(row[cPo]) : '',
    })
    count++; total += amt
  }
  if (count === 0) return []

  // One summary + top-5 by amount as individual items
  out.push({
    id: hashId(SRC, 'summary'),
    type: 'COLLECTION_ACTION',
    source: 'boise-ap',
    title: `[BOISE AP] ${count} invoices totaling $${total.toFixed(0)} currently due`,
    description: `Account ABELUGA 000. ${count} Boise Cascade invoices totaling $${total.toFixed(2)}. Statement dated 04-20-2026. Top 5 largest listed separately.`,
    priority: total > 20000 ? 'CRITICAL' : 'HIGH',
    financialImpact: total,
    dueBy: new Date('2026-04-28T12:00:00Z'),
  })
  const top5 = [...invoices].sort((a, b) => b.amt - a.amt).slice(0, 5)
  for (const inv of top5) {
    out.push({
      id: hashId(SRC, `inv:${inv.inv}`),
      type: 'COLLECTION_ACTION',
      source: 'boise-ap',
      title: `[BOISE AP] Invoice ${inv.inv} — $${inv.amt.toFixed(2)}${inv.po ? ` (PO ${inv.po})` : ''}`,
      description: `Boise invoice ${inv.inv} dated ${inv.date}, amount $${inv.amt.toFixed(2)}${inv.po ? `, customer PO ${inv.po}` : ''}. Review for payment or dispute.`,
      priority: inv.amt > 5000 ? 'HIGH' : 'MEDIUM',
      financialImpact: inv.amt,
      dueBy: new Date('2026-04-28T12:00:00Z'),
    })
  }
  return out
}

// ---------- 2. Boise Statement vs InFlow Receipt Audit ----------
function loadBoiseReceiptAudit(): Item[] {
  const file = path.join(ROOT, 'Boise Cascade Negotiation Package', 'Boise_Statement_vs_InFlow_Receipt_Audit_v2.xlsx')
  const wb = XLSX.readFile(file)
  const ws = wb.Sheets['Statement vs Received']
  const rows = XLSX.utils.sheet_to_json<any>(ws, { header: 1, defval: null }) as any[][]
  const SRC = 'BOISE_STATEMENT_AUDIT'

  // Find header row — look for "Statement", "Received", "Variance" column headers
  let hdrIdx = -1
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = rows[i].map((c) => normStr(c).toLowerCase())
    if (cells.some((c) => /statement|received|variance/.test(c))) {
      hdrIdx = i; break
    }
  }
  if (hdrIdx < 0) return []

  // Count rows with any variance flagged
  let varianceCount = 0
  let matchCount = 0
  for (const row of rows.slice(hdrIdx + 1)) {
    const rowStr = row.map(normStr).join(' ').toLowerCase()
    if (!rowStr) continue
    // Heuristic: rows that mention "variance", "missing", "extra", or have two amount columns differing
    if (/variance|missing|extra|discrepanc/i.test(rowStr)) varianceCount++
    else matchCount++
  }
  const totalRows = rows.length - hdrIdx - 1
  return [{
    id: hashId(SRC, 'summary'),
    type: 'ACTION_REQUIRED',
    source: 'boise-recon',
    title: `[BOISE RECON] Statement 4/14 vs InFlow — reconcile ${totalRows} line items`,
    description: `Boise Cascade statement dated 04/14/2026 reconciled against Abel InFlow receipts. ${totalRows} statement lines examined. Potential variances: ~${varianceCount}. Review Boise_Statement_vs_InFlow_Receipt_Audit_v2.xlsx for line-item detail before the 4/28 meeting — discrepancies are negotiation leverage.`,
    priority: 'HIGH',
    financialImpact: null,
    dueBy: new Date('2026-04-28T12:00:00Z'),
  }]
}

// ---------- 3. Material Triage — PO Aging ----------
function loadMaterialTriagePoAging(): Item[] {
  const file = path.join(ROOT, 'Abel_Lumber_Material_Triage.xlsx')
  const wb = XLSX.readFile(file)
  const ws = wb.Sheets['6. PO Aging']
  const rows = XLSX.utils.sheet_to_json<any>(ws, { header: 1, defval: null }) as any[][]
  const SRC = 'MATERIAL_TRIAGE_PO_AGING'

  // Find header with "PO" or "vendor" + "days" or "age"
  let hdrIdx = -1
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = rows[i].map((c) => normStr(c).toLowerCase())
    if (cells.some((c) => /po|order/.test(c)) && cells.some((c) => /days|age|aging/.test(c))) {
      hdrIdx = i; break
    }
  }
  if (hdrIdx < 0) return []
  const hdrs = rows[hdrIdx].map((h) => normStr(h).toLowerCase())
  const cDays = hdrs.findIndex((h) => /days|age/.test(h))
  const cAmt = hdrs.findIndex((h) => /amount|total|\$|value/.test(h))

  let aged60 = 0, aged30 = 0, total60 = 0, total30 = 0
  for (const row of rows.slice(hdrIdx + 1)) {
    const days = cDays >= 0 ? toNum(row[cDays]) : null
    const amt = cAmt >= 0 ? toNum(row[cAmt]) ?? 0 : 0
    if (days === null || days <= 0) continue
    if (days >= 60) { aged60++; total60 += amt }
    else if (days >= 30) { aged30++; total30 += amt }
  }
  return [{
    id: hashId(SRC, 'summary'),
    type: 'ACTION_REQUIRED',
    source: 'material-triage',
    title: `[PO AGING] ${aged60} POs >60 days ($${total60.toFixed(0)}), ${aged30} POs 30-60 days ($${total30.toFixed(0)})`,
    description: `Open Purchase Orders aging analysis from Material Triage (4/15). POs over 60 days: ${aged60} totaling $${total60.toFixed(2)}. POs 30-60 days: ${aged30} totaling $${total30.toFixed(2)}. Review 'PO Aging' sheet of Abel_Lumber_Material_Triage.xlsx for per-PO detail. Old POs should be confirmed, expedited, or cancelled.`,
    priority: aged60 > 20 ? 'CRITICAL' : aged60 > 5 ? 'HIGH' : 'MEDIUM',
    financialImpact: total60 + total30,
  }]
}

// ---------- 4. Material Triage — WB Line Detail summary ----------
function loadMaterialTriageWbDetail(): Item[] {
  const file = path.join(ROOT, 'Abel_Lumber_Material_Triage.xlsx')
  const wb = XLSX.readFile(file)
  const ws = wb.Sheets['3. WB Line Detail']
  const rows = XLSX.utils.sheet_to_json<any>(ws, { header: 1, defval: null }) as any[][]
  const SRC = 'MATERIAL_TRIAGE_WB_DETAIL'

  // Count distinct jobs + shortage lines
  const jobSet = new Set<string>()
  let shortage = 0
  for (const row of rows.slice(3)) {
    const cells = row.map(normStr)
    const first = cells[0]
    if (first && /^\d+/.test(first)) jobSet.add(first)
    if (cells.some((c) => /short|missing|need|reorder/i.test(c))) shortage++
  }
  return [{
    id: hashId(SRC, 'summary'),
    type: 'MRP_RECOMMENDATION',
    source: 'material-triage',
    title: `[WHITEBOARD] ${jobSet.size} active jobs, ${shortage} lines flagged short`,
    description: `Material Triage whiteboard tracks ${jobSet.size} active jobs across ${rows.length - 3} line items. Approximately ${shortage} lines marked as short/missing/need-reorder. See Whiteboard Jobs + WB Line Detail sheets for per-job material status.`,
    priority: 'HIGH',
  }]
}

// ---------- 5. NFC Hardware Shopping List ----------
function loadNfcHardware(): Item[] {
  const file = path.join(ROOT, 'Abel Lumber - NFC Hardware Shopping List.xlsx')
  const wb = XLSX.readFile(file)
  const ws = wb.Sheets['NFC Shopping List']
  const rows = XLSX.utils.sheet_to_json<any>(ws, { header: 1, defval: null }) as any[][]
  const SRC = 'NFC_HARDWARE_LIST'

  // Find header
  let hdrIdx = -1
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const cells = rows[i].map((c) => normStr(c).toLowerCase())
    if (cells.some((c) => /item|part|sku|description/.test(c))) { hdrIdx = i; break }
  }
  if (hdrIdx < 0) hdrIdx = 2
  const hdrs = rows[hdrIdx].map((h) => normStr(h).toLowerCase())
  const cQty = hdrs.findIndex((h) => /qty|quantity/.test(h))
  const cCost = hdrs.findIndex((h) => /cost|price|total/.test(h))

  let items = 0, total = 0
  for (const row of rows.slice(hdrIdx + 1)) {
    const first = normStr(row[0])
    if (!first || first.toLowerCase().includes('total')) continue
    const qty = cQty >= 0 ? toNum(row[cQty]) ?? 1 : 1
    const cost = cCost >= 0 ? toNum(row[cCost]) ?? 0 : 0
    items++
    total += qty * cost
  }
  return [{
    id: hashId(SRC, 'summary'),
    type: 'PO_APPROVAL',
    source: 'nfc-project',
    title: `[NFC PROJECT] Door-identity hardware shopping list — ${items} items, ~$${total.toFixed(0)} est.`,
    description: `NFC-based door identity system hardware list. ${items} items needed (scanners, tags, NFC phones, etc.) totaling approx $${total.toFixed(2)}. See 'Abel Lumber - NFC Hardware Shopping List.xlsx' for per-item spec. Capex review needed before purchasing.`,
    priority: total > 5000 ? 'MEDIUM' : 'LOW',
    financialImpact: total,
  }]
}

async function main() {
  console.log(`ETL urgent-v2 — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  const batches = [
    { name: 'Boise Invoices Due (fixed)', items: loadBoiseInvoicesDue() },
    { name: 'Boise Statement vs Receipt',  items: loadBoiseReceiptAudit() },
    { name: 'Material Triage PO Aging',    items: loadMaterialTriagePoAging() },
    { name: 'Material Triage WB Detail',   items: loadMaterialTriageWbDetail() },
    { name: 'NFC Hardware Shopping List',  items: loadNfcHardware() },
  ]
  let total = 0
  for (const b of batches) { console.log(`  ${b.name}: ${b.items.length}`); total += b.items.length }
  console.log(`Total: ${total} InboxItems`)
  const all = batches.flatMap((b) => b.items)
  console.log('Sample:')
  all.slice(0, 6).forEach((it) => console.log(`  [${it.priority.padEnd(8)}] ${it.title.slice(0, 100)}`))
  if (DRY_RUN) { console.log('\nDRY-RUN — re-run with --commit.'); return }

  const prisma = new PrismaClient()
  let created = 0, updated = 0, failed = 0
  try {
    for (const it of all) {
      try {
        const res = await prisma.inboxItem.upsert({
          where: { id: it.id },
          create: {
            id: it.id, type: it.type, source: it.source,
            title: it.title.slice(0, 240),
            description: it.description?.slice(0, 2000),
            priority: it.priority, status: 'PENDING',
            financialImpact: it.financialImpact, dueBy: it.dueBy,
          },
          update: {
            title: it.title.slice(0, 240),
            description: it.description?.slice(0, 2000),
            priority: it.priority,
            financialImpact: it.financialImpact,
          },
          select: { createdAt: true, updatedAt: true },
        })
        if (res.createdAt.getTime() === res.updatedAt.getTime()) created++; else updated++
      } catch (e) { failed++; console.error('  FAIL:', (e as Error).message.slice(0, 120)) }
    }
    console.log(`Committed: created=${created} updated=${updated} failed=${failed}`)
  } finally { await prisma.$disconnect() }
}

main().catch((e) => { console.error(e); process.exit(1) })
