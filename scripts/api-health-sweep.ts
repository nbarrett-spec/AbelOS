/**
 * api-health-sweep.ts — READ-ONLY Aegis API health probe.
 *
 * Source tag: API_HEALTH_SWEEP_APR2026
 *
 * What it does:
 *   1. Enumerates every src/app/app/api/**\/route.ts file on disk
 *   2. Reads each file to determine allowed HTTP methods
 *   3. GET-probes public routes (no POSTs, no writes)
 *   4. Expects 401/403 on /api/ops/* and /api/admin/* (protected, not 500)
 *   5. Flags any 5xx (500/502/503/504) as CRITICAL
 *   6. Writes a markdown report + up to 10 InboxItems for the worst offenders
 *
 * Run: npx tsx scripts/api-health-sweep.ts
 *
 * Constraints honored:
 *   - READ-ONLY HTTP (GET / HEAD only; never POST/PUT/DELETE/PATCH)
 *   - Rate limit: 2 req/sec (500ms between requests)
 *   - Timeout: 30s per request
 *   - No auth headers — we probe as anonymous
 *   - Only DB writes are the InboxItem rows for the worst-broken endpoints
 */

import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'
import { writeFileSync } from 'fs'

const BASE_URL = process.env.AEGIS_BASE_URL || 'https://app.abellumber.com'
const API_ROOT = path.join(process.cwd(), 'src', 'app', 'api')
const REPORT_PATH = 'C:\\Users\\natha\\OneDrive\\Abel Lumber\\AEGIS-API-HEALTH-REPORT.md'
const REQUEST_TIMEOUT_MS = 30_000
const REQUEST_INTERVAL_MS = 500 // 2 req/sec
const MAX_INBOX_ITEMS = 10
const SOURCE_TAG = 'API_HEALTH_SWEEP_APR2026'

const prisma = new PrismaClient()

type Classification = 'public-ok' | 'protected-ok' | 'broken' | 'parse-failure' | 'unexpected' | 'skipped'

interface Probe {
  filePath: string
  urlPath: string
  methods: string[]
  isProtected: boolean
  status: number | null
  classification: Classification
  note: string
  durationMs: number
  bodySample: string | null
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Walk the filesystem to find every route.ts under src/app/api.
 */
function enumerateRoutes(root: string): string[] {
  const results: string[] = []
  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile() && entry.name === 'route.ts') {
        results.push(full)
      }
    }
  }
  walk(root)
  return results
}

/**
 * Convert a filesystem path like
 *   src/app/api/admin/builders/[id]/route.ts
 * into a URL path like
 *   /api/admin/builders/[id]
 * (we keep the dynamic segment literally; we won't actually probe dynamic routes
 * unless we can substitute, but we still record them).
 */
function filePathToUrl(filePath: string): string {
  const rel = path.relative(API_ROOT, filePath).replace(/\\/g, '/')
  const withoutRoute = rel.replace(/\/route\.ts$/, '')
  return '/api/' + withoutRoute
}

/**
 * Very light static analysis — find exported HTTP method functions.
 * Looks for `export async function GET` / `export function POST` etc.
 */
function readMethods(filePath: string): string[] {
  const src = fs.readFileSync(filePath, 'utf8')
  const methods: string[] = []
  const verbs = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
  for (const verb of verbs) {
    const re = new RegExp(`export\\s+(async\\s+)?function\\s+${verb}\\b`)
    const reConst = new RegExp(`export\\s+const\\s+${verb}\\b`)
    if (re.test(src) || reConst.test(src)) {
      methods.push(verb)
    }
  }
  return methods
}

function isProtectedPath(urlPath: string): boolean {
  return (
    urlPath.startsWith('/api/ops/') ||
    urlPath.startsWith('/api/admin/') ||
    urlPath.startsWith('/api/v1/engine/') // engine routes are also token-protected
  )
}

function hasDynamicSegment(urlPath: string): boolean {
  return /\[[^\]]+\]/.test(urlPath)
}

async function probe(urlPath: string): Promise<{ status: number | null; note: string; durationMs: number; bodySample: string | null }> {
  const url = BASE_URL + urlPath
  const start = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        'user-agent': `Aegis-API-Health-Sweep/${SOURCE_TAG}`,
        accept: 'application/json,text/plain,*/*',
      },
    })
    clearTimeout(timeout)
    let bodySample: string | null = null
    try {
      const text = await res.text()
      bodySample = text.slice(0, 300)
    } catch {
      bodySample = null
    }
    return { status: res.status, note: '', durationMs: Date.now() - start, bodySample }
  } catch (err: any) {
    clearTimeout(timeout)
    const note = err?.name === 'AbortError' ? 'timeout' : `fetch-error: ${err?.message || String(err)}`
    return { status: null, note, durationMs: Date.now() - start, bodySample: null }
  }
}

function classify(status: number | null, isProtected: boolean, note: string): { classification: Classification; note: string } {
  if (status === null) {
    return { classification: 'broken', note: note || 'no response' }
  }
  if (status >= 500 && status <= 599) {
    return { classification: 'broken', note: `HTTP ${status}` }
  }
  if (isProtected) {
    // Protected routes: we want to see 401/403 or a 404-like on unknown dynamic params.
    // Anything 2xx leaking would be suspicious; anything 5xx is broken (handled above).
    if (status === 401 || status === 403) {
      return { classification: 'protected-ok', note: `HTTP ${status}` }
    }
    if (status === 404 || status === 405 || status === 400) {
      return { classification: 'protected-ok', note: `HTTP ${status} (likely path/method mismatch, not 5xx)` }
    }
    if (status >= 200 && status < 300) {
      return { classification: 'unexpected', note: `HTTP ${status} — protected route returned 2xx to anonymous` }
    }
    if (status === 301 || status === 302 || status === 307 || status === 308) {
      return { classification: 'protected-ok', note: `HTTP ${status} redirect` }
    }
    return { classification: 'unexpected', note: `HTTP ${status}` }
  }
  // Public routes
  if (status >= 200 && status < 400) {
    return { classification: 'public-ok', note: `HTTP ${status}` }
  }
  if (status === 401 || status === 403) {
    // Route we thought was public actually gates — still not broken
    return { classification: 'protected-ok', note: `HTTP ${status} (public path but auth-gated)` }
  }
  if (status === 404 || status === 405 || status === 400) {
    return { classification: 'public-ok', note: `HTTP ${status} (method/path mismatch — not 5xx)` }
  }
  if (status === 429) {
    return { classification: 'public-ok', note: 'HTTP 429 — rate limited, not a defect' }
  }
  return { classification: 'unexpected', note: `HTTP ${status}` }
}

async function writeInboxItems(probes: Probe[]) {
  const broken = probes.filter((p) => p.classification === 'broken')
  const top = broken.slice(0, MAX_INBOX_ITEMS)
  let created = 0
  for (const p of top) {
    try {
      await prisma.inboxItem.create({
        data: {
          type: 'SYSTEM',
          source: 'api-health-sweep',
          title: `API 5xx: ${p.urlPath}`,
          description: `Endpoint returned ${p.note} during health sweep. File: ${path.relative(process.cwd(), p.filePath)}. Body sample: ${(p.bodySample || '').slice(0, 200)}`,
          priority: 'HIGH',
          status: 'PENDING',
          entityType: 'ApiRoute',
          entityId: p.urlPath,
          actionData: {
            sourceTag: SOURCE_TAG,
            urlPath: p.urlPath,
            status: p.status,
            methods: p.methods,
            durationMs: p.durationMs,
          },
        },
      })
      created++
    } catch (err: any) {
      console.error(`  [inbox] failed to create item for ${p.urlPath}: ${err?.message || err}`)
    }
  }
  return created
}

function renderReport(probes: Probe[], gitSha: string, startedAt: Date, finishedAt: Date, inboxCreated: number): string {
  const total = probes.length
  const byClass = probes.reduce<Record<string, number>>((acc, p) => {
    acc[p.classification] = (acc[p.classification] || 0) + 1
    return acc
  }, {})
  const broken = probes.filter((p) => p.classification === 'broken')
  const unexpected = probes.filter((p) => p.classification === 'unexpected')

  const lines: string[] = []
  lines.push(`# Aegis API Health Sweep Report`)
  lines.push('')
  lines.push(`- **Source tag:** ${SOURCE_TAG}`)
  lines.push(`- **Git SHA:** ${gitSha}`)
  lines.push(`- **Base URL:** ${BASE_URL}`)
  lines.push(`- **Started:** ${startedAt.toISOString()}`)
  lines.push(`- **Finished:** ${finishedAt.toISOString()}`)
  lines.push(`- **Duration:** ${((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1)}s`)
  lines.push(`- **Total routes on disk:** ${total}`)
  lines.push('')
  lines.push(`## Summary`)
  lines.push('')
  lines.push(`| Classification | Count |`)
  lines.push(`|---|---|`)
  for (const k of ['public-ok', 'protected-ok', 'broken', 'parse-failure', 'unexpected', 'skipped']) {
    lines.push(`| ${k} | ${byClass[k] || 0} |`)
  }
  lines.push('')
  lines.push(`- **InboxItems created:** ${inboxCreated}`)
  lines.push('')

  lines.push(`## Broken (5xx / no response) — ${broken.length}`)
  lines.push('')
  if (broken.length === 0) {
    lines.push('_None. Good._')
  } else {
    lines.push(`| URL | Status | Note | Duration (ms) |`)
    lines.push(`|---|---|---|---|`)
    for (const p of broken) {
      lines.push(`| \`${p.urlPath}\` | ${p.status ?? 'n/a'} | ${p.note} | ${p.durationMs} |`)
    }
  }
  lines.push('')

  lines.push(`## Unexpected (non-5xx but unusual) — ${unexpected.length}`)
  lines.push('')
  if (unexpected.length === 0) {
    lines.push('_None._')
  } else {
    lines.push(`| URL | Status | Note |`)
    lines.push(`|---|---|---|`)
    for (const p of unexpected) {
      lines.push(`| \`${p.urlPath}\` | ${p.status ?? 'n/a'} | ${p.note} |`)
    }
  }
  lines.push('')

  lines.push(`## Methodology`)
  lines.push('')
  lines.push(`- Enumerated every \`src/app/api/**/route.ts\` on disk.`)
  lines.push(`- Parsed allowed methods via regex on \`export (async )?function <VERB>\`.`)
  lines.push(`- Sent anonymous \`GET\` (no cookies, no tokens). No writes, no POSTs.`)
  lines.push(`- Routes under \`/api/ops/\`, \`/api/admin/\`, \`/api/v1/engine/\` treated as protected; 401/403/404/405/redirect = healthy.`)
  lines.push(`- Routes with dynamic segments (\`[id]\`) were probed with the literal bracket path; 404/400 is acceptable there.`)
  lines.push(`- Rate-limited to ~2 req/sec with a 30s timeout per request.`)
  lines.push('')
  lines.push(`---`)
  lines.push(`_Generated by \`scripts/api-health-sweep.ts\` — tag ${SOURCE_TAG}. Read-only._`)
  return lines.join('\n')
}

function getGitSha(): string {
  try {
    const { execSync } = require('child_process')
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

async function main() {
  const startedAt = new Date()
  const gitSha = getGitSha()
  console.log(`[api-health-sweep] tag=${SOURCE_TAG} sha=${gitSha}`)
  console.log(`[api-health-sweep] base=${BASE_URL}`)

  const files = enumerateRoutes(API_ROOT)
  console.log(`[api-health-sweep] found ${files.length} route.ts files`)

  const probes: Probe[] = []
  let i = 0
  for (const filePath of files) {
    i++
    let methods: string[] = []
    try {
      methods = readMethods(filePath)
    } catch (err: any) {
      const urlPath = filePathToUrl(filePath)
      probes.push({
        filePath,
        urlPath,
        methods: [],
        isProtected: isProtectedPath(urlPath),
        status: null,
        classification: 'parse-failure',
        note: `parse error: ${err?.message || err}`,
        durationMs: 0,
        bodySample: null,
      })
      continue
    }
    const urlPath = filePathToUrl(filePath)
    const isProtected = isProtectedPath(urlPath)

    // If the file doesn't export GET (or HEAD), we can't safely probe without a POST body.
    if (!methods.includes('GET') && !methods.includes('HEAD')) {
      probes.push({
        filePath,
        urlPath,
        methods,
        isProtected,
        status: null,
        classification: 'skipped',
        note: `no GET/HEAD exported (methods: ${methods.join(',') || 'none'})`,
        durationMs: 0,
        bodySample: null,
      })
      continue
    }

    const { status, note, durationMs, bodySample } = await probe(urlPath)
    const { classification, note: cNote } = classify(status, isProtected, note)
    probes.push({
      filePath,
      urlPath,
      methods,
      isProtected,
      status,
      classification,
      note: cNote || note,
      durationMs,
      bodySample,
    })

    if (i % 25 === 0) {
      console.log(`  progress: ${i}/${files.length}`)
    }

    await sleep(REQUEST_INTERVAL_MS)
  }

  const finishedAt = new Date()

  const inboxCreated = await writeInboxItems(probes)
  const report = renderReport(probes, gitSha, startedAt, finishedAt, inboxCreated)

  writeFileSync(REPORT_PATH, report, 'utf8')
  console.log('\n===== REPORT =====')
  console.log(report)
  console.log('\n==================')
  console.log(`[api-health-sweep] wrote ${REPORT_PATH}`)
  console.log(`[api-health-sweep] InboxItems created: ${inboxCreated}`)

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('[api-health-sweep] FATAL', err)
  try {
    await prisma.$disconnect()
  } catch {}
  process.exit(1)
})
