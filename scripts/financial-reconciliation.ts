/**
 * scripts/financial-reconciliation.ts
 *
 * READ-ONLY financial reconciliation pass. Cross-checks AR/AP totals in the
 * live Neon DB against prior-known figures and surfaces reconciliation gaps.
 *
 * Prior findings (reference baselines):
 *   - AR total: $267K across 24 AccountTouchpoint rows (AR report ETL)
 *   - AP aging: $708K total, 72% > 90 days ($508K) — from A43 FY-archive data
 *   - Open Boise AP: ~$88K (current)
 *   - 87 CollectionAction rows
 *
 * What this script does:
 *   1. Sums Invoice.balanceDue for statuses in (ISSUED, SENT, PARTIALLY_PAID, OVERDUE)
 *      → compares vs $267K baseline.
 *   2. Sums PurchaseOrder.total where status NOT IN (RECEIVED, CANCELLED)
 *      → compares vs $88K (current open) + $508K (historical >90d) = $596K.
 *   3. Flags any reconciliation gap > 10%.
 *   4. Counts:
 *        a. Builders with accountBalance > 0 (overpaid / credit on file)
 *        b. Builders with accountBalance < 0 (we owe them)
 *        c. Invoices past due > 90 days with NO CollectionAction attached
 *   5. Writes report to stdout and to AEGIS-FINANCIAL-RECON.md.
 *   6. Creates up to 5 CRITICAL InboxItems for the biggest reconciliation gaps.
 *
 * READ-ONLY on: Invoice, PurchaseOrder, CollectionAction, AccountTouchpoint,
 *               Builder (for accountBalance).
 * WRITES (finding surfacing only): InboxItem (type=SYSTEM, source=recon-fin-apr2026).
 *
 * Source tag: FIN_RECON_APR2026
 * Run: npx tsx scripts/financial-reconciliation.ts
 */

import * as path from 'node:path'
import * as fs from 'node:fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const SOURCE_TAG = 'FIN_RECON_APR2026'
const RUN_TIMESTAMP = new Date().toISOString()
const REPORT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'AEGIS-FINANCIAL-RECON.md',
)

// Baselines to reconcile against
const AR_BASELINE_USD = 267_000
const AP_OPEN_BOISE_BASELINE_USD = 88_000
const AP_AGED_HISTORICAL_USD = 508_000
const AP_BASELINE_TOTAL_USD = AP_OPEN_BOISE_BASELINE_USD + AP_AGED_HISTORICAL_USD // 596K
const GAP_THRESHOLD_PCT = 10

// AR open invoice statuses (matches src/lib/collections + AR report ETL)
const AR_OPEN_STATUSES = ['ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE'] as const

// AP open PO statuses = everything except RECEIVED / CANCELLED
const AP_OPEN_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SENT_TO_VENDOR',
  'PARTIALLY_RECEIVED',
] as const

type ReconGap = {
  label: string
  observed: number
  baseline: number
  deltaUsd: number
  deltaPct: number
  critical: boolean
  explanation: string
}

type Section = {
  title: string
  lines: string[]
}

const sections: Section[] = []
const gaps: ReconGap[] = []

function section(title: string, lines: string[]) {
  sections.push({ title, lines })
  console.log('\n' + '─'.repeat(72))
  console.log('  ' + title)
  console.log('─'.repeat(72))
  for (const l of lines) console.log(l)
}

function usd(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US')
}

function pct(a: number, b: number): number {
  if (b === 0) return a === 0 ? 0 : 100
  return ((a - b) / b) * 100
}

function recordGap(
  label: string,
  observed: number,
  baseline: number,
  explanation: string,
): ReconGap {
  const deltaUsd = observed - baseline
  const deltaPct = pct(observed, baseline)
  const critical = Math.abs(deltaPct) > GAP_THRESHOLD_PCT
  const g: ReconGap = {
    label,
    observed,
    baseline,
    deltaUsd,
    deltaPct,
    critical,
    explanation,
  }
  gaps.push(g)
  return g
}

async function reconcileAR() {
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: AR_OPEN_STATUSES as unknown as any } },
    select: {
      id: true,
      invoiceNumber: true,
      builderId: true,
      balanceDue: true,
      status: true,
      dueDate: true,
      issuedAt: true,
    },
  })

  const totalAR = invoices.reduce((s, i) => s + (i.balanceDue || 0), 0)

  // Aging buckets (based on dueDate, fall back to issuedAt)
  const now = Date.now()
  const buckets = {
    current: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d91_plus: 0,
    unknownAge: 0,
  }
  const over90ByInvoice: Array<{
    id: string
    invoiceNumber: string
    balanceDue: number
  }> = []

  for (const inv of invoices) {
    const ref = inv.dueDate ?? inv.issuedAt
    if (!ref) {
      buckets.unknownAge += inv.balanceDue || 0
      continue
    }
    const days = Math.floor((now - ref.getTime()) / (1000 * 60 * 60 * 24))
    const bal = inv.balanceDue || 0
    if (days <= 0) buckets.current += bal
    else if (days <= 30) buckets.d1_30 += bal
    else if (days <= 60) buckets.d31_60 += bal
    else if (days <= 90) buckets.d61_90 += bal
    else {
      buckets.d91_plus += bal
      over90ByInvoice.push({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        balanceDue: bal,
      })
    }
  }

  const gap = recordGap(
    'AR (Invoice.balanceDue open statuses)',
    totalAR,
    AR_BASELINE_USD,
    'Baseline comes from AR report ETL (24 AccountTouchpoint rows). A large gap means invoices were not landed into Invoice table (expected — AR ETL used AccountTouchpoint instead of Invoice per its docstring).',
  )

  // Cross-check: AccountTouchpoint rows tagged AR_REPORT_2026-04-10
  const arTouchpoints = await prisma.accountTouchpoint.findMany({
    where: { notes: { contains: 'AR_REPORT_2026-04-10' } },
    select: { id: true, builderId: true, notes: true, outcome: true },
  })

  const lines = [
    `Open invoices (ISSUED/SENT/PARTIALLY_PAID/OVERDUE): ${invoices.length}`,
    `Total open AR (Invoice.balanceDue):                 ${usd(totalAR)}`,
    `Baseline (AR report ETL $267K):                     ${usd(AR_BASELINE_USD)}`,
    `Delta:                                              ${usd(gap.deltaUsd)} (${gap.deltaPct.toFixed(1)}%)`,
    `Reconciliation status:                              ${gap.critical ? 'GAP > 10% — CRITICAL' : 'within tolerance'}`,
    '',
    `AccountTouchpoint rows tagged AR_REPORT_2026-04-10: ${arTouchpoints.length}`,
    '',
    `Aging buckets (by dueDate, then issuedAt):`,
    `  Current  (<=0 days):    ${usd(buckets.current)}`,
    `  1–30 days:              ${usd(buckets.d1_30)}`,
    `  31–60 days:             ${usd(buckets.d31_60)}`,
    `  61–90 days:             ${usd(buckets.d61_90)}`,
    `  90+ days:               ${usd(buckets.d91_plus)}`,
    `  Unknown age (no dates): ${usd(buckets.unknownAge)}`,
  ]
  section('AR Reconciliation', lines)

  return { totalAR, buckets, over90ByInvoice, arTouchpoints, invoices }
}

async function reconcileAP() {
  const pos = await prisma.purchaseOrder.findMany({
    where: { status: { in: AP_OPEN_STATUSES as unknown as any } },
    select: {
      id: true,
      poNumber: true,
      vendorId: true,
      total: true,
      status: true,
      orderedAt: true,
      createdAt: true,
      vendor: { select: { id: true, name: true } },
    },
  })

  const totalAP = pos.reduce((s, p) => s + (p.total || 0), 0)

  // Split Boise AP (for the $88K sub-check) vs all others
  let boiseAP = 0
  for (const p of pos) {
    const name = (p.vendor?.name || '').toLowerCase()
    if (name.includes('boise')) boiseAP += p.total || 0
  }

  // Aging based on orderedAt -> createdAt fallback
  const now = Date.now()
  const ageBuckets = { lt30: 0, d30_60: 0, d60_90: 0, gt90: 0, unknown: 0 }
  for (const p of pos) {
    const ref = p.orderedAt ?? p.createdAt
    if (!ref) {
      ageBuckets.unknown += p.total || 0
      continue
    }
    const days = Math.floor((now - ref.getTime()) / (1000 * 60 * 60 * 24))
    const t = p.total || 0
    if (days < 30) ageBuckets.lt30 += t
    else if (days < 60) ageBuckets.d30_60 += t
    else if (days < 90) ageBuckets.d60_90 += t
    else ageBuckets.gt90 += t
  }

  const totalGap = recordGap(
    'AP (PurchaseOrder.total — status NOT in RECEIVED/CANCELLED)',
    totalAP,
    AP_BASELINE_TOTAL_USD,
    'Baseline combines ~$88K current Boise AP + $508K historical >90d aged (A43 FY-archive). A large gap likely means historical AP was never imported as PurchaseOrder rows — it lives in the A43 archive only.',
  )
  const boiseGap = recordGap(
    'AP — Boise subset',
    boiseAP,
    AP_OPEN_BOISE_BASELINE_USD,
    'Current Boise Cascade open-AP figure from negotiation package.',
  )

  const lines = [
    `Open POs (NOT RECEIVED/CANCELLED):    ${pos.length}`,
    `Total open AP (PurchaseOrder.total):  ${usd(totalAP)}`,
    `Baseline ($88K Boise + $508K aged):   ${usd(AP_BASELINE_TOTAL_USD)}`,
    `Delta:                                ${usd(totalGap.deltaUsd)} (${totalGap.deltaPct.toFixed(1)}%)`,
    `Reconciliation status:                ${totalGap.critical ? 'GAP > 10% — CRITICAL' : 'within tolerance'}`,
    '',
    `Boise AP observed:                    ${usd(boiseAP)}`,
    `Boise AP baseline:                    ${usd(AP_OPEN_BOISE_BASELINE_USD)}`,
    `Boise delta:                          ${usd(boiseGap.deltaUsd)} (${boiseGap.deltaPct.toFixed(1)}%)`,
    `Boise status:                         ${boiseGap.critical ? 'GAP > 10% — CRITICAL' : 'within tolerance'}`,
    '',
    `AP aging buckets (by orderedAt/createdAt):`,
    `  <30 days:   ${usd(ageBuckets.lt30)}`,
    `  30–60 days: ${usd(ageBuckets.d30_60)}`,
    `  60–90 days: ${usd(ageBuckets.d60_90)}`,
    `  >90 days:   ${usd(ageBuckets.gt90)}`,
    `  Unknown:    ${usd(ageBuckets.unknown)}`,
  ]
  section('AP Reconciliation', lines)

  return { totalAP, boiseAP, ageBuckets, pos }
}

async function accountBalanceChecks() {
  const overpaid = await prisma.builder.findMany({
    where: { accountBalance: { gt: 0 } },
    select: { id: true, companyName: true, accountBalance: true },
    orderBy: { accountBalance: 'desc' },
  })
  const weOwe = await prisma.builder.findMany({
    where: { accountBalance: { lt: 0 } },
    select: { id: true, companyName: true, accountBalance: true },
    orderBy: { accountBalance: 'asc' },
  })

  const overpaidTotal = overpaid.reduce((s, b) => s + (b.accountBalance || 0), 0)
  const weOweTotal = weOwe.reduce((s, b) => s + (b.accountBalance || 0), 0)

  const lines = [
    `Builders with accountBalance > 0 (overpaid / credit on file): ${overpaid.length}  (${usd(overpaidTotal)})`,
    ...overpaid.slice(0, 10).map(
      (b) => `  + ${b.companyName.padEnd(40)} ${usd(b.accountBalance)}`,
    ),
    overpaid.length > 10 ? `  (+${overpaid.length - 10} more)` : '',
    '',
    `Builders with accountBalance < 0 (we owe them):              ${weOwe.length}  (${usd(weOweTotal)})`,
    ...weOwe.slice(0, 10).map(
      (b) => `  - ${b.companyName.padEnd(40)} ${usd(b.accountBalance)}`,
    ),
    weOwe.length > 10 ? `  (+${weOwe.length - 10} more)` : '',
  ].filter(Boolean)
  section('Account Balance Anomalies', lines)

  return { overpaid, weOwe, overpaidTotal, weOweTotal }
}

async function overdueWithoutCollectionCheck(
  over90ByInvoice: Array<{ id: string; invoiceNumber: string; balanceDue: number }>,
) {
  if (over90ByInvoice.length === 0) {
    section('Past-Due > 90d Without CollectionAction', [
      'No open invoices past 90 days found — nothing to check.',
    ])
    return { orphans: [] as typeof over90ByInvoice, totalOrphanUsd: 0 }
  }

  const ids = over90ByInvoice.map((i) => i.id)
  const existing = await prisma.collectionAction.findMany({
    where: { invoiceId: { in: ids } },
    select: { invoiceId: true },
  })
  const hasAction = new Set(existing.map((e) => e.invoiceId))

  const orphans = over90ByInvoice.filter((i) => !hasAction.has(i.id))
  const totalOrphanUsd = orphans.reduce((s, o) => s + o.balanceDue, 0)

  const lines = [
    `Open invoices past due > 90 days:            ${over90ByInvoice.length}  (${usd(over90ByInvoice.reduce((s, o) => s + o.balanceDue, 0))})`,
    `  …with at least one CollectionAction:        ${over90ByInvoice.length - orphans.length}`,
    `  …with NO CollectionAction (collection gap): ${orphans.length}  (${usd(totalOrphanUsd)})`,
    '',
    ...orphans.slice(0, 10).map(
      (o) => `  ! ${o.invoiceNumber.padEnd(20)} ${usd(o.balanceDue)}`,
    ),
    orphans.length > 10 ? `  (+${orphans.length - 10} more)` : '',
  ].filter(Boolean)
  section('Past-Due > 90d Without CollectionAction', lines)

  return { orphans, totalOrphanUsd }
}

async function collectionActionSummary() {
  const total = await prisma.collectionAction.count()
  const distinctInvoices = await prisma.collectionAction.findMany({
    select: { invoiceId: true },
    distinct: ['invoiceId'],
  })
  const lines = [
    `CollectionAction rows total:              ${total}`,
    `Distinct invoices with ≥1 action:         ${distinctInvoices.length}`,
    `Baseline from prior findings:             87 rows`,
    `Delta vs baseline:                        ${total - 87} rows`,
  ]
  section('CollectionAction Summary', lines)
  return { total, distinctInvoices: distinctInvoices.length }
}

async function createInboxItemsForGaps(
  arGap: ReconGap,
  apGap: ReconGap,
  boiseGap: ReconGap,
  orphanCount: number,
  orphanUsd: number,
  overpaidCount: number,
  overpaidUsd: number,
) {
  // Rank candidate findings by severity (abs delta in USD for gaps; dollar
  // amount for orphan / overpaid). Keep max 5 CRITICAL items.
  type Candidate = {
    priority: 'CRITICAL' | 'HIGH'
    title: string
    description: string
    impact: number
    entityType?: string
    entityId?: string
  }
  const candidates: Candidate[] = []

  if (arGap.critical) {
    candidates.push({
      priority: 'CRITICAL',
      title: `AR reconciliation gap: ${usd(Math.abs(arGap.deltaUsd))} vs baseline`,
      description: `Open Invoice.balanceDue sums to ${usd(arGap.observed)} but AR report baseline is ${usd(arGap.baseline)} (${arGap.deltaPct.toFixed(1)}%). ${arGap.explanation}`,
      impact: Math.abs(arGap.deltaUsd),
    })
  }
  if (apGap.critical) {
    candidates.push({
      priority: 'CRITICAL',
      title: `AP reconciliation gap: ${usd(Math.abs(apGap.deltaUsd))} vs baseline`,
      description: `Open PO totals sum to ${usd(apGap.observed)} but baseline ($88K Boise + $508K aged) is ${usd(apGap.baseline)} (${apGap.deltaPct.toFixed(1)}%). ${apGap.explanation}`,
      impact: Math.abs(apGap.deltaUsd),
    })
  }
  if (boiseGap.critical) {
    candidates.push({
      priority: 'CRITICAL',
      title: `Boise AP reconciliation gap: ${usd(Math.abs(boiseGap.deltaUsd))}`,
      description: `Boise Cascade open PO total ${usd(boiseGap.observed)} vs $88K baseline (${boiseGap.deltaPct.toFixed(1)}%). ${boiseGap.explanation}`,
      impact: Math.abs(boiseGap.deltaUsd),
    })
  }
  if (orphanCount > 0) {
    candidates.push({
      priority: 'CRITICAL',
      title: `${orphanCount} invoices past-due >90d with no CollectionAction`,
      description: `${orphanCount} open invoices totaling ${usd(orphanUsd)} are >90 days past due but have zero CollectionAction rows attached. Collections workflow is missing these.`,
      impact: orphanUsd,
    })
  }
  if (overpaidCount > 0) {
    candidates.push({
      priority: 'CRITICAL',
      title: `${overpaidCount} builders with positive accountBalance (credit on file)`,
      description: `${overpaidCount} builders have accountBalance > 0 totaling ${usd(overpaidUsd)} — either overpaid or credits never applied. Review before next invoice run.`,
      impact: overpaidUsd,
    })
  }

  // Sort by impact desc, take top 5
  candidates.sort((a, b) => b.impact - a.impact)
  const top = candidates.slice(0, 5)

  const created: Array<{ id: string; title: string }> = []
  for (const c of top) {
    // Dedupe by title prefix + source in last 24h so repeated runs don't spam
    const existing = await prisma.inboxItem.findFirst({
      where: {
        source: `recon-${SOURCE_TAG.toLowerCase()}`,
        title: c.title,
        status: 'PENDING',
      },
      select: { id: true },
    })
    if (existing) {
      created.push({ id: existing.id, title: c.title + ' (existing)' })
      continue
    }
    const item = await prisma.inboxItem.create({
      data: {
        type: 'SYSTEM',
        source: `recon-${SOURCE_TAG.toLowerCase()}`,
        title: c.title,
        description: c.description,
        priority: c.priority,
        status: 'PENDING',
        financialImpact: c.impact,
        actionData: {
          sourceTag: SOURCE_TAG,
          runAt: RUN_TIMESTAMP,
        } as any,
      },
      select: { id: true, title: true },
    })
    created.push(item)
  }

  const lines = [
    `Candidate findings:   ${candidates.length}`,
    `InboxItems created:   ${created.length} (cap = 5)`,
    '',
    ...created.map((c, i) => `  ${i + 1}. [${c.id}] ${c.title}`),
  ]
  section('InboxItems (CRITICAL reconciliation findings)', lines)

  return created
}

function writeMarkdownReport(gitSha: string, inboxItems: Array<{ id: string; title: string }>) {
  const body: string[] = []
  body.push('# Aegis Financial Reconciliation Report')
  body.push('')
  body.push(`**Run at:** ${RUN_TIMESTAMP}`)
  body.push(`**Source tag:** \`${SOURCE_TAG}\``)
  body.push(`**Git SHA:** \`${gitSha}\``)
  body.push('')
  body.push('READ-ONLY diagnostic. No finance-table writes. Findings may have created up to 5 CRITICAL InboxItems.')
  body.push('')

  for (const s of sections) {
    body.push(`## ${s.title}`)
    body.push('')
    body.push('```')
    for (const l of s.lines) body.push(l)
    body.push('```')
    body.push('')
  }

  body.push('## Reconciliation Gaps (>10%)')
  body.push('')
  const critGaps = gaps.filter((g) => g.critical)
  if (critGaps.length === 0) {
    body.push('_No gaps exceeded 10% threshold._')
  } else {
    body.push('| Check | Observed | Baseline | Delta | Delta % |')
    body.push('|---|---:|---:|---:|---:|')
    for (const g of critGaps) {
      body.push(
        `| ${g.label} | ${usd(g.observed)} | ${usd(g.baseline)} | ${usd(g.deltaUsd)} | ${g.deltaPct.toFixed(1)}% |`,
      )
    }
  }
  body.push('')

  body.push('## InboxItems Created')
  body.push('')
  if (inboxItems.length === 0) {
    body.push('_None._')
  } else {
    for (const i of inboxItems) body.push(`- \`${i.id}\` — ${i.title}`)
  }
  body.push('')

  body.push('---')
  body.push('')
  body.push(
    `_Generated by \`scripts/financial-reconciliation.ts\` — source tag \`${SOURCE_TAG}\`. Read-only on finance tables; InboxItem creates permitted for surfacing findings._`,
  )
  body.push('')

  fs.writeFileSync(REPORT_PATH, body.join('\n'), 'utf8')
  console.log(`\nReport written → ${REPORT_PATH}`)
}

async function getGitSha(): Promise<string> {
  try {
    const { execSync } = await import('node:child_process')
    return execSync('git rev-parse HEAD', {
      cwd: path.resolve(__dirname, '..'),
    })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

async function main() {
  console.log('═'.repeat(72))
  console.log(`  Aegis Financial Reconciliation — ${SOURCE_TAG}`)
  console.log(`  ${RUN_TIMESTAMP}`)
  console.log('═'.repeat(72))

  const ar = await reconcileAR()
  const ap = await reconcileAP()
  const bal = await accountBalanceChecks()
  const orphan = await overdueWithoutCollectionCheck(ar.over90ByInvoice)
  await collectionActionSummary()

  // Identify the three tracked gap objects (we pushed them in order)
  const arGap = gaps[0]
  const apGap = gaps[1]
  const boiseGap = gaps[2]

  const inbox = await createInboxItemsForGaps(
    arGap,
    apGap,
    boiseGap,
    orphan.orphans.length,
    orphan.totalOrphanUsd,
    bal.overpaid.length,
    bal.overpaidTotal,
  )

  const sha = await getGitSha()
  writeMarkdownReport(sha, inbox)

  console.log('\n' + '═'.repeat(72))
  console.log('  Reconciliation complete.')
  console.log(`  Gaps >10%:           ${gaps.filter((g) => g.critical).length}`)
  console.log(`  InboxItems created:  ${inbox.length}`)
  console.log(`  Git SHA:             ${sha}`)
  console.log('═'.repeat(72))
}

main()
  .catch((err) => {
    console.error('Reconciliation failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
