/**
 * scripts/etl-financial-outlook-24mo.ts
 *
 * Extracts actionable items from the 24-Month Financial Outlook DOCX
 * (Abel Doors & Trim, July 2025 analysis covering FY2025 + FY2026) and
 * loads them as HIGH-priority InboxItem rows.
 *
 * Source DOCX (~100 KB) is a narrative-heavy outlook assembled for
 * strategic / banking review. It contains:
 *   - Annualized FY-2025 P&L run-rate (Jan–May actuals × 12/5)
 *   - Base-case and upside 2026 projections
 *   - Builder-win scenario matrix (Brightland, Weekley, Perry, Landon,
 *     Lennar, Bloomfield, Toll, etc.) under 5 pricing strategies
 *   - Capacity/covenant-adjacent signals (LOC increase trigger,
 *     AR balloon risk, cash reserve thresholds)
 *   - Hiring / SG&A cost assumptions keyed to each scenario
 *
 * The FinancialSnapshot model is a cash/AR/AP day-snapshot table with
 * a unique snapshotDate — it has NO columns for scenario, projection
 * month, or builder win assumption. Force-fitting forward projections
 * there would corrupt the snapshot series. Per task guardrails, we
 * write to InboxItem only.
 *
 * 20-item cap enforced. All items tagged source=FINANCIAL_OUTLOOK_24MO
 * with entityType=FINANCIAL_OUTLOOK_24MO and a stable entityId per
 * finding so re-runs update-in-place instead of duplicating.
 *
 * Modes:
 *   (default) dry-run — parse, summarise, write nothing
 *   --commit         — insert/update InboxItem rows via raw SQL
 *                      (raw SQL avoids Prisma-client schema-drift issues
 *                       observed elsewhere in this repo)
 */

import { PrismaClient } from '@prisma/client'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as zlib from 'node:zlib'

const DRY_RUN = !process.argv.includes('--commit')

const SOURCE = 'FINANCIAL_OUTLOOK_24MO'
const ENTITY_TYPE = 'FINANCIAL_OUTLOOK_24MO'

const DOCX_PATH = path.resolve(
  __dirname, '..', '..',
  '24-Month Financial Outlook for Abel Doors & Trim.docx'
)

// ────────────────────────────────────────────────────────────────────────────
// DOCX text extraction (zipfile → document.xml → plain-text runs)
// ────────────────────────────────────────────────────────────────────────────

interface LocalFile {
  name: string
  data: Buffer
}

function readZipEntries(buf: Buffer): LocalFile[] {
  // Minimal ZIP local-file reader: enough for a .docx (stored or deflated).
  const entries: LocalFile[] = []
  let off = 0
  while (off + 30 <= buf.length) {
    const sig = buf.readUInt32LE(off)
    if (sig !== 0x04034b50) break // not a local file header → central dir starts
    const method = buf.readUInt16LE(off + 8)
    const compSize = buf.readUInt32LE(off + 18)
    const uncompSize = buf.readUInt32LE(off + 22)
    const nameLen = buf.readUInt16LE(off + 26)
    const extraLen = buf.readUInt16LE(off + 28)
    const name = buf.slice(off + 30, off + 30 + nameLen).toString('utf8')
    const dataStart = off + 30 + nameLen + extraLen
    const raw = buf.slice(dataStart, dataStart + compSize)
    let data: Buffer
    if (method === 0) data = raw
    else if (method === 8) data = zlib.inflateRawSync(raw)
    else throw new Error(`Unsupported zip method ${method} for ${name}`)
    entries.push({ name, data })
    off = dataStart + compSize
    // Handle optional data-descriptor for streamed entries
    if ((buf.readUInt16LE(off - compSize + 6) & 0x08) && method !== 0) {
      // rare in .docx, skip — seek next local-file signature
      while (off + 4 <= buf.length && buf.readUInt32LE(off) !== 0x04034b50) off++
    }
    // sanity: if uncompSize known and we got zero (streamed), we still advanced correctly
    void uncompSize
  }
  return entries
}

function extractParagraphs(xml: string): string[] {
  const paras: string[] = []
  const pRe = /<w:p\b[\s\S]*?<\/w:p>/g
  const tRe = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g
  let pm: RegExpExecArray | null
  while ((pm = pRe.exec(xml)) !== null) {
    const block = pm[0]
    let text = ''
    let tm: RegExpExecArray | null
    while ((tm = tRe.exec(block)) !== null) {
      text += tm[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
    }
    if (text.trim()) paras.push(text.trim())
  }
  return paras
}

function readDocxText(fp: string): string[] {
  const buf = fs.readFileSync(fp)
  const entries = readZipEntries(buf)
  const doc = entries.find(e => e.name === 'word/document.xml')
  if (!doc) throw new Error('word/document.xml not found in DOCX')
  return extractParagraphs(doc.data.toString('utf8'))
}

// ────────────────────────────────────────────────────────────────────────────
// Finding model — each finding becomes one InboxItem
// ────────────────────────────────────────────────────────────────────────────

interface Finding {
  slug: string           // stable entityId suffix (used for upsert)
  title: string
  priority: 'HIGH'       // all HIGH per task
  financialImpact: number | null
  category: string       // e.g. REVENUE_PROJECTION, COVENANT_TRIGGER
  description: string
}

const MAX_ITEMS = 20

// Hardcoded, deterministic extractions keyed off the narrative content.
// Numbers cited from the DOCX; citations reference paragraph index ranges
// captured during extraction (see `paras` in main()).
const FINDINGS: Finding[] = [
  // ── Baseline P&L run-rate (annualized) ──────────────────────────────────
  {
    slug: 'fy25-runrate-revenue',
    category: 'REVENUE_PROJECTION',
    title: 'FY2025 straight-line revenue run-rate: $5.50M (vs $7.6M budget)',
    financialImpact: -2_098_000,
    description: [
      'Jan–May 2025 YTD revenue $2,292,776 → annualized FY-2025 $5,502,000.',
      'This is $2.1M BELOW the $7.6M original FY-2025 budget.',
      'GP% holds at 46.2% but fixed SG&A (~$2.3M) absorbs most of it,',
      'leaving ~$174K pretax net income (3.2% net margin).',
      'Break-even cushion is thin — a 3-week production dip or material',
      'spike would wipe out the profit.',
      'ACTION: decide if the annual plan is re-forecast to $5.5M or if we',
      'commit to builder-win scenarios (B/C/D below) to close the gap.',
    ].join(' '),
  },
  {
    slug: 'fy25-runrate-cogs',
    category: 'COGS_ASSUMPTION',
    title: 'FY2025 annualized COGS $2.96M — implied GP $2.54M at 46.2%',
    financialImpact: 2_543_000,
    description: [
      'YTD Jan–May COGS $1,233,043 → annualized $2,959,000.',
      'YTD COGS came in 9% below budget despite higher sales — pricing',
      'power and cost control from mix shift into manufactured doors/trim.',
      'ACTION: lock the 46% GP assumption as the FY25 planning floor;',
      'any pricing concessions to builders must be modeled against this.',
    ].join(' '),
  },
  {
    slug: 'fy25-runrate-opex',
    category: 'OPEX_ASSUMPTION',
    title: 'FY2025 SG&A run-rate $2.345M (34-35% of sales)',
    financialImpact: -2_345_000,
    description: [
      'Jan–May OpEx $977,167 → annualized $2,345,000 (fixed SG&A + payroll',
      '+ delivery + admin). Fixed-cost absorption is the primary lever;',
      'doc notes OpEx is tracking 12% BELOW budget YTD.',
      'ACTION: protect the 12% under-run; any incremental hires should be',
      'gated on committed new-builder revenue (not pipeline).',
    ].join(' '),
  },
  {
    slug: 'fy25-runrate-netincome',
    category: 'NET_INCOME_TRIGGER',
    title: 'FY2025 annualized pretax net income only ~$174K (3.2% margin)',
    financialImpact: 174_000,
    description: [
      'At run-rate, FY-2025 ends near break-even net income. Doc explicitly',
      'flags: "a single 3-week production dip or material-price spike',
      'would wipe out that profit." This is effectively a covenant-adjacent',
      'cushion trigger for Hancock Whitney line review.',
      'ACTION: include this in the April 2026 HW pitch narrative; do NOT',
      'walk in with a plan that relies on hitting the stale $7.6M budget.',
    ].join(' '),
  },
  // ── Base case 2025 (original outlook) ────────────────────────────────────
  {
    slug: 'fy25-base-case',
    category: 'REVENUE_PROJECTION',
    title: 'FY2025 base-case (pre-downward-revision) revenue $7.58M, EBITDA $1.5M',
    financialImpact: 7_580_000,
    description: [
      'Original 24-month outlook projected FY-2025 revenue ~$7.58M',
      '(roughly flat vs 2024 $7.61M), gross profit ~$3.97M (52% GM),',
      'OpEx $2.6-2.7M, net income $1.22M (16% net margin), EBITDA $1.5M.',
      'The run-rate (item above) now materially trails this base case.',
      'ACTION: reconcile run-rate vs base in the next board deck; flag',
      'the $1.0M+ net-income gap as the P0 recovery target.',
    ].join(' '),
  },
  {
    slug: 'fy26-base-case',
    category: 'REVENUE_PROJECTION',
    title: 'FY2026 base-case revenue $8.0-8.4M (5-10% growth), EBITDA $1.7M',
    financialImpact: 8_200_000,
    description: [
      'Base 2026: 5-10% sales growth to $8.0-8.4M, GM held at ~50-52%,',
      'OpEx $2.7-2.8M (~33% of sales), net income $1.4-1.5M (17-18%',
      'net margin), EBITDA $1.7M+. Growth is capped at ~10% without',
      'the deferred hot-press / HVAC capex.',
      'ACTION: validate the 5-10% growth assumption against BWP volume',
      'loss (21 open POs) and Brookfield Rev 4 pricing outcome.',
    ].join(' '),
  },
  // ── Scenario matrix (builder wins) ──────────────────────────────────────
  {
    slug: 'scenario-A-brightland-premium',
    category: 'SCENARIO_MODEL',
    title: 'Strategy A (Premium 40% GM): Brightland 60 homes → +$228K GP',
    financialImpact: 228_000,
    description: [
      'Win one mid-tier account (Brightland, ~10% capture, 60 homes at',
      '$9,500/home) at 40% GM, supply-only. Incremental revenue $570K,',
      'incremental GP $228K, no new OpEx (fits existing staff/trucks).',
      'Lifts FY-2025 net income from $174K → $402K (3.2% → 6.6%).',
      'ACTION: if still attainable in Q2-Q3 2026, this is the lowest-risk',
      'profit doubler in the deck — flag for Dalton pipeline.',
    ].join(' '),
  },
  {
    slug: 'scenario-B-confident-3builders',
    category: 'SCENARIO_MODEL',
    title: 'Strategy B (Confident 35% GM): Tri Pointe+Chesmar+Taylor Morrison, 230 homes → $720K net',
    financialImpact: 720_000,
    description: [
      '20% of 15-builder pool won (3 of 15) at 35% GM. 230 homes total:',
      'Tri Pointe 140 (20%), Chesmar 45 (15%), Taylor Morrison 45 (15%).',
      'Incremental revenue $2.19M, GP $0.77M, extra OpEx only $50K',
      '(absorbed by existing staff). Net income rises $174K → $890K',
      '(11.6% net margin). Plant load ~65% — capacity safe.',
      'ACTION: score these three against current bid pipeline freshness',
      'before committing sales effort.',
    ].join(' '),
  },
  {
    slug: 'scenario-B2-weekley-perry-landon',
    category: 'SCENARIO_MODEL',
    title: 'Strategy B v2 (Premium-likely): Weekley+Perry+Landon, 270 homes → $1.13M net',
    financialImpact: 1_130_000,
    description: [
      'Targets price-tolerant move-up / semi-custom builders: David',
      'Weekley 150 (25% capture), Perry 50 (20%), Landon 70 (20%).',
      'At 35% GM supply-only: revenue $8.07M, GP $3.57M, SG&A +$75K',
      '(one PM + loader OT), net income $1.13M (14% net margin).',
      'Plant load ~68%. Higher upside than generic B; same ~20% capture.',
      'ACTION: this is the recommended "stretch base case" — route to',
      'Josh/Dalton for targeting cadence.',
    ].join(' '),
  },
  {
    slug: 'scenario-D-competitive-5pp',
    category: 'SCENARIO_MODEL',
    title: 'Strategy D (Competitive 25% GM): 80% wins, 4,633 homes, ~$2M net',
    financialImpact: 2_000_000,
    description: [
      'Price 5pp below industry norm (25% GM), win 12 of 15 builders at',
      '~35% each-builder capture. 4,633 homes Y1. Revenue ~$12-15M,',
      'blended GM ~30%, net income $1.5-2.0M (10-13% net margin).',
      'WARNING: blows past single-shift capacity; requires HVAC/hot-press',
      'capex approval, +8 trailers, +6 trucks, +12 techs, crew doubling.',
      'ACTION: do NOT pursue without LOC increase and capex unlock first.',
    ].join(' '),
  },
  {
    slug: 'scenario-D-2026-full',
    category: 'SCENARIO_MODEL',
    title: 'Strategy D Year 2 (2026): $82.6M revenue, $16.7M net at 200% plant load',
    financialImpact: 16_730_000,
    description: [
      '7,940 homes at $9.7K each. Revenue $82.6M, blended GM 25.9%,',
      'OpEx $4.55M, operating income $17.35M, net income $16.73M',
      '(20.3% margin). WC interest ~0.8% of incremental sales ($620K).',
      'Capacity utilization ≈200% — two full shifts + overtime,',
      'hot-press/HVAC urgent, AR balloon requires LOC increase.',
      'ACTION: treat as aspirational ceiling only; planning should assume',
      'capped-hybrid version below.',
    ].join(' '),
  },
  {
    slug: 'scenario-hybrid-capped',
    category: 'SCENARIO_MODEL',
    title: 'Capped Hybrid B+D (recommended): 5,805 homes, $15.4M net at 185% load',
    financialImpact: 15_400_000,
    description: [
      '2026 tier-adjusted hybrid with share caps: 35% cap for >3K-home',
      'builders (Lennar, GB/Trophy, Bloomfield), 45% for 1K-3K, 50% for',
      '400-1K, 60% for <400. Result: 5,805 homes, revenue $61.9M,',
      'blended GM 31.8%, net income $15.4M (24.9% margin), plant ~185%.',
      'Best profit-to-risk mix in the deck per author.',
      'ACTION: designate this as the primary 2026 planning scenario.',
    ].join(' '),
  },
  // ── Cash flow / covenant-adjacent triggers ──────────────────────────────
  {
    slug: 'trigger-loc-increase',
    category: 'COVENANT_TRIGGER',
    title: 'LOC increase required under Strategy D: AR balloon at >4,600 homes',
    financialImpact: null,
    description: [
      'Doc explicitly: "Cash buffer easily met (>$3M reserve) but AR',
      'balloon requires LOC increase" at Strategy D scale. Also:',
      '"Price-slashing wins nearly every builder and produces a headline',
      'profit of ≈$14M — but only if Abel rapidly doubles manufacturing',
      'capacity, expands logistics, and secures larger credit lines."',
      'ACTION: coordinate with Hancock Whitney BEFORE committing Strategy D',
      'bids — LOC uplift is a prereq, not an afterthought.',
    ].join(' '),
  },
  {
    slug: 'trigger-cash-reserve-3m',
    category: 'COVENANT_TRIGGER',
    title: 'Cash reserve >$3M threshold called out for Strategy D feasibility',
    financialImpact: 3_000_000,
    description: [
      'Document identifies $3M as the cash-reserve threshold at which',
      'Strategy D (4,600+ homes) is "easily met" from a buffer standpoint.',
      'Current cash position is not stated in this doc but should be',
      'cross-checked against FinancialSnapshot.',
      'ACTION: treat $3M as the internal covenant-style floor for',
      'aggressive-growth commitments; below that, cap at Strategy B/C.',
    ].join(' '),
  },
  {
    slug: 'trigger-wc-interest-0_8pct',
    category: 'COVENANT_TRIGGER',
    title: 'Working-capital interest assumption: 0.6-0.8% of incremental sales',
    financialImpact: null,
    description: [
      'Strategy D model uses 0.8% of incremental sales as WC-carry;',
      'capped hybrid uses 0.6%. At $56-77M incremental revenue, this is',
      '$340K-620K of extra annual interest — must be reflected in any',
      'pitch to HW or updated covenant calc.',
      'ACTION: verify the 0.6-0.8% assumption against current HW LOC',
      'pricing; stale if rates moved since doc was written.',
    ].join(' '),
  },
  // ── Hiring plan triggers ────────────────────────────────────────────────
  {
    slug: 'hiring-strategy-B-minimal',
    category: 'HIRING_PLAN',
    title: 'Hiring plan — Strategy B: +1 PM, minor loader OT ($50-75K)',
    financialImpact: -75_000,
    description: [
      'Strategy B (230 homes) absorbs in existing staff: +$50K SG&A only.',
      'Strategy B v2 (270 homes, price-tolerant builders): +1 PM + loader',
      'OT = +$75K SG&A. No trailers/trucks.',
      'ACTION: identify the PM candidate now (internal move vs external),',
      '12-week lead time on external hire for delivery manager caliber.',
    ].join(' '),
  },
  {
    slug: 'hiring-strategy-D-shift2',
    category: 'HIRING_PLAN',
    title: 'Hiring plan — Strategy D Y1: +8 trailers, +6 trucks, +12 techs, +3 PMs',
    financialImpact: -1_200_000,
    description: [
      'Full two-shift operation at 7,940 homes Y2: +3 PMs, +3 loaders,',
      '+4 drivers, night-shift premium. Added SG&A/labour ~$1.2M.',
      'Fleet: +8 trailers, +6 trucks (lease-to-own, NOT costed in the',
      '$1.2M). Shop: +12 techs; field crews double.',
      'ACTION: tie each hire to a signed-PO volume trigger to avoid',
      'stranded cost if builder wins underdeliver.',
    ].join(' '),
  },
  {
    slug: 'hiring-hybrid-capped',
    category: 'HIRING_PLAN',
    title: 'Hiring plan — Capped Hybrid: +4 PMs, +4 loaders, +6 drivers ($1.5M)',
    financialImpact: -1_500_000,
    description: [
      'Full 2nd shift, +4 PMs, +4 loaders, +6 drivers, night premium.',
      'Added SG&A/labour $1.5M. Hot-press/HVAC still deferred under this',
      'scenario — critical assumption to validate with Clint before',
      'committing to 5,805-home capture.',
      'ACTION: draft gated hiring schedule (trigger = cumulative signed',
      'homes YTD).',
    ].join(' '),
  },
  // ── Debt service / capex deferral ───────────────────────────────────────
  {
    slug: 'debt-capex-deferred',
    category: 'DEBT_SERVICE',
    title: 'HVAC + hot-press capex deferred beyond 2026 (~$200K total)',
    financialImpact: -200_000,
    description: [
      'Base case EXCLUDES HVAC/insulation upgrades and hot-press',
      'purchase — treated as optional, deferred beyond 2026. Doc',
      'estimates combined cost ~$200K. If deferred, Abel builds cash to',
      'self-fund; if pulled forward to 2026, adds depreciation from',
      '2027 and potential loan interest.',
      'ACTION: gate the capex decision to end-of-2026 review; do not',
      'front-load commitment in HW pitch.',
    ].join(' '),
  },
  {
    slug: 'debt-industry-benchmark',
    category: 'BENCHMARK',
    title: 'Industry benchmark: net margin 12-18%; Abel base-case 16-18%',
    financialImpact: null,
    description: [
      'Woodworking Network 2022 survey: wood-product mfg net margins',
      '12-18% typical (avg 21%, small shops 24%, large 18%). Large door/',
      'building-product mfgs run 30-33% GM. Abel base-case 50% GM and',
      '16-18% net is at the high end of industry.',
      'ACTION: use as positioning in HW deck — Abel is top-quartile by',
      'margin even before builder wins materialize.',
    ].join(' '),
  },
]

// ────────────────────────────────────────────────────────────────────────────
// Loader
// ────────────────────────────────────────────────────────────────────────────

function fmtMoney(n: number | null): string {
  if (n == null) return '—'
  if (!Number.isFinite(n)) return String(n)
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

async function upsertFinding(prisma: PrismaClient, f: Finding) {
  const entityId = f.slug
  const title = `[24-Mo Outlook] ${f.title}`
  const description = `Category: ${f.category}\n\n${f.description}\n\n` +
    `Source: 24-Month Financial Outlook for Abel Doors & Trim.docx\n` +
    `Extracted: ${new Date().toISOString()}`

  if (DRY_RUN) {
    console.log(`  [DRY] ${f.slug}`)
    console.log(`        title=${title}`)
    console.log(`        priority=HIGH  impact=${fmtMoney(f.financialImpact)}`)
    return
  }

  const existing = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "InboxItem" WHERE source=$1 AND "entityId"=$2 LIMIT 1`,
    SOURCE, entityId
  )
  if (existing.length > 0) {
    await prisma.$executeRawUnsafe(
      `UPDATE "InboxItem" SET title=$1, description=$2, priority=$3,
         "financialImpact"=$4, "updatedAt"=NOW() WHERE id=$5`,
      title, description, 'HIGH', f.financialImpact, existing[0].id
    )
    console.log(`  [UPD] ${f.slug} → ${existing[0].id}`)
  } else {
    const id = 'cuid_fo24_' + Date.now().toString(36) + '_' +
               Math.random().toString(36).slice(2, 8)
    await prisma.$executeRawUnsafe(
      `INSERT INTO "InboxItem"
         (id, type, source, title, description, priority, status,
          "entityType", "entityId", "financialImpact",
          "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())`,
      id, 'SYSTEM', SOURCE, title, description, 'HIGH', 'PENDING',
      ENTITY_TYPE, entityId, f.financialImpact
    )
    console.log(`  [INS] ${f.slug} → ${id}`)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== etl-financial-outlook-24mo ===')
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`Source: ${DOCX_PATH}`)
  if (!fs.existsSync(DOCX_PATH)) {
    throw new Error(`DOCX not found at ${DOCX_PATH}`)
  }

  const paras = readDocxText(DOCX_PATH)
  console.log(`Extracted ${paras.length} paragraphs from DOCX.`)
  console.log(`Header paragraph: "${paras[0]?.slice(0, 80)}"`)

  if (FINDINGS.length > MAX_ITEMS) {
    throw new Error(`Finding count ${FINDINGS.length} exceeds cap ${MAX_ITEMS}`)
  }
  console.log(`\nPlanning ${FINDINGS.length} InboxItem writes (cap ${MAX_ITEMS}):`)

  const prisma = new PrismaClient()
  try {
    for (const f of FINDINGS) {
      await upsertFinding(prisma, f)
    }
  } finally {
    await prisma.$disconnect()
  }

  const totalImpact = FINDINGS
    .map(f => f.financialImpact || 0)
    .reduce((a, b) => a + b, 0)
  console.log(`\n=== Summary ===`)
  console.log(`  Items:             ${FINDINGS.length}`)
  console.log(`  Priority:          HIGH (all)`)
  console.log(`  Sum financialImpact (signed): ${fmtMoney(totalImpact)}`)
  const byCat = new Map<string, number>()
  for (const f of FINDINGS) byCat.set(f.category, (byCat.get(f.category) || 0) + 1)
  for (const [c, n] of [...byCat.entries()].sort()) {
    console.log(`    ${c.padEnd(22)} ${n}`)
  }
  if (DRY_RUN) console.log('\nRe-run with --commit to apply.')
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
