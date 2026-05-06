/**
 * Webhook hardening sweep.
 *
 * Inventories every webhook-shaped route and grades it on six dimensions:
 *
 *   1. Signature verification        — verifyHmacSignature / verifyBearerToken
 *                                       / verifyGooglePubSubToken / verifySvix*
 *                                       (or per-provider equivalent)
 *   2. Timing-safe comparison        — crypto.timingSafeEqual is reachable from
 *                                       the verification path (strong proxy)
 *   3. Raw body read before parse    — request.text() or req.text() called
 *                                       before JSON.parse — required for HMAC
 *   4. Idempotency check             — ensureIdempotent() called, or
 *                                       provider-specific dedup
 *   5. Payload persisted for replay  — payload passed to ensureIdempotent or
 *                                       written to a dead-letter table
 *   6. Audit logging                 — logAudit / audit / auditBuilder /
 *                                       withAudit / withAgentHubAudit
 *
 * Each route gets a score X/6 and a grade. Coverage is reported by route +
 * by dimension so we can see "every webhook signs, but only 6/8 persist".
 *
 * Run with:
 *   npx tsx scripts/webhook-hardening-sweep.ts > WEBHOOK-HARDENING-REPORT.md
 */

import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '..')
const API_ROOT = path.join(ROOT, 'src', 'app', 'api')

// Webhook-shaped routes — anything inbound from a third party. We scan all
// of /api/ and pick out the ones that look like webhooks (path segment
// `webhook` or `webhooks`, or known integration ingress like /agent/email).
const KNOWN_WEBHOOK_PATHS = new Set([
  '/api/agent/email',  // SendGrid / Mailgun
  '/api/agent/sms',    // Twilio (currently stubbed)
  '/api/hyphen/orders', // SPConnect inbound
])

// Admin routes that *manage* webhook records but aren't themselves inbound
// receivers. The sweep was originally flagging these as F because they don't
// sign — which is correct, they shouldn't, they're operator UIs.
const NOT_A_RECEIVER = new Set([
  '/api/admin/webhooks',
  '/api/admin/webhooks/[id]',
])

function isWebhookRoute(apiPath: string): boolean {
  if (NOT_A_RECEIVER.has(apiPath)) return false
  if (KNOWN_WEBHOOK_PATHS.has(apiPath)) return true
  return /\/webhooks?(\/|$)/.test(apiPath)
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

interface Score {
  apiPath: string
  filePath: string
  isStub: boolean
  signature: boolean
  timingSafe: boolean
  rawBodyFirst: boolean
  idempotent: boolean
  payloadPersisted: boolean
  audited: boolean
  notes: string[]
}

function analyze(filePath: string): Score | null {
  const content = fs.readFileSync(filePath, 'utf8')
  const rel = path.relative(API_ROOT, filePath).replace(/\\/g, '/').replace(/\/route\.tsx?$/, '')
  const apiPath = '/api/' + rel
  if (!isWebhookRoute(apiPath)) return null

  const notes: string[] = []

  // ── (1) Signature verification ─────────────────────────────────────────
  const sigPatterns = [
    /\bverifyHmacSignature\s*\(/,
    /\bverifyBearerToken\s*\(/,
    /\bverifyGooglePubSubToken\s*\(/,
    /\bverifyWebhookSignature\s*\(/, // stripe + buildertrend
    /\bverifySvixSignature\s*\(/,
    // Hyphen SPConnect uses OAuth Bearer with rotating tokens; validateHyphenRequest
    // does timing-safe credential lookup against IntegrationConfig.
    /\bauthenticateHyphenRequest\s*\(/,
    // Brain webhook uses static Bearer token + env compare. Recognized but
    // weaker than HMAC — flagged in notes.
    /\bvalidateBrainAuth\s*\(/,
  ]
  const signature = sigPatterns.some((p) => p.test(content))
  if (/\bvalidateBrainAuth\s*\(/.test(content)) {
    notes.push('uses static Bearer token via env compare — adequate for internal NUC traffic; not HMAC')
  }

  // ── (2) Timing-safe comparison reachable ───────────────────────────────
  // Either (a) calls one of the lib helpers (timing-safe inside) or
  //        (b) imports timingSafeEqual directly, or
  //        (c) authenticateHyphenRequest (does timing-safe credential lookup).
  const libCalled =
    /from\s+['"]@\/lib\/webhook['"]/.test(content) ||
    /from\s+['"]@\/lib\/stripe['"]/.test(content)
  const directTimingSafe = /timingSafeEqual/.test(content)
  const hyphenAuthCalled = /\bauthenticateHyphenRequest\s*\(/.test(content) &&
    /from\s+['"]@\/lib\/hyphen\/auth['"]/.test(content)
  const timingSafe = libCalled || directTimingSafe || hyphenAuthCalled

  // ── (3) Raw body read BEFORE JSON.parse ────────────────────────────────
  // Find the index of the first .text() call vs the first JSON.parse().
  const textIdx = content.search(/\brequest\.text\s*\(\s*\)|\breq\.text\s*\(\s*\)/)
  const parseIdx = content.search(/\bJSON\.parse\s*\(/)
  const reqJsonIdx = content.search(/\brequest\.json\s*\(\s*\)|\breq\.json\s*\(\s*\)/)

  // Auth schemes that DON'T sign over the body — Bearer/JWT/OAuth-Bearer —
  // can safely use request.json() since there's no HMAC to verify against
  // raw bytes. Treat raw-body-first as N/A for those.
  const usesBodySig =
    /\bverifyHmacSignature\s*\(/.test(content) ||
    /\bverifyWebhookSignature\s*\(/.test(content) ||
    /\bverifySvixSignature\s*\(/.test(content)

  let rawBodyFirst = false
  if (textIdx > -1 && (parseIdx === -1 || textIdx < parseIdx)) {
    rawBodyFirst = true
  } else if (!usesBodySig) {
    // Bearer/JWT routes: raw-body-first doesn't apply.
    rawBodyFirst = true
    if (signature && reqJsonIdx > -1) {
      notes.push('Bearer/JWT auth — body signing not required; request.json() is fine')
    }
  } else if (textIdx === -1 && reqJsonIdx > -1 && usesBodySig) {
    rawBodyFirst = false
    notes.push('HMAC signature claimed but body parsed via request.json() — signature over reformatted JSON is unreliable')
  }

  // ── (4) Idempotency ────────────────────────────────────────────────────
  const idemViaLib = /\bensureIdempotent\s*\(/.test(content)
  const idemViaApp =
    /WHERE.*=\s*\$1\s+AND\s+status\s*=\s*'PENDING'/.test(content) ||
    /ON CONFLICT.*DO NOTHING/.test(content) ||
    /duplicatesSkipped/.test(content)
  const idempotent = idemViaLib || idemViaApp
  if (idempotent && !idemViaLib) {
    notes.push('uses app-level dedup, not ensureIdempotent — works but bypasses retry/DLQ machinery')
  }

  // ── (5) Payload persisted for replay ───────────────────────────────────
  const payloadPersisted =
    // ensureIdempotent(provider, eventId, eventType, payload) — 4 args
    /ensureIdempotent\s*\([^)]*?,\s*[^)]*?,\s*[^)]*?,\s*[^)]+\)/.test(content) ||
    // Explicit DLQ / event-store table writes
    /WebhookDeadLetter|HyphenOrderEvent|WebhookIngest|AgentEmailLog/.test(content) ||
    // Brain webhook persists every event into InboxItem with full payload
    /INSERT INTO\s+"InboxItem"/.test(content)

  // ── (6) Audit ──────────────────────────────────────────────────────────
  const audited =
    (/\baudit\s*\(/.test(content) && /from\s+['"]@\/lib\/audit['"]/.test(content)) ||
    /\blogAudit\s*\(/.test(content) ||
    /\bauditBuilder\s*\(/.test(content) ||
    (/\bwithAudit\s*\(/.test(content) && /from\s+['"]@\/lib\/audit-route['"]/.test(content)) ||
    (/\bwithAgentHubAudit\s*\(/.test(content) && /from\s+['"]@\/lib\/agent-hub\/audit-shim['"]/.test(content))

  // Stubs don't count against the score — they're explicitly not wired.
  const isStub =
    /Not Implemented|status:\s*501|TODO\(twilio\)/.test(content) &&
    !/handleWebhook|processStripeEvent|processWebhookPayload/.test(content)

  return {
    apiPath,
    filePath: path.relative(ROOT, filePath).replace(/\\/g, '/'),
    isStub,
    signature,
    timingSafe,
    rawBodyFirst,
    idempotent,
    payloadPersisted,
    audited,
    notes,
  }
}

function scoreOf(s: Score): { score: number; grade: string } {
  if (s.isStub) return { score: -1, grade: 'STUB' }
  const dims = [s.signature, s.timingSafe, s.rawBodyFirst, s.idempotent, s.payloadPersisted, s.audited]
  const score = dims.filter(Boolean).length
  const grade =
    score === 6 ? 'A+' :
    score === 5 ? 'A' :
    score === 4 ? 'B' :
    score === 3 ? 'C' :
    score === 2 ? 'D' : 'F'
  return { score, grade }
}

function emoji(b: boolean): string { return b ? '✅' : '❌' }

function main() {
  const files = walk(API_ROOT)
  const scores: Score[] = []
  for (const f of files) {
    const s = analyze(f)
    if (s) scores.push(s)
  }
  scores.sort((a, b) => a.apiPath.localeCompare(b.apiPath))

  const out: string[] = []
  const push = (s: string = '') => out.push(s)

  push(`# Webhook Hardening Sweep — ${new Date().toISOString().slice(0, 10)}`)
  push()
  push(`Six-dimension scorecard for every inbound webhook route. Each row scores`)
  push(`on signature verification, timing-safe compare, raw-body-first parsing,`)
  push(`idempotency, payload persistence, and audit logging.`)
  push()

  // ── Summary ──
  const active = scores.filter((s) => !s.isStub)
  const totalDims = active.length * 6
  const passDims =
    active.reduce((acc, s) =>
      acc +
      [s.signature, s.timingSafe, s.rawBodyFirst, s.idempotent, s.payloadPersisted, s.audited]
        .filter(Boolean).length, 0)
  const coverage = totalDims > 0 ? ((passDims / totalDims) * 100).toFixed(1) : '0.0'

  const aPlus = active.filter((s) => scoreOf(s).grade === 'A+').length
  const aBelow = active.filter((s) => scoreOf(s).score < 6 && scoreOf(s).score >= 0).length

  push(`## Summary`)
  push()
  push(`| Metric | Count |`)
  push(`|---|---:|`)
  push(`| Webhook routes inventoried | **${scores.length}** |`)
  push(`| Active (non-stub) | **${active.length}** |`)
  push(`| Stubs / not-yet-wired | **${scores.length - active.length}** |`)
  push(`| Routes scoring A+ (6/6) | **${aPlus}** |`)
  push(`| Routes scoring < A+ | **${aBelow}** |`)
  push(`| Total dimension coverage | **${coverage}%** (${passDims}/${totalDims}) |`)
  push()

  // ── Per-dimension coverage ──
  const dimLabels: Array<[keyof Score, string]> = [
    ['signature', 'Signature verification'],
    ['timingSafe', 'Timing-safe compare'],
    ['rawBodyFirst', 'Raw body before parse'],
    ['idempotent', 'Idempotency'],
    ['payloadPersisted', 'Payload persisted for replay'],
    ['audited', 'Audit logging'],
  ]
  push(`## Coverage by dimension`)
  push()
  push(`| Dimension | Coverage |`)
  push(`|---|---:|`)
  for (const [key, label] of dimLabels) {
    const n = active.filter((s) => Boolean(s[key])).length
    const total = active.length
    const pct = total > 0 ? ((n / total) * 100).toFixed(0) : '0'
    const emoji = n === total ? '✅' : '🟡'
    push(`| ${emoji} ${label} | ${n}/${total} (${pct}%) |`)
  }
  push()

  // ── Per-route scorecard ──
  push(`## Scorecard`)
  push()
  push(`| Route | Sig | Safe | Raw1st | Idem | Persist | Audit | Score |`)
  push(`|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|`)
  for (const s of scores) {
    const { score, grade } = scoreOf(s)
    if (s.isStub) {
      push(`| \`${s.apiPath}\` | — | — | — | — | — | — | **STUB** |`)
    } else {
      push(`| \`${s.apiPath}\` | ${emoji(s.signature)} | ${emoji(s.timingSafe)} | ${emoji(s.rawBodyFirst)} | ${emoji(s.idempotent)} | ${emoji(s.payloadPersisted)} | ${emoji(s.audited)} | **${grade}** (${score}/6) |`)
    }
  }
  push()

  // ── Notes / gaps ──
  const withNotes = scores.filter((s) => s.notes.length > 0 || (!s.isStub && scoreOf(s).score < 6))
  if (withNotes.length > 0) {
    push(`## Notes & gaps`)
    push()
    for (const s of withNotes) {
      const { grade, score } = scoreOf(s)
      const missing: string[] = []
      if (!s.isStub) {
        if (!s.signature) missing.push('signature verification')
        if (!s.timingSafe) missing.push('timing-safe compare')
        if (!s.rawBodyFirst) missing.push('raw body before parse')
        if (!s.idempotent) missing.push('idempotency')
        if (!s.payloadPersisted) missing.push('payload persistence')
        if (!s.audited) missing.push('audit logging')
      }
      push(`### \`${s.apiPath}\` — ${s.isStub ? 'STUB' : `${grade} (${score}/6)`}`)
      push()
      push(`File: \`${s.filePath}\``)
      push()
      if (missing.length > 0) {
        push(`**Missing:** ${missing.join(', ')}`)
        push()
      }
      for (const n of s.notes) push(`- ${n}`)
      push()
    }
  }

  console.log(out.join('\n'))
}

main()
