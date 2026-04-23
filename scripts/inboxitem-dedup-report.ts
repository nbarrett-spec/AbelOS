/**
 * scripts/inboxitem-dedup-report.ts
 *
 * READ-ONLY dedup / quality pass on InboxItem rows.
 *
 * Pulls every InboxItem with priority in (CRITICAL, HIGH, MEDIUM) and
 * status = PENDING. Tokenizes each title (lowercase, strip punctuation,
 * drop tokens <=3 chars), computes pairwise Jaccard similarity, and
 * clusters any item that shares similarity >= THRESHOLD with another.
 *
 * Reports clusters of >= MIN_CLUSTER_SIZE members. For each cluster the
 * "primary" is picked by (priority rank DESC, earliest dueBy, then most
 * recent createdAt). The remaining members are the duplicates Nate can
 * consolidate onto the primary.
 *
 * Writes the report to stdout AND to
 *   C:/Users/natha/OneDrive/Abel Lumber/AEGIS-INBOX-DEDUP-REPORT.md
 *
 * THIS SCRIPT NEVER MODIFIES InboxItem ROWS.
 * The --apply-dedup flag is intentionally not implemented. If it is
 * passed, the script exits with a notice — touching InboxItem rows from
 * here is explicitly forbidden without a separate, purpose-built writer.
 *
 * Usage:
 *   npx tsx scripts/inboxitem-dedup-report.ts
 *   npx tsx scripts/inboxitem-dedup-report.ts --threshold 0.7
 */

import { PrismaClient } from '@prisma/client'
import * as dotenv from 'dotenv'
import * as path from 'node:path'
import * as fs from 'node:fs'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

// -- flags ------------------------------------------------------------------

if (process.argv.includes('--apply-dedup')) {
  console.error(
    '[inboxitem-dedup-report] --apply-dedup is not supported in this script. ' +
      'This is a READ-ONLY diagnostic. InboxItem writes are forbidden here. Exiting.',
  )
  process.exit(2)
}

function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag)
  if (i === -1) return fallback
  return process.argv[i + 1] ?? fallback
}

const THRESHOLD = Number(argValue('--threshold', '0.65'))
const MIN_CLUSTER_SIZE = Number(argValue('--min-cluster-size', '3'))
const REPORT_PATH =
  'C:/Users/natha/OneDrive/Abel Lumber/AEGIS-INBOX-DEDUP-REPORT.md'

// -- constants --------------------------------------------------------------

const PRIORITY_RANK: Record<string, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
}

const prisma = new PrismaClient()

// -- helpers ----------------------------------------------------------------

function tokenize(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 3),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

// Union-Find for clustering
class UF {
  parent: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]]
      x = this.parent[x]
    }
    return x
  }
  union(a: number, b: number) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent[ra] = rb
  }
}

type Item = {
  id: string
  title: string
  description: string | null
  priority: string
  status: string
  source: string
  type: string
  dueBy: Date | null
  createdAt: Date
  financialImpact: number | null
  tokens: Set<string>
}

function pickPrimary(items: Item[]): Item {
  // Highest priority rank, then earliest dueBy (nulls last), then most recent createdAt.
  return [...items].sort((a, b) => {
    const pr = (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0)
    if (pr !== 0) return pr
    const aDue = a.dueBy ? a.dueBy.getTime() : Number.POSITIVE_INFINITY
    const bDue = b.dueBy ? b.dueBy.getTime() : Number.POSITIVE_INFINITY
    if (aDue !== bDue) return aDue - bDue
    return b.createdAt.getTime() - a.createdAt.getTime()
  })[0]
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return '—'
  return d.toISOString().slice(0, 10)
}

// -- main -------------------------------------------------------------------

async function main() {
  console.log(
    `[inboxitem-dedup-report] threshold=${THRESHOLD} min-cluster=${MIN_CLUSTER_SIZE}`,
  )

  const rows = await prisma.inboxItem.findMany({
    where: {
      status: 'PENDING',
      priority: { in: ['CRITICAL', 'HIGH', 'MEDIUM'] },
    },
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      status: true,
      source: true,
      type: true,
      dueBy: true,
      createdAt: true,
      financialImpact: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  const items: Item[] = rows.map((r) => ({
    ...r,
    tokens: tokenize(r.title ?? ''),
  }))

  console.log(`[inboxitem-dedup-report] loaded ${items.length} candidate rows`)

  // O(n^2) pairwise — 890 max → ~400k comparisons, fine.
  const uf = new UF(items.length)
  let edgeCount = 0
  for (let i = 0; i < items.length; i++) {
    const a = items[i]
    if (a.tokens.size === 0) continue
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j]
      if (b.tokens.size === 0) continue
      const sim = jaccard(a.tokens, b.tokens)
      if (sim >= THRESHOLD) {
        uf.union(i, j)
        edgeCount++
      }
    }
  }

  // Collect clusters
  const groups = new Map<number, number[]>()
  for (let i = 0; i < items.length; i++) {
    const root = uf.find(i)
    const g = groups.get(root) ?? []
    g.push(i)
    groups.set(root, g)
  }

  const clusters = [...groups.values()]
    .filter((g) => g.length >= MIN_CLUSTER_SIZE)
    .map((idxs) => idxs.map((i) => items[i]))

  // Sort clusters largest first
  clusters.sort((a, b) => b.length - a.length)

  const totalDupable = clusters.reduce((s, c) => s + (c.length - 1), 0)

  // ---- Build report -------------------------------------------------------

  const now = new Date().toISOString()
  const lines: string[] = []
  lines.push(`# AEGIS Inbox Dedup Report`)
  lines.push('')
  lines.push(`- Generated: \`${now}\``)
  lines.push(`- Source: \`scripts/inboxitem-dedup-report.ts\` (READ-ONLY)`)
  lines.push(
    `- Filter: priority in (CRITICAL, HIGH, MEDIUM), status = PENDING`,
  )
  lines.push(
    `- Similarity: Jaccard on title tokens (>3 chars), threshold ${THRESHOLD}`,
  )
  lines.push(`- Min cluster size: ${MIN_CLUSTER_SIZE}`)
  lines.push('')
  lines.push(`## Summary`)
  lines.push('')
  lines.push(`- Candidate InboxItems scanned: **${items.length}**`)
  lines.push(`- Similarity edges found: **${edgeCount}**`)
  lines.push(`- Clusters (size >= ${MIN_CLUSTER_SIZE}): **${clusters.length}**`)
  lines.push(
    `- Largest cluster size: **${clusters[0]?.length ?? 0}**`,
  )
  lines.push(
    `- Estimated dedupable rows if Nate acts on this report: **${totalDupable}**`,
  )
  lines.push('')
  lines.push(`## Top 5 clusters by size`)
  lines.push('')
  lines.push(`| # | Size | Primary title | Primary source | Primary priority |`)
  lines.push(`|---|------|---------------|-----------------|-------------------|`)
  clusters.slice(0, 5).forEach((c, i) => {
    const primary = pickPrimary(c)
    const safeTitle = primary.title.replace(/\|/g, '\\|')
    lines.push(
      `| ${i + 1} | ${c.length} | ${safeTitle} | ${primary.source} | ${primary.priority} |`,
    )
  })
  lines.push('')

  lines.push(`## Clusters (full detail)`)
  lines.push('')
  if (clusters.length === 0) {
    lines.push(`_No clusters found at threshold ${THRESHOLD}._`)
  }
  clusters.forEach((c, i) => {
    const primary = pickPrimary(c)
    const dups = c.filter((x) => x.id !== primary.id)
    lines.push(`### Cluster ${i + 1} — ${c.length} items`)
    lines.push('')
    lines.push(`**Primary (keep):**`)
    lines.push('')
    lines.push(`- \`${primary.id}\``)
    lines.push(`  - title: ${primary.title}`)
    lines.push(`  - source: \`${primary.source}\` | type: \`${primary.type}\``)
    lines.push(
      `  - priority: ${primary.priority} | dueBy: ${fmtDate(primary.dueBy)} | created: ${fmtDate(primary.createdAt)}`,
    )
    if (primary.financialImpact != null) {
      lines.push(`  - financialImpact: $${primary.financialImpact.toLocaleString()}`)
    }
    lines.push('')
    lines.push(`**Duplicates (${dups.length}) — candidates for consolidation:**`)
    lines.push('')
    dups.forEach((d) => {
      const sim = jaccard(primary.tokens, d.tokens).toFixed(3)
      lines.push(`- \`${d.id}\` (sim to primary: ${sim})`)
      lines.push(`  - title: ${d.title}`)
      lines.push(
        `  - source: \`${d.source}\` | priority: ${d.priority} | dueBy: ${fmtDate(d.dueBy)} | created: ${fmtDate(d.createdAt)}`,
      )
    })
    lines.push('')
  })

  lines.push('---')
  lines.push('')
  lines.push(
    `_Generated by \`scripts/inboxitem-dedup-report.ts\` — READ-ONLY diagnostic. ` +
      `No InboxItem rows were modified. To act on this report, review clusters ` +
      `manually and run a separate, purpose-built writer with human approval._`,
  )
  lines.push('')

  const report = lines.join('\n')

  // Write to disk
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, report, 'utf8')

  // Echo to stdout
  console.log('\n' + report)
  console.log(`\n[inboxitem-dedup-report] wrote: ${REPORT_PATH}`)
}

main()
  .catch((err) => {
    console.error('[inboxitem-dedup-report] FAILED:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
