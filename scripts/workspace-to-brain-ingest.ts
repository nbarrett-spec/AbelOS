/**
 * scripts/workspace-to-brain-ingest.ts
 *
 * Targeted Brain ingestion of high-curation workspace files:
 *   - memory/      (25 hand-curated team/customer/brand notes)
 *   - brain/       (28 master architecture docs)
 *   - root MDs     (~20 strategic AEGIS-* and tracker files)
 *
 * Posts each file as a Brain Event with source=MANUAL, event_type=workspace_file.
 * Uses CF Access service-token headers (no Brain bearer needed for /brain/ingest).
 *
 * Usage:
 *   npx tsx scripts/workspace-to-brain-ingest.ts            # DRY-RUN (default)
 *   npx tsx scripts/workspace-to-brain-ingest.ts --commit   # actually POST
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import * as XLSX from 'xlsx'

const DRY_RUN = !process.argv.includes('--commit')
const ROOT = path.resolve(__dirname, '..', '..')
const BRAIN_URL = process.env.NUC_BRAIN_URL || 'https://brain.abellumber.com'
const CF_ID = process.env.CF_ACCESS_CLIENT_ID
const CF_SECRET = process.env.CF_ACCESS_CLIENT_SECRET
const BRAIN_API_KEY = process.env.BRAIN_API_KEY

// CLI: --dir <path> can be passed multiple times to limit ingestion to specific folders
function getDirArgs(): string[] {
  const out: string[] = []
  const a = process.argv.slice(2)
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--dir' && a[i + 1]) { out.push(a[i + 1]); i++ }
  }
  return out
}
const DIR_OVERRIDES = getDirArgs()

interface BrainEvent {
  source: string
  source_id: string
  event_type: string
  title: string
  content: string
  raw_data?: Record<string, unknown>
  tags?: string[]
  priority?: string
  timestamp?: string
}

const MAX_CONTENT = 8000
const STRATEGIC_ROOT_MDS = [
  'ABEL_NUC_MASTER_TRACKER.md',
  'ABEL-OS-ROADMAP.md',
  'ABEL_MASTER_BUILD_PLAN.md',
  'AEGIS-DEPLOY-NOTES-2026-04-22.md',
  'AEGIS-TEAM-READINESS-PLAN.md',
  'AEGIS-VS-LEGACY-GAP-ANALYSIS.md',
  'AEGIS_GLASS_ROLLOUT_PLAN.md',
  'AEGIS_LAUNCH_READINESS_PROMPT.md',
  'AEGIS_V2_CLAUDE_CODE_PROMPT.md',
  'Abel-OS-Go-Live-Action-Plan.md',
  'AEGIS-BRAIN-SWEEP.md',
  'AEGIS-DATA-LOADED-MANIFEST.md',
  'AEGIS-VENDOR-AUDIT.md',
  'AEGIS-FINANCIAL-RECON-v2.md',
  'AEGIS-CRON-MANIFEST.md',
  'AEGIS-CRON-HISTORY.md',
  'AEGIS-AUTH-AUDIT.md',
  'AEGIS-MOCK-ROUTE-AUDIT.md',
  'AEGIS-INTEGRITY-REPORT.md',
  'AEGIS-INBOX-DEDUP-REPORT.md',
]

function tagsForFile(relPath: string, content: string): string[] {
  const tags = new Set<string>(['workspace-ingestion', `file:${relPath.replace(/\\/g, '/')}`])
  // first segment as folder tag
  const seg = relPath.split(/[\\/]/)[0]
  if (seg === 'memory' || seg === 'brain') tags.add(seg)
  // entity-name auto-tag from content (top tier customers + vendors + key terms)
  const text = content.toLowerCase()
  const entities = [
    'pulte', 'brookfield', 'toll brothers', 'shaddock', 'bloomfield',
    'boise cascade', 'metrie', 'masonite', 'jeld-wen', 'kwikset',
    'hancock whitney', 'mg financial', 'aegis', 'nuc', 'hyphen',
    'inflow', 'eci bolt', 'quickbooks', 'curri',
  ]
  for (const e of entities) {
    if (text.includes(e)) tags.add(e.replace(/[^a-z0-9]+/g, '-'))
  }
  return Array.from(tags)
}

function isTextLike(filePath: string): boolean {
  const lower = filePath.toLowerCase()
  return lower.endsWith('.md') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.json') ||
    lower.endsWith('.jsonl') ||
    lower.endsWith('.yml') ||
    lower.endsWith('.yaml') ||
    lower.endsWith('.csv')
}

function isSpreadsheet(filePath: string): boolean {
  const lower = filePath.toLowerCase()
  return lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.xlsm')
}

function isIngestable(filePath: string): boolean {
  return isTextLike(filePath) || isSpreadsheet(filePath)
}

// Skip these dirs anywhere in the path
const SKIP_DIR_NAMES = new Set([
  '.claude', '.remote-plugins', '.git', 'node_modules',
  'abel-builder-platform', 'Abel-Bridge-MCP', 'Abel-NUC-MCP',
  'Abel-Image-Pipeline', 'Abel-Logo-Refresh-April-2026', 'Aegis-Style-Concepts',
  'Bay-Cards', 'abel-orchestrator', 'skills-bundle', 'ui-ux-pro-max-skill',
  'NUC_CLUSTER', 'Supplier_Catalogs', 'Manufacturer_Catalogs', 'Plans',
])

function walkDir(dir: string, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) return files
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return files }
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue
    if (entry.name.startsWith('.~lock')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkDir(full, files)
    else if (entry.isFile() && isIngestable(entry.name)) files.push(full)
  }
  return files
}

function normalizeContent(content: string): string {
  if (content.length <= MAX_CONTENT) return content
  // Keep head (intro/overview) + tail (often summaries/conclusions)
  const head = content.slice(0, MAX_CONTENT - 800)
  const tail = content.slice(-700)
  return `${head}\n\n... [truncated ${content.length - MAX_CONTENT + 100} chars] ...\n\n${tail}`
}

function readSpreadsheetSummary(absPath: string): string | null {
  try {
    const wb = XLSX.readFile(absPath, { cellDates: true })
    const parts: string[] = []
    parts.push(`SPREADSHEET: ${path.basename(absPath)}`)
    parts.push(`Sheets: ${wb.SheetNames.join(', ')}`)
    let totalRows = 0
    for (const name of wb.SheetNames.slice(0, 8)) {
      const ws = wb.Sheets[name]
      if (!ws) continue
      const ref = ws['!ref']
      if (!ref) continue
      const range = XLSX.utils.decode_range(ref)
      const rows = range.e.r - range.s.r + 1
      const cols = range.e.c - range.s.c + 1
      totalRows += rows
      parts.push(`\n[${name}] rows=${rows} cols=${cols}`)
      // Header + first 3 data rows
      const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { defval: null, header: 1 }) as unknown[][]
      for (let i = 0; i < Math.min(4, data.length); i++) {
        const row = data[i]
        if (!row || !Array.isArray(row)) continue
        const cells = row.slice(0, 8).map((c) => String(c ?? '').slice(0, 30))
        parts.push(`  [${i}] ${cells.join(' | ')}`)
      }
    }
    parts.push(`\nTotal rows scanned: ${totalRows}`)
    return parts.join('\n')
  } catch (e) {
    return null
  }
}

function fileToEvent(absPath: string): BrainEvent | null {
  const lower = absPath.toLowerCase()
  let content: string | null = null
  let sizeBytes = 0
  try {
    if (isSpreadsheet(absPath)) {
      content = readSpreadsheetSummary(absPath)
      try { sizeBytes = fs.statSync(absPath).size } catch {}
    } else {
      content = fs.readFileSync(absPath, 'utf8')
      sizeBytes = content.length
    }
  } catch { return null }
  if (!content) return null
  const stripped = content.trim()
  if (stripped.length < 30) return null
  const relPath = path.relative(ROOT, absPath).replace(/\\/g, '/')
  const sourceId = 'wsfile_' + crypto.createHash('sha256').update(relPath).digest('hex').slice(0, 16)
  const baseName = path.basename(relPath, path.extname(relPath))
  let title = baseName.replace(/[-_]/g, ' ')
  const firstLine = stripped.split('\n').find((l) => l.trim().length > 0)?.trim() || ''
  if (firstLine.startsWith('#')) {
    title = firstLine.replace(/^#+\s*/, '').slice(0, 180)
  } else if (isSpreadsheet(absPath)) {
    title = `XLSX: ${baseName}`.slice(0, 240)
  }
  const tags = tagsForFile(relPath, stripped)
  if (isSpreadsheet(absPath)) tags.push('spreadsheet')
  return {
    source: 'manual',
    source_id: sourceId,
    event_type: isSpreadsheet(absPath) ? 'workspace_xlsx' : 'workspace_file',
    title: title.slice(0, 240),
    content: normalizeContent(stripped),
    tags,
    priority: 'P3',
    raw_data: {
      relativePath: relPath,
      sizeBytes,
      ingestedAt: new Date().toISOString(),
    },
  }
}

async function postBatch(events: BrainEvent[]): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (CF_ID && CF_SECRET) {
    headers['CF-Access-Client-Id'] = CF_ID
    headers['CF-Access-Client-Secret'] = CF_SECRET
  }
  if (BRAIN_API_KEY) {
    headers['X-API-Key'] = BRAIN_API_KEY
    headers['Authorization'] = `Bearer ${BRAIN_API_KEY}` // CF strips X-API-Key
  }
  if (!headers['X-API-Key'] && !headers['CF-Access-Client-Id']) {
    throw new Error('Either BRAIN_API_KEY or CF_ACCESS_CLIENT_* must be set')
  }
  const r = await fetch(`${BRAIN_URL}/brain/ingest/batch`, {
    method: 'POST',
    headers,
    body: JSON.stringify(events),
    signal: AbortSignal.timeout(60_000),
  })
  const body = await r.text().catch(() => '')
  return { status: r.status, body: body.slice(0, 300) }
}

async function main() {
  console.log(`Workspace → Brain ingestion — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`Brain URL: ${BRAIN_URL}`)
  const hasAuth = (CF_ID && CF_SECRET) || BRAIN_API_KEY
  console.log(`Auth: ${BRAIN_API_KEY ? 'BRAIN_API_KEY' : ''}${BRAIN_API_KEY && CF_ID ? ' + ' : ''}${CF_ID && CF_SECRET ? 'CF Access' : ''}${hasAuth ? '' : 'MISSING (will fail in commit mode)'}`)
  console.log()

  // Collect targets — if --dir overrides given, honor those; else default to memory/brain/strategic
  let all: string[] = []
  if (DIR_OVERRIDES.length > 0) {
    console.log(`--dir overrides: ${DIR_OVERRIDES.join(', ')}`)
    for (const d of DIR_OVERRIDES) {
      const abs = path.isAbsolute(d) ? d : path.join(ROOT, d)
      const found = walkDir(abs)
      console.log(`  ${d}: ${found.length} files`)
      all.push(...found)
    }
  } else {
    const memFiles = walkDir(path.join(ROOT, 'memory'))
    const brainFiles = walkDir(path.join(ROOT, 'brain'))
    const rootMds: string[] = []
    for (const md of STRATEGIC_ROOT_MDS) {
      const full = path.join(ROOT, md)
      if (fs.existsSync(full)) rootMds.push(full)
    }
    all = [...memFiles, ...brainFiles, ...rootMds]
    console.log(`Targets: memory=${memFiles.length} brain=${brainFiles.length} root_mds=${rootMds.length} total=${all.length}`)
  }

  // Build events
  const events: BrainEvent[] = []
  let skipped = 0
  for (const f of all) {
    const e = fileToEvent(f)
    if (e) events.push(e)
    else skipped++
  }
  console.log(`Built ${events.length} events (skipped ${skipped} too-small/unreadable)`)

  // Stats by tag prefix
  const folderCounts: Record<string, number> = {}
  for (const e of events) {
    const folder = (e.raw_data?.relativePath as string).split('/')[0]
    folderCounts[folder] = (folderCounts[folder] || 0) + 1
  }
  console.log('By folder:', folderCounts)

  // Sample
  console.log('\nSample (first 5):')
  for (const e of events.slice(0, 5)) {
    const fp = e.raw_data?.relativePath
    console.log(`  ${(fp as string).padEnd(50)} → "${e.title.slice(0, 70)}" (${e.content.length} chars, ${e.tags?.length} tags)`)
  }

  if (DRY_RUN) {
    console.log('\nDRY-RUN — re-run with --commit to POST.')
    return
  }

  // Post in batches
  const BATCH = 25
  console.log(`\nPosting ${events.length} events in batches of ${BATCH}...`)
  let sent = 0, failed = 0
  for (let i = 0; i < events.length; i += BATCH) {
    const slice = events.slice(i, i + BATCH)
    try {
      const r = await postBatch(slice)
      if (r.status >= 200 && r.status < 300) {
        sent += slice.length
        process.stdout.write(`  batch ${Math.floor(i / BATCH) + 1}: HTTP ${r.status} (${slice.length} sent)\n`)
      } else {
        failed += slice.length
        console.error(`  batch ${Math.floor(i / BATCH) + 1}: HTTP ${r.status} body=${r.body}`)
      }
    } catch (e) {
      failed += slice.length
      console.error(`  batch ${Math.floor(i / BATCH) + 1}: ERROR ${(e as Error).message.slice(0, 200)}`)
    }
    // Tiny delay between batches
    await new Promise((r) => setTimeout(r, 200))
  }
  console.log(`\nFinal: sent=${sent} failed=${failed}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
