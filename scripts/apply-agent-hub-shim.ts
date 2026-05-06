/**
 * Apply the withAgentHubAudit shim to every state-changing handler in
 * src/app/api/agent-hub/.
 *
 * Two transforms per file:
 *   1. Add `import { withAgentHubAudit } from '@/lib/agent-hub/audit-shim'`
 *      if not already present.
 *   2. Replace `export async function VERB(...) { ... }` with
 *      `export const VERB = withAgentHubAudit(async (...) => { ... })`
 *      for every state-changing verb (POST/PUT/PATCH/DELETE).
 *
 * The transform is intentionally conservative:
 *   - Skips files that already import audit (manual audit wins).
 *   - Skips files that already use withAgentHubAudit (idempotent).
 *   - Leaves GET handlers untouched (read paths).
 *
 * Run with --commit to write changes; default is dry-run.
 *
 * Usage:
 *   npx tsx scripts/apply-agent-hub-shim.ts            # DRY-RUN
 *   npx tsx scripts/apply-agent-hub-shim.ts --commit   # apply
 */

import * as fs from 'fs'
import * as path from 'path'

const COMMIT = process.argv.includes('--commit')
const ROOT = path.resolve(__dirname, '..')
const TARGET_DIR = path.join(ROOT, 'src', 'app', 'api', 'agent-hub')

const STATE_VERBS = ['POST', 'PUT', 'PATCH', 'DELETE']

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
  status: 'patched' | 'already-audited' | 'no-state-verbs' | 'already-shimmed' | 'error'
  versions?: { before: number; after: number }
  verbs?: string[]
  error?: string
}

function transform(content: string): { changed: boolean; out: string; verbs: string[] } {
  const verbs: string[] = []

  // Detect verbs present
  for (const v of STATE_VERBS) {
    const re = new RegExp(`export\\s+async\\s+function\\s+${v}\\s*\\(`, 'm')
    if (re.test(content)) verbs.push(v)
  }
  if (verbs.length === 0) return { changed: false, out: content, verbs: [] }

  let out = content

  // 1. Add import if missing.
  if (!/from\s+['"]@\/lib\/agent-hub\/audit-shim['"]/.test(out)) {
    // Match complete import statements (single + multi-line). Earlier
    // version of this regex (`/^import .*$/gm`) matched the first line of
    // a multi-line `import { ... } from '...'` and corrupted the file.
    const importStmtRe = /^import\s+(?:[\s\S]*?\bfrom\s+)?['"][^'"]+['"]\s*;?$/gm
    let lastImportIdx = 0
    let m: RegExpExecArray | null
    while ((m = importStmtRe.exec(out)) !== null) {
      lastImportIdx = m.index + m[0].length
    }
    if (lastImportIdx > 0) {
      out =
        out.slice(0, lastImportIdx) +
        `\nimport { withAgentHubAudit } from '@/lib/agent-hub/audit-shim'` +
        out.slice(lastImportIdx)
    } else {
      out = `import { withAgentHubAudit } from '@/lib/agent-hub/audit-shim'\n` + out
    }
  }

  // 2. Wrap each state-change verb. Convert:
  //      export async function POST(request: NextRequest) {
  //        ...body...
  //      }
  //    to:
  //      export const POST = withAgentHubAudit(async (request: NextRequest) => {
  //        ...body...
  //      })
  for (const verb of verbs) {
    // Match the function signature only — the body can have nested braces, so
    // we use a brace-counting walk instead of a single regex.
    const sigRe = new RegExp(
      `export\\s+async\\s+function\\s+${verb}\\s*\\(([^)]*)\\)\\s*(?::[^{]+)?\\s*\\{`,
      'm'
    )
    const sigMatch = sigRe.exec(out)
    if (!sigMatch) continue

    const sigStart = sigMatch.index
    const openBraceIdx = sigMatch.index + sigMatch[0].length - 1 // position of '{'
    const argList = sigMatch[1]

    // Walk forward from openBraceIdx to find matching close brace.
    let depth = 0
    let closeIdx = -1
    let inString: string | null = null
    let inLineComment = false
    let inBlockComment = false
    for (let i = openBraceIdx; i < out.length; i++) {
      const c = out[i]
      const next = out[i + 1]
      if (inLineComment) {
        if (c === '\n') inLineComment = false
        continue
      }
      if (inBlockComment) {
        if (c === '*' && next === '/') {
          inBlockComment = false
          i++
        }
        continue
      }
      if (inString) {
        if (c === '\\') {
          i++
          continue
        }
        if (c === inString) inString = null
        continue
      }
      if (c === '/' && next === '/') {
        inLineComment = true
        continue
      }
      if (c === '/' && next === '*') {
        inBlockComment = true
        continue
      }
      if (c === '"' || c === "'" || c === '`') {
        inString = c
        continue
      }
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          closeIdx = i
          break
        }
      }
    }
    if (closeIdx < 0) continue // malformed; leave alone

    const before = out.slice(0, sigStart)
    const body = out.slice(openBraceIdx + 1, closeIdx) // contents between { and }
    const after = out.slice(closeIdx + 1)

    const newDecl =
      `export const ${verb} = withAgentHubAudit(async (${argList}) => {` +
      body +
      `})`
    out = before + newDecl + after
  }

  return { changed: out !== content, out, verbs }
}

function main() {
  const files = walk(TARGET_DIR)
  console.log(`APPLY AGENT-HUB AUDIT SHIM — mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`)
  console.log(`Scanning ${files.length} agent-hub route files\n`)

  const results: Result[] = []

  for (const filePath of files) {
    const rel = path.relative(ROOT, filePath).replace(/\\/g, '/')
    let content: string
    try {
      content = fs.readFileSync(filePath, 'utf8')
    } catch (e: any) {
      results.push({ filePath: rel, status: 'error', error: e?.message })
      continue
    }

    // Skip if already manually audited via @/lib/audit
    const hasManualAudit =
      /from\s+['"]@\/lib\/audit['"]/.test(content) &&
      /\b(audit|logAudit|auditBuilder)\s*\(/.test(content)
    if (hasManualAudit) {
      results.push({ filePath: rel, status: 'already-audited' })
      continue
    }

    const alreadyShimmed = /from\s+['"]@\/lib\/agent-hub\/audit-shim['"]/.test(content)
    if (alreadyShimmed) {
      results.push({ filePath: rel, status: 'already-shimmed' })
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
    results.push({
      filePath: rel,
      status: 'patched',
      verbs,
      versions: { before: content.length, after: out.length },
    })
  }

  // Summarize
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

  const skipped = results.filter((r) => r.status === 'already-audited')
  if (skipped.length > 0) {
    console.log(`\n  Skipped ${skipped.length} files (already manually audited):`)
    skipped.forEach((r) => console.log(`    - ${r.filePath}`))
  }
}

main()
