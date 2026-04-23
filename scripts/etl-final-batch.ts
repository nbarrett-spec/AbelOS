/**
 * scripts/etl-final-batch.ts
 *
 * Final two items in the 10-more batch:
 *   #9  Boise Top-15 SKU spend items for 4/28 meeting prep
 *   #10 Turnaround FY2025 financial snapshot as a narrative InboxItem
 *
 * (The FinancialSnapshot schema table is cash/AR/AP focused — the FY2025
 * P&L data is better surfaced as a priority InboxItem Nate can reference.)
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const ROOT = path.resolve(__dirname, '..', '..')

function hashId(tag: string, k: string): string {
  return 'ib_fin_' + crypto.createHash('sha256').update(`${tag}::${k}`).digest('hex').slice(0, 18)
}
function toNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,()]/g, ''))
  return Number.isFinite(n) ? n : 0
}
function normStr(v: unknown): string { return (v ?? '').toString().trim() }

// #9 — Boise top-15 SKUs from AMP Spend Outlook
function loadBoiseTopSkus() {
  const file = path.join(ROOT, 'AMP_Boise_Cascade_Spend_Outlook_2026.xlsx')
  const wb = XLSX.readFile(file)
  const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets['Top_SKUs'], { defval: null })
  const SRC = 'BOISE_TOP15_SKUS_2026'

  interface Sku { sku: string; name: string; cat: string; spend: number; qty: number; price: number; orders: number }
  const skus: Sku[] = []
  for (const r of rows) {
    const sku = normStr(r.ProductSKU || r.SKU || r['Product SKU'])
    if (!sku || !/^BC\d+/i.test(sku)) continue
    skus.push({
      sku,
      name: normStr(r.ProductName),
      cat: normStr(r.Category),
      spend: toNum(r['12-mo spend']),
      qty: toNum(r['12-mo qty']),
      price: toNum(r['Avg unit price']),
      orders: toNum(r.Orders),
    })
  }

  const out: any[] = []
  const total = skus.reduce((s, x) => s + x.spend, 0)

  // Summary item
  out.push({
    id: hashId(SRC, 'summary'),
    type: 'PO_APPROVAL',
    source: 'boise-spend',
    title: `[BOISE 4/28] Top 15 Boise SKUs = $${total.toFixed(0)} / 12mo spend`,
    description: `Top 15 SKUs we buy from Boise Cascade in trailing 12 months total $${total.toFixed(0)}. Leverage for 4/28 negotiation — these are where price reductions compound. Per-SKU items listed below.`,
    priority: 'HIGH',
    financialImpact: total,
    dueBy: new Date('2026-04-28T12:00:00Z'),
  })

  // Per-SKU items for top 10 by spend
  const top10 = [...skus].sort((a, b) => b.spend - a.spend).slice(0, 10)
  for (const s of top10) {
    out.push({
      id: hashId(SRC, `sku:${s.sku}`),
      type: 'PO_APPROVAL',
      source: 'boise-spend',
      title: `[BOISE 4/28] ${s.sku} — $${s.spend.toFixed(0)} / 12mo spend (${s.qty.toFixed(0)} units @ $${s.price.toFixed(2)})`,
      description: `${s.name} (${s.cat}). 12-month Boise spend $${s.spend.toFixed(2)} across ${s.orders} orders, ${s.qty.toFixed(0)} units at avg $${s.price.toFixed(2)}/unit. Size of spend = size of negotiation lever.`,
      priority: s.spend > 20000 ? 'HIGH' : 'MEDIUM',
      financialImpact: s.spend,
      dueBy: new Date('2026-04-28T12:00:00Z'),
    })
  }
  return out
}

// #10 — Turnaround FY2025 Financial Snapshot
function loadFinancialSnapshot() {
  const file = path.join(ROOT, 'Abel_Turnaround_Action_Plan_April2026.xlsx')
  const wb = XLSX.readFile(file)
  const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets['Financial Snapshot'], { header: 1, defval: null }) as any[][]
  const SRC = 'FY2025_FINANCIAL_SNAPSHOT'

  // Extract key P&L + balance sheet lines — anything with a $ in a data column
  const lines: { label: string; fy: string; benchmark: string; action: string }[] = []
  for (const row of rows) {
    const label = normStr(row[0])
    const fy = normStr(row[1])
    const benchmark = normStr(row[3])
    const action = normStr(row[5])
    if (!label || !fy || label.match(/^(ABEL|INCOME|BALANCE|SECTION)/i)) continue
    if (fy && (fy.includes('$') || fy.includes('%') || /^\(?\$?[\d,]/.test(fy))) {
      lines.push({ label, fy, benchmark, action })
    }
  }

  const detailLines = lines
    .slice(0, 18)
    .map((l) => `• ${l.label.padEnd(30)} ${l.fy.padStart(14)}${l.benchmark ? `   benchmark: ${l.benchmark}` : ''}${l.action ? `   → ${l.action}` : ''}`)
    .join('\n')

  return [{
    id: hashId(SRC, 'snapshot'),
    type: 'ACTION_REQUIRED',
    source: 'financial-snapshot',
    title: '[FY2025 SNAPSHOT] Rev $4.47M · GP $1.24M (27.7% vs 35-40% target) · Net -$872K · EBITDA -$481K',
    description: `FY2025 Income Statement + Balance Sheet highlights from the Turnaround file:\n\n${detailLines}\n\nThis is the baseline Nate is turning around. Every InboxItem with source=turnaround-plan, profitability-plan, pricing-rebuild-*, boise-negotiation, or improvement-plan traces back to closing one of these gaps.`,
    priority: 'HIGH',
    financialImpact: 872087, // NET INCOME gap
  }]
}

async function main() {
  console.log(`ETL final batch — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  const items = [...loadBoiseTopSkus(), ...loadFinancialSnapshot()]
  console.log(`Items: ${items.length}`)
  items.forEach((it) => console.log(`  [${it.priority.padEnd(8)}] ${it.title.slice(0, 100)}`))
  if (DRY_RUN) { console.log('\nDRY-RUN — re-run with --commit.'); return }

  const prisma = new PrismaClient()
  let created = 0, updated = 0, failed = 0
  try {
    for (const it of items) {
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
            priority: it.priority, financialImpact: it.financialImpact,
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
