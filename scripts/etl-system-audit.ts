/**
 * scripts/etl-system-audit.ts
 *
 * Loads Abel_Lumber_Full_System_Audit.xlsx into the Aegis `InboxItem` table
 * so the April 6, 2026 full-system audit punch-list surfaces in the inbox UI.
 *
 * The XLSX has ONE sheet ("Full System Audit") laid out as alternating:
 *   - section header rows  (column A = "SALES & CRM", etc.; other cols blank)
 *   - data rows            (column A = running number 1..59)
 *   - header row           (column A = "#") — skipped
 *   - a trailing SUMMARY COUNTS block — skipped
 *
 * Data-row columns:
 *   A (#)              : row number (1-59)
 *   __EMPTY            : Department / Function
 *   __EMPTY_1          : Finding
 *   __EMPTY_2          : Current Status  (WORKING | ISSUE | EMPTY | N/A)
 *   __EMPTY_3          : Priority        (CRITICAL | HIGH | MEDIUM | LOW)
 *   __EMPTY_4          : Action Required
 *   __EMPTY_5          : Owner
 *   __EMPTY_6          : Effort          (None | Low | Medium | High)
 *   __EMPTY_7          : Notes
 *
 * Source tag: SYSTEM_AUDIT_V1 (distinct from improvement-plan-v1 so both coexist)
 * entityType: SystemAudit
 *
 * Idempotency: deterministic entityId = sha1(SOURCE_TAG|section|rowNum|titleLower) [24 hex]
 *
 * Modes:
 *   (default)  DRY-RUN — prints summary, writes nothing
 *   --commit   applies creates/updates via raw SQL (bypasses potential
 *              InboxItem.brainAcknowledgedAt drift seen by etl-improvement-plan.ts)
 *
 * Usage:
 *   npx tsx scripts/etl-system-audit.ts
 *   npx tsx scripts/etl-system-audit.ts --commit
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as crypto from 'node:crypto'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const DRY_RUN = !process.argv.includes('--commit')
const SOURCE_TAG = 'SYSTEM_AUDIT_V1'
const ENTITY_TYPE = 'SystemAudit'
const FILE = path.resolve(
  __dirname,
  '..',
  '..',
  'Abel_Lumber_Full_System_Audit.xlsx',
)

const TITLE_COL = 'Abel Lumber Ops Platform — Complete System Audit & Recommendations'

type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
type Status = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SNOOZED' | 'EXPIRED' | 'COMPLETED'

interface Item {
  entityId: string
  rowNum: number
  section: string
  title: string
  description: string
  priority: Priority
  status: Status
  type: string
  financialImpact: number | null
  actionData: Record<string, unknown>
}

function normStr(v: unknown): string {
  return (v ?? '').toString().trim()
}

function deterministicId(section: string, rowNum: number, title: string): string {
  return crypto
    .createHash('sha1')
    .update(`${SOURCE_TAG}|${section}|${rowNum}|${title.toLowerCase()}`)
    .digest('hex')
    .slice(0, 24)
}

function mapPriorityWord(raw: string): Priority {
  const s = raw.trim().toUpperCase()
  if (s.startsWith('CRIT')) return 'CRITICAL'
  if (s.startsWith('HIGH')) return 'HIGH'
  if (s.startsWith('MED')) return 'MEDIUM'
  if (s.startsWith('LOW')) return 'LOW'
  return 'MEDIUM'
}

// A "findingStatus" like WORKING / ISSUE / EMPTY / N/A is NOT the same as the
// inbox-item workflow Status. Everything starts PENDING except findings
// explicitly marked WORKING — those are treated as already-resolved observations
// (kept in the feed for visibility but marked COMPLETED so they don't clutter
// the active queue).
function mapInboxStatus(findingStatus: string): Status {
  const s = findingStatus.trim().toUpperCase()
  if (s === 'WORKING') return 'COMPLETED'
  return 'PENDING'
}

function isSectionHeader(c0: unknown, c1: unknown, c2: unknown): boolean {
  // Section header rows have text in col 0 and the rest blank.
  if (typeof c0 !== 'string') return false
  if (c0 === '#') return false
  if (/^\d+$/.test(c0.trim())) return false
  return c1 === null && c2 === null
}

function isDataRow(c0: unknown): boolean {
  if (typeof c0 === 'number' && Number.isFinite(c0)) return true
  if (typeof c0 === 'string' && /^\d+$/.test(c0.trim())) return true
  return false
}

function extract(rows: any[]): Item[] {
  const out: Item[] = []
  let section = 'UNCATEGORIZED'

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const c0 = r[TITLE_COL]
    const c1 = r['__EMPTY']
    const c2 = r['__EMPTY_1']

    // Skip the summary-counts block at the end (c0 null, c1 = "Total findings:" etc.)
    if (c0 === null && typeof c1 === 'string' && c1.endsWith(':')) continue
    // Skip the title row at the very top (section "April 6, 2026 | ...")
    // We'll let it fall into isSectionHeader then reject — but also skip findings
    // while section starts with "April" (pre-first-real-section).
    if (isSectionHeader(c0, c1, c2)) {
      const s = String(c0)
      if (s.startsWith('April') || s === 'SUMMARY COUNTS') {
        section = 'UNCATEGORIZED'
      } else {
        section = s
      }
      continue
    }
    if (!isDataRow(c0)) continue

    const rowNum = typeof c0 === 'number' ? c0 : parseInt(String(c0), 10)
    const department = normStr(c1)
    const finding = normStr(c2)
    const findingStatus = normStr(r['__EMPTY_2']) // WORKING | ISSUE | EMPTY | N/A
    const priorityRaw = normStr(r['__EMPTY_3'])
    const actionRequired = normStr(r['__EMPTY_4'])
    const owner = normStr(r['__EMPTY_5'])
    const effort = normStr(r['__EMPTY_6'])
    const notes = normStr(r['__EMPTY_7'])

    if (!finding) continue

    // Title: short, human-scannable. Prefer the finding's first clause.
    const firstClause = finding.split(/[.!?]\s|—|–/)[0].trim()
    const title = firstClause.length > 0 && firstClause.length <= 140
      ? `[${section}] ${firstClause}`
      : `[${section}] ${finding.slice(0, 120)}`

    const descParts: string[] = []
    descParts.push(`Finding: ${finding}`)
    if (findingStatus) descParts.push(`Status: ${findingStatus}`)
    if (department) descParts.push(`Dept: ${department}`)
    if (actionRequired) descParts.push(`Action: ${actionRequired}`)
    if (owner) descParts.push(`Owner: ${owner}`)
    if (effort) descParts.push(`Effort: ${effort}`)
    if (notes) descParts.push(`Notes: ${notes}`)
    const description = descParts.join(' | ')

    out.push({
      entityId: deterministicId(section, rowNum, title),
      rowNum,
      section,
      title,
      description,
      priority: mapPriorityWord(priorityRaw),
      status: mapInboxStatus(findingStatus),
      type: 'SYSTEM_AUDIT_FINDING',
      financialImpact: null, // audit rows don't carry $ figures
      actionData: {
        rowNum,
        section,
        department,
        finding,
        findingStatus,
        priorityRaw,
        actionRequired,
        owner,
        effort,
        notes,
      },
    })
  }
  return out
}

async function main() {
  console.log(`ETL system-audit — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`  source tag: ${SOURCE_TAG}`)
  console.log(`  entityType: ${ENTITY_TYPE}`)
  if (!fs.existsSync(FILE)) throw new Error(`Not found: ${FILE}`)

  const wb = XLSX.readFile(FILE)
  const sheetName = wb.SheetNames[0]
  const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[sheetName], { defval: null })
  console.log(`  sheet "${sheetName}": ${rows.length} raw rows`)

  const items = extract(rows)
  console.log(`  parsed: ${items.length} findings`)

  // Dup detection
  const seen = new Set<string>()
  const dupes: string[] = []
  for (const it of items) {
    if (seen.has(it.entityId)) dupes.push(it.entityId)
    else seen.add(it.entityId)
  }
  if (dupes.length > 0) {
    console.warn(`  WARN: ${dupes.length} duplicate entityId(s) — hash collision`)
  }

  // Priority breakdown (for sanity check)
  const byPrio: Record<string, number> = {}
  for (const it of items) byPrio[it.priority] = (byPrio[it.priority] ?? 0) + 1
  console.log(`  priority mix:`, byPrio)

  if (items.length === 0) { console.log('Nothing to do.'); return }

  const prisma = new PrismaClient()
  try {
    type ExistingRow = {
      id: string
      entityId: string | null
      title: string
      description: string | null
      priority: string
      status: string
      type: string
      financialImpact: number | null
      actionData: unknown
    }
    const existing = await prisma.$queryRawUnsafe<ExistingRow[]>(
      `SELECT id, "entityId", title, description, priority, status, type, "financialImpact", "actionData"
         FROM "InboxItem"
         WHERE source = $1 AND "entityType" = $2`,
      SOURCE_TAG,
      ENTITY_TYPE,
    )
    const byEntityId = new Map(existing.map((e) => [e.entityId ?? '', e]))
    console.log(`  existing system-audit InboxItems: ${existing.length}`)

    let toCreate = 0
    let toUpdate = 0
    let unchanged = 0
    const updatePlans: Array<{
      id: string
      entityId: string
      title: string
      changes: string[]
      data: Record<string, unknown>
    }> = []
    const creates: Item[] = []

    const canon = (x: unknown): string => {
      if (x === null || x === undefined) return 'null'
      if (typeof x !== 'object') return JSON.stringify(x)
      if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']'
      const o = x as Record<string, unknown>
      const keys = Object.keys(o).sort()
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}'
    }

    for (const it of items) {
      const hit = byEntityId.get(it.entityId)
      if (!hit) { creates.push(it); toCreate++; continue }
      const changes: string[] = []
      const data: Record<string, unknown> = {}
      if (hit.title !== it.title) { changes.push('title'); data.title = it.title }
      if ((hit.description ?? '') !== it.description) { changes.push('description'); data.description = it.description }
      if (hit.type !== it.type) { changes.push('type'); data.type = it.type }
      if (hit.priority !== it.priority) { changes.push('priority'); data.priority = it.priority }
      // Don't clobber user-driven transitions (APPROVED/REJECTED/SNOOZED) but
      // sync when DB is still PENDING and the XLSX now says COMPLETED (WORKING),
      // or vice-versa — only when DB is PENDING or COMPLETED (auto-managed).
      if ((hit.status === 'PENDING' || hit.status === 'COMPLETED') && hit.status !== it.status) {
        changes.push('status'); data.status = it.status
      }
      if ((hit.financialImpact ?? null) !== (it.financialImpact ?? null)) {
        changes.push('financialImpact'); data.financialImpact = it.financialImpact
      }
      const prev = canon(hit.actionData)
      const next = canon(it.actionData)
      if (prev !== next) { changes.push('actionData'); data.actionData = it.actionData as any }

      if (changes.length > 0) {
        updatePlans.push({ id: hit.id, entityId: it.entityId, title: it.title, changes, data })
        toUpdate++
      } else {
        unchanged++
      }
    }

    console.log()
    console.log('=== SUMMARY ===')
    console.log(`  Parsed items     : ${items.length}`)
    console.log(`  Existing records : ${existing.length}`)
    console.log(`  To create        : ${toCreate}`)
    console.log(`  To update        : ${toUpdate}`)
    console.log(`  Unchanged        : ${unchanged}`)

    if (creates.length > 0) {
      console.log(`\nSample creates (first 5 of ${creates.length}):`)
      creates.slice(0, 5).forEach((c) => {
        console.log(`  + [${c.priority}/${c.status}] ${c.title}`)
        if (c.description) console.log(`      ${c.description.slice(0, 180)}`)
      })
    }
    if (updatePlans.length > 0) {
      console.log(`\nSample updates (first 5 of ${updatePlans.length}):`)
      updatePlans.slice(0, 5).forEach((u) => {
        console.log(`  ~ ${u.title} — changes: ${u.changes.join(', ')}`)
      })
    }

    if (DRY_RUN) {
      console.log('\nDRY-RUN — no changes written. Re-run with --commit to apply.')
      return
    }

    console.log('\nCOMMIT — applying...')
    let created = 0, updated = 0, failed = 0

    function cuidish(): string {
      return 'c' + crypto.randomBytes(12).toString('hex')
    }

    for (const c of creates) {
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "InboxItem"
             (id, type, source, title, description, priority, status,
              "entityType", "entityId", "financialImpact", "actionData",
              "createdAt", "updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW(),NOW())`,
          cuidish(),
          c.type,
          SOURCE_TAG,
          c.title,
          c.description || null,
          c.priority,
          c.status,
          ENTITY_TYPE,
          c.entityId,
          c.financialImpact,
          JSON.stringify(c.actionData),
        )
        created++
      } catch (e) {
        failed++
        console.error(`  FAIL create "${c.title}":`, (e as Error).message.slice(0, 300))
      }
    }

    for (const u of updatePlans) {
      try {
        const sets: string[] = []
        const vals: unknown[] = []
        let i = 1
        for (const [k, v] of Object.entries(u.data)) {
          if (k === 'actionData') {
            sets.push(`"actionData" = $${i}::jsonb`)
            vals.push(JSON.stringify(v))
          } else if (k === 'financialImpact') {
            sets.push(`"financialImpact" = $${i}`)
            vals.push(v)
          } else {
            sets.push(`"${k}" = $${i}`)
            vals.push(v)
          }
          i++
        }
        sets.push(`"updatedAt" = NOW()`)
        vals.push(u.id)
        await prisma.$executeRawUnsafe(
          `UPDATE "InboxItem" SET ${sets.join(', ')} WHERE id = $${i}`,
          ...vals,
        )
        updated++
      } catch (e) {
        failed++
        console.error(`  FAIL update "${u.title}":`, (e as Error).message.slice(0, 300))
      }
    }
    console.log(`Committed: created=${created} updated=${updated} failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
