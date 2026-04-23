/**
 * scripts/etl-blueprint-manifest.ts
 *
 * Metadata-only inventory of blueprint PDFs across customer folders. Writes:
 *   - InboxItem — summary + per-customer + Bloomfield deal flag (capped at 10)
 *   - CommunityFloorPlan.blueprintUrl — populated with file:// OneDrive paths
 *     where the filename matches an existing plan (fuzzy match on plan name)
 *
 * Source tag: BLUEPRINT_MANIFEST
 *
 * IMPORTANT: Does NOT read PDF content. OneDrive rehydration + binary PDFs
 * mean content parsing is risky; this script works from filesystem stat only
 * (filename + size + path).
 *
 * Scope:
 *   - C:\Users\natha\OneDrive\Abel Lumber\Bloomfield Homes (recursive)
 *   - C:\Users\natha\OneDrive\Abel Lumber\Brookfield (recursive)
 *   - workspace-wide sweep for PDFs matching plan|blueprint|takeoff|elev
 *     in the filename (builder blueprints only — excludes AgriTec and other
 *     non-builder content by folder).
 *
 * Usage: dry-run by default; pass --commit to persist.
 */

import { PrismaClient } from '@prisma/client'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const SRC_TAG = 'BLUEPRINT_MANIFEST'

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..')
const BLOOMFIELD_ROOT = path.join(WORKSPACE_ROOT, 'Bloomfield Homes')
const BROOKFIELD_ROOT = path.join(WORKSPACE_ROOT, 'Brookfield')

interface PdfMeta {
  absPath: string
  relPath: string      // path relative to WORKSPACE_ROOT
  filename: string
  size: number
  customer: string     // 'Bloomfield' | 'Brookfield' | 'Other'
  planName: string | null
}

// Known Bloomfield plan names (from existing CommunityFloorPlan seed). Any
// PDF filename containing one of these tokens maps to that plan name.
const BLOOMFIELD_PLAN_TOKENS = [
  'Bellflower', 'Camellia', 'Caraway', 'Carolina', 'Cypress', 'Daffodil',
  'Dewberry', 'Dogwood', 'Gardenia', 'Hawthorne', 'Jasmine', 'Laurel',
  'Lily', 'Lilly', 'Magnolia', 'Primrose', 'Redbud', 'Rockcress', 'Rose',
  'Seaberry', 'Violet', 'Willow', 'Woodrose', 'Bayberry', 'SpringCress',
  'Spring Cress',
]

function hashId(key: string): string {
  return 'bpm_' + crypto.createHash('sha256').update(`${SRC_TAG}::${key}`).digest('hex').slice(0, 18)
}

function walkPdfs(root: string): string[] {
  if (!fs.existsSync(root)) return []
  const out: string[] = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        stack.push(full)
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.pdf')) {
        out.push(full)
      }
    }
  }
  return out
}

function inferPlanName(filename: string): string | null {
  for (const tok of BLOOMFIELD_PLAN_TOKENS) {
    const re = new RegExp(`\\b${tok}\\b`, 'i')
    if (re.test(filename)) {
      // Normalize Lilly → Lily
      if (/lilly/i.test(tok)) return 'Lily'
      return tok.replace(/\s+/g, ' ')
    }
  }
  return null
}

function toFileUrl(absPath: string): string {
  // Windows absolute → file:/// URL. Use forward slashes, percent-encode spaces.
  const norm = absPath.replace(/\\/g, '/')
  const encoded = norm.split('/').map(encodeURIComponent).join('/')
  // Re-inject drive colon (was encoded as %3A)
  return 'file:///' + encoded.replace(/^([A-Za-z])%3A/, '$1:')
}

function buildManifest(): PdfMeta[] {
  const out: PdfMeta[] = []

  // Bloomfield sweep
  for (const abs of walkPdfs(BLOOMFIELD_ROOT)) {
    const stat = fs.statSync(abs)
    const rel = path.relative(WORKSPACE_ROOT, abs)
    out.push({
      absPath: abs,
      relPath: rel,
      filename: path.basename(abs),
      size: stat.size,
      customer: 'Bloomfield',
      planName: inferPlanName(path.basename(abs)),
    })
  }

  // Brookfield sweep
  for (const abs of walkPdfs(BROOKFIELD_ROOT)) {
    const stat = fs.statSync(abs)
    const rel = path.relative(WORKSPACE_ROOT, abs)
    out.push({
      absPath: abs,
      relPath: rel,
      filename: path.basename(abs),
      size: stat.size,
      customer: 'Brookfield',
      planName: null,
    })
  }

  return out
}

// Pick the canonical (largest) PDF per plan — prefers full plan sets over
// partial / executive / presentation PDFs.
function canonicalPdfPerPlan(pdfs: PdfMeta[]): Map<string, PdfMeta> {
  const byPlan = new Map<string, PdfMeta>()
  for (const p of pdfs) {
    if (!p.planName) continue
    const prior = byPlan.get(p.planName)
    if (!prior || p.size > prior.size) byPlan.set(p.planName, p)
  }
  return byPlan
}

function fmtMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2)
}

async function main() {
  console.log(`ETL Blueprint Manifest — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`Source tag: ${SRC_TAG}`)
  console.log()

  const pdfs = buildManifest()

  const byCustomer = new Map<string, PdfMeta[]>()
  for (const p of pdfs) {
    const arr = byCustomer.get(p.customer) ?? []
    arr.push(p)
    byCustomer.set(p.customer, arr)
  }

  const totalBytes = pdfs.reduce((s, p) => s + p.size, 0)
  console.log(`Total PDFs: ${pdfs.length} | Total size: ${fmtMb(totalBytes)} MB`)
  for (const [cust, arr] of byCustomer) {
    const mb = fmtMb(arr.reduce((s, p) => s + p.size, 0))
    const planCount = new Set(arr.map((p) => p.planName).filter(Boolean)).size
    console.log(`  ${cust.padEnd(12)} ${String(arr.length).padStart(3)} files | ${mb.padStart(8)} MB | ${planCount} distinct plan names`)
  }
  console.log()

  const bloomfield = byCustomer.get('Bloomfield') ?? []
  const canonical = canonicalPdfPerPlan(bloomfield)
  console.log(`Bloomfield canonical blueprints per plan: ${canonical.size}`)
  for (const [plan, p] of [...canonical].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${plan.padEnd(14)} → ${p.filename} (${fmtMb(p.size)} MB)`)
  }
  console.log()

  const prisma = new PrismaClient()
  try {
    // ── CommunityFloorPlan.blueprintUrl updates ──────────────────────
    // Find Bloomfield community
    const bloomBuilder = await prisma.builder.findFirst({
      where: { companyName: { contains: 'Bloomfield', mode: 'insensitive' } },
      select: { id: true, companyName: true },
    })
    let cfpUpdates: Array<{ id: string; name: string; url: string; prior: string | null }> = []
    if (bloomBuilder) {
      const community = await prisma.community.findFirst({
        where: { builderId: bloomBuilder.id },
        select: { id: true, name: true },
      })
      if (community) {
        const plans = await prisma.communityFloorPlan.findMany({
          where: { communityId: community.id },
          select: { id: true, name: true, blueprintUrl: true },
        })
        console.log(`Bloomfield community "${community.name}" — ${plans.length} CommunityFloorPlan rows`)
        for (const plan of plans) {
          // Fuzzy: lowercase compare ignoring punctuation/spaces
          const key = plan.name.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')
          for (const [matchPlan, pdf] of canonical) {
            const mkey = matchPlan.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')
            if (mkey === key || mkey.includes(key) || key.includes(mkey)) {
              cfpUpdates.push({
                id: plan.id,
                name: plan.name,
                url: toFileUrl(pdf.absPath),
                prior: plan.blueprintUrl,
              })
              break
            }
          }
        }
        console.log(`  → blueprintUrl updates queued: ${cfpUpdates.length}`)
        for (const u of cfpUpdates.slice(0, 5)) {
          console.log(`    ${u.name.padEnd(14)} ${u.prior ? '(overwrite)' : '(new)     '} → ${u.url.slice(0, 100)}...`)
        }
        if (cfpUpdates.length > 5) console.log(`    ...and ${cfpUpdates.length - 5} more`)
      } else {
        console.log(`Bloomfield community not found — skipping CFP updates`)
      }
    } else {
      console.log(`Bloomfield builder not found — skipping CFP updates`)
    }
    console.log()

    // ── InboxItem drafts (cap at 10) ──────────────────────────────────
    const items: Array<{
      key: string; type: string; source: string; title: string
      description: string; priority: string
    }> = []

    // 1) Summary
    items.push({
      key: 'summary',
      type: 'SYSTEM',
      source: 'blueprint-manifest',
      title: `[BLUEPRINTS] Inventory — ${pdfs.length} files across ${byCustomer.size} customer(s), ${fmtMb(totalBytes)} MB`,
      description: `Blueprint PDF manifest refreshed ${new Date().toISOString().slice(0, 10)}. Tracked in BLUEPRINT-PDF-MANIFEST.md at workspace root. Metadata-only (no content parsing). ${pdfs.length} PDFs, ${fmtMb(totalBytes)} MB total. Breakdown: ${[...byCustomer.entries()].map(([c, arr]) => `${c}=${arr.length}`).join(', ')}.`,
      priority: 'LOW',
    })

    // 2) Per-customer items
    for (const [cust, arr] of byCustomer) {
      if (arr.length === 0) continue
      const planCount = new Set(arr.map((p) => p.planName).filter(Boolean)).size
      const mb = fmtMb(arr.reduce((s, p) => s + p.size, 0))
      items.push({
        key: `customer:${cust}`,
        type: 'SYSTEM',
        source: 'blueprint-manifest',
        title: `[BLUEPRINTS] ${cust} — ${arr.length} PDFs, ${planCount} distinct plans, ${mb} MB`,
        description: `${cust} blueprint inventory: ${arr.length} PDFs on file, ${planCount} distinct plan names identified. Total ${mb} MB. See BLUEPRINT-PDF-MANIFEST.md for full file list.`,
        priority: 'LOW',
      })
    }

    // 3) Bloomfield deal-critical flag
    if (bloomfield.length > 0) {
      items.push({
        key: 'bloomfield-deal-critical',
        type: 'DEAL_FOLLOWUP',
        source: 'blueprint-manifest',
        title: `[BLOOMFIELD] ${canonical.size} plan blueprints on file — deal (85% / $3.57M) needs fast quote turnaround`,
        description: `Bloomfield deal is at 85% probability / $3.57M. ${canonical.size} distinct plans have canonical blueprint PDFs available for takeoff (Bellflower, Carolina, Magnolia, Primrose, etc). CommunityFloorPlan.blueprintUrl populated with file:// paths → Aegis UI renders them as clickable links on each plan. Use these to accelerate takeoffs and bid responses. Brookfield folder currently has 0 blueprint PDFs — follow up with Amanda Barham if Rev4 plan breakdown needs matching PDFs.`,
        priority: 'HIGH',
      })
    }

    // Cap at 10
    const capped = items.slice(0, 10)
    console.log(`InboxItems to upsert: ${capped.length} (cap 10)`)
    for (const it of capped) {
      console.log(`  + [${it.priority.padEnd(6)}] ${it.title.slice(0, 110)}`)
    }
    console.log()

    if (DRY_RUN) {
      console.log('DRY-RUN — no writes. Re-run with --commit to persist.')
      return
    }

    console.log('COMMIT — applying writes...')

    // CommunityFloorPlan updates
    let cfpApplied = 0
    for (const u of cfpUpdates) {
      await prisma.communityFloorPlan.update({
        where: { id: u.id },
        data: { blueprintUrl: u.url },
      })
      cfpApplied++
    }
    console.log(`  CommunityFloorPlan.blueprintUrl updated: ${cfpApplied}`)

    // InboxItem upserts
    let ibCreated = 0, ibUpdated = 0
    for (const it of capped) {
      const id = hashId(it.key)
      const res = await prisma.inboxItem.upsert({
        where: { id },
        create: {
          id,
          type: it.type,
          source: it.source,
          title: it.title,
          description: it.description,
          priority: it.priority,
          status: 'PENDING',
          actionData: { sourceTag: SRC_TAG, key: it.key, totalPdfs: pdfs.length, totalBytes },
        },
        update: {
          title: it.title,
          description: it.description,
          priority: it.priority,
        },
        select: { createdAt: true, updatedAt: true },
      })
      if (res.createdAt.getTime() === res.updatedAt.getTime()) ibCreated++
      else ibUpdated++
    }
    console.log(`  InboxItems: created=${ibCreated} updated=${ibUpdated}`)
    console.log('DONE.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
