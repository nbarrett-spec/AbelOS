/**
 * scripts/etl-formation-docs.ts
 *
 * Abel Formation Documentation — corporate-records folder pointer ETL.
 *
 * The on-disk folder holds Abel Lumber, Inc.'s corporate-formation records
 * (bylaws, shareholder agreements, organizational consents, loan agreements,
 * and other incorporation/governance paperwork). It lives on Nate's OneDrive.
 *
 * PRIVACY / SCOPE:
 *   This ETL is deliberately minimal. It does NOT parse document contents,
 *   does NOT copy filenames into the DB, and does NOT extract counterparties,
 *   share counts, loan amounts, ownership percentages, or any other field.
 *   It only creates a small set of `InboxItem` reminders so Nate sees the
 *   folder in his inbox with a pointer back to OneDrive where the real
 *   documents live.
 *
 * Source (read-only):
 *   C:\Users\natha\OneDrive\Abel Lumber\Abel Formation Documentation\
 *   We stat the tree for (count of files, total bytes) only.
 *
 * Output InboxItems (2 total, priority MEDIUM — governance hygiene, not
 * an active deadline unless one surfaces):
 *   1. Folder pointer: "Formation records contain N files totaling X MB at <path>"
 *   2. Compliance-calendar reminder: review annual-report / franchise-tax
 *      filings and other recurring corporate-compliance dates.
 *
 * Idempotency: upsert on (source, entityType, entityId).
 *
 * Modes:
 *   (default)  DRY-RUN — prints plan, writes nothing.
 *   --commit   applies upserts.
 *
 * Usage:
 *   npx tsx scripts/etl-formation-docs.ts
 *   npx tsx scripts/etl-formation-docs.ts --commit
 */

import { PrismaClient } from '@prisma/client'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as crypto from 'node:crypto'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const DRY_RUN = !process.argv.includes('--commit')
const SOURCE_TAG = 'FORMATION_DOCS'
const ABEL_FOLDER = path.resolve(__dirname, '..', '..')
const FORMATION_FOLDER = path.join(ABEL_FOLDER, 'Abel Formation Documentation')

type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

function cuidish(): string {
  return 'c' + crypto.randomBytes(12).toString('hex')
}

function isResolved(status: string): boolean {
  return (
    status === 'APPROVED' ||
    status === 'REJECTED' ||
    status === 'COMPLETED' ||
    status === 'EXPIRED'
  )
}

/**
 * Walk the formation-docs folder and return (file count, total bytes).
 * We do NOT collect filenames — only aggregate stats.
 */
function scanFormation(root: string): { fileCount: number; totalBytes: number } {
  if (!fs.existsSync(root)) {
    throw new Error(`Formation folder missing: ${root}`)
  }
  let fileCount = 0
  let totalBytes = 0
  const stack: string[] = [root]
  while (stack.length) {
    const dir = stack.pop() as string
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        stack.push(full)
      } else if (ent.isFile()) {
        try {
          const st = fs.statSync(full)
          fileCount++
          totalBytes += st.size
        } catch {
          // skip unreadable
        }
      }
    }
  }
  return { fileCount, totalBytes }
}

async function upsertInboxItem(
  prisma: PrismaClient,
  args: {
    entityType: string
    entityId: string
    type: string
    title: string
    description: string
    priority: Priority
    actionData: Record<string, unknown>
  },
): Promise<'created' | 'updated' | 'skipped'> {
  type ExistingRow = { id: string; status: string }
  const existing = await prisma.$queryRawUnsafe<ExistingRow[]>(
    `SELECT id, status FROM "InboxItem"
       WHERE source = $1 AND "entityType" = $2 AND "entityId" = $3
       LIMIT 1`,
    SOURCE_TAG,
    args.entityType,
    args.entityId,
  )
  const hit = existing[0]

  if (DRY_RUN) {
    return hit ? (isResolved(hit.status) ? 'skipped' : 'updated') : 'created'
  }

  if (hit) {
    if (isResolved(hit.status)) return 'skipped'
    await prisma.$executeRawUnsafe(
      `UPDATE "InboxItem"
         SET type = $1,
             title = $2,
             description = $3,
             priority = $4,
             "actionData" = $5::jsonb,
             "updatedAt" = NOW()
         WHERE id = $6`,
      args.type,
      args.title,
      args.description,
      args.priority,
      JSON.stringify(args.actionData),
      hit.id,
    )
    return 'updated'
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "InboxItem"
       (id, type, source, title, description, priority, status,
        "entityType", "entityId", "actionData",
        "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW(),NOW())`,
    cuidish(),
    args.type,
    SOURCE_TAG,
    args.title,
    args.description,
    args.priority,
    'PENDING',
    args.entityType,
    args.entityId,
    JSON.stringify(args.actionData),
  )
  return 'created'
}

async function main() {
  console.log('═'.repeat(64))
  console.log('  FORMATION DOCS — corporate-records folder pointer ETL')
  console.log(`  Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'COMMIT'}`)
  console.log('═'.repeat(64))

  const { fileCount, totalBytes } = scanFormation(FORMATION_FOLDER)
  const totalMb = totalBytes / 1024 / 1024
  console.log(`\nFormation folder scanned (aggregate only — no filenames logged):`)
  console.log(`  Path:       ${FORMATION_FOLDER}`)
  console.log(`  File count: ${fileCount}`)
  console.log(`  Total size: ${totalMb.toFixed(2)} MB`)

  const prisma = new PrismaClient()
  try {
    let created = 0
    let updated = 0
    let skipped = 0

    // 1. Folder pointer
    {
      const result = await upsertInboxItem(prisma, {
        entityType: 'CorporateRecord',
        entityId: 'FORMATION_DOCS_FOLDER',
        type: 'GOVERNANCE_REVIEW',
        title: 'Abel Lumber — corporate formation records on OneDrive',
        description:
          `Formation records contain ${fileCount} files totaling ${totalMb.toFixed(2)} MB at ` +
          `[${FORMATION_FOLDER}]. Sensitive corporate documents — contents intentionally not ` +
          `indexed in Aegis. Keep originals in OneDrive; do not move, rename, or delete without ` +
          `coordinating with counsel. Share access on a need-to-know basis only.`,
        priority: 'MEDIUM',
        actionData: {
          source: SOURCE_TAG,
          folderPath: FORMATION_FOLDER,
          fileCount,
          totalBytes,
          totalMb: Number(totalMb.toFixed(2)),
          note: 'Aggregate stats only. No filenames, amounts, ownership %, or counterparties stored here.',
        },
      })
      if (result === 'created') created++
      else if (result === 'updated') updated++
      else skipped++
      console.log(`  [POINTER]           FORMATION_DOCS_FOLDER -> ${result}`)
    }

    // 2. Compliance-calendar reminder
    {
      const result = await upsertInboxItem(prisma, {
        entityType: 'CorporateRecord',
        entityId: 'FORMATION_DOCS_COMPLIANCE_CALENDAR',
        type: 'GOVERNANCE_REVIEW',
        title: 'Review corporate compliance calendar (annual report, franchise tax, etc.)',
        description:
          `Reminder: walk the corporate-compliance calendar once per quarter. Confirm the ` +
          `Texas franchise-tax report is filed on time (typically May 15), the public-information / ` +
          `annual report is current with the Secretary of State, the registered-agent record is ` +
          `accurate, and any shareholder / member meeting minutes required by the bylaws are on ` +
          `file. Pull source docs from [${FORMATION_FOLDER}]; loop in counsel for anything ambiguous.`,
        priority: 'MEDIUM',
        actionData: {
          source: SOURCE_TAG,
          folderPath: FORMATION_FOLDER,
          note: 'Set recurring calendar holds for franchise-tax and annual-report deadlines.',
        },
      })
      if (result === 'created') created++
      else if (result === 'updated') updated++
      else skipped++
      console.log(`  [COMPLIANCE-CAL]    FORMATION_DOCS_COMPLIANCE_CALENDAR -> ${result}`)
    }

    console.log('\n' + '─'.repeat(64))
    console.log(`  ${DRY_RUN ? 'Would' : 'Did'} create: ${created}`)
    console.log(`  ${DRY_RUN ? 'Would' : 'Did'} update: ${updated}`)
    console.log(`  Skipped (already resolved): ${skipped}`)
    console.log(`  Total InboxItems touched: ${created + updated + skipped}`)
    console.log('─'.repeat(64))
    if (DRY_RUN) {
      console.log('\nDRY-RUN complete. Re-run with --commit to persist.')
    } else {
      console.log('\nCommit complete.')
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
