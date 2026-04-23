/**
 * scripts/etl-ai-engine-report.ts
 *
 * Load actionable items from the AI Business Engine System Report DOCX into
 * Aegis as InboxItem rows so the report's callable facts live inside the
 * platform (not just as a Word doc on disk).
 *
 * Source file: ../Abel Lumber - AI Business Engine System Report.docx (~49KB)
 * Source tag:  AI_ENGINE_SYSTEM_REPORT
 *
 * Extraction method:
 *   - No python-docx available — parse word/document.xml directly via
 *     Node's yauzl-free approach (use `fflate` if installed, else fall back
 *     to zip stdlib). We use @zip.js/zip.js if present; otherwise we shell
 *     out to PowerShell's Expand-Archive. BUT simplest + dep-free: use the
 *     Node built-in `zlib` with a tiny inline ZIP central-directory reader.
 *
 *   Actually we take the pragmatic route: invoke a short PowerShell snippet
 *   to extract document.xml to a temp file, then parse with regex. DOCX is
 *   a well-formed zip; Windows PowerShell handles this cleanly.
 *
 * What ships as InboxItems:
 *   The report is primarily a system inventory (feature catalog, model list,
 *   role map, lib modules). It contains *very few* explicit TODOs. Loading
 *   every bullet would bloat the inbox with reference prose. Instead we
 *   surface a small set of derived actionable items — factual corrections
 *   and follow-ups the report reveals when cross-checked against current
 *   state (gate: explicit TODO-ish text OR a fact that contradicts CLAUDE.md
 *   / current schema and would mislead a reader).
 *
 * Priority logic:
 *   - MEDIUM for document-integrity fixes (stale facts in the canonical
 *     internal reference)
 *   - LOW for the archival pointer (so the report is findable from inbox)
 *
 * Idempotency: deterministic IDs from source tag + slug, upsert pattern.
 *
 * Usage:
 *   npx tsx scripts/etl-ai-engine-report.ts          # dry run (default)
 *   npx tsx scripts/etl-ai-engine-report.ts --commit # write
 */

import { PrismaClient } from '@prisma/client'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as crypto from 'node:crypto'
import { execSync } from 'node:child_process'

const DRY_RUN = !process.argv.includes('--commit')
const SOURCE_TAG = 'AI_ENGINE_SYSTEM_REPORT'
const DOCX = path.resolve(
  __dirname,
  '..',
  '..',
  'Abel Lumber - AI Business Engine System Report.docx'
)

function hashId(key: string): string {
  return (
    'ib_aier_' +
    crypto.createHash('sha256').update(`${SOURCE_TAG}::${key}`).digest('hex').slice(0, 16)
  )
}

// ---------------------------------------------------------------------------
// DOCX text extraction (pure Node, no python-docx dep)
// ---------------------------------------------------------------------------
// DOCX = zip with word/document.xml. We use PowerShell Expand-Archive to a
// temp dir since Node has no built-in zip reader. Windows-only by design
// (this whole project is Windows-first).
function extractDocumentXml(docxPath: string): string {
  if (!fs.existsSync(docxPath)) throw new Error(`Not found: ${docxPath}`)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aier-'))
  const copy = path.join(tmp, 'report.zip')
  fs.copyFileSync(docxPath, copy)
  const extractDir = path.join(tmp, 'extracted')
  // PowerShell handles UNC + long paths + spaces correctly here
  const ps = `Expand-Archive -LiteralPath '${copy}' -DestinationPath '${extractDir}' -Force`
  execSync(`powershell -NoProfile -NonInteractive -Command "${ps}"`, { stdio: 'pipe' })
  const xmlPath = path.join(extractDir, 'word', 'document.xml')
  const xml = fs.readFileSync(xmlPath, 'utf8')
  // best-effort temp cleanup
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
  return xml
}

interface Para {
  style: string
  isBullet: boolean
  text: string
}

function parseParagraphs(xml: string): Para[] {
  const paraRe = /<w:p[ >][\s\S]*?<\/w:p>/g
  const out: Para[] = []
  const matches = xml.match(paraRe) ?? []
  for (const p of matches) {
    const styleM = p.match(/<w:pStyle[^/>]*w:val="([^"]+)"/)
    const style = styleM?.[1] ?? ''
    const isBullet = p.includes('<w:numPr>')
    const texts = [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1])
    const text = texts
      .join('')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .trim()
    if (text) out.push({ style, isBullet, text })
  }
  return out
}

// ---------------------------------------------------------------------------
// Derived inbox items
// ---------------------------------------------------------------------------
interface InboxData {
  id: string
  type: string
  source: string
  title: string
  description: string
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  entityType?: string
  entityId?: string
}

function buildItems(paras: Para[]): InboxData[] {
  const items: InboxData[] = []
  const full = paras.map((p) => p.text).join('\n')

  // Helper: pull a value that follows a label row in a 2-col table layout
  // (label row then value row — how Word tables flatten in <w:p>)
  const valAfter = (label: string): string | null => {
    const idx = paras.findIndex((p) => p.text === label)
    if (idx < 0 || idx + 1 >= paras.length) return null
    return paras[idx + 1].text
  }

  // --- 1. Archival pointer so the report is findable from inbox
  items.push({
    id: hashId('archive:pointer'),
    type: 'SYSTEM',
    source: 'ai-engine-report',
    title: 'AI Business Engine System Report (Apr 2026) archived — reference on demand',
    description:
      `Source: ${path.basename(DOCX)} (~49KB, 704 paragraphs, 25 section headings).\n` +
      `Covers: user portals (6), integrations (8), DB schema (77 tables / 53 Prisma models), ` +
      `feature modules (sales, mfg, NFC, orders, delivery, finance, inventory, AI, builder portal, ` +
      `reporting, staff ops), 13 staff roles, entity lifecycles, 48 lib modules, deployment config, ` +
      `brand tokens, recent build highlights.\n` +
      `This is a reference doc — no explicit TODOs. Pointed-to here so search/inbox can surface it ` +
      `when someone asks "what's in the system?".`,
    priority: 'LOW',
  })

  // --- 2. Stale fact: "Version Control: Local development (no git repo)"
  // CLAUDE.md explicitly states repo `abel-builder-platform` exists on main
  // branch with go-live tag. The report predates the repo-ification.
  if (full.includes('Local development (no git repo)')) {
    items.push({
      id: hashId('stale:version-control'),
      type: 'SYSTEM',
      source: 'ai-engine-report',
      title: 'Report claims "no git repo" — stale; update before re-sharing',
      description:
        `The DOCX "Deployment & Infrastructure" table lists Version Control: "Local development ` +
        `(no git repo)". Actual state per CLAUDE.md: repo exists at abel-builder-platform, main ` +
        `branch, tag go-live-2026-04-13. If this deck is shared with HW/Boise/builders, correct ` +
        `this line first. Fix: regenerate report section or redline manually.`,
      priority: 'MEDIUM',
    })
  }

  // --- 3. Stale fact: report says 53 Prisma models; CLAUDE.md says 58
  const modelsVal = valAfter('Prisma Schema Models')
  if (modelsVal && modelsVal !== '58') {
    items.push({
      id: hashId('stale:prisma-model-count'),
      type: 'SYSTEM',
      source: 'ai-engine-report',
      title: `Report model count (${modelsVal}) lags live schema (58) — regenerate stats`,
      description:
        `"Platform at a Glance" reports ${modelsVal} Prisma models. CLAUDE.md says 58 models, ` +
        `453 API routes, ~200 pages, 8 crons. Report also shows 359 routes / 179 pages / 2 crons. ` +
        `If the report is being used in the Hancock Whitney pitch or any external narrative, ` +
        `refresh the counts via a schema introspection before the meeting.`,
      priority: 'MEDIUM',
    })
  }

  // --- 4. Route count drift: 359 in report vs ~453 in CLAUDE.md
  const routesVal = valAfter('API Route Endpoints')
  if (routesVal && /^\d+$/.test(routesVal) && parseInt(routesVal, 10) < 400) {
    items.push({
      id: hashId('stale:api-route-count'),
      type: 'SYSTEM',
      source: 'ai-engine-report',
      title: `Report API route count (${routesVal}) behind live (~453)`,
      description:
        `"Platform at a Glance" reports ${routesVal} endpoints. CLAUDE.md shows ~453. ~90 new ` +
        `routes shipped since the report was generated. Any stat cited from this DOCX should be ` +
        `re-pulled fresh before sharing externally.`,
      priority: 'LOW',
    })
  }

  // --- 5. Cron count drift: 2 in report vs 8 in CLAUDE.md
  const cronIdx = paras.findIndex((p) => p.text === 'Cron Jobs')
  if (cronIdx >= 0 && cronIdx + 1 < paras.length) {
    const cronLine = paras[cronIdx + 1].text
    if (/^2 scheduled/.test(cronLine)) {
      items.push({
        id: hashId('stale:cron-count'),
        type: 'SYSTEM',
        source: 'ai-engine-report',
        title: 'Report lists 2 crons; live platform runs 8 — document the other 6',
        description:
          `Report "Deployment & Infrastructure" lists 2 vercel.json crons (quote follow-up + ` +
          `opportunity detection). CLAUDE.md says 8 crons. Gap of 6. Either (a) the 6 extras are ` +
          `post-report additions worth noting in a refreshed deck, or (b) they're Vercel-external ` +
          `(e.g., InFlow sync, outreach processor) that should be documented.`,
        priority: 'MEDIUM',
      })
    }
  }

  // --- 6. Integration parity reminder — report lists 8 integrations all as
  // "connected" but CLAUDE.md calls out QB Desktop "not fully wired" and
  // Hyphen "partly broken". Anyone quoting the DOCX needs that caveat.
  if (full.includes('External Integrations (8)')) {
    items.push({
      id: hashId('caveat:integration-status'),
      type: 'SYSTEM',
      source: 'ai-engine-report',
      title: 'Report lists 8 integrations as live — QB and Hyphen need caveats',
      description:
        `"External Integrations (8)" table lists QuickBooks Desktop and Hyphen as shipped. ` +
        `CLAUDE.md: QB "QB Sync Queue models exist, not fully wired — decision pending to build ` +
        `or kill"; Hyphen "API integration partly broken" (0/80 linked for Brookfield as of 4/20). ` +
        `If the DOCX is used in HW or builder decks, footnote or downgrade these two lines.`,
      priority: 'MEDIUM',
    })
  }

  // --- 7. Pulte-mentioning content check — the report predates 4/20 loss
  // so any Pulte reference in it is obsolete
  if (/pulte/i.test(full)) {
    items.push({
      id: hashId('caveat:pulte-references'),
      type: 'SYSTEM',
      source: 'ai-engine-report',
      title: 'Scrub Pulte references before re-sharing — account lost 4/20/2026',
      description:
        `Report (dated Apr 1 2026) may reference Pulte positively in narrative. Account was lost ` +
        `4/20/2026 (Treeline → 84 Lumber). If this deck is shared externally or used in the HW ` +
        `pitch, scrub or caveat any Pulte mentions. Grep the source DOCX for "pulte" and revise.`,
      priority: 'MEDIUM',
    })
  }

  // --- 8. Staff roles table vs live staff — report says 13 role types
  // supported. Worth a Staff-audit that every hire is on a valid role.
  if (full.includes('Staff Roles Supported') && full.includes('13')) {
    items.push({
      id: hashId('followup:staff-role-audit'),
      type: 'AGENT_TASK',
      source: 'ai-engine-report',
      title: 'Audit Staff table against the 13 roles listed in the report',
      description:
        `Report lists 13 supported roles: ADMIN, MANAGER, PROJECT_MANAGER, ESTIMATOR, SALES_REP, ` +
        `PURCHASING, WAREHOUSE_LEAD, WAREHOUSE_TECH, DRIVER, INSTALLER, QC_INSPECTOR, ACCOUNTING, ` +
        `VIEWER. Verify every active Staff row has a role in this set; flag any null/legacy values. ` +
        `One-shot SQL check — not a recurring action.`,
      priority: 'LOW',
    })
  }

  return items
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`ETL AI Engine System Report — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`Source: ${DOCX}`)
  console.log(`Source tag: ${SOURCE_TAG}`)

  const xml = extractDocumentXml(DOCX)
  const paras = parseParagraphs(xml)
  console.log(`\nParsed paragraphs: ${paras.length}`)
  const bullets = paras.filter((p) => p.isBullet)
  const headings = paras.filter((p) => /Heading|Title/.test(p.style))
  console.log(`  bullet paragraphs: ${bullets.length}`)
  console.log(`  headings:          ${headings.length}`)

  const items = buildItems(paras)
  console.log(`\nInboxItems to load: ${items.length} (cap 25)`)

  const byPriority = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
  for (const it of items) byPriority[it.priority]++
  console.log('Priority mix:', byPriority)
  console.log()
  console.log('All items:')
  items.forEach((it, i) => {
    console.log(`  ${i + 1}. [${it.priority.padEnd(8)}] ${it.title}`)
  })
  console.log()

  if (items.length === 0) {
    console.log('Nothing to load — exit.')
    return
  }

  if (DRY_RUN) {
    console.log('=== DRY-RUN — no writes performed. Re-run with --commit to apply. ===')
    return
  }

  const prisma = new PrismaClient()
  let created = 0
  let updated = 0
  let failed = 0
  try {
    for (const it of items) {
      try {
        const existing = await prisma.inboxItem.findUnique({
          where: { id: it.id },
          select: { id: true },
        })
        await prisma.inboxItem.upsert({
          where: { id: it.id },
          create: {
            id: it.id,
            type: it.type,
            source: it.source,
            title: it.title.slice(0, 240),
            description: it.description.slice(0, 2000),
            priority: it.priority,
            status: 'PENDING',
            entityType: it.entityType,
            entityId: it.entityId,
          },
          update: {
            title: it.title.slice(0, 240),
            description: it.description.slice(0, 2000),
            priority: it.priority,
          },
        })
        if (existing) updated++
        else created++
      } catch (e) {
        failed++
        console.error(`  FAIL ${it.id}:`, (e as Error).message.slice(0, 160))
      }
    }
    console.log(`Committed: created=${created}, updated=${updated}, failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
