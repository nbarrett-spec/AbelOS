/**
 * scripts/etl-mg-financial.ts
 *
 * MG Financial litigation — evidence tracker ETL.
 *
 * MG Financial is a former lender in active litigation with Abel. The on-disk
 * evidence package lives on Nate's OneDrive and is being delivered to counsel.
 *
 * PRIVACY / SCOPE:
 *   This ETL is deliberately minimal. It does NOT parse document contents,
 *   does NOT copy filenames into the DB, and does NOT record monetary amounts,
 *   witness names, or legal strategy. It only creates a small set of
 *   `InboxItem` reminders so Nate sees the matter in his inbox with a pointer
 *   back to the OneDrive folder where the real evidence lives.
 *
 * Source (read-only):
 *   C:\Users\natha\OneDrive\Abel Lumber\MG Financial Evidence for Counsel\
 *   We stat the tree for (count of files, total bytes) only.
 *
 * Output InboxItems (1-3 total, all priority CRITICAL — litigation is
 * time-sensitive):
 *   1. Folder pointer: "Evidence package contains N files totaling X MB at <path>"
 *   2. Review-before-next-status-conference reminder.
 *   3. (optional) A calendar-nudge reminder to sync with counsel.
 *
 * Idempotency: upsert on (source, entityType, entityId).
 *
 * Modes:
 *   (default)  DRY-RUN — prints plan, writes nothing.
 *   --commit   applies upserts.
 *
 * Usage:
 *   npx tsx scripts/etl-mg-financial.ts
 *   npx tsx scripts/etl-mg-financial.ts --commit
 */

import { PrismaClient } from '@prisma/client'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as crypto from 'node:crypto'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const DRY_RUN = !process.argv.includes('--commit')
const SOURCE_TAG = 'MG_FINANCIAL_LITIGATION'
const ABEL_FOLDER = path.resolve(__dirname, '..', '..')
const EVIDENCE_FOLDER = path.join(ABEL_FOLDER, 'MG Financial Evidence for Counsel')

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
 * Walk the evidence folder and return (file count, total bytes).
 * We do NOT collect filenames — only aggregate stats.
 */
function scanEvidence(root: string): { fileCount: number; totalBytes: number } {
  if (!fs.existsSync(root)) {
    throw new Error(`Evidence folder missing: ${root}`)
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
  console.log('  MG FINANCIAL LITIGATION — evidence tracker ETL')
  console.log(`  Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'COMMIT'}`)
  console.log('═'.repeat(64))

  const { fileCount, totalBytes } = scanEvidence(EVIDENCE_FOLDER)
  const totalMb = totalBytes / 1024 / 1024
  console.log(`\nEvidence folder scanned (aggregate only — no filenames logged):`)
  console.log(`  Path:       ${EVIDENCE_FOLDER}`)
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
        entityType: 'LegalMatter',
        entityId: 'MG_FINANCIAL_EVIDENCE_PACKAGE',
        type: 'LEGAL_REVIEW',
        title: 'MG Financial litigation — evidence package on OneDrive',
        description:
          `Evidence package contains ${fileCount} files totaling ${totalMb.toFixed(2)} MB at ` +
          `[${EVIDENCE_FOLDER}]. Do not move, rename, or delete files without coordinating ` +
          `with counsel (preservation obligation). Sensitive material — contents intentionally ` +
          `not indexed in Aegis.`,
        priority: 'CRITICAL',
        actionData: {
          source: SOURCE_TAG,
          folderPath: EVIDENCE_FOLDER,
          fileCount,
          totalBytes,
          totalMb: Number(totalMb.toFixed(2)),
          note: 'Aggregate stats only. No filenames, amounts, or witness data stored here.',
        },
      })
      if (result === 'created') created++
      else if (result === 'updated') updated++
      else skipped++
      console.log(`  [POINTER]         MG_FINANCIAL_EVIDENCE_PACKAGE -> ${result}`)
    }

    // 2. Pre-conference review reminder
    {
      const result = await upsertInboxItem(prisma, {
        entityType: 'LegalMatter',
        entityId: 'MG_FINANCIAL_PRE_CONFERENCE_REVIEW',
        type: 'LEGAL_REVIEW',
        title: 'MG Financial — review evidence package before next status conference',
        description:
          `Reminder: walk the evidence package with counsel before the next scheduled status ` +
          `conference. Confirm the package is complete, nothing has been added/removed since ` +
          `last sync, and any new correspondence has been forwarded. Litigation hold remains ` +
          `in effect. Folder: [${EVIDENCE_FOLDER}].`,
        priority: 'CRITICAL',
        actionData: {
          source: SOURCE_TAG,
          folderPath: EVIDENCE_FOLDER,
          note: 'Calendar the next status-conference date once counsel confirms it.',
        },
      })
      if (result === 'created') created++
      else if (result === 'updated') updated++
      else skipped++
      console.log(`  [PRE-CONFERENCE]  MG_FINANCIAL_PRE_CONFERENCE_REVIEW -> ${result}`)
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
