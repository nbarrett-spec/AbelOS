// vendor-completeness-audit.ts
//
// READ-ONLY audit of the Vendor table for data completeness.
// Inspects every Vendor row + its VendorProduct and PurchaseOrder relations
// and classifies each vendor as:
//   - COMPLETE         : name + contact + address + paymentTerms + active + >=1 VendorProduct + >=1 PO
//   - MISSING_CONTACT  : active vendor, no email and no phone
//   - MISSING_TERMS    : active vendor, no paymentTerms/paymentTermDays
//   - PROSPECT         : PROSPECT-NC-* code from A7 supplier research (low priority)
//   - INACTIVE_NO_POS  : record exists but no PO history and no VendorProducts (cleanup candidate)
//
// A single vendor can collect multiple "MISSING_*" flags; primary classification
// is the highest-priority one (see pickCategory).
//
// Default mode is DRY-RUN — prints stdout summary + writes AEGIS-VENDOR-AUDIT.md.
// Pass --commit to also create up to 8 InboxItems tagged
// source='VENDOR_COMPLETENESS_APR2026'.
//
// NEVER deletes a Vendor. Flag-only. Vendor/PurchaseOrder/VendorProduct are
// READ-ONLY — the only writes are InboxItems.
//
// Usage:
//   npx tsx scripts/vendor-completeness-audit.ts
//   npx tsx scripts/vendor-completeness-audit.ts --commit

import { PrismaClient } from '@prisma/client'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as crypto from 'node:crypto'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const COMMIT = process.argv.includes('--commit')
const SOURCE_TAG = 'VENDOR_COMPLETENESS_APR2026'
const INBOX_SOURCE = 'VENDOR_COMPLETENESS_APR2026'
const MAX_INBOX_ITEMS = 8
const TOP_ACTIVE_INCOMPLETE = 5

const REPORT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'AEGIS-VENDOR-AUDIT.md',
)

const prisma = new PrismaClient()

type Category =
  | 'COMPLETE'
  | 'MISSING_CONTACT'
  | 'MISSING_TERMS'
  | 'PROSPECT'
  | 'INACTIVE_NO_POS'

interface VendorRow {
  id: string
  name: string
  code: string
  active: boolean
  hasContact: boolean
  hasAddress: boolean
  hasTerms: boolean
  productCount: number
  poCount: number
  totalPoValue: number
  isProspect: boolean
  category: Category
  flags: string[] // all the things wrong
}

function deterministicInboxId(
  kind: string,
  ...parts: string[]
): string {
  const h = crypto.createHash('sha256')
  h.update([SOURCE_TAG, kind, ...parts].join('|'))
  return h.digest('hex').slice(0, 32)
}

function pickCategory(row: {
  active: boolean
  isProspect: boolean
  hasContact: boolean
  hasTerms: boolean
  poCount: number
  productCount: number
}): Category {
  // PROSPECT classification first — these are A7 research rows, not real
  // suppliers yet. Low priority.
  if (row.isProspect) return 'PROSPECT'

  // Inactive + no history + no products → candidate for deletion
  if (!row.active && row.poCount === 0 && row.productCount === 0)
    return 'INACTIVE_NO_POS'
  if (row.poCount === 0 && row.productCount === 0) return 'INACTIVE_NO_POS'

  if (row.active && !row.hasContact) return 'MISSING_CONTACT'
  if (row.active && !row.hasTerms) return 'MISSING_TERMS'

  return 'COMPLETE'
}

async function main() {
  console.log(
    `[vendor-completeness-audit] starting (${COMMIT ? 'COMMIT' : 'DRY-RUN'})`,
  )

  // Pull vendors + aggregate product / PO counts in one pass.
  const vendors = await prisma.vendor.findMany({
    select: {
      id: true,
      name: true,
      code: true,
      email: true,
      phone: true,
      address: true,
      paymentTerms: true,
      paymentTermDays: true,
      active: true,
      _count: {
        select: { vendorProducts: true, purchaseOrders: true },
      },
    },
    orderBy: { name: 'asc' },
  })

  // Aggregate PO totals per vendor in one groupBy.
  const poTotals = await prisma.purchaseOrder.groupBy({
    by: ['vendorId'],
    _sum: { total: true },
  })
  const totalByVendor = new Map<string, number>()
  for (const t of poTotals) {
    totalByVendor.set(t.vendorId, t._sum.total ?? 0)
  }

  const rows: VendorRow[] = vendors.map(v => {
    const hasContact = Boolean(
      (v.email && v.email.trim()) || (v.phone && v.phone.trim()),
    )
    const hasAddress = Boolean(v.address && v.address.trim())
    const hasTerms = Boolean(
      (v.paymentTerms && v.paymentTerms.trim()) ||
        (v.paymentTermDays && v.paymentTermDays > 0),
    )
    const productCount = v._count.vendorProducts
    const poCount = v._count.purchaseOrders
    const totalPoValue = totalByVendor.get(v.id) ?? 0
    const isProspect = v.code?.startsWith('PROSPECT-NC-') ?? false

    const flags: string[] = []
    if (!hasContact) flags.push('no-contact')
    if (!hasAddress) flags.push('no-address')
    if (!hasTerms) flags.push('no-payment-terms')
    if (productCount === 0) flags.push('no-vendor-products')
    if (poCount === 0) flags.push('no-po-history')
    if (!v.active) flags.push('inactive')

    const category = pickCategory({
      active: v.active,
      isProspect,
      hasContact,
      hasTerms,
      poCount,
      productCount,
    })

    return {
      id: v.id,
      name: v.name,
      code: v.code,
      active: v.active,
      hasContact,
      hasAddress,
      hasTerms,
      productCount,
      poCount,
      totalPoValue,
      isProspect,
      category,
      flags,
    }
  })

  // ──────────────────────────────────────────────────────────────────────
  // Counts
  // ──────────────────────────────────────────────────────────────────────
  const counts: Record<Category, number> = {
    COMPLETE: 0,
    MISSING_CONTACT: 0,
    MISSING_TERMS: 0,
    PROSPECT: 0,
    INACTIVE_NO_POS: 0,
  }
  for (const r of rows) counts[r.category]++

  // Top active-but-incomplete: active vendors w/ PO history but missing
  // contact, address, or terms. Ranked by totalPoValue (biggest $ exposure).
  const activeIncomplete = rows
    .filter(
      r =>
        r.active &&
        !r.isProspect &&
        r.poCount > 0 &&
        (!r.hasContact || !r.hasAddress || !r.hasTerms),
    )
    .sort((a, b) => b.totalPoValue - a.totalPoValue)

  const top5Incomplete = activeIncomplete.slice(0, TOP_ACTIVE_INCOMPLETE)

  const inactiveCandidates = rows
    .filter(r => r.category === 'INACTIVE_NO_POS')
    .sort((a, b) => a.name.localeCompare(b.name))

  const prospects = rows
    .filter(r => r.category === 'PROSPECT')
    .sort((a, b) => a.name.localeCompare(b.name))

  // ──────────────────────────────────────────────────────────────────────
  // Markdown report
  // ──────────────────────────────────────────────────────────────────────
  const lines: string[] = []
  lines.push('# Aegis Vendor Completeness Audit')
  lines.push('')
  lines.push(`_Generated ${new Date().toISOString()}_`)
  lines.push('')
  lines.push(`**Vendors scanned:** ${rows.length}`)
  lines.push(`**Source tag:** \`${SOURCE_TAG}\``)
  lines.push('')
  lines.push('## Classification summary')
  lines.push('')
  lines.push('| Category | Count |')
  lines.push('|---|---:|')
  lines.push(`| COMPLETE | ${counts.COMPLETE} |`)
  lines.push(`| MISSING_CONTACT | ${counts.MISSING_CONTACT} |`)
  lines.push(`| MISSING_TERMS | ${counts.MISSING_TERMS} |`)
  lines.push(`| PROSPECT | ${counts.PROSPECT} |`)
  lines.push(`| INACTIVE_NO_POS | ${counts.INACTIVE_NO_POS} |`)
  lines.push(`| **TOTAL** | **${rows.length}** |`)
  lines.push('')

  lines.push('## Top active-but-incomplete vendors (ranked by PO $ exposure)')
  lines.push('')
  if (top5Incomplete.length === 0) {
    lines.push('_None — every active vendor with PO history has complete data._')
  } else {
    lines.push(
      '| # | Vendor | Code | POs | PO $ | Missing |',
    )
    lines.push('|---:|---|---|---:|---:|---|')
    top5Incomplete.forEach((r, i) => {
      const missing: string[] = []
      if (!r.hasContact) missing.push('contact')
      if (!r.hasAddress) missing.push('address')
      if (!r.hasTerms) missing.push('terms')
      lines.push(
        `| ${i + 1} | ${r.name} | ${r.code} | ${r.poCount} | $${r.totalPoValue.toLocaleString()} | ${missing.join(', ')} |`,
      )
    })
  }
  lines.push('')

  lines.push('## INACTIVE_NO_POS — cleanup candidates')
  lines.push('')
  lines.push(
    '_These have no VendorProducts and no PurchaseOrder history. Flagged for review; **never auto-deleted**._',
  )
  lines.push('')
  if (inactiveCandidates.length === 0) {
    lines.push('_None._')
  } else {
    lines.push('| Vendor | Code | Active flag |')
    lines.push('|---|---|---|')
    for (const r of inactiveCandidates) {
      lines.push(`| ${r.name} | ${r.code} | ${r.active ? 'yes' : 'no'} |`)
    }
  }
  lines.push('')

  lines.push('## PROSPECTs from A7 supplier research')
  lines.push('')
  lines.push(`_${prospects.length} PROSPECT-NC-* rows. Decision needed: activate (convert into real supplier records) or purge._`)
  lines.push('')
  if (prospects.length > 0) {
    lines.push('| Vendor | Code |')
    lines.push('|---|---|')
    for (const r of prospects) {
      lines.push(`| ${r.name} | ${r.code} |`)
    }
  }
  lines.push('')

  lines.push('## Full vendor roster')
  lines.push('')
  lines.push(
    '| Vendor | Code | Active | Contact | Addr | Terms | VP | POs | PO $ | Category |',
  )
  lines.push('|---|---|---|:-:|:-:|:-:|---:|---:|---:|---|')
  for (const r of rows) {
    lines.push(
      `| ${r.name} | ${r.code} | ${r.active ? 'Y' : 'N'} | ${r.hasContact ? 'Y' : 'N'} | ${r.hasAddress ? 'Y' : 'N'} | ${r.hasTerms ? 'Y' : 'N'} | ${r.productCount} | ${r.poCount} | $${r.totalPoValue.toLocaleString()} | ${r.category} |`,
    )
  }
  lines.push('')

  // Footer boilerplate
  lines.push('---')
  lines.push('')
  lines.push(
    "_Generated by `scripts/vendor-completeness-audit.ts` — READ-ONLY on Vendor, VendorProduct, and PurchaseOrder. The only writes this script ever performs are InboxItems with `source='VENDOR_COMPLETENESS_APR2026'` (and only when invoked with `--commit`). No Vendor row is ever deleted — cleanup candidates are flagged only. Re-run any time; output is deterministic per snapshot._",
  )
  lines.push('')

  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8')
  console.log(`[vendor-completeness-audit] wrote report → ${REPORT_PATH}`)

  // ──────────────────────────────────────────────────────────────────────
  // Stdout summary
  // ──────────────────────────────────────────────────────────────────────
  console.log('')
  console.log(`Vendors scanned: ${rows.length}`)
  console.log(
    `  COMPLETE=${counts.COMPLETE}  MISSING_CONTACT=${counts.MISSING_CONTACT}  MISSING_TERMS=${counts.MISSING_TERMS}  PROSPECT=${counts.PROSPECT}  INACTIVE_NO_POS=${counts.INACTIVE_NO_POS}`,
  )
  console.log('')
  console.log(`Top active-but-incomplete vendors:`)
  if (top5Incomplete.length === 0) console.log('  (none)')
  top5Incomplete.forEach((r, i) => {
    const missing: string[] = []
    if (!r.hasContact) missing.push('contact')
    if (!r.hasAddress) missing.push('address')
    if (!r.hasTerms) missing.push('terms')
    console.log(
      `  ${i + 1}. ${r.name} (${r.code}) — ${r.poCount} POs, $${r.totalPoValue.toLocaleString()} — missing: ${missing.join(', ')}`,
    )
  })

  // ──────────────────────────────────────────────────────────────────────
  // InboxItem creation (only on --commit)
  // ──────────────────────────────────────────────────────────────────────
  if (!COMMIT) {
    console.log('')
    console.log(
      `[vendor-completeness-audit] DRY-RUN — skipping InboxItem writes. Re-run with --commit to create up to ${MAX_INBOX_ITEMS} inbox items.`,
    )
    await prisma.$disconnect()
    return
  }

  let created = 0
  let skipped = 0
  const inboxItemsToCreate: Array<{
    kind: string
    entityType: string
    entityId: string
    title: string
    description: string
    priority: string
    financialImpact?: number | null
    actionData: Record<string, unknown>
  }> = []

  // 1. Summary inbox item
  inboxItemsToCreate.push({
    kind: 'summary',
    entityType: 'VendorAudit',
    entityId: `summary-${new Date().toISOString().slice(0, 10)}`,
    title: `Vendor completeness audit — ${rows.length} rows scanned`,
    description:
      `COMPLETE=${counts.COMPLETE}, MISSING_CONTACT=${counts.MISSING_CONTACT}, ` +
      `MISSING_TERMS=${counts.MISSING_TERMS}, PROSPECT=${counts.PROSPECT}, ` +
      `INACTIVE_NO_POS=${counts.INACTIVE_NO_POS}. Full report at AEGIS-VENDOR-AUDIT.md. ` +
      `Top incomplete active vendors: ${top5Incomplete.map(r => r.name).join(', ') || 'none'}.`,
    priority: 'MEDIUM',
    actionData: {
      sourceTag: SOURCE_TAG,
      counts,
      scannedAt: new Date().toISOString(),
      totalVendors: rows.length,
    },
  })

  // 2. Up to 5 inbox items — one per top active-but-incomplete vendor (HIGH)
  for (const r of top5Incomplete) {
    const missing: string[] = []
    if (!r.hasContact) missing.push('contact (email/phone)')
    if (!r.hasAddress) missing.push('address')
    if (!r.hasTerms) missing.push('payment terms')
    inboxItemsToCreate.push({
      kind: 'active-incomplete',
      entityType: 'Vendor',
      entityId: r.id,
      title: `Incomplete active vendor: ${r.name}`,
      description:
        `${r.name} (${r.code}) has ${r.poCount} POs totaling $${r.totalPoValue.toLocaleString()} ` +
        `but is missing: ${missing.join(', ')}. Fill in the missing fields so ` +
        `the vendor scorecard + reliability metrics have complete data.`,
      priority: 'HIGH',
      financialImpact: r.totalPoValue,
      actionData: {
        sourceTag: SOURCE_TAG,
        vendorId: r.id,
        vendorCode: r.code,
        vendorName: r.name,
        missing,
        poCount: r.poCount,
        totalPoValue: r.totalPoValue,
      },
    })
  }

  // 3. One inbox item listing INACTIVE_NO_POS candidates for cleanup
  if (inactiveCandidates.length > 0) {
    const preview = inactiveCandidates
      .slice(0, 20)
      .map(r => `${r.name} (${r.code})`)
      .join(', ')
    inboxItemsToCreate.push({
      kind: 'inactive-cleanup',
      entityType: 'VendorAudit',
      entityId: `inactive-no-pos-${new Date().toISOString().slice(0, 10)}`,
      title: `Vendor cleanup: ${inactiveCandidates.length} INACTIVE_NO_POS rows`,
      description:
        `${inactiveCandidates.length} vendors have no VendorProducts and no PO history — ` +
        `deletion candidates pending review. Sample: ${preview}${inactiveCandidates.length > 20 ? `, ... (+${inactiveCandidates.length - 20} more)` : ''}. ` +
        `See AEGIS-VENDOR-AUDIT.md for the full list. Script does not auto-delete.`,
      priority: 'MEDIUM',
      actionData: {
        sourceTag: SOURCE_TAG,
        count: inactiveCandidates.length,
        vendorIds: inactiveCandidates.map(r => r.id),
        vendors: inactiveCandidates.map(r => ({
          id: r.id,
          name: r.name,
          code: r.code,
          active: r.active,
        })),
      },
    })
  }

  // 4. One inbox item flagging PROSPECTs
  if (prospects.length > 0) {
    const preview = prospects
      .slice(0, 10)
      .map(r => `${r.name} (${r.code})`)
      .join(', ')
    inboxItemsToCreate.push({
      kind: 'prospect-decision',
      entityType: 'VendorAudit',
      entityId: `prospects-${new Date().toISOString().slice(0, 10)}`,
      title: `Decide fate of ${prospects.length} PROSPECT-NC-* vendors`,
      description:
        `${prospects.length} rows from A7 supplier research sit in Vendor table as PROSPECT-NC-*. ` +
        `Decision needed: activate (convert into real supplier records with contact + terms) ` +
        `or purge. Sample: ${preview}${prospects.length > 10 ? `, ... (+${prospects.length - 10} more)` : ''}.`,
      priority: 'MEDIUM',
      actionData: {
        sourceTag: SOURCE_TAG,
        count: prospects.length,
        vendorIds: prospects.map(r => r.id),
        vendors: prospects.map(r => ({
          id: r.id,
          name: r.name,
          code: r.code,
        })),
      },
    })
  }

  // Cap at MAX_INBOX_ITEMS
  const finalItems = inboxItemsToCreate.slice(0, MAX_INBOX_ITEMS)

  for (const item of finalItems) {
    const dedupeHash = deterministicInboxId(item.kind, item.entityId)
    const existing = await prisma.inboxItem.findFirst({
      where: {
        source: INBOX_SOURCE,
        entityType: item.entityType,
        entityId: item.entityId,
      },
      select: { id: true },
    })
    if (existing) {
      skipped++
      continue
    }

    await prisma.inboxItem.create({
      data: {
        type: 'SYSTEM',
        source: INBOX_SOURCE,
        title: item.title,
        description: item.description,
        priority: item.priority,
        status: 'PENDING',
        entityType: item.entityType,
        entityId: item.entityId,
        financialImpact: item.financialImpact ?? null,
        actionData: {
          ...item.actionData,
          entityHash: dedupeHash,
        },
      },
    })
    created++
  }

  console.log('')
  console.log(
    `[vendor-completeness-audit] InboxItems created: ${created}  skipped (dedup): ${skipped}  (cap: ${MAX_INBOX_ITEMS})`,
  )

  await prisma.$disconnect()
}

main().catch(async err => {
  console.error('[vendor-completeness-audit] FATAL', err)
  await prisma.$disconnect()
  process.exit(1)
})
