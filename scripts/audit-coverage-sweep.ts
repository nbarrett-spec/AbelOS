/**
 * Audit-coverage sweep across all API routes.
 *
 * For each route.ts file:
 *   - Find which HTTP verbs are exported (GET/POST/PUT/PATCH/DELETE)
 *   - Determine if it's state-changing (POST/PUT/PATCH/DELETE)
 *   - Check whether the file calls audit(...) or auditBuilder(...) or logAudit(...)
 *   - Categorize by risk based on path tokens
 *
 * Output: a markdown report with:
 *   - Total routes, state-changing count, audited count, coverage %
 *   - List of HIGH-risk routes missing audit
 *   - List of MED-risk routes missing audit
 *   - List of LOW-risk routes missing audit
 *   - Summary by /api/<top-level-folder>
 *
 * Usage:
 *   npx tsx scripts/audit-coverage-sweep.ts > AUDIT-COVERAGE-REPORT.md
 */
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '..')
const API_ROOT = path.join(ROOT, 'src', 'app', 'api')

const STATE_VERBS = ['POST', 'PUT', 'PATCH', 'DELETE']

// Risk classification by path keyword. Higher specificity wins.
function classifyRisk(p: string): 'CRITICAL' | 'HIGH' | 'MED' | 'LOW' {
  const x = p.toLowerCase()
  // Critical: anything that touches money, auth, identity, or destructive ops
  if (/\b(payment|invoice|refund|writeoff|payroll|payout|charge|stripe|qb|qbwc|quickbooks|credit|tax)/.test(x)) return 'CRITICAL'
  if (/\b(auth|login|logout|session|password|token|reset|magic|2fa|otp|invite|impersonate)/.test(x)) return 'CRITICAL'
  if (/\b(staff|user|role|permission|admin)/.test(x) && !/dashboard|stats|metrics/.test(x)) return 'CRITICAL'
  if (/\bdelete\b|\bvoid\b|\bremove\b|\bpurge\b|\bdestroy\b/.test(x)) return 'CRITICAL'

  // High: orders, POs, inventory, pricing, quotes, jobs, builders
  if (/\b(order|purchase-order|po|quote|invoice|builder|customer|vendor)/.test(x)) return 'HIGH'
  if (/\b(price|pricing|product|inventory|allocation|reservation)/.test(x)) return 'HIGH'
  if (/\b(job|delivery|driver|install|schedule|dispatch)/.test(x)) return 'HIGH'
  if (/\b(integration|sync|webhook|cron)/.test(x)) return 'HIGH'

  // Med: dashboards, reports, automations, agent actions
  if (/\b(automation|agent|task|inbox|notification|email|sms|outreach)/.test(x)) return 'MED'
  if (/\b(report|export|dashboard)/.test(x)) return 'MED'

  return 'LOW'
}

interface RouteInfo {
  filePath: string
  apiPath: string
  verbs: string[]
  hasAudit: boolean
  hasAuditBuilder: boolean
  hasLogAudit: boolean
  hasCronWrapper: boolean
  hasAgentHubShim: boolean
  hasGenericShim: boolean
  isStateChanging: boolean
  risk: 'CRITICAL' | 'HIGH' | 'MED' | 'LOW'
  topFolder: string
}

function walk(dir: string, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) return files
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) walk(full, files)
    else if (name === 'route.ts' || name === 'route.tsx') files.push(full)
  }
  return files
}

function analyzeRoute(filePath: string): RouteInfo {
  const content = fs.readFileSync(filePath, 'utf8')

  // Find exported verbs
  const verbs: string[] = []
  for (const v of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    const re = new RegExp(`export\\s+(async\\s+function\\s+${v}|const\\s+${v}\\s*=)`, 'm')
    if (re.test(content)) verbs.push(v)
  }

  const hasAudit = /\baudit\s*\(/.test(content) && /from\s+['"]@\/lib\/audit['"]/.test(content)
  const hasAuditBuilder = /\bauditBuilder\s*\(/.test(content)
  const hasLogAudit = /\blogAudit\s*\(/.test(content)
  // withCronRun / startCronRun / finishCronRun (in src/lib/cron.ts) auto-write
  // an AuditLog row on every cron start + finish, so a route that uses any of
  // them is implicitly audited.
  const hasCronWrapper = /\b(withCronRun|startCronRun|finishCronRun)\s*\(/.test(content) &&
    /from\s+['"]@\/lib\/cron['"]/.test(content)
  // withAgentHubAudit (in src/lib/agent-hub/audit-shim.ts) wraps the handler
  // and writes an AuditLog row on every state-changing call.
  const hasAgentHubShim = /\bwithAgentHubAudit\s*\(/.test(content) &&
    /from\s+['"]@\/lib\/agent-hub\/audit-shim['"]/.test(content)
  // withAudit (in src/lib/audit-route.ts) — generic version of the shim.
  const hasGenericShim = /\bwithAudit\s*\(/.test(content) &&
    /from\s+['"]@\/lib\/audit-route['"]/.test(content)
  const auditPresent = hasAudit || hasAuditBuilder || hasLogAudit || hasCronWrapper || hasAgentHubShim || hasGenericShim

  // Compute the API path
  const rel = path.relative(API_ROOT, filePath).replace(/\\/g, '/').replace(/\/route\.tsx?$/, '')
  const apiPath = '/api/' + rel
  const topFolder = rel.split('/')[0] || ''

  return {
    filePath,
    apiPath,
    verbs,
    hasAudit,
    hasAuditBuilder,
    hasLogAudit,
    hasCronWrapper,
    hasAgentHubShim,
    hasGenericShim,
    isStateChanging: verbs.some(v => STATE_VERBS.includes(v)),
    risk: classifyRisk(apiPath),
    topFolder,
  }
}

function main() {
  const files = walk(API_ROOT)
  const routes = files.map(analyzeRoute)
  const stateChanging = routes.filter(r => r.isStateChanging)
  const audited = stateChanging.filter(r => r.hasAudit || r.hasAuditBuilder || r.hasLogAudit || r.hasCronWrapper || r.hasAgentHubShim || r.hasGenericShim)
  const missing = stateChanging.filter(r => !r.hasAudit && !r.hasAuditBuilder && !r.hasLogAudit && !r.hasCronWrapper && !r.hasAgentHubShim && !r.hasGenericShim)

  const byRisk = (level: string) => missing.filter(r => r.risk === level)

  const out: string[] = []
  const push = (s: string = '') => out.push(s)

  push(`# Audit Coverage Sweep — ${new Date().toISOString().slice(0, 10)}`)
  push()
  push(`## Summary`)
  push()
  push(`| Metric | Count |`)
  push(`|---|---:|`)
  push(`| Total route.ts files | **${routes.length}** |`)
  push(`| Routes with state-changing verbs | **${stateChanging.length}** |`)
  push(`| State-changing routes WITH audit() | **${audited.length}** |`)
  push(`| State-changing routes MISSING audit() | **${missing.length}** |`)
  push(`| **Coverage** | **${((audited.length / Math.max(stateChanging.length, 1)) * 100).toFixed(1)}%** |`)
  push()
  push(`## Gap by risk tier`)
  push()
  push(`| Risk | Missing | Why it matters |`)
  push(`|---|---:|---|`)
  push(`| 🔴 CRITICAL | **${byRisk('CRITICAL').length}** | Money, auth, identity, deletion — SOC/legal/insurance demand these |`)
  push(`| 🟠 HIGH | **${byRisk('HIGH').length}** | Orders/POs/jobs/integrations — ops daily-truth |`)
  push(`| 🟡 MED | **${byRisk('MED').length}** | Automations, dashboards, agents |`)
  push(`| ⚪ LOW | **${byRisk('LOW').length}** | Misc — internal tooling |`)
  push()

  push(`## Coverage by top-level folder`)
  push()
  push(`| /api/<folder> | total state-changing | audited | missing | coverage |`)
  push(`|---|---:|---:|---:|---:|`)
  const folders = new Set(stateChanging.map(r => r.topFolder))
  for (const f of [...folders].sort()) {
    const inFolder = stateChanging.filter(r => r.topFolder === f)
    const aud = inFolder.filter(r => r.hasAudit || r.hasAuditBuilder || r.hasLogAudit || r.hasCronWrapper || r.hasAgentHubShim || r.hasGenericShim).length
    const tot = inFolder.length
    const pct = ((aud / tot) * 100).toFixed(0) + '%'
    const marker = aud === tot ? '✅' : aud === 0 ? '🔴' : '🟡'
    push(`| ${marker} \`/${f}\` | ${tot} | ${aud} | ${tot - aud} | ${pct} |`)
  }
  push()

  for (const lvl of ['CRITICAL', 'HIGH', 'MED', 'LOW'] as const) {
    const list = byRisk(lvl)
    if (list.length === 0) continue
    push(`## ${lvl} risk routes missing audit (${list.length})`)
    push()
    for (const r of list.sort((a, b) => a.apiPath.localeCompare(b.apiPath))) {
      push(`- \`${r.verbs.filter(v => STATE_VERBS.includes(v)).join(',')}\`  **${r.apiPath}**`)
    }
    push()
  }

  console.log(out.join('\n'))
}

main()
