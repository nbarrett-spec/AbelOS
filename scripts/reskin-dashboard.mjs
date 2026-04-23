#!/usr/bin/env node
/**
 * One-shot reskin of /src/app/dashboard/** from legacy Tailwind color classes
 * to Aegis v3 semantic tokens.
 *
 * Mechanical class swaps only — does NOT touch structure, API calls, routing,
 * or component imports.
 *
 * Invoked manually, not in CI.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..', 'src', 'app', 'dashboard')

/** Most-specific-first ordered token replacements.
 *  Keys are literal Tailwind classes or class fragments found in the code;
 *  values are Aegis v3 semantic tokens.
 *  Only string-literal replacement — no regex, no surprise edits. */
const RAW_PAIRS = [
  // ── Text: primary foreground ────────────────────────────────────────────
  ['text-gray-900 dark:text-white',         'text-fg'],
  ['dark:text-white text-gray-900',         'text-fg'],
  ['text-white dark:text-gray-900',         'text-fg-inverse'],

  // ── Text: muted (body / secondary) ──────────────────────────────────────
  ['text-gray-500 dark:text-gray-400',      'text-fg-muted'],
  ['text-gray-600 dark:text-gray-400',      'text-fg-muted'],
  ['text-gray-600 dark:text-gray-300',      'text-fg-muted'],
  ['text-gray-700 dark:text-gray-300',      'text-fg-muted'],
  ['text-gray-700 dark:text-gray-200',      'text-fg-muted'],
  ['text-gray-500 dark:text-gray-500',      'text-fg-muted'],

  // ── Text: subtle (placeholder / icon) ───────────────────────────────────
  ['text-gray-400 dark:text-gray-500',      'text-fg-subtle'],
  ['text-gray-400 dark:text-gray-600',      'text-fg-subtle'],
  ['text-gray-300 dark:text-gray-600',      'text-fg-subtle'],

  // ── Backgrounds: surface ────────────────────────────────────────────────
  ['bg-white dark:bg-gray-900',             'bg-surface'],
  ['bg-white dark:bg-gray-800',             'bg-surface'],
  ['bg-gray-50 dark:bg-gray-900',           'bg-surface'],
  ['bg-gray-50 dark:bg-gray-900/60',        'bg-surface-muted'],
  ['bg-gray-50 dark:bg-gray-800/60',        'bg-surface-muted'],
  ['bg-gray-50 dark:bg-gray-800/40',        'bg-surface-muted'],
  ['bg-gray-50 dark:bg-gray-800/50',        'bg-surface-muted'],
  ['bg-gray-50 dark:bg-gray-800',           'bg-surface-muted'],
  ['bg-gray-100 dark:bg-gray-800',          'bg-surface-muted'],
  ['bg-gray-100 dark:bg-gray-900',          'bg-surface-muted'],
  ['bg-gray-100 dark:bg-gray-700',          'bg-surface-muted'],
  ['bg-gray-200 dark:bg-gray-700',          'bg-surface-muted'],

  // Hover states (background)
  ['hover:bg-gray-50 dark:hover:bg-gray-800/40',  'hover:bg-surface-muted'],
  ['hover:bg-gray-50 dark:hover:bg-gray-800/50',  'hover:bg-surface-muted'],
  ['hover:bg-gray-50 dark:hover:bg-gray-800/60',  'hover:bg-surface-muted'],
  ['hover:bg-gray-50 dark:hover:bg-gray-800',     'hover:bg-surface-muted'],
  ['hover:bg-gray-100 dark:hover:bg-gray-800',    'hover:bg-surface-muted'],
  ['hover:bg-gray-100 dark:hover:bg-gray-700',    'hover:bg-surface-muted'],

  // ── Borders ─────────────────────────────────────────────────────────────
  ['border-gray-100 dark:border-gray-800',  'border-border'],
  ['border-gray-200 dark:border-gray-800',  'border-border'],
  ['border-gray-200 dark:border-gray-700',  'border-border'],
  ['border-gray-200/80 dark:border-gray-800/80', 'border-border'],
  ['border-gray-300 dark:border-gray-700',  'border-border-strong'],
  ['border-gray-300 dark:border-gray-600',  'border-border-strong'],

  // Dividers
  ['divide-gray-100 dark:divide-gray-800',  'divide-border'],
  ['divide-gray-200 dark:divide-gray-800',  'divide-border'],
  ['divide-gray-200 dark:divide-gray-700',  'divide-border'],

  // ── Single-token fallbacks (less specific) ──────────────────────────────
  // Only kick in if the compound pair above didn't catch them.
  ['text-gray-900',                         'text-fg'],
  ['text-gray-800',                         'text-fg'],
  ['text-gray-700',                         'text-fg-muted'],
  ['text-gray-600',                         'text-fg-muted'],
  ['text-gray-500',                         'text-fg-muted'],
  ['text-gray-400',                         'text-fg-subtle'],
  ['text-gray-300',                         'text-fg-subtle'],

  ['dark:text-white',                       'dark:text-fg'],
  ['dark:text-gray-400',                    'dark:text-fg-muted'],
  ['dark:text-gray-300',                    'dark:text-fg-muted'],
  ['dark:text-gray-500',                    'dark:text-fg-subtle'],

  ['bg-gray-50',                            'bg-surface-muted'],
  ['bg-gray-100',                           'bg-surface-muted'],
  ['bg-gray-200',                           'bg-surface-muted'],
  ['dark:bg-gray-900',                      'dark:bg-surface'],
  ['dark:bg-gray-800',                      'dark:bg-surface-muted'],
  ['dark:bg-gray-700',                      'dark:bg-surface-muted'],

  ['border-gray-100',                       'border-border'],
  ['border-gray-200',                       'border-border'],
  ['border-gray-300',                       'border-border-strong'],
  ['dark:border-gray-700',                  'dark:border-border'],
  ['dark:border-gray-800',                  'dark:border-border'],

  ['divide-gray-100',                       'divide-border'],
  ['divide-gray-200',                       'divide-border'],
  ['dark:divide-gray-700',                  'dark:divide-border'],
  ['dark:divide-gray-800',                  'dark:divide-border'],

  // ── Semantic accent colors: walnut → accent, amber → signal where used ──
  ['text-navy-deep dark:text-white',        'text-fg'],
  ['text-navy-deep',                        'text-fg'],
  ['bg-navy-deep',                          'bg-brand'],

  // Dashboard skeleton / loading state boxes use gray-200/gray-800; remap
  ['bg-gray-200 dark:bg-gray-800',          'bg-surface-muted'],
]

// Ensure we replace longer strings first so we don't clip compound matches.
const PAIRS = RAW_PAIRS.slice().sort((a, b) => b[0].length - a[0].length)

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile() && (full.endsWith('.tsx') || full.endsWith('.ts'))) out.push(full)
  }
  return out
}

function swap(src) {
  let out = src
  let hits = 0
  for (const [from, to] of PAIRS) {
    if (from === to) continue
    if (!out.includes(from)) continue
    const before = out
    out = out.split(from).join(to)
    hits += (before.length - out.length + (to.length - from.length) * ((before.match(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length)) ? 1 : 0
  }
  return { out, changed: out !== src }
}

const files = walk(ROOT)
const changed = []
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const { out, changed: didChange } = swap(src)
  if (didChange) {
    fs.writeFileSync(f, out)
    // line diff count approximation
    const beforeLines = src.split('\n')
    const afterLines  = out.split('\n')
    let lines = 0
    const max = Math.min(beforeLines.length, afterLines.length)
    for (let i = 0; i < max; i++) if (beforeLines[i] !== afterLines[i]) lines++
    lines += Math.abs(afterLines.length - beforeLines.length)
    changed.push([path.relative(ROOT, f), lines])
  }
}

console.log(`Reskinned ${changed.length}/${files.length} files.`)
for (const [f, n] of changed) console.log(`  ${f.padEnd(55)} ${n} lines`)
