#!/usr/bin/env node
// scripts/add-audit-to-migrates.mjs
//
// One-shot codemod: adds `import { audit } from '@/lib/audit'` plus a single
// `audit(request, 'RUN_MIGRATION_<NAME>', 'Database', ...)` call into each
// route.ts under src/app/api/ops/migrate-*, src/app/api/ops/migrate/*,
// src/app/api/ops/seed*, and src/app/api/ops/sales/(migrate|seed-reps).
//
// The script is idempotent — re-running it is a no-op on already-patched files.
//
// USAGE: node scripts/add-audit-to-migrates.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const TARGETS = [
  'src/app/api/ops/migrate-agent-hub/route.ts',
  'src/app/api/ops/migrate-all/route.ts',
  'src/app/api/ops/migrate-cascades/route.ts',
  'src/app/api/ops/migrate-change-orders/route.ts',
  'src/app/api/ops/migrate-documents/route.ts',
  'src/app/api/ops/migrate-features/route.ts',
  'src/app/api/ops/migrate-indexes/route.ts',
  'src/app/api/ops/migrate-manufacturing/route.ts',
  'src/app/api/ops/migrate-nfc/route.ts',
  'src/app/api/ops/migrate-outreach/route.ts',
  'src/app/api/ops/migrate-phase2/route.ts',
  'src/app/api/ops/migrate-phase3/route.ts',
  'src/app/api/ops/migrate-phase4/route.ts',
  'src/app/api/ops/migrate-phase5/route.ts',
  'src/app/api/ops/migrate-punch-items/route.ts',
  'src/app/api/ops/migrate-temporal/route.ts',
  'src/app/api/ops/migrate/route.ts',
  'src/app/api/ops/migrate/add-indexes/route.ts',
  'src/app/api/ops/migrate/ai-agent/route.ts',
  'src/app/api/ops/migrate/builder-pricing-tiers/route.ts',
  'src/app/api/ops/migrate/data-scrub/route.ts',
  'src/app/api/ops/migrate/employee-onboarding/route.ts',
  'src/app/api/ops/migrate/fix-order-totals/route.ts',
  'src/app/api/ops/migrate/manufacturing-tables/route.ts',
  'src/app/api/ops/migrate/multi-role-support/route.ts',
  'src/app/api/ops/migrate/platform-upgrade/route.ts',
  'src/app/api/ops/migrate/portal-overrides/route.ts',
  'src/app/api/ops/migrate/product-expansion/route.ts',
  'src/app/api/ops/migrate/vendor-credit/route.ts',
  'src/app/api/ops/seed/route.ts',
  'src/app/api/ops/seed-employees/route.ts',
  'src/app/api/ops/seed-workflow/route.ts',
  'src/app/api/ops/sales/migrate/route.ts',
  'src/app/api/ops/sales/seed-reps/route.ts',
]

// Derive a short UPPER_SNAKE action token from the file path segment after /ops/.
function deriveActionToken(relPath) {
  const parts = relPath.split(/[\\/]/)
  const idx = parts.indexOf('ops')
  const tail = parts.slice(idx + 1, parts.length - 1) // drop "route.ts"
  return tail
    .join('_')
    .replace(/-/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '')
    .toUpperCase()
}

function patchFile(absPath, relPath) {
  let src = fs.readFileSync(absPath, 'utf8')
  if (src.includes("from '@/lib/audit'") && src.includes('audit(request,')) {
    return { file: relPath, status: 'already-patched' }
  }

  const action = `RUN_${deriveActionToken(relPath)}`

  // 1. Insert the audit import just after an existing '@/lib/api-auth' or
  //    '@/lib/auth' import (common across these routes). If neither is
  //    present, append after the last import line.
  if (!src.includes("from '@/lib/audit'")) {
    const importMarkers = [
      /^(import\s+\{\s*[^}]*\}\s+from\s+['"]@\/lib\/api-auth['"];?)$/m,
      /^(import\s+\{\s*[^}]*\}\s+from\s+['"]@\/lib\/auth['"];?)$/m,
    ]
    let inserted = false
    for (const rx of importMarkers) {
      const m = src.match(rx)
      if (m) {
        src = src.replace(m[0], `${m[0]}\nimport { audit } from '@/lib/audit'`)
        inserted = true
        break
      }
    }
    if (!inserted) {
      // Fallback: put it after the final top-of-file import.
      const importBlock = src.match(/^(import[\s\S]*?)(\n\n)/)
      if (importBlock) {
        src = src.replace(
          importBlock[0],
          `${importBlock[1]}\nimport { audit } from '@/lib/audit'${importBlock[2]}`
        )
        inserted = true
      }
    }
    if (!inserted) {
      // Last resort prepend.
      src = `import { audit } from '@/lib/audit'\n${src}`
    }
  }

  // 2. Inject an audit() call right after the first auth guard inside POST.
  //    Match either "checkStaffAuth(request)" or "requireDevAdmin(request)"
  //    pattern followed by the early-return.
  const guardPatterns = [
    /(export async function POST\([^)]*\)[^{]*\{\s*const\s+authError\s*=\s*await\s*checkStaffAuthWithFallback\(request\)[^\n]*\n\s*if\s*\(authError\)\s*return\s*authError;?)/,
    /(export async function POST\([^)]*\)[^{]*\{\s*const\s+authError\s*=\s*checkStaffAuth\(request\);?\s*\n\s*if\s*\(authError\)\s*return\s*authError;?)/,
    /(export async function POST\([^)]*\)[^{]*\{\s*const\s+guard\s*=\s*requireDevAdmin\(request\);?\s*\n\s*if\s*\(guard\)\s*return\s*guard;?)/,
  ]
  let auditInserted = false
  for (const rx of guardPatterns) {
    const m = src.match(rx)
    if (m) {
      src = src.replace(
        m[0],
        `${m[0]}\n\n  audit(request, '${action}', 'Database', undefined, { migration: '${action}' }, 'CRITICAL').catch(() => {})`
      )
      auditInserted = true
      break
    }
  }
  if (!auditInserted) {
    // Fallback: insert just inside the first "try {" in the file.
    const tryRx = /(export async function POST[\s\S]*?try\s*\{)/
    const m = src.match(tryRx)
    if (m) {
      src = src.replace(
        m[0],
        `${m[0]}\n    audit(request, '${action}', 'Database', undefined, { migration: '${action}' }, 'CRITICAL').catch(() => {})`
      )
      auditInserted = true
    }
  }

  if (!auditInserted) {
    return { file: relPath, status: 'skipped-no-handler-pattern' }
  }

  fs.writeFileSync(absPath, src, 'utf8')
  return { file: relPath, status: 'patched', action }
}

const results = []
for (const rel of TARGETS) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) {
    results.push({ file: rel, status: 'missing' })
    continue
  }
  try {
    results.push(patchFile(abs, rel))
  } catch (e) {
    results.push({ file: rel, status: 'error', error: String(e).slice(0, 200) })
  }
}

// Pretty summary
const counts = results.reduce((acc, r) => {
  acc[r.status] = (acc[r.status] || 0) + 1
  return acc
}, {})
console.log(`\n${'='.repeat(60)}\naudit() backfill summary\n${'='.repeat(60)}`)
console.log(counts)
for (const r of results) {
  const tag = r.status.padEnd(24)
  console.log(`${tag} ${r.file}${r.action ? `  →  ${r.action}` : ''}${r.error ? `  ⚠ ${r.error}` : ''}`)
}
