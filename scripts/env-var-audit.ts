/**
 * env-var-audit.ts — READ-ONLY env var parity audit: code vs Vercel vs .env.example.
 *
 * Source tag: ENV_AUDIT_APR2026
 *
 * What it does:
 *   1. Scans src/** for every `process.env.XXX` reference, dedupes, counts files per var.
 *   2. Shells out to `vercel env ls production` and parses the var names (NEVER values).
 *   3. Parses .env.example to get the documented/expected set.
 *   4. Diffs the three sets:
 *        - MISSING: in code, not on Vercel (runtime-failure risk)
 *        - ORPHAN: on Vercel, not in code (legacy cruft)
 *        - DOC DRIFT: in .env.example, not in code
 *        - UNDOCUMENTED: in code, not in .env.example
 *   5. For each MISSING var, lists top consuming files (route / lib / script).
 *   6. Writes C:\Users\natha\OneDrive\Abel Lumber\AEGIS-ENV-AUDIT.md.
 *   7. Creates up to 5 InboxItems: 1 summary + up to 4 HIGH-priority MISSING
 *      vars referenced in more than 3 files.
 *
 * Run: npx tsx scripts/env-var-audit.ts
 *
 * Constraints:
 *   - READ-ONLY. Does not mutate env vars. Only DB writes are InboxItems.
 *   - Never prints env var VALUES — only names.
 *   - `vercel env ls` only emits names + encrypted status, so there is no
 *     code path where a plaintext secret ever enters this script's memory.
 */

import { PrismaClient } from '@prisma/client'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const REPO_ROOT = process.cwd()
const SRC_ROOT = path.join(REPO_ROOT, 'src')
const ENV_EXAMPLE_PATH = path.join(REPO_ROOT, '.env.example')
const REPORT_PATH = 'C:\\Users\\natha\\OneDrive\\Abel Lumber\\AEGIS-ENV-AUDIT.md'
const SOURCE_TAG = 'ENV_AUDIT_APR2026'
const MAX_INBOX_ITEMS = 5
const HIGH_PRIORITY_MIN_FILE_COUNT = 3 // strict > 3

const prisma = new PrismaClient()

interface CodeRef {
  name: string
  files: Set<string>
}

// ─── 1. Walk src/ and collect process.env references ──────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name.startsWith('.')) continue
      walk(full, out)
    } else if (/\.(ts|tsx|js|mjs|cjs|jsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function collectCodeEnvRefs(): Map<string, CodeRef> {
  const files = walk(SRC_ROOT)
  const refs = new Map<string, CodeRef>()
  // Match process.env.FOO and process.env['FOO'] / process.env["FOO"]
  // Identifier must start with uppercase letter and end with alphanumeric
  // (avoids catching `process.env.NEXT_PUBLIC_${flag}` as `NEXT_PUBLIC_`).
  const dotRe = /process\.env\.([A-Z][A-Z0-9_]*[A-Z0-9])/g
  const bracketRe = /process\.env\[\s*['"]([A-Z][A-Z0-9_]*[A-Z0-9])['"]\s*\]/g

  for (const file of files) {
    let content: string
    try {
      content = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const rel = path.relative(REPO_ROOT, file)
    const seenInFile = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = dotRe.exec(content))) seenInFile.add(m[1])
    while ((m = bracketRe.exec(content))) seenInFile.add(m[1])
    for (const name of seenInFile) {
      if (!refs.has(name)) refs.set(name, { name, files: new Set() })
      refs.get(name)!.files.add(rel)
    }
  }
  return refs
}

// ─── 2. Pull Vercel production env var names ──────────────────────────────

function pullVercelEnv(): { names: Set<string>; raw: string; error: string | null } {
  try {
    const raw = execSync('vercel env ls production', {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    })
    const names = new Set<string>()
    for (const line of raw.split(/\r?\n/)) {
      // Lines look like: `  NAME                Encrypted   Production     1d ago`
      const m = line.match(/^\s*([A-Z][A-Z0-9_]+)\s+Encrypted\b/)
      if (m) names.add(m[1])
    }
    return { names, raw, error: null }
  } catch (err: any) {
    return { names: new Set(), raw: '', error: err?.message || String(err) }
  }
}

// ─── 3. Parse .env.example ────────────────────────────────────────────────

function parseEnvExample(): Set<string> {
  const names = new Set<string>()
  if (!fs.existsSync(ENV_EXAMPLE_PATH)) return names
  const content = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Z][A-Z0-9_]+)\s*=/)
    if (m) names.add(m[1])
  }
  return names
}

// ─── 4. Helpers ───────────────────────────────────────────────────────────

// Built-in / framework-provided vars that should NEVER be flagged as missing
// on Vercel because Vercel / Next inject them automatically.
const BUILTIN_EXEMPT = new Set([
  'NODE_ENV',
  'VERCEL',
  'VERCEL_ENV',
  'VERCEL_URL',
  'VERCEL_REGION',
  'VERCEL_GIT_COMMIT_SHA',
  'VERCEL_GIT_COMMIT_REF',
  'VERCEL_GIT_COMMIT_MESSAGE',
  'VERCEL_GIT_REPO_SLUG',
  'VERCEL_GIT_REPO_OWNER',
  'VERCEL_GIT_PROVIDER',
  'CI',
  'PORT',
  'NEXT_RUNTIME', // injected by Next at runtime
  'npm_package_version',
])

// Vars that are consumed indirectly (prisma schema.prisma via env("..."),
// Next's build-time inlining for NEXT_PUBLIC_*, @sentry/nextjs auto-reads,
// etc.) so they MAY not appear in a process.env.* grep even though they're
// genuinely needed. Do NOT flag as orphan on Vercel.
const INDIRECT_USE_EXEMPT = new Set([
  'DATABASE_URL', // prisma schema.prisma env("DATABASE_URL")
  'DIRECT_URL', // prisma schema.prisma env("DIRECT_URL")
  'NEXT_PUBLIC_APP_NAME', // inlined at build by Next
])

function categorize(
  code: Map<string, CodeRef>,
  vercel: Set<string>,
  example: Set<string>
) {
  const codeNames = new Set(code.keys())
  const missing: string[] = []
  const orphan: string[] = []
  const docDrift: string[] = []
  const undocumented: string[] = []

  for (const n of codeNames) {
    if (BUILTIN_EXEMPT.has(n)) continue
    if (!vercel.has(n)) missing.push(n)
    if (!example.has(n)) undocumented.push(n)
  }
  for (const n of vercel) {
    if (BUILTIN_EXEMPT.has(n) || INDIRECT_USE_EXEMPT.has(n)) continue
    if (!codeNames.has(n)) orphan.push(n)
  }
  for (const n of example) {
    if (BUILTIN_EXEMPT.has(n) || INDIRECT_USE_EXEMPT.has(n)) continue
    if (!codeNames.has(n)) docDrift.push(n)
  }

  return {
    missing: missing.sort(),
    orphan: orphan.sort(),
    docDrift: docDrift.sort(),
    undocumented: undocumented.sort(),
  }
}

function routeHint(file: string): string {
  if (file.includes('app/api/')) return 'API'
  if (file.includes('/lib/')) return 'lib'
  if (file.includes('/cron')) return 'cron'
  if (file.includes('/middleware')) return 'middleware'
  return 'src'
}

// ─── 5. Report + InboxItems ───────────────────────────────────────────────

function gitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function renderReport(
  code: Map<string, CodeRef>,
  vercel: Set<string>,
  example: Set<string>,
  diff: ReturnType<typeof categorize>,
  vercelError: string | null,
  sha: string,
  startedAt: Date,
  inboxCreated: number
): string {
  const L: string[] = []
  L.push('# Aegis Env Var Audit')
  L.push('')
  L.push(`- **Source tag:** ${SOURCE_TAG}`)
  L.push(`- **Git SHA:** ${sha}`)
  L.push(`- **Started:** ${startedAt.toISOString()}`)
  L.push(`- **Vars in code (src/):** ${code.size}`)
  L.push(`- **Vars on Vercel (production):** ${vercel.size}`)
  L.push(`- **Vars in .env.example:** ${example.size}`)
  L.push(`- **MISSING (code → no Vercel):** ${diff.missing.length}`)
  L.push(`- **ORPHAN (Vercel → no code):** ${diff.orphan.length}`)
  L.push(`- **DOC DRIFT (.env.example → no code):** ${diff.docDrift.length}`)
  L.push(`- **UNDOCUMENTED (code → no .env.example):** ${diff.undocumented.length}`)
  L.push(`- **InboxItems created:** ${inboxCreated}`)
  L.push('')
  if (vercelError) {
    L.push(`> **WARNING:** \`vercel env ls production\` failed: ${vercelError}`)
    L.push('> The MISSING / ORPHAN sections below are unreliable until this is resolved.')
    L.push('')
  }
  L.push('---')
  L.push('')

  // MISSING — the critical list
  L.push('## MISSING on Vercel (code depends on them)')
  L.push('')
  L.push('These vars are referenced in code but not set on Vercel production.')
  L.push('High-risk items (> 3 consuming files) are flagged HIGH in the Inbox.')
  L.push('')
  if (diff.missing.length === 0) {
    L.push('_None. Vercel covers every var the code reads._')
  } else {
    L.push('| Var | Files | Priority | Top consumers |')
    L.push('|---|---|---|---|')
    const enriched = diff.missing
      .map((name) => {
        const ref = code.get(name)!
        return { name, count: ref.files.size, files: [...ref.files] }
      })
      .sort((a, b) => b.count - a.count)
    for (const row of enriched) {
      const pri = row.count > HIGH_PRIORITY_MIN_FILE_COUNT ? 'HIGH' : 'MEDIUM'
      const top = row.files
        .slice(0, 4)
        .map((f) => `${routeHint(f)}:${f.replace(/\\/g, '/')}`)
        .join('<br>')
      L.push(`| \`${row.name}\` | ${row.count} | ${pri} | ${top} |`)
    }
  }
  L.push('')

  // ORPHAN
  L.push('## ORPHAN on Vercel (no code references)')
  L.push('')
  L.push('These vars are set on Vercel production but no code reads them. Candidates for cleanup.')
  L.push('')
  if (diff.orphan.length === 0) {
    L.push('_None._')
  } else {
    for (const n of diff.orphan) L.push(`- \`${n}\``)
  }
  L.push('')

  // DOC DRIFT
  L.push('## DOC DRIFT — in .env.example but not in code')
  L.push('')
  L.push('Documented but unused. Remove from .env.example OR restore the feature that consumed them.')
  L.push('')
  if (diff.docDrift.length === 0) {
    L.push('_None._')
  } else {
    for (const n of diff.docDrift) L.push(`- \`${n}\``)
  }
  L.push('')

  // UNDOCUMENTED
  L.push('## UNDOCUMENTED — in code but not in .env.example')
  L.push('')
  L.push('These are being read at runtime but nobody will know to set them. Add to .env.example.')
  L.push('')
  if (diff.undocumented.length === 0) {
    L.push('_None._')
  } else {
    L.push('| Var | Files |')
    L.push('|---|---|')
    for (const n of diff.undocumented) {
      const ref = code.get(n)
      L.push(`| \`${n}\` | ${ref ? ref.files.size : 0} |`)
    }
  }
  L.push('')

  // Full code reference table
  L.push('## Appendix — Every `process.env.*` reference')
  L.push('')
  L.push('| Var | File count | On Vercel | In .env.example |')
  L.push('|---|---|---|---|')
  const all = [...code.values()].sort((a, b) => b.files.size - a.files.size)
  for (const r of all) {
    const onVercel = vercel.has(r.name) ? 'yes' : 'no'
    const inExample = example.has(r.name) ? 'yes' : 'no'
    L.push(`| \`${r.name}\` | ${r.files.size} | ${onVercel} | ${inExample} |`)
  }
  L.push('')
  L.push('---')
  L.push('')
  L.push(`_Generated by \`scripts/env-var-audit.ts\` (${SOURCE_TAG}). READ-ONLY; no env var values were read or logged._`)
  return L.join('\n')
}

async function writeInboxItems(
  code: Map<string, CodeRef>,
  diff: ReturnType<typeof categorize>,
  sha: string
): Promise<number> {
  let created = 0

  // Summary card — always first
  try {
    await prisma.inboxItem.create({
      data: {
        type: 'SYSTEM',
        source: 'env-var-audit',
        title: `Env parity: ${diff.missing.length} missing, ${diff.orphan.length} orphan on Vercel`,
        description:
          `Code vs Vercel production parity check. ${diff.missing.length} vars in code are NOT set on Vercel; ` +
          `${diff.orphan.length} vars on Vercel have no code references; ` +
          `${diff.docDrift.length} vars in .env.example are no longer referenced. ` +
          `Full report: AEGIS-ENV-AUDIT.md.`,
        priority: diff.missing.length > 0 ? 'HIGH' : 'MEDIUM',
        status: 'PENDING',
        entityType: 'EnvAudit',
        entityId: SOURCE_TAG,
        actionData: {
          sourceTag: SOURCE_TAG,
          gitSha: sha,
          counts: {
            code: code.size,
            missing: diff.missing.length,
            orphan: diff.orphan.length,
            docDrift: diff.docDrift.length,
            undocumented: diff.undocumented.length,
          },
          missing: diff.missing,
          orphan: diff.orphan,
        },
      },
    })
    created++
  } catch (err: any) {
    console.error(`  [inbox] summary create failed: ${err?.message || err}`)
  }

  // Up to 4 HIGH-priority MISSING vars (> 3 consumer files)
  const highRisk = diff.missing
    .map((name) => ({ name, files: [...(code.get(name)?.files || [])] }))
    .filter((r) => r.files.length > HIGH_PRIORITY_MIN_FILE_COUNT)
    .sort((a, b) => b.files.length - a.files.length)
    .slice(0, MAX_INBOX_ITEMS - 1)

  for (const r of highRisk) {
    try {
      await prisma.inboxItem.create({
        data: {
          type: 'SYSTEM',
          source: 'env-var-audit',
          title: `Missing Vercel env: ${r.name} (${r.files.length} files)`,
          description:
            `\`${r.name}\` is referenced by ${r.files.length} files in src/ but is not set on Vercel production. ` +
            `Top consumers: ${r.files.slice(0, 5).map((f) => f.replace(/\\/g, '/')).join(', ')}. ` +
            `Set on Vercel (\`vercel env add ${r.name} production\`) or remove the references.`,
          priority: 'HIGH',
          status: 'PENDING',
          entityType: 'EnvVar',
          entityId: r.name,
          actionData: {
            sourceTag: SOURCE_TAG,
            gitSha: sha,
            varName: r.name,
            fileCount: r.files.length,
            files: r.files.slice(0, 25),
          },
        },
      })
      created++
    } catch (err: any) {
      console.error(`  [inbox] ${r.name} create failed: ${err?.message || err}`)
    }
  }

  return created
}

// ─── 6. Main ──────────────────────────────────────────────────────────────

async function main() {
  const startedAt = new Date()
  const sha = gitSha()

  console.log(`[env-audit] ${SOURCE_TAG} — git ${sha}`)
  console.log(`[env-audit] scanning ${SRC_ROOT} ...`)
  const code = collectCodeEnvRefs()
  console.log(`[env-audit] found ${code.size} unique process.env references`)

  console.log(`[env-audit] calling vercel env ls production ...`)
  const { names: vercel, error: vercelError } = pullVercelEnv()
  console.log(`[env-audit] vercel returned ${vercel.size} vars${vercelError ? ` (error: ${vercelError})` : ''}`)

  console.log(`[env-audit] parsing .env.example ...`)
  const example = parseEnvExample()
  console.log(`[env-audit] .env.example lists ${example.size} vars`)

  const diff = categorize(code, vercel, example)
  console.log(
    `[env-audit] missing=${diff.missing.length} orphan=${diff.orphan.length} ` +
      `docDrift=${diff.docDrift.length} undocumented=${diff.undocumented.length}`
  )

  console.log(`[env-audit] creating InboxItems ...`)
  const inboxCreated = await writeInboxItems(code, diff, sha)
  console.log(`[env-audit] created ${inboxCreated} inbox items`)

  const report = renderReport(code, vercel, example, diff, vercelError, sha, startedAt, inboxCreated)
  fs.writeFileSync(REPORT_PATH, report, 'utf8')
  console.log(`[env-audit] wrote ${REPORT_PATH}`)

  // Emit a console-only summary (safe — no values, just names)
  console.log('')
  console.log('────────────── SUMMARY ──────────────')
  console.log(`code=${code.size}  vercel=${vercel.size}  example=${example.size}`)
  console.log(`MISSING (${diff.missing.length}): ${diff.missing.slice(0, 10).join(', ')}${diff.missing.length > 10 ? ' …' : ''}`)
  console.log(`ORPHAN  (${diff.orphan.length}): ${diff.orphan.slice(0, 10).join(', ')}${diff.orphan.length > 10 ? ' …' : ''}`)
  console.log(`git=${sha}`)
}

main()
  .catch((err) => {
    console.error('[env-audit] FATAL:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
