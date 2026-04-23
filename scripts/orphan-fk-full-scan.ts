/**
 * orphan-fk-full-scan.ts — READ-ONLY comprehensive orphan-FK scanner for Aegis.
 *
 * What it does:
 *   1. Parses prisma/schema.prisma to extract every @relation(fields:[…], references:[…]).
 *      This captures BOTH hard FKs (enforced by Postgres) AND soft FKs (declared in
 *      Prisma but not actually enforced in the DB — those are the dangerous ones).
 *   2. For every child→parent edge it finds:
 *        - Counts total non-null child rows  (skips tables < 100 rows to stay cheap)
 *        - LEFT-JOINs against parent, counts rows where parent is missing
 *        - Pulls up to 5 sample orphan IDs
 *      Each relation is capped at 200k child rows scanned; bigger tables are sampled
 *      deterministically (first 200k rows ordered by ctid) so the full sweep stays
 *      under the 5-minute budget.
 *   3. Writes a Markdown report to AEGIS-ORPHAN-FK-SCAN.md at the OneDrive root.
 *   4. For relations with orphanCount > 10, creates an InboxItem (source=ORPHAN_FK_SCAN).
 *        Cap: 15 InboxItems total, prioritized by (orphanCount * tableImportance).
 *
 * Run:  npx tsx scripts/orphan-fk-full-scan.ts
 *
 * ──────────────────────────────────────────────────────────────────────
 * Abel Lumber — Aegis OS · 2026-04-23
 * Author: Nate Barrett / Aegis ops · READ-ONLY diagnostic
 * ──────────────────────────────────────────────────────────────────────
 */

import { PrismaClient } from '@prisma/client'
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const prisma = new PrismaClient()

const REPORT_PATH = 'C:/Users/natha/OneDrive/Abel Lumber/AEGIS-ORPHAN-FK-SCAN.md'
const SCHEMA_PATH = 'C:/Users/natha/OneDrive/Abel Lumber/abel-builder-platform/prisma/schema.prisma'
const MIN_ROWS = 100                // skip child tables smaller than this
const SAMPLE_CAP = 200_000          // cap per-relation scan to stay under 5 min
const MAX_INBOX_ITEMS = 15
const ORPHAN_INBOX_THRESHOLD = 10
const SAMPLE_IDS_PER_RELATION = 5

// Core business tables weighted higher for InboxItem prioritization.
const TABLE_IMPORTANCE: Record<string, number> = {
  Order: 10, OrderItem: 10, PurchaseOrder: 10, PurchaseOrderItem: 9,
  Invoice: 10, InvoiceItem: 9, Payment: 10,
  Job: 9, JobPhase: 7, Project: 8,
  Builder: 10, Staff: 8, Vendor: 9, Product: 8,
  Quote: 7, QuoteItem: 6, Delivery: 7, Installation: 6,
  BuilderPricing: 7, ChangeOrder: 7, Contract: 7, Community: 7,
  CollectionAction: 6, Deal: 6, InboxItem: 5, InventoryItem: 6,
}

type Relation = {
  childModel: string            // Prisma model name
  childTable: string            // Postgres table name (quoted)
  parentModel: string
  parentTable: string
  fkField: string               // child column
  parentKey: string             // parent column (usually id)
  relationName?: string
  modifier: '' | '?' | '[]'     // nullability from schema
}

type RelationResult = {
  rel: Relation
  childRowCount: number
  nonNullFkCount: number
  scanned: number
  orphanCount: number
  sampleOrphanIds: string[]
  skipped?: string
  error?: string
}

/* ──────────────── schema.prisma parser ──────────────── */

function parseRelations(): Relation[] {
  const src = readFileSync(SCHEMA_PATH, 'utf8')
  const relations: Relation[] = []

  // Find every `model X { … }` block
  const modelRegex = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  let m: RegExpExecArray | null
  while ((m = modelRegex.exec(src)) !== null) {
    const childModel = m[1]
    const body = m[2]

    // In each body, find field lines that carry `@relation(...)`.
    // Example match:  builder Builder @relation(fields: [builderId], references: [id], onDelete: Cascade)
    // Example named:  referrer Builder @relation("ReferrerReferrals", fields: [referrerId], references: [id])
    const relRegex =
      /^\s*(\w+)\s+(\w+)(\[\]|\?)?\s+@relation\(\s*(?:"([^"]+)"\s*,\s*)?fields:\s*\[(\w+)\]\s*,\s*references:\s*\[(\w+)\][^)]*\)/gm
    let r: RegExpExecArray | null
    while ((r = relRegex.exec(body)) !== null) {
      const [, , parentModel, modifierRaw, relName, fkField, parentKey] = r
      const modifier = (modifierRaw ?? '') as '' | '?' | '[]'
      relations.push({
        childModel,
        childTable: `"${childModel}"`,
        parentModel,
        parentTable: `"${parentModel}"`,
        fkField,
        parentKey,
        relationName: relName,
        modifier,
      })
    }
  }
  return relations
}

/* ──────────────── scan helpers ──────────────── */

async function tableExists(table: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name=$1
     ) AS exists`,
    table.replace(/"/g, ''),
  )
  return rows[0]?.exists === true
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1 AND column_name=$2
     ) AS exists`,
    table.replace(/"/g, ''),
    column,
  )
  return rows[0]?.exists === true
}

async function countRows(table: string): Promise<number> {
  // Use planner stats first for speed; fall back to COUNT(*) only if reltuples looks bad.
  const stat = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT reltuples::bigint AS n FROM pg_class WHERE relname=$1 AND relkind='r'`,
    table.replace(/"/g, ''),
  )
  const est = Number(stat[0]?.n ?? 0)
  if (est >= MIN_ROWS * 2) return est
  const exact = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*)::bigint AS n FROM ${table}`,
  )
  return Number(exact[0]?.n ?? 0)
}

async function scanRelation(rel: Relation): Promise<RelationResult> {
  const base: Omit<RelationResult, 'orphanCount' | 'sampleOrphanIds' | 'scanned' | 'nonNullFkCount' | 'childRowCount'> & Partial<RelationResult> = {
    rel,
  }

  try {
    if (!(await tableExists(rel.childModel))) {
      return { ...base, childRowCount: 0, nonNullFkCount: 0, scanned: 0, orphanCount: 0, sampleOrphanIds: [], skipped: 'child table missing from DB (model not migrated)' }
    }
    if (!(await tableExists(rel.parentModel))) {
      return { ...base, childRowCount: 0, nonNullFkCount: 0, scanned: 0, orphanCount: 0, sampleOrphanIds: [], skipped: `parent table "${rel.parentModel}" missing from DB` }
    }
    if (!(await columnExists(rel.childModel, rel.fkField))) {
      return { ...base, childRowCount: 0, nonNullFkCount: 0, scanned: 0, orphanCount: 0, sampleOrphanIds: [], skipped: `fk column "${rel.fkField}" missing from DB` }
    }

    const childRowCount = await countRows(rel.childTable)
    if (childRowCount < MIN_ROWS) {
      return { ...base, childRowCount, nonNullFkCount: 0, scanned: 0, orphanCount: 0, sampleOrphanIds: [], skipped: `child table < ${MIN_ROWS} rows` }
    }

    // Total non-null references.
    const nonNullRow = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*)::bigint AS n FROM ${rel.childTable} WHERE "${rel.fkField}" IS NOT NULL`,
    )
    const nonNullFkCount = Number(nonNullRow[0]?.n ?? 0)

    if (nonNullFkCount === 0) {
      return { ...base, childRowCount, nonNullFkCount, scanned: 0, orphanCount: 0, sampleOrphanIds: [], skipped: 'no non-null FK values' }
    }

    // Scan window — cap at SAMPLE_CAP rows for bigger tables (deterministic via ctid).
    const scanSrc =
      nonNullFkCount <= SAMPLE_CAP
        ? `SELECT id, "${rel.fkField}" AS fk FROM ${rel.childTable} WHERE "${rel.fkField}" IS NOT NULL`
        : `SELECT id, "${rel.fkField}" AS fk FROM ${rel.childTable}
             WHERE "${rel.fkField}" IS NOT NULL
             ORDER BY ctid LIMIT ${SAMPLE_CAP}`

    // Orphan count via LEFT JOIN against parent.
    const orphanCountRow = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*)::bigint AS n
         FROM ( ${scanSrc} ) c
         LEFT JOIN ${rel.parentTable} p ON p."${rel.parentKey}" = c.fk
        WHERE p."${rel.parentKey}" IS NULL`,
    )
    const orphanCount = Number(orphanCountRow[0]?.n ?? 0)

    const sampleRows = orphanCount
      ? await prisma.$queryRawUnsafe<Array<{ id: string; fk: string }>>(
          `SELECT c.id, c.fk
             FROM ( ${scanSrc} ) c
             LEFT JOIN ${rel.parentTable} p ON p."${rel.parentKey}" = c.fk
            WHERE p."${rel.parentKey}" IS NULL
            LIMIT ${SAMPLE_IDS_PER_RELATION}`,
        )
      : []

    const scanned = Math.min(nonNullFkCount, SAMPLE_CAP)

    return {
      ...base,
      childRowCount,
      nonNullFkCount,
      scanned,
      orphanCount,
      sampleOrphanIds: sampleRows.map((s) => `${s.id}→${s.fk}`),
    }
  } catch (e: any) {
    return {
      rel,
      childRowCount: 0,
      nonNullFkCount: 0,
      scanned: 0,
      orphanCount: 0,
      sampleOrphanIds: [],
      error: String(e?.message ?? e),
    }
  }
}

/* ──────────────── main ──────────────── */

async function main() {
  const t0 = Date.now()
  const gitSha = (() => {
    try {
      return execSync('git rev-parse --short HEAD', {
        cwd: 'C:/Users/natha/OneDrive/Abel Lumber/abel-builder-platform',
      }).toString().trim()
    } catch {
      return '(unknown)'
    }
  })()

  console.log(`Parsing ${SCHEMA_PATH} …`)
  const relations = parseRelations()
  console.log(`Found ${relations.length} declared @relation edges across schema.`)

  // De-duplicate (named back-refs can produce duplicates pointing to same fields)
  const seen = new Set<string>()
  const unique = relations.filter((r) => {
    const k = `${r.childModel}.${r.fkField}->${r.parentModel}.${r.parentKey}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  console.log(`Scanning ${unique.length} unique relations (min rows = ${MIN_ROWS}, scan cap = ${SAMPLE_CAP}) …\n`)

  const results: RelationResult[] = []
  for (const rel of unique) {
    const r = await scanRelation(rel)
    results.push(r)
    if (r.error) {
      console.log(`[ERR ] ${rel.childModel}.${rel.fkField} → ${rel.parentModel}  ${r.error}`)
    } else if (r.skipped) {
      console.log(`[SKIP] ${rel.childModel}.${rel.fkField} → ${rel.parentModel}  (${r.skipped})`)
    } else {
      const badge = r.orphanCount > 0 ? '[ORPH]' : '[OK  ]'
      console.log(
        `${badge} ${rel.childModel}.${rel.fkField} → ${rel.parentModel}  ` +
        `rows=${r.childRowCount} refs=${r.nonNullFkCount} scanned=${r.scanned} orphans=${r.orphanCount}`,
      )
    }
  }

  const durationSec = ((Date.now() - t0) / 1000).toFixed(1)

  /* ───── classify ───── */
  const scanned = results.filter((r) => !r.skipped && !r.error)
  const withOrphans = scanned.filter((r) => r.orphanCount > 0).sort((a, b) => b.orphanCount - a.orphanCount)
  const inboxCandidates = scanned
    .filter((r) => r.orphanCount > ORPHAN_INBOX_THRESHOLD)
    .map((r) => ({
      r,
      score: r.orphanCount * (TABLE_IMPORTANCE[r.rel.childModel] ?? 3 + (TABLE_IMPORTANCE[r.rel.parentModel] ?? 1)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_INBOX_ITEMS)

  /* ───── report ───── */
  const lines: string[] = []
  lines.push(`# AEGIS — Full Orphan-FK Scan`)
  lines.push('')
  lines.push(`- **Generated:** ${new Date().toISOString()}`)
  lines.push(`- **Git SHA:** \`${gitSha}\``)
  lines.push(`- **Duration:** ${durationSec}s`)
  lines.push(`- **Relations parsed from schema.prisma:** ${relations.length}`)
  lines.push(`- **Unique child.fk → parent edges:** ${unique.length}`)
  lines.push(`- **Scanned (child ≥ ${MIN_ROWS} rows):** ${scanned.length}`)
  lines.push(`- **Skipped / empty / missing:** ${results.length - scanned.length - results.filter((r) => r.error).length}`)
  lines.push(`- **Errors:** ${results.filter((r) => r.error).length}`)
  lines.push(`- **Relations with ≥1 orphan:** ${withOrphans.length}`)
  lines.push(`- **Scan cap per relation:** ${SAMPLE_CAP} rows`)
  lines.push('')
  lines.push(`## Relations with orphans (sorted by orphan count)`)
  lines.push('')
  if (withOrphans.length === 0) {
    lines.push(`_No orphans detected across any relation scanned._`)
  } else {
    lines.push(`| # | Child | FK column | Parent | Child rows | Non-null refs | Scanned | Orphans | Sample (childId→fkValue) |`)
    lines.push(`|---|---|---|---|---:|---:|---:|---:|---|`)
    withOrphans.forEach((r, i) => {
      const sample = r.sampleOrphanIds.length ? r.sampleOrphanIds.map((s) => `\`${s}\``).join('<br>') : ''
      lines.push(
        `| ${i + 1} | \`${r.rel.childModel}\` | \`${r.rel.fkField}\` | \`${r.rel.parentModel}\` | ` +
        `${r.childRowCount} | ${r.nonNullFkCount} | ${r.scanned} | **${r.orphanCount}** | ${sample} |`,
      )
    })
  }

  lines.push('')
  lines.push(`## Top 10 offenders`)
  lines.push('')
  const top10 = withOrphans.slice(0, 10)
  if (top10.length === 0) {
    lines.push(`_No orphans to rank._`)
  } else {
    top10.forEach((r, i) => {
      lines.push(`${i + 1}. **${r.rel.childModel}.${r.rel.fkField} → ${r.rel.parentModel}** — ${r.orphanCount} orphans (of ${r.nonNullFkCount} refs)`)
    })
  }

  lines.push('')
  lines.push(`## Scanned relations — full table`)
  lines.push('')
  lines.push(`| Child.fk → Parent | Child rows | Refs | Scanned | Orphans | Status |`)
  lines.push(`|---|---:|---:|---:|---:|---|`)
  for (const r of results) {
    const label = `\`${r.rel.childModel}.${r.rel.fkField}\` → \`${r.rel.parentModel}\``
    const status = r.error ? `ERROR: ${r.error}` : r.skipped ?? (r.orphanCount > 0 ? 'ORPHANS' : 'OK')
    lines.push(
      `| ${label} | ${r.childRowCount} | ${r.nonNullFkCount} | ${r.scanned} | ${r.orphanCount} | ${status} |`,
    )
  }
  lines.push('')
  lines.push(`## InboxItem creation`)
  lines.push('')
  if (inboxCandidates.length === 0) {
    lines.push(`_No relations exceeded the orphan threshold (>${ORPHAN_INBOX_THRESHOLD}) — no InboxItems created._`)
  } else {
    lines.push(`Creating ${inboxCandidates.length} InboxItem(s), source=\`ORPHAN_FK_SCAN\`:`)
    lines.push('')
    inboxCandidates.forEach((c, i) => {
      lines.push(
        `${i + 1}. ${c.r.rel.childModel}.${c.r.rel.fkField} → ${c.r.rel.parentModel}  ` +
        `(orphans=${c.r.orphanCount}, score=${c.score})`,
      )
    })
  }

  lines.push('')
  lines.push(`---`)
  lines.push(`_Generated by \`scripts/orphan-fk-full-scan.ts\` · Abel Lumber — Aegis ops · READ-ONLY diagnostic_`)
  lines.push('')

  writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8')
  console.log(`\nReport → ${REPORT_PATH}`)

  /* ───── Inbox items (this is the only write; respects cap) ───── */
  let created = 0
  for (const c of inboxCandidates) {
    const r = c.r
    const priority =
      r.orphanCount >= 1000 ? 'CRITICAL' :
      r.orphanCount >= 100  ? 'HIGH'     :
                              'MEDIUM'

    try {
      await prisma.inboxItem.create({
        data: {
          type: 'SYSTEM',
          source: 'ORPHAN_FK_SCAN',
          title: `Orphan FK: ${r.rel.childModel}.${r.rel.fkField} → ${r.rel.parentModel} (${r.orphanCount} orphans)`,
          description:
            `The scan of ${r.nonNullFkCount.toLocaleString()} non-null ` +
            `\`${r.rel.childModel}.${r.rel.fkField}\` references found ${r.orphanCount.toLocaleString()} ` +
            `pointing to missing \`${r.rel.parentModel}\` rows. Investigate data origin (ETL, Hyphen, legacy ` +
            `import) before any cleanup. Sample child→fk: ${r.sampleOrphanIds.slice(0, 3).join(', ') || '(n/a)'}.`,
          priority,
          entityType: r.rel.childModel,
          actionData: {
            childModel: r.rel.childModel,
            fkField: r.rel.fkField,
            parentModel: r.rel.parentModel,
            orphanCount: r.orphanCount,
            nonNullFkCount: r.nonNullFkCount,
            childRowCount: r.childRowCount,
            scanned: r.scanned,
            sampleOrphanIds: r.sampleOrphanIds,
            relationName: r.rel.relationName ?? null,
            gitSha,
          },
        },
      })
      created++
      console.log(`[INBOX +] ${r.rel.childModel}.${r.rel.fkField} → ${r.rel.parentModel}  priority=${priority}`)
    } catch (e: any) {
      console.log(`[INBOX X] ${r.rel.childModel}.${r.rel.fkField} → ${r.rel.parentModel}  ${String(e?.message ?? e)}`)
    }
  }
  console.log(`\nInboxItems created: ${created}/${inboxCandidates.length}`)
  console.log(`Done in ${durationSec}s.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
