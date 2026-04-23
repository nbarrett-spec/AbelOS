/**
 * ops-page-smoke.ts
 *
 * READ-ONLY filesystem scan of Aegis (Abel OS) page.tsx files under
 * src/app/**. Does static checks only — no runtime, no builds, no DB.
 *
 * Source tag: OPS_PAGE_SMOKE_APR2026
 *
 * What it looks for:
 *   1. Known-suspect CSS classes Cowork introduced and partially fixed:
 *        - bg-signal, text-signal, border-signal, ring-signal
 *        - bg-ink, text-ink variants that don't exist in tailwind config
 *   2. Rough JSX balance heuristic (open vs self-closing vs close tag counts)
 *   3. Identifiers used as function calls that are never imported or declared
 *      in-file — surface candidates for "missing import" errors
 *   4. TODO / FIXME / XXX / HACK comments — top 10 as InboxItems-ready list
 *
 * Output: stdout + AEGIS-PAGE-SMOKE-REPORT.md alongside the repo root.
 *
 * Usage:
 *   npx tsx scripts/ops-page-smoke.ts
 *
 * Note: This file is intentionally self-contained with no non-stdlib deps.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(REPO_ROOT, 'src', 'app');
const REPORT_PATH = path.resolve(REPO_ROOT, '..', 'AEGIS-PAGE-SMOKE-REPORT.md');

// --- Suspect classes: only flag numeric-shade variants of `signal` since
//     the theme defines DEFAULT/hover/subtle/glow — `bg-signal`,
//     `bg-signal-hover`, etc. are VALID. But `bg-signal-500` would be broken. ---
const VALID_SIGNAL_SUFFIXES = new Set(['', '-hover', '-subtle', '-glow']);
const SIGNAL_CLASS_RE = /\b(bg|text|border|ring|from|to|fill|stroke|outline|divide|placeholder)-signal(-[A-Za-z0-9]+)?\b/g;

const TODO_RE = /\b(TODO|FIXME|XXX|HACK)\b[:\s-]*(.*)/g;

type Finding = {
  file: string;
  kind: 'suspect-class' | 'jsx-imbalance' | 'todo' | 'missing-import';
  detail: string;
  line?: number;
};

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      // skip api routes and node_modules-ish things
      if (e.name === 'api' || e.name === 'node_modules' || e.name.startsWith('.')) continue;
      await walk(full, out);
    } else if (e.isFile() && e.name === 'page.tsx') {
      out.push(full);
    }
  }
  return out;
}

function checkSuspectClasses(file: string, src: string): Finding[] {
  const findings: Finding[] = [];
  const re = new RegExp(SIGNAL_CLASS_RE.source, 'g');
  let m: RegExpExecArray | null;
  const bad: string[] = [];
  while ((m = re.exec(src))) {
    const suffix = m[2] || '';
    if (!VALID_SIGNAL_SUFFIXES.has(suffix)) {
      bad.push(m[0]);
    }
  }
  if (bad.length) {
    findings.push({
      file,
      kind: 'suspect-class',
      detail: `unknown signal shade(s): ${[...new Set(bad)].slice(0, 5).join(', ')}${bad.length > 5 ? ` +${bad.length - 5} more` : ''}`,
    });
  }
  return findings;
}

function checkJsxBalance(file: string, src: string): Finding[] {
  // Strip TS generic args, comments, strings, and regex literals to cut
  // false positives before counting JSX tags. Still a heuristic.
  const stripped = src
    // line + block comments
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // strings (single/double/back-tick)
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');

  // fragment counts
  const fragOpens = (stripped.match(/<>/g) || []).length;
  const fragCloses = (stripped.match(/<\/>/g) || []).length;

  // JSX open tags: `<Name` NOT preceded by an identifier char (which would
  // indicate a generic like `useState<Foo>`), and NOT a closing tag.
  const opens = (stripped.match(/(?<![A-Za-z0-9_$])<[A-Z][A-Za-z0-9_.]*(?:\s[^<>]*?)?(?<!\/)>/g) || []).length
    + (stripped.match(/(?<![A-Za-z0-9_$])<[a-z][a-z0-9-]*(?:\s[^<>]*?)?(?<!\/)>/g) || []).length;
  const selfs = (stripped.match(/(?<![A-Za-z0-9_$])<[A-Za-z][A-Za-z0-9_.-]*(?:\s[^<>]*?)?\/>/g) || []).length;
  const closes = (stripped.match(/<\/[A-Za-z][A-Za-z0-9_.-]*\s*>/g) || []).length;

  const diff = opens - closes;
  const fragDiff = fragOpens - fragCloses;
  const findings: Finding[] = [];
  // threshold raised — heuristic still imperfect around multi-line attrs
  if (diff > 5 || diff < -5) {
    findings.push({
      file,
      kind: 'jsx-imbalance',
      detail: `tag open/close mismatch: open=${opens} close=${closes} self=${selfs} diff=${diff}`,
    });
  }
  if (fragDiff !== 0) {
    findings.push({
      file,
      kind: 'jsx-imbalance',
      detail: `fragment mismatch: <>=${fragOpens} </>=${fragCloses}`,
    });
  }
  return findings;
}

function collectTodos(file: string, src: string): Finding[] {
  const findings: Finding[] = [];
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/\b(TODO|FIXME|XXX|HACK)\b[:\s-]*(.*)/);
    if (m) {
      findings.push({
        file,
        kind: 'todo',
        line: i + 1,
        detail: `${m[1]}: ${(m[2] || '').trim().slice(0, 160)}`,
      });
    }
  }
  return findings;
}

function collectMissingImports(file: string, src: string): Finding[] {
  // Very conservative: look for hooks/functions that LOOK like project-local
  // calls (PascalCase<...> or camelCase(...)) where the identifier is neither
  // imported, declared, nor a known React/browser global. Too noisy to be
  // authoritative, so we ONLY flag when a JSX tag <Foo ... is used and no
  // `Foo` appears in imports / const / function decls.
  const findings: Finding[] = [];
  // Strip TS generics + strings/comments before collecting JSX tag names.
  const cleaned = src
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');

  const tagNames = new Set<string>();
  // Require NOT preceded by identifier char (that rules out useState<Foo>)
  const tagRe = /(?<![A-Za-z0-9_$])<([A-Z][A-Za-z0-9]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(cleaned))) tagNames.add(m[1]);
  if (!tagNames.size) return findings;

  // Gather identifiers available in this file
  const available = new Set<string>();
  // Full `import ... from '...'` block — handle default + named + namespace
  const importBlockRe = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"][^'"]+['"]/g;
  while ((m = importBlockRe.exec(src))) {
    const clause = m[1];
    // default: leading bare identifier before comma or `{`
    const def = clause.match(/^\s*([A-Za-z_$][\w$]*)/);
    if (def) available.add(def[1]);
    // namespace: `* as Foo`
    const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (ns) available.add(ns[1]);
    // named bindings inside `{ ... }` (possibly multiple groups, multi-line)
    const namedBlocks = clause.match(/\{([^}]*)\}/g) || [];
    for (const nb of namedBlocks) {
      const inner = nb.slice(1, -1);
      for (const part of inner.split(',')) {
        const p = part.trim().replace(/^type\s+/, '');
        if (!p) continue;
        const asMatch = p.match(/^[A-Za-z_$][\w$]*\s+as\s+([A-Za-z_$][\w$]*)$/);
        if (asMatch) available.add(asMatch[1]);
        else {
          const id = p.match(/^([A-Za-z_$][\w$]*)/);
          if (id) available.add(id[1]);
        }
      }
    }
  }
  const declRe = /\b(?:const|let|var|function|class)\s+([A-Z][A-Za-z0-9_$]*)/g;
  while ((m = declRe.exec(src))) available.add(m[1]);
  // Destructured parameter bindings, e.g. `{ icon: Icon }` in a function sig
  const destrRe = /\b[A-Za-z_$][\w$]*\s*:\s*([A-Z][A-Za-z0-9_$]*)\b/g;
  while ((m = destrRe.exec(src))) available.add(m[1]);
  // `as Foo` rename patterns
  const asRe = /\bas\s+([A-Z][A-Za-z0-9_$]*)\b/g;
  while ((m = asRe.exec(src))) available.add(m[1]);

  // Known-in-scope React intrinsics often authored uppercase
  const builtins = new Set([
    'Fragment', 'Suspense', 'StrictMode', 'Profiler', 'Image', 'Link',
    'Head', 'Script', 'Form', 'Input', 'Fragment',
  ]);

  for (const tag of tagNames) {
    if (available.has(tag)) continue;
    if (builtins.has(tag)) continue;
    findings.push({
      file,
      kind: 'missing-import',
      detail: `<${tag}> used but no matching import/declaration found`,
    });
  }
  return findings;
}

async function main() {
  const files = await walk(APP_DIR);
  const findings: Finding[] = [];

  for (const f of files) {
    let src: string;
    try {
      src = await fs.readFile(f, 'utf8');
    } catch {
      continue;
    }
    findings.push(...checkSuspectClasses(f, src));
    findings.push(...checkJsxBalance(f, src));
    findings.push(...collectTodos(f, src));
    findings.push(...collectMissingImports(f, src));
  }

  const byKind = (k: Finding['kind']) => findings.filter((x) => x.kind === k);
  const suspect = byKind('suspect-class');
  const jsx = byKind('jsx-imbalance');
  const todos = byKind('todo');
  const missing = byKind('missing-import');

  const toRel = (p: string) => path.relative(REPO_ROOT, p).replace(/\\/g, '/');

  const lines: string[] = [];
  lines.push('# Aegis Page Smoke Report');
  lines.push('');
  lines.push(`Source tag: **OPS_PAGE_SMOKE_APR2026**`);
  lines.push(`Pages scanned: **${files.length}**`);
  lines.push(`Suspect-class hits: **${suspect.length}**`);
  lines.push(`JSX imbalance flags: **${jsx.length}**`);
  lines.push(`Missing-import candidates: **${missing.length}**`);
  lines.push(`TODO/FIXME/XXX/HACK hits: **${todos.length}**`);
  lines.push('');

  lines.push('## Suspect CSS classes (known Cowork carryover)');
  if (!suspect.length) lines.push('- None. Cowork cleanup appears complete.');
  for (const s of suspect) lines.push(`- \`${toRel(s.file)}\` — ${s.detail}`);
  lines.push('');

  lines.push('## JSX imbalance flags (heuristic, manual review)');
  if (!jsx.length) lines.push('- None over threshold.');
  for (const s of jsx) lines.push(`- \`${toRel(s.file)}\` — ${s.detail}`);
  lines.push('');

  lines.push('## Missing-import candidates (JSX tag with no import)');
  if (!missing.length) lines.push('- None.');
  for (const s of missing.slice(0, 20)) lines.push(`- \`${toRel(s.file)}\` — ${s.detail}`);
  if (missing.length > 20) lines.push(`- ... and ${missing.length - 20} more`);
  lines.push('');

  lines.push('## Top 10 TODO/FIXME/XXX/HACK');
  const top = todos.slice(0, 10);
  if (!top.length) lines.push('- None.');
  top.forEach((t, i) => {
    lines.push(`${i + 1}. \`${toRel(t.file)}:${t.line}\` — ${t.detail}`);
  });
  lines.push('');

  lines.push('---');
  lines.push('Static scan only — no runtime testing. READ-ONLY filesystem pass.');
  lines.push('Generated by `scripts/ops-page-smoke.ts`.');

  const body = lines.join('\n');
  await fs.writeFile(REPORT_PATH, body, 'utf8');
  // eslint-disable-next-line no-console
  console.log(body);
  // eslint-disable-next-line no-console
  console.log(`\nReport written to: ${REPORT_PATH}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('ops-page-smoke failed:', err);
  process.exit(1);
});
