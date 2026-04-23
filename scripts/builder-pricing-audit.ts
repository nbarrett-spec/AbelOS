// builder-pricing-audit.ts
//
// READ-ONLY sanity check of Aegis BuilderPricing rows against the Product
// catalog. Compares customPrice to Product.basePrice and Product.cost to flag:
//   - above-list      : customPrice > basePrice       (builder paying more than walk-in rate)
//   - below-cost      : customPrice < cost            (selling below Abel cost — bleeds cash)
//   - inconsistent    : customPrice/basePrice ratio spread > 0.25 within same builder
//                       (same builder has wildly different discounts SKU to SKU)
//
// Default mode is DRY-RUN — prints stdout summary + writes
// AEGIS-PRICING-AUDIT.md. Pass --commit to also create up to 10 InboxItems
// tagged source='PRICING_ANOMALY' for the most egregious findings (CRITICAL
// priority reserved for below-cost; HIGH for above-list; MEDIUM for
// inconsistency). InboxItem writes are the only mutation — no BuilderPricing
// or Product writes ever.
//
// Per-builder sampling: for each builder with >= 20 BuilderPricing rows, a
// random sample of up to 10 (builder, SKU) pairs is inspected and the full
// builder roll-up is computed from ALL rows (not just the sample) so averages
// are honest. Anomalies are ranked across the full population.
//
// Usage:
//   npx tsx scripts/builder-pricing-audit.ts
//   npx tsx scripts/builder-pricing-audit.ts --commit

import { PrismaClient } from '@prisma/client'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as crypto from 'node:crypto'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const COMMIT = process.argv.includes('--commit')
const SOURCE_TAG = 'BUILDER_PRICING_AUDIT'
const INBOX_SOURCE = 'PRICING_ANOMALY'
const MIN_ROWS_PER_BUILDER = 20
const SAMPLE_SIZE = 10
const INCONSISTENCY_RATIO_SPREAD = 0.25 // ratio stddev/max-min threshold
const TOP_ANOMALIES = 20
const MAX_INBOX_ITEMS = 10

const REPORT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'AEGIS-PRICING-AUDIT.md',
)

const prisma = new PrismaClient()

interface Row {
  id: string
  builderId: string
  builderName: string
  productId: string
  sku: string
  productName: string
  customPrice: number
  basePrice: number
  cost: number
}

interface Anomaly {
  kind: 'above-list' | 'below-cost' | 'inconsistent'
  severity: number // sort key, higher = worse
  builderId: string
  builderName: string
  sku: string
  productName: string
  customPrice: number
  basePrice: number
  cost: number
  ratio: number
  note: string
  pricingRowId: string
  productId: string
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function deterministicInboxId(
  kind: string,
  builderId: string,
  productId: string,
): string {
  return crypto
    .createHash('sha1')
    .update(`${SOURCE_TAG}|${kind}|${builderId}|${productId}`)
    .digest('hex')
    .slice(0, 24)
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

async function main() {
  console.log(
    `[builder-pricing-audit] mode=${COMMIT ? 'COMMIT' : 'DRY-RUN'}  source=${SOURCE_TAG}`,
  )

  // Pull everything in a single query so ratios are computed from the same
  // snapshot. BuilderPricing count is ~1.8K so this is cheap.
  const rows = await prisma.builderPricing.findMany({
    select: {
      id: true,
      builderId: true,
      customPrice: true,
      builder: { select: { companyName: true } },
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          basePrice: true,
          cost: true,
        },
      },
    },
  })

  const normalized: Row[] = rows.map(r => ({
    id: r.id,
    builderId: r.builderId,
    builderName: r.builder?.companyName ?? '(unknown builder)',
    productId: r.product.id,
    sku: r.product.sku,
    productName: r.product.name,
    customPrice: r.customPrice,
    basePrice: r.product.basePrice,
    cost: r.product.cost,
  }))

  console.log(`[builder-pricing-audit] loaded ${normalized.length} BuilderPricing rows`)

  // Group by builder
  const byBuilder = new Map<string, Row[]>()
  for (const r of normalized) {
    if (!byBuilder.has(r.builderId)) byBuilder.set(r.builderId, [])
    byBuilder.get(r.builderId)!.push(r)
  }

  // Per-builder roll-up. Only report on builders with >= MIN_ROWS_PER_BUILDER.
  interface BuilderSummary {
    builderId: string
    builderName: string
    rowCount: number
    avgRatio: number // mean customPrice/basePrice where basePrice>0
    minRatio: number
    maxRatio: number
    avgMargin: number // mean (customPrice-cost)/customPrice where customPrice>0
    aboveListCount: number
    belowCostCount: number
    sampleSkus: string[]
    ratioSpread: number // maxRatio - minRatio
  }

  const builderSummaries: BuilderSummary[] = []
  const anomalies: Anomaly[] = []

  for (const [builderId, bRows] of byBuilder) {
    if (bRows.length < MIN_ROWS_PER_BUILDER) continue

    const valid = bRows.filter(r => r.basePrice > 0)
    const ratios = valid.map(r => r.customPrice / r.basePrice)
    const margins = bRows
      .filter(r => r.customPrice > 0)
      .map(r => (r.customPrice - r.cost) / r.customPrice)

    const avgRatio =
      ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0
    const minRatio = ratios.length > 0 ? Math.min(...ratios) : 0
    const maxRatio = ratios.length > 0 ? Math.max(...ratios) : 0
    const avgMargin =
      margins.length > 0
        ? margins.reduce((a, b) => a + b, 0) / margins.length
        : 0

    const aboveList = bRows.filter(
      r => r.basePrice > 0 && r.customPrice > r.basePrice,
    )
    const belowCost = bRows.filter(
      r => r.cost > 0 && r.customPrice < r.cost,
    )

    // Sample 10 random (builder, SKU) pairs for the report
    const sample = shuffle(bRows).slice(0, SAMPLE_SIZE)

    builderSummaries.push({
      builderId,
      builderName: bRows[0].builderName,
      rowCount: bRows.length,
      avgRatio,
      minRatio,
      maxRatio,
      avgMargin,
      aboveListCount: aboveList.length,
      belowCostCount: belowCost.length,
      sampleSkus: sample.map(s => s.sku),
      ratioSpread: maxRatio - minRatio,
    })

    // Collect anomalies
    for (const r of aboveList) {
      const ratio = r.basePrice > 0 ? r.customPrice / r.basePrice : 0
      anomalies.push({
        kind: 'above-list',
        severity: (r.customPrice - r.basePrice), // $ over list
        builderId,
        builderName: r.builderName,
        sku: r.sku,
        productName: r.productName,
        customPrice: r.customPrice,
        basePrice: r.basePrice,
        cost: r.cost,
        ratio,
        note: `custom ${fmt(r.customPrice)} > base ${fmt(r.basePrice)} (${pct(ratio - 1)} over)`,
        pricingRowId: r.id,
        productId: r.productId,
      })
    }
    for (const r of belowCost) {
      const ratio = r.basePrice > 0 ? r.customPrice / r.basePrice : 0
      anomalies.push({
        kind: 'below-cost',
        severity: 10_000 + (r.cost - r.customPrice), // always above above-list
        builderId,
        builderName: r.builderName,
        sku: r.sku,
        productName: r.productName,
        customPrice: r.customPrice,
        basePrice: r.basePrice,
        cost: r.cost,
        ratio,
        note: `custom ${fmt(r.customPrice)} < cost ${fmt(r.cost)} (bleeding ${fmt(r.cost - r.customPrice)}/unit)`,
        pricingRowId: r.id,
        productId: r.productId,
      })
    }

    // Inconsistency: only flag once per builder (the widest outlier pair)
    if (ratios.length >= 5 && maxRatio - minRatio > INCONSISTENCY_RATIO_SPREAD) {
      // Find the rep SKU with the most extreme ratio
      let worst = valid[0]
      let worstDelta = 0
      for (const r of valid) {
        const d = Math.abs(r.customPrice / r.basePrice - avgRatio)
        if (d > worstDelta) {
          worstDelta = d
          worst = r
        }
      }
      anomalies.push({
        kind: 'inconsistent',
        severity: (maxRatio - minRatio) * 100, // < above-list in $, but still visible
        builderId,
        builderName: worst.builderName,
        sku: worst.sku,
        productName: worst.productName,
        customPrice: worst.customPrice,
        basePrice: worst.basePrice,
        cost: worst.cost,
        ratio: worst.basePrice > 0 ? worst.customPrice / worst.basePrice : 0,
        note: `builder ratio spread ${pct(minRatio)}→${pct(maxRatio)} (avg ${pct(avgRatio)}); outlier SKU shown`,
        pricingRowId: worst.id,
        productId: worst.productId,
      })
    }
  }

  // Sort anomalies: below-cost > above-list > inconsistent, then by severity desc
  anomalies.sort((a, b) => b.severity - a.severity)

  const counts = {
    aboveList: anomalies.filter(a => a.kind === 'above-list').length,
    belowCost: anomalies.filter(a => a.kind === 'below-cost').length,
    inconsistent: anomalies.filter(a => a.kind === 'inconsistent').length,
  }

  // -------------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------------

  const lines: string[] = []
  lines.push('# Aegis BuilderPricing Audit')
  lines.push('')
  lines.push(`- Generated: ${new Date().toISOString()}`)
  lines.push(`- Mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`)
  lines.push(`- Source tag: \`${SOURCE_TAG}\``)
  lines.push(
    `- Rows scanned: **${normalized.length}** across **${byBuilder.size}** builders`,
  )
  lines.push(
    `- Builders with >= ${MIN_ROWS_PER_BUILDER} rows: **${builderSummaries.length}**`,
  )
  lines.push('')
  lines.push(
    `- **${counts.belowCost}** below-cost rows, **${counts.aboveList}** above-list rows, **${counts.inconsistent}** inconsistency flags`,
  )
  lines.push('')

  // Per-builder summary
  lines.push('## Per-builder summary')
  lines.push('')
  lines.push(
    '| Builder | Rows | Avg ratio | Avg margin | Min–Max ratio | Above-list | Below-cost | Sample SKUs |',
  )
  lines.push(
    '|---|---:|---:|---:|---|---:|---:|---|',
  )
  builderSummaries
    .sort((a, b) => a.avgRatio - b.avgRatio)
    .forEach(s => {
      lines.push(
        `| ${s.builderName} | ${s.rowCount} | ${pct(s.avgRatio)} | ${pct(s.avgMargin)} | ${pct(s.minRatio)} – ${pct(s.maxRatio)} | ${s.aboveListCount} | ${s.belowCostCount} | ${s.sampleSkus.slice(0, 5).join(', ')}${s.sampleSkus.length > 5 ? ', …' : ''} |`,
      )
    })
  lines.push('')

  // Top anomalies
  lines.push(`## Top ${TOP_ANOMALIES} anomalies`)
  lines.push('')
  lines.push(
    '| # | Kind | Builder | SKU | Custom | Base | Cost | Ratio | Note |',
  )
  lines.push('|---:|---|---|---|---:|---:|---:|---:|---|')
  anomalies.slice(0, TOP_ANOMALIES).forEach((a, i) => {
    lines.push(
      `| ${i + 1} | ${a.kind} | ${a.builderName} | ${a.sku} | ${fmt(a.customPrice)} | ${fmt(a.basePrice)} | ${fmt(a.cost)} | ${pct(a.ratio)} | ${a.note} |`,
    )
  })
  lines.push('')

  // Top 5 below-cost
  const below5 = anomalies.filter(a => a.kind === 'below-cost').slice(0, 5)
  lines.push('## Top 5 below-cost items (CRITICAL — selling below cost)')
  lines.push('')
  if (below5.length === 0) {
    lines.push('_None found._')
  } else {
    lines.push('| # | Builder | SKU | Product | Custom | Cost | Loss/unit |')
    lines.push('|---:|---|---|---|---:|---:|---:|')
    below5.forEach((a, i) => {
      lines.push(
        `| ${i + 1} | ${a.builderName} | ${a.sku} | ${a.productName} | ${fmt(a.customPrice)} | ${fmt(a.cost)} | ${fmt(a.cost - a.customPrice)} |`,
      )
    })
  }
  lines.push('')

  // Footer boilerplate
  lines.push('---')
  lines.push('')
  lines.push(
    '_Generated by `scripts/builder-pricing-audit.ts` — READ-ONLY on BuilderPricing and Product. The only writes this script ever performs are InboxItems with `source=\'PRICING_ANOMALY\'` (and only when invoked with `--commit`). Re-run any time; output is deterministic per snapshot aside from the random sample SKUs._',
  )
  lines.push('')

  const report = lines.join('\n')
  fs.writeFileSync(REPORT_PATH, report, 'utf8')
  console.log(`[builder-pricing-audit] wrote report → ${REPORT_PATH}`)

  // -------------------------------------------------------------------------
  // Stdout summary
  // -------------------------------------------------------------------------

  console.log('')
  console.log(`Builders audited: ${builderSummaries.length}`)
  console.log(
    `Anomalies: ${counts.belowCost} below-cost, ${counts.aboveList} above-list, ${counts.inconsistent} inconsistency`,
  )
  console.log('')
  console.log(`Top ${Math.min(TOP_ANOMALIES, anomalies.length)} anomalies:`)
  anomalies.slice(0, TOP_ANOMALIES).forEach((a, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}. [${a.kind.padEnd(12)}] ${a.builderName} · ${a.sku} — ${a.note}`,
    )
  })

  // -------------------------------------------------------------------------
  // InboxItem creation (only on --commit)
  // -------------------------------------------------------------------------

  if (!COMMIT) {
    console.log('')
    console.log(
      '[builder-pricing-audit] DRY-RUN — skipping InboxItem writes. Re-run with --commit to create up to',
      MAX_INBOX_ITEMS,
      'inbox items.',
    )
    await prisma.$disconnect()
    return
  }

  // Pick up to MAX_INBOX_ITEMS — prioritize below-cost (CRITICAL), then
  // above-list (HIGH), then inconsistency (MEDIUM)
  const forInbox: Anomaly[] = []
  for (const a of anomalies) {
    if (forInbox.length >= MAX_INBOX_ITEMS) break
    forInbox.push(a)
  }

  let created = 0
  let skipped = 0
  for (const a of forInbox) {
    const entityId = deterministicInboxId(a.kind, a.builderId, a.productId)
    const priority =
      a.kind === 'below-cost'
        ? 'CRITICAL'
        : a.kind === 'above-list'
          ? 'HIGH'
          : 'MEDIUM'

    const title =
      a.kind === 'below-cost'
        ? `Below-cost pricing: ${a.builderName} · ${a.sku}`
        : a.kind === 'above-list'
          ? `Above-list pricing: ${a.builderName} · ${a.sku}`
          : `Inconsistent pricing ratios: ${a.builderName}`

    const description =
      `${a.note}. Custom price ${fmt(a.customPrice)}, catalog base ${fmt(a.basePrice)}, ` +
      `Abel cost ${fmt(a.cost)}. Review BuilderPricing row ${a.pricingRowId} ` +
      `against source XLSX and either correct the custom price or document why ` +
      `this deviation is intentional.`

    // Check for existing so we don't duplicate
    const existing = await prisma.inboxItem.findFirst({
      where: {
        source: INBOX_SOURCE,
        entityType: 'BuilderPricing',
        entityId: a.pricingRowId,
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
        title,
        description,
        priority,
        status: 'PENDING',
        entityType: 'BuilderPricing',
        entityId: a.pricingRowId,
        financialImpact:
          a.kind === 'below-cost'
            ? a.cost - a.customPrice
            : a.kind === 'above-list'
              ? a.customPrice - a.basePrice
              : null,
        actionData: {
          sourceTag: SOURCE_TAG,
          kind: a.kind,
          builderId: a.builderId,
          builderName: a.builderName,
          productId: a.productId,
          sku: a.sku,
          customPrice: a.customPrice,
          basePrice: a.basePrice,
          cost: a.cost,
          ratio: a.ratio,
          entityHash: entityId,
        },
      },
    })
    created++
  }

  console.log('')
  console.log(
    `[builder-pricing-audit] InboxItems created: ${created}  skipped (dedup): ${skipped}`,
  )

  await prisma.$disconnect()
}

main().catch(async err => {
  console.error('[builder-pricing-audit] FATAL', err)
  await prisma.$disconnect()
  process.exit(1)
})
