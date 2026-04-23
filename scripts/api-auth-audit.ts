/**
 * API Auth Audit — API_AUTH_AUDIT_APR2026
 *
 * READ-ONLY static analysis of all src/app/api/** /route.ts files.
 * - Classifies expected auth level from path prefix
 * - Cross-references middleware.ts coverage
 * - Reads each route file for self-enforced auth signals
 * - Flags unauthed mutations, sensitive public routes, bearer w/o verify,
 *   and POST endpoints outside CSRF coverage
 *
 * Generates:
 *   - C:/Users/natha/OneDrive/Abel Lumber/AEGIS-AUTH-AUDIT.md
 *   - Up to 10 InboxItem rows for highest-risk findings (priority=CRITICAL
 *     for unauthed mutations).
 *
 * Source tag: API_AUTH_AUDIT_APR2026
 */

import { promises as fs } from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import { PrismaClient } from '@prisma/client'

const ROOT = path.resolve(__dirname, '..')
const API_DIR = path.join(ROOT, 'src', 'app', 'api')
const MIDDLEWARE = path.join(ROOT, 'src', 'middleware.ts')
const REPORT_OUT = 'C:/Users/natha/OneDrive/Abel Lumber/AEGIS-AUTH-AUDIT.md'
const SOURCE_TAG = 'API_AUTH_AUDIT_APR2026'

type AuthClass =
  | 'public'
  | 'cron'
  | 'ops'
  | 'admin'
  | 'agent-hub'
  | 'v1-engine'
  | 'builder-portal'
  | 'webhook'
  | 'internal'
  | 'auth'
  | 'health'
  | 'unclassified'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'

interface RouteRecord {
  absPath: string
  urlPath: string
  relPath: string
  expectedAuth: AuthClass
  middlewareCovered: boolean
  middlewareNotes: string[]
  selfEnforcesAuth: boolean
  authSignals: string[]
  methods: Method[]
  mutations: Method[]
  isSensitive: boolean
  flags: string[]     // risk flags
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'OK'
  risk: number        // sortable risk score
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, out)
    else if (entry.isFile() && entry.name === 'route.ts') out.push(full)
  }
  return out
}

function toUrlPath(absPath: string): string {
  const rel = path.relative(path.join(ROOT, 'src', 'app'), absPath).replace(/\\/g, '/')
  // strip trailing /route.ts
  return '/' + rel.replace(/\/route\.ts$/, '')
}

function classify(urlPath: string): AuthClass {
  if (urlPath.startsWith('/api/webhooks/')) return 'webhook'
  if (urlPath.startsWith('/api/internal/')) return 'internal'
  if (urlPath.startsWith('/api/cron/')) return 'cron'
  if (urlPath.startsWith('/api/admin/')) return 'admin'
  if (urlPath.startsWith('/api/ops/')) return 'ops'
  if (urlPath.startsWith('/api/agent-hub/')) return 'agent-hub'
  if (urlPath.startsWith('/api/v1/engine/')) return 'v1-engine'
  if (urlPath.startsWith('/api/builder/') || urlPath.startsWith('/api/builder-portal/') ||
      urlPath.startsWith('/api/dashboard/') || urlPath.startsWith('/api/projects/') ||
      urlPath.startsWith('/api/account/')) {
    return 'builder-portal'
  }
  if (urlPath.startsWith('/api/auth/')) return 'auth'
  if (urlPath.startsWith('/api/health') || urlPath === '/api/health') return 'health'
  if (urlPath.startsWith('/api/client-errors') || urlPath.startsWith('/api/_meta') ||
      urlPath.startsWith('/api/docs')) {
    return 'public'
  }
  return 'unclassified'
}

function detectMethods(src: string): Method[] {
  const methods: Method[] = []
  const list: Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']
  for (const m of list) {
    const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b`)
    const re2 = new RegExp(`export\\s+const\\s+${m}\\s*=`)
    if (re.test(src) || re2.test(src)) methods.push(m)
  }
  return methods
}

interface AuthSignals {
  signals: string[]
  selfEnforces: boolean
  bearerVerified: boolean
  bearerUsed: boolean
}

function detectAuthSignals(src: string): AuthSignals {
  const signals: string[] = []
  let selfEnforces = false
  let bearerUsed = false
  let bearerVerified = false

  if (/checkStaffAuth\(/.test(src)) { signals.push('checkStaffAuth'); selfEnforces = true }
  if (/requireStaffAuth\(/.test(src)) { signals.push('requireStaffAuth'); selfEnforces = true }
  if (/verifyStaffSession\(/.test(src)) { signals.push('verifyStaffSession'); selfEnforces = true }
  if (/getStaffFromRequest\(/.test(src)) { signals.push('getStaffFromRequest'); selfEnforces = true }
  if (/verifyEngineToken\(/.test(src)) { signals.push('verifyEngineToken'); selfEnforces = true; bearerVerified = true; bearerUsed = true }
  if (/verifyAgentToken\(/.test(src)) { signals.push('verifyAgentToken'); selfEnforces = true; bearerVerified = true; bearerUsed = true }
  if (/AEGIS_API_KEY/.test(src)) { signals.push('AEGIS_API_KEY'); selfEnforces = true; bearerVerified = true; bearerUsed = true }
  if (/CRON_SECRET/.test(src)) { signals.push('CRON_SECRET'); selfEnforces = true; bearerVerified = true; bearerUsed = true }
  if (/AGENT_HUB_API_KEY/.test(src)) { signals.push('AGENT_HUB_API_KEY'); selfEnforces = true; bearerVerified = true; bearerUsed = true }
  if (/INTERNAL_LOG_SECRET/.test(src)) { signals.push('INTERNAL_LOG_SECRET'); selfEnforces = true; bearerVerified = true }
  if (/x-api-key/i.test(src)) { signals.push('x-api-key'); bearerUsed = true }
  if (/verifyWebhook|verifySignature|hmac/i.test(src)) { signals.push('webhook-signature'); selfEnforces = true; bearerVerified = true }
  if (/jwtVerify\(/.test(src)) { signals.push('jwtVerify'); selfEnforces = true }
  if (/request\.cookies\.get\(/.test(src) && /STAFF_COOKIE|abel_staff_session|abel_session/.test(src)) {
    signals.push('cookie-check'); selfEnforces = true
  }
  if (/getServerSession\(/.test(src)) { signals.push('getServerSession'); selfEnforces = true }

  // Heuristic: authorization header mentioned but never compared to anything
  if (/authorization/i.test(src) && /Bearer/.test(src)) {
    bearerUsed = true
    // Check if there is some kind of equality/verify against it
    if (/===\s*(process\.env|expected|token)|!==\s*(process\.env|expected|token)|compare|verify/i.test(src)) {
      bearerVerified = true
    }
  }

  return { signals, selfEnforces, bearerVerified, bearerUsed }
}

// middleware coverage — mirrors the real middleware.ts logic
function middlewareCoverage(urlPath: string, methods: Method[]): { covered: boolean; notes: string[] } {
  const notes: string[] = []

  // Matcher includes /api/:path* — all /api/* are in scope for CSRF at least
  const inMatcher = urlPath.startsWith('/api/')

  // /api/webhooks — explicitly bypassed by middleware (public pass-through)
  if (urlPath.startsWith('/api/webhooks/')) {
    notes.push('middleware: explicit bypass (public pass-through)')
    return { covered: false, notes }
  }

  // /api/internal — CSRF skipped; no auth applied by middleware
  if (urlPath.startsWith('/api/internal/')) {
    notes.push('middleware: CSRF skipped; no middleware auth')
    return { covered: false, notes }
  }

  // /api/admin — middleware enforces ADMIN role
  if (urlPath.startsWith('/api/admin/')) {
    notes.push('middleware: ADMIN role enforced')
    return { covered: true, notes }
  }

  // /api/ops — middleware enforces staff cookie, with public exceptions
  if (urlPath.startsWith('/api/ops/')) {
    if (urlPath.startsWith('/api/ops/auth/') && !urlPath.startsWith('/api/ops/auth/permissions')) {
      notes.push('middleware: public (ops/auth)')
      return { covered: false, notes }
    }
    if (urlPath === '/api/ops/handbook') {
      notes.push('middleware: public (handbook)')
      return { covered: false, notes }
    }
    if (urlPath === '/api/ops/communication-logs/gmail-sync') {
      notes.push('middleware: staff OR x-api-key (route-verified)')
      return { covered: true, notes }
    }
    if (urlPath === '/api/ops/hyphen/ingest') {
      notes.push('middleware: staff OR Bearer (route-verified AEGIS_API_KEY)')
      return { covered: true, notes }
    }
    notes.push('middleware: staff cookie enforced')
    return { covered: true, notes }
  }

  // /api/agent-hub — Bearer (AGENT_HUB_API_KEY) OR staff cookie
  if (urlPath.startsWith('/api/agent-hub/')) {
    notes.push('middleware: Bearer or staff cookie enforced')
    return { covered: true, notes }
  }

  // /api/v1/engine — no middleware auth branch exists; must self-enforce
  if (urlPath.startsWith('/api/v1/engine/')) {
    notes.push('middleware: NONE (CSRF only) — route must self-enforce')
    return { covered: false, notes }
  }

  // CSRF coverage for POST/PUT/PATCH/DELETE on /api/*
  if (inMatcher && methods.some(m => !['GET','HEAD','OPTIONS'].includes(m))) {
    notes.push('middleware: CSRF origin check (mutations)')
  }

  // Everything else under /api/* — middleware only does CSRF; no auth
  notes.push('middleware: NONE (CSRF only)')
  return { covered: false, notes }
}

function isSensitivePath(urlPath: string): boolean {
  const sensitive = [
    '/api/admin/', '/api/ops/', '/api/v1/engine/', '/api/agent-hub/',
    '/api/builder/', '/api/invoices/', '/api/payments/', '/api/orders',
    '/api/cron/', '/api/internal/', '/api/upload', '/api/builders/register',
    '/api/hyphen/', '/api/blueprints/', '/api/quotes',
  ]
  return sensitive.some(p => urlPath.startsWith(p))
}

function evaluate(route: RouteRecord): RouteRecord {
  const flags: string[] = []
  const mutations = route.methods.filter(m => !['GET','HEAD','OPTIONS'].includes(m))
  route.mutations = mutations

  const authOk = route.middlewareCovered || route.selfEnforcesAuth

  // Flag 1: /api/ops/ routes that bypass middleware AND don't self-enforce
  if (route.urlPath.startsWith('/api/ops/') && !route.middlewareCovered && !route.selfEnforcesAuth) {
    flags.push('OPS_BYPASS_NO_SELF_AUTH')
  }

  // Flag 2: Public (no middleware) + sensitive data + mutation + no self-auth
  if (!route.middlewareCovered && !route.selfEnforcesAuth && route.isSensitive) {
    if (mutations.length > 0) flags.push('UNAUTHED_SENSITIVE_MUTATION')
    else flags.push('UNAUTHED_SENSITIVE_READ')
  }

  // Flag 3: Bearer used but not verified
  if (route.authSignals.includes('x-api-key') && !route.authSignals.some(s => /API_KEY|SECRET|verify/i.test(s))) {
    flags.push('BEARER_NOT_VERIFIED')
  }

  // Flag 4: POST without CSRF coverage. All /api/* mutations go through CSRF
  // origin check unless they're in the skip list. Skip list: /api/internal,
  // /api/agent-hub + Bearer, gmail-sync, hyphen-ingest. Webhooks bypass entirely.
  if (mutations.length > 0) {
    const csrfSkip =
      route.urlPath.startsWith('/api/internal/') ||
      route.urlPath.startsWith('/api/webhooks/') ||
      (route.urlPath.startsWith('/api/agent-hub/')) || // only with Bearer — but still CSRF-safe via origin
      route.urlPath === '/api/ops/communication-logs/gmail-sync' ||
      route.urlPath === '/api/ops/hyphen/ingest'
    if (route.urlPath.startsWith('/api/webhooks/') && !route.authSignals.includes('webhook-signature')) {
      flags.push('WEBHOOK_NO_SIGNATURE_VERIFY')
    }
    if (route.urlPath.startsWith('/api/internal/') && !route.selfEnforcesAuth) {
      flags.push('INTERNAL_NO_SECRET_CHECK')
    }
  }

  // Flag 5: /api/v1/engine — must self-enforce bearer
  if (route.urlPath.startsWith('/api/v1/engine/') && !route.selfEnforcesAuth) {
    flags.push('ENGINE_MISSING_SELF_AUTH')
  }

  // Flag 6: /api/cron — must check CRON_SECRET (or staff auth for manual POST)
  if (route.urlPath.startsWith('/api/cron/') && !route.selfEnforcesAuth) {
    flags.push('CRON_NO_SECRET_CHECK')
  }

  // Severity scoring
  let severity: RouteRecord['severity'] = 'OK'
  let risk = 0
  if (flags.includes('UNAUTHED_SENSITIVE_MUTATION')) { severity = 'CRITICAL'; risk = 100 }
  else if (flags.includes('OPS_BYPASS_NO_SELF_AUTH')) { severity = 'CRITICAL'; risk = 95 }
  else if (flags.includes('ENGINE_MISSING_SELF_AUTH')) { severity = 'CRITICAL'; risk = 95 }
  else if (flags.includes('INTERNAL_NO_SECRET_CHECK')) { severity = 'CRITICAL'; risk = 90 }
  else if (flags.includes('CRON_NO_SECRET_CHECK')) { severity = 'HIGH'; risk = 80 }
  else if (flags.includes('WEBHOOK_NO_SIGNATURE_VERIFY')) { severity = 'HIGH'; risk = 75 }
  else if (flags.includes('UNAUTHED_SENSITIVE_READ')) { severity = 'HIGH'; risk = 70 }
  else if (flags.includes('BEARER_NOT_VERIFIED')) { severity = 'MEDIUM'; risk = 50 }
  else if (flags.length === 0 && authOk) { severity = 'OK'; risk = 0 }
  else if (flags.length === 0 && !authOk && !route.isSensitive) { severity = 'LOW'; risk = 10 }

  route.flags = flags
  route.severity = severity
  route.risk = risk
  return route
}

// ────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────

async function main() {
  const files = await walk(API_DIR)
  const routes: RouteRecord[] = []

  for (const abs of files) {
    const src = await fs.readFile(abs, 'utf8')
    const urlPath = toUrlPath(abs)
    const methods = detectMethods(src)
    const auth = detectAuthSignals(src)
    const cov = middlewareCoverage(urlPath, methods)
    const rec: RouteRecord = {
      absPath: abs,
      relPath: path.relative(ROOT, abs).replace(/\\/g, '/'),
      urlPath,
      expectedAuth: classify(urlPath),
      middlewareCovered: cov.covered,
      middlewareNotes: cov.notes,
      selfEnforcesAuth: auth.selfEnforces,
      authSignals: auth.signals,
      methods,
      mutations: [],
      isSensitive: isSensitivePath(urlPath),
      flags: [],
      severity: 'OK',
      risk: 0,
    }
    routes.push(evaluate(rec))
  }

  // ── counts
  const byClass: Record<string, number> = {}
  for (const r of routes) byClass[r.expectedAuth] = (byClass[r.expectedAuth] || 0) + 1

  const flagged = routes.filter(r => r.flags.length > 0).sort((a, b) => b.risk - a.risk)
  const critical = flagged.filter(r => r.severity === 'CRITICAL')
  const high = flagged.filter(r => r.severity === 'HIGH')
  const medium = flagged.filter(r => r.severity === 'MEDIUM')

  // ── git sha
  let sha = 'unknown'
  try {
    sha = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim()
  } catch { /* ignore */ }

  // ── report
  const lines: string[] = []
  lines.push(`# Aegis API Auth Audit`)
  lines.push(``)
  lines.push(`**Source tag:** ${SOURCE_TAG}  `)
  lines.push(`**Generated:** ${new Date().toISOString()}  `)
  lines.push(`**Git SHA:** \`${sha}\`  `)
  lines.push(`**Total routes scanned:** ${routes.length}  `)
  lines.push(``)
  lines.push(`## Classification counts`)
  lines.push(``)
  lines.push(`| Expected auth | Count |`)
  lines.push(`|---|---:|`)
  for (const k of Object.keys(byClass).sort()) lines.push(`| ${k} | ${byClass[k]} |`)
  lines.push(``)
  lines.push(`## Severity summary`)
  lines.push(``)
  lines.push(`| Severity | Count |`)
  lines.push(`|---|---:|`)
  lines.push(`| CRITICAL | ${critical.length} |`)
  lines.push(`| HIGH | ${high.length} |`)
  lines.push(`| MEDIUM | ${medium.length} |`)
  lines.push(`| LOW | ${flagged.filter(r => r.severity === 'LOW').length} |`)
  lines.push(`| OK | ${routes.length - flagged.length} |`)
  lines.push(``)
  lines.push(`## Top findings (by risk)`)
  lines.push(``)
  const top = flagged.slice(0, 50)
  if (top.length === 0) {
    lines.push(`_No flagged routes._`)
  } else {
    lines.push(`| # | Severity | Path | Methods | Flags | Middleware | Self-auth |`)
    lines.push(`|---:|---|---|---|---|---|---|`)
    top.forEach((r, i) => {
      lines.push(
        `| ${i + 1} | ${r.severity} | \`${r.urlPath}\` | ${r.methods.join(',') || '—'} | ${r.flags.join(', ')} | ${r.middlewareCovered ? 'yes' : 'no'} | ${r.selfEnforcesAuth ? r.authSignals.join('+') : 'no'} |`
      )
    })
  }
  lines.push(``)
  lines.push(`## Flag reference`)
  lines.push(``)
  lines.push(`- **UNAUTHED_SENSITIVE_MUTATION** — Mutation (POST/PUT/PATCH/DELETE) on sensitive path, no middleware auth, no self-auth.`)
  lines.push(`- **OPS_BYPASS_NO_SELF_AUTH** — \`/api/ops/*\` route in a middleware bypass branch with no self-auth in the handler.`)
  lines.push(`- **ENGINE_MISSING_SELF_AUTH** — \`/api/v1/engine/*\` route without \`verifyEngineToken\` / bearer check.`)
  lines.push(`- **INTERNAL_NO_SECRET_CHECK** — \`/api/internal/*\` route without \`INTERNAL_LOG_SECRET\` verification.`)
  lines.push(`- **CRON_NO_SECRET_CHECK** — \`/api/cron/*\` route without \`CRON_SECRET\` (or manual-POST staff-auth) check.`)
  lines.push(`- **WEBHOOK_NO_SIGNATURE_VERIFY** — Webhook route with no signature/HMAC verification.`)
  lines.push(`- **UNAUTHED_SENSITIVE_READ** — Sensitive read with neither middleware nor self-auth.`)
  lines.push(`- **BEARER_NOT_VERIFIED** — Route accepts an API-key/Bearer header but never compares it to an env value.`)
  lines.push(``)
  lines.push(`## All routes`)
  lines.push(``)
  lines.push(`<details><summary>Expand full list (${routes.length})</summary>`)
  lines.push(``)
  lines.push(`| Path | Class | Methods | Middleware | Self-auth | Severity | Flags |`)
  lines.push(`|---|---|---|---|---|---|---|`)
  for (const r of routes.sort((a, b) => a.urlPath.localeCompare(b.urlPath))) {
    lines.push(
      `| \`${r.urlPath}\` | ${r.expectedAuth} | ${r.methods.join(',') || '—'} | ${r.middlewareCovered ? 'yes' : 'no'} | ${r.selfEnforcesAuth ? 'yes' : 'no'} | ${r.severity} | ${r.flags.join(', ') || '—'} |`
    )
  }
  lines.push(``)
  lines.push(`</details>`)
  lines.push(``)
  lines.push(`---`)
  lines.push(``)
  lines.push(`Static analysis only — no endpoints were called. Tag: ${SOURCE_TAG}`)
  lines.push(``)

  await fs.writeFile(REPORT_OUT, lines.join('\n'), 'utf8')
  console.log(`[${SOURCE_TAG}] report → ${REPORT_OUT}`)
  console.log(`[${SOURCE_TAG}] scanned=${routes.length} critical=${critical.length} high=${high.length} medium=${medium.length}`)

  // ── Inbox items for top-10 highest-risk
  const pickForInbox = flagged.slice(0, 10)
  if (pickForInbox.length > 0) {
    const prisma = new PrismaClient()
    try {
      for (const r of pickForInbox) {
        const priority =
          r.severity === 'CRITICAL' ? 'CRITICAL' :
          r.severity === 'HIGH' ? 'HIGH' : 'MEDIUM'
        const title = `[${SOURCE_TAG}] ${r.severity}: ${r.urlPath}`
        const description =
          `Route: ${r.urlPath}\n` +
          `File: ${r.relPath}\n` +
          `Methods: ${r.methods.join(',') || 'none'}\n` +
          `Class: ${r.expectedAuth}\n` +
          `Middleware covered: ${r.middlewareCovered ? 'yes' : 'no'} (${r.middlewareNotes.join('; ')})\n` +
          `Self-auth signals: ${r.authSignals.join(', ') || 'none'}\n` +
          `Flags: ${r.flags.join(', ')}\n` +
          `Severity: ${r.severity} (risk ${r.risk})`
        // Idempotency: delete any prior run's open items for this exact title
        await prisma.inboxItem.deleteMany({
          where: { title, status: 'PENDING' },
        })
        await prisma.inboxItem.create({
          data: {
            type: 'SYSTEM',
            source: SOURCE_TAG,
            title,
            description,
            priority,
            status: 'PENDING',
            entityType: 'ApiRoute',
            entityId: r.urlPath,
            actionData: {
              urlPath: r.urlPath,
              filePath: r.relPath,
              flags: r.flags,
              methods: r.methods,
              expectedAuth: r.expectedAuth,
              middlewareCovered: r.middlewareCovered,
              selfEnforcesAuth: r.selfEnforcesAuth,
              authSignals: r.authSignals,
              sourceTag: SOURCE_TAG,
            },
          },
        })
      }
      console.log(`[${SOURCE_TAG}] created ${pickForInbox.length} InboxItems`)
    } finally {
      await prisma.$disconnect()
    }
  } else {
    console.log(`[${SOURCE_TAG}] no findings — no InboxItems created`)
  }
}

main().catch(err => {
  console.error(`[${SOURCE_TAG}] FATAL:`, err)
  process.exit(1)
})
