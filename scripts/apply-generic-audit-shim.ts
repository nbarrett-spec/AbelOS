/**
 * Apply the generic withAudit shim to every state-changing route that
 * doesn't already have audit coverage.
 *
 * Same transform as apply-agent-hub-shim.ts, but:
 *   - Targets ALL of src/app/api/, not just agent-hub
 *   - Skips routes that already audit (any of the recognized signals)
 *   - Skips webhook routes (they use a separate verification + audit path)
 *   - Skips library wrappers (cron, agent-hub) — those have their own shims
 *
 * Usage:
 *   npx tsx scripts/apply-generic-audit-shim.ts            # DRY-RUN
 *   npx tsx scripts/apply-generic-audit-shim.ts --commit   # apply
 */

import * as fs from 'fs'
import * as path from 'path'

const COMMIT = process.argv.includes('--commit')
const ROOT = path.resolve(__dirname, '..')
const TARGET_DIR = path.join(ROOT, 'src', 'app', 'api')

const STATE_VERBS = ['POST', 'PUT', 'PATCH', 'DELETE']

// Skip these subtrees — they already have audit via other means or shouldn't
// be auto-shimmed.
const SKIP_PREFIXES = [
  'src/app/api/agent-hub/', // already has its own shim
  'src/app/api/cron/',      // covered by cron lib instrumentation
  'src/app/api/webhooks/',  // webhook handlers have their own audit
  'src/app/api/auth/',      // already audited per-route
  'src/app/api/admin/',     // already audited per-route
  'src/app/api/builder/',   // already audited per-route
  'src/app/api/builders/',  // already audited per-route
  'src/app/api/homeowner/', // already audited per-route
]

function walk(dir: string, files: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) walk(full, files)
    else if (name === 'route.ts' || name === 'route.tsx') files.push(full)
  }
  return files
}

interface Result {
  filePath: string
  status: 'patched' | 'already-audited' | 'no-state-verbs' | 'skipped-prefix' | 'error'
  verbs?: string[]
  error?: string
}

function transform(content: string): { changed: boolean; out: string; verbs: string[] } {
  const verbs: string[] = []

  for (const v of STATE_VERBS) {
    const re = new RegExp(`export\\s+async\\s+function\\s+${v}\\s*\\(`, 'm')
    if (re.test(content)) verbs.push(v)
  }
  if (verbs.length === 0) return { changed: false, out: content, verbs: [] }

  let out = content

  if (!/from\s+['"]@\/lib\/audit-route['"]/.test(out)) {
    // Match complete import statements (single-line + multi-line). Multi-line
    // imports use `{ … }` blocks ending with a closing brace + from clause —
    // earlier regex of `/^import .*$/gm` matched line 1 of a multi-line
    // import and corrupted the file. This pattern requires the trailing
    // `from '...'` so it always grabs the whole statement.
    const importStmtRe = /^import\s+(?:[\s\S]*?\bfrom\s+)?['"][^'"]+['"]\s*;?$/gm
    let lastImportIdx = 0
    let m: RegExpExecArray | null
    while ((m = importStmtRe.exec(out)) !== null) {
      lastImportIdx = m.index + m[0].length
    }
    if (lastImportIdx > 0) {
      out =
        out.slice(0, lastImportIdx) +
        `\nimport { withAudit } from '@/lib/audit-route'` +
        out.slice(lastImportIdx)
    } else {
      out = `import { withAudit } from '@/lib/audit-route'\n` + out
    }
  }

  for (const verb of verbs) {
    const sigRe = new RegExp(
      `export\\s+async\\s+function\\s+${verb}\\s*\\(([^)]*)\\)\\s*(?::[^{]+)?\\s*\\{`,
      'm'
    )
    const sigMatch = sigRe.exec(out)
    if (!sigMatch) continue

    const sigStart = sigMatch.index
    const openBraceIdx = sigMatch.index + sigMatch[0].length - 1
    const argList = sigMatch[1]

    let depth = 0
    let closeIdx = -1
    let inString: string | null = null
    let inLineComment = false
    let inBlockComment = false
    for (let i = openBraceIdx; i < out.length; i++) {
      const c = out[i]
      const next = out[i + 1]
      if (inLineComment) { if (c === '\n') inLineComment = false; continue }
      if (inBlockComment) {
        if (c === '*' && next === '/') { inBlockComment = false; i++ }
        continue
      }
      if (inString) {
        if (c === '\\') { i++; continue }
        if (c === inString) inString = null
        continue
      }
      if (c === '/' && next === '/') { inLineComment = true; continue }
      if (c === '/' && next === '*') { inBlockComment = true; continue }
      if (c === '"' || c === "'" || c === '`') { inString = c; continue }
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) { closeIdx = i; break }
      }
    }
    if (closeIdx < 0) continue

    const before = out.slice(0, sigStart)
    const body = out.slice(openBraceIdx + 1, closeIdx)
    const after = out.slice(closeIdx + 1)

    out =
      before +
      `export const ${verb} = withAudit(async (${argList}) => {` +
      body +
      `})` +
      after
  }

  return { changed: out !== content, out, verbs }
}

function main() {
  const files = walk(TARGET_DIR)
  console.log(`APPLY GENERIC AUDIT SHIM — mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`)
  console.log(`Scanning ${files.length} route files\n`)

  const results: Result[] = []

  for (const filePath of files) {
    const rel = path.relative(ROOT, filePath).replace(/\\/g, '/')

    if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) {
      results.push({ filePath: rel, status: 'skipped-prefix' })
      continue
    }

    let content: string
    try {
      content = fs.readFileSync(filePath, 'utf8')
    } catch (e: any) {
      results.push({ filePath: rel, status: 'error', error: e?.message })
      continue
    }

    // Skip if already audited (any of the supported signals)
    const hasManualAudit =
      /from\s+['"]@\/lib\/audit['"]/.test(content) &&
      /\b(audit|logAudit|auditBuilder)\s*\(/.test(content)
    const hasShim =
      /from\s+['"]@\/lib\/audit-route['"]/.test(content) ||
      /from\s+['"]@\/lib\/agent-hub\/audit-shim['"]/.test(content)
    const hasCronWrap =
      /\b(withCronRun|startCronRun|finishCronRun)\s*\(/.test(content) &&
      /from\s+['"]@\/lib\/cron['"]/.test(content)

    if (hasManualAudit || hasShim || hasCronWrap) {
      results.push({ filePath: rel, status: 'already-audited' })
      continue
    }

    const { changed, out, verbs } = transform(content)
    if (!changed || verbs.length === 0) {
      results.push({ filePath: rel, status: 'no-state-verbs', verbs })
      continue
    }

    if (COMMIT) {
      fs.writeFileSync(filePath, out, 'utf8')
    }
    results.push({ filePath: rel, status: 'patched', verbs })
  }

  const counts: Record<string, number> = {}
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1

  console.log('\n──── RESULT ────')
  Object.entries(counts).forEach(([k, v]) => console.log(`  ${k.padEnd(20)} ${v}`))
  console.log()

  for (const r of results) {
    if (r.status === 'patched') {
      console.log(`  ✏️  ${r.filePath.padEnd(60)} ${r.verbs?.join(',')}`)
    } else if (r.status === 'error') {
      console.log(`  ❌  ${r.filePath} — ${r.error}`)
    }
  }
}

main()
