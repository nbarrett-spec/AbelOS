/**
 * relationship-integrity-check.ts — READ-ONLY referential-integrity diagnostic.
 *
 * Scope (expanded beyond the earlier InboxItem.Order check):
 *   1. InboxItem.(entityType, entityId) — every distinct entityType
 *   2. CollectionAction.invoiceId → Invoice       (FK already declared, verified anyway)
 *   3. CollectionAction.sentBy    → Staff         (soft ref)
 *   4. AccountTouchpoint.builderId → Builder     (soft ref — no FK)
 *   5. AccountTouchpoint.staffId   → Staff       (soft ref)
 *   6. BuilderPricing.builderId    → Builder     (FK declared)
 *   7. BuilderPricing.productId    → Product     (FK declared)
 *   8. CommunityFloorPlan.communityId → Community (FK declared)
 *   9. Staff.managerId             → Staff       (self-ref, post-hierarchy migration)
 *
 * Strategy: raw SQL `LEFT JOIN ... WHERE target.id IS NULL` against the pg pool
 * so we can dynamically pivot InboxItem.entityType onto whatever table it names.
 * Prisma is used ONLY for counts and sample rows — never writes.
 *
 * Run: npx tsx scripts/relationship-integrity-check.ts
 *
 * ──────────────────────────────────────────────────────────────────────
 * Abel Lumber — Aegis OS · 2026-04-22
 * Author: Nate Barrett / Aegis ops · READ-ONLY audit
 * ──────────────────────────────────────────────────────────────────────
 */

import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const prisma = new PrismaClient()

const REPORT_PATH = 'C:/Users/natha/OneDrive/Abel Lumber/AEGIS-INTEGRITY-REPORT.md'

/** entityType value → actual Postgres table name (case-sensitive, quoted) */
const ENTITY_TYPE_TABLE: Record<string, string> = {
  Builder:        '"Builder"',
  Staff:          '"Staff"',
  PurchaseOrder:  '"PurchaseOrder"',
  Product:        '"Product"',
  Deal:           '"Deal"',
  Delivery:       '"Delivery"',
  Job:            '"Job"',
  Vendor:         '"Vendor"',
  Order:          '"Order"',
  Invoice:        '"Invoice"',
  Task:           '"Task"',
  Project:        '"Project"',
  Quote:          '"Quote"',
  Community:      '"Community"',
  Contract:       '"Contract"',
  CollectionAction: '"CollectionAction"',
  // extend as new types appear
}

interface OrphanResult {
  label: string
  totalRefs: number
  orphanCount: number
  orphanSamples: string[]
  unknownType?: boolean
  note?: string
}

const results: OrphanResult[] = []

function push(r: OrphanResult) {
  results.push(r)
  const badge = r.orphanCount > 0 ? '[ORPHAN]' : '[OK]'
  console.log(`${badge} ${r.label}  refs=${r.totalRefs}  orphans=${r.orphanCount}`)
  if (r.orphanSamples.length) {
    console.log(`       sample ids: ${r.orphanSamples.join(', ')}`)
  }
  if (r.note) console.log(`       note: ${r.note}`)
}

async function checkInboxItem() {
  console.log('\n── InboxItem.(entityType, entityId) ───────────────────────')

  const types = await prisma.$queryRawUnsafe<Array<{ entityType: string | null; n: bigint }>>(
    `SELECT "entityType", COUNT(*)::bigint AS n
       FROM "InboxItem"
      WHERE "entityId" IS NOT NULL
      GROUP BY "entityType"
      ORDER BY n DESC`,
  )

  for (const row of types) {
    const et = row.entityType
    const total = Number(row.n)

    if (!et) {
      push({
        label: `InboxItem[entityType=<NULL but entityId set>]`,
        totalRefs: total,
        orphanCount: total,
        orphanSamples: [],
        note: 'entityId set but entityType null — impossible to resolve',
      })
      continue
    }

    const target = ENTITY_TYPE_TABLE[et]
    if (!target) {
      push({
        label: `InboxItem[entityType=${et}]`,
        totalRefs: total,
        orphanCount: 0,
        orphanSamples: [],
        unknownType: true,
        note: `entityType not in mapping — cannot verify`,
      })
      continue
    }

    const orphans = await prisma.$queryRawUnsafe<Array<{ id: string; entityId: string }>>(
      `SELECT i.id, i."entityId"
         FROM "InboxItem" i
         LEFT JOIN ${target} t ON t.id = i."entityId"
        WHERE i."entityType" = $1
          AND i."entityId" IS NOT NULL
          AND t.id IS NULL
        LIMIT 10`,
      et,
    )

    const orphanCountRow = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*)::bigint AS n
         FROM "InboxItem" i
         LEFT JOIN ${target} t ON t.id = i."entityId"
        WHERE i."entityType" = $1
          AND i."entityId" IS NOT NULL
          AND t.id IS NULL`,
      et,
    )
    const orphanCount = Number(orphanCountRow[0]?.n ?? 0)

    push({
      label: `InboxItem[entityType=${et}] → ${target}`,
      totalRefs: total,
      orphanCount,
      orphanSamples: orphans.map((o) => `${o.id}->${o.entityId}`),
    })
  }
}

async function checkSoftRef(
  label: string,
  sourceTable: string,
  column: string,
  targetTable: string,
) {
  const totalRow = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*)::bigint AS n FROM ${sourceTable} WHERE "${column}" IS NOT NULL`,
  )
  const total = Number(totalRow[0]?.n ?? 0)

  const orphanCountRow = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*)::bigint AS n
       FROM ${sourceTable} s
       LEFT JOIN ${targetTable} t ON t.id = s."${column}"
      WHERE s."${column}" IS NOT NULL AND t.id IS NULL`,
  )
  const orphanCount = Number(orphanCountRow[0]?.n ?? 0)

  const samples = await prisma.$queryRawUnsafe<Array<{ id: string; v: string }>>(
    `SELECT s.id, s."${column}" AS v
       FROM ${sourceTable} s
       LEFT JOIN ${targetTable} t ON t.id = s."${column}"
      WHERE s."${column}" IS NOT NULL AND t.id IS NULL
      LIMIT 10`,
  )

  push({
    label,
    totalRefs: total,
    orphanCount,
    orphanSamples: samples.map((r) => `${r.id}->${r.v}`),
  })
}

async function run() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  Aegis — Relationship Integrity Check (READ-ONLY)')
  console.log('  ' + new Date().toISOString())
  console.log('═══════════════════════════════════════════════════════════')

  await checkInboxItem()

  console.log('\n── Other entity-reference checks ──────────────────────────')
  await checkSoftRef(
    'CollectionAction.invoiceId → Invoice',
    '"CollectionAction"', 'invoiceId', '"Invoice"',
  )
  await checkSoftRef(
    'CollectionAction.sentBy → Staff',
    '"CollectionAction"', 'sentBy', '"Staff"',
  )
  await checkSoftRef(
    'AccountTouchpoint.builderId → Builder',
    '"AccountTouchpoint"', 'builderId', '"Builder"',
  )
  await checkSoftRef(
    'AccountTouchpoint.staffId → Staff',
    '"AccountTouchpoint"', 'staffId', '"Staff"',
  )
  await checkSoftRef(
    'BuilderPricing.builderId → Builder',
    '"BuilderPricing"', 'builderId', '"Builder"',
  )
  await checkSoftRef(
    'BuilderPricing.productId → Product',
    '"BuilderPricing"', 'productId', '"Product"',
  )
  await checkSoftRef(
    'CommunityFloorPlan.communityId → Community',
    '"CommunityFloorPlan"', 'communityId', '"Community"',
  )
  await checkSoftRef(
    'Staff.managerId → Staff (self-ref, post-hierarchy migration)',
    '"Staff"', 'managerId', '"Staff"',
  )

  // ── Write report ────────────────────────────────────────────────────
  let sha = 'unknown'
  try {
    sha = execSync('git rev-parse HEAD', {
      cwd: 'C:/Users/natha/OneDrive/Abel Lumber/abel-builder-platform',
    }).toString().trim()
  } catch {
    /* ignore */
  }

  const total = results.reduce((a, r) => a + r.totalRefs, 0)
  const orphanTotal = results.reduce((a, r) => a + r.orphanCount, 0)
  const unknownTypes = results.filter((r) => r.unknownType).map((r) => r.label)

  const rows = results
    .map(
      (r) =>
        `| ${r.label} | ${r.totalRefs} | ${r.orphanCount} | ${
          r.orphanCount > 0 ? 'FAIL' : r.unknownType ? 'UNKNOWN_TYPE' : 'OK'
        } | ${r.orphanSamples.slice(0, 5).join(', ') || '—'} |`,
    )
    .join('\n')

  const criticalOrphans = results.filter(
    (r) =>
      r.orphanCount > 0 &&
      (r.label.includes('Builder') ||
        r.label.includes('Staff') ||
        r.label.includes('Community') ||
        r.label.includes('Invoice')),
  )

  const md = `# Aegis — Relationship Integrity Report

**Generated:** ${new Date().toISOString()}
**Git SHA:** \`${sha}\`
**DB:** Neon prod (read-only)

## Summary

- Total references examined: **${total}**
- Total orphan references: **${orphanTotal}**
- Unknown \`entityType\` values (not in mapping, skipped): ${
    unknownTypes.length ? unknownTypes.join(', ') : 'none'
  }
- Critical-table orphans (Builder / Staff / Community / Invoice): **${criticalOrphans.length}**

## Per-Check Results

| Check | Total Refs | Orphans | Status | Sample IDs |
|---|---:|---:|---|---|
${rows}

${
  criticalOrphans.length
    ? `## Critical Orphans\n\n${criticalOrphans
        .map(
          (r) =>
            `### ${r.label}\nOrphans: **${r.orphanCount}**\nSample IDs: ${r.orphanSamples.join(
              ', ',
            )}`,
        )
        .join('\n\n')}\n`
    : '## Critical Orphans\n\nNone.\n'
}

## Recommended Fixes

${
  orphanTotal === 0
    ? '- No orphans — referential integrity holds across all checked relations.\n- Consider promoting soft refs (AccountTouchpoint.builderId, Staff.managerId) to real FKs in schema.prisma so Prisma enforces it.'
    : `- For each orphan row, decide: (a) backfill the missing parent, or (b) null the reference.\n- Add Prisma FK constraints on the relations currently held together by convention (InboxItem.entityId is polymorphic so stays soft, but AccountTouchpoint.builderId/staffId and CollectionAction.sentBy should be promoted).\n- If orphans exist on Staff.managerId, verify today's hierarchy migration populated correctly before rolling out org-chart features.`
}

---
Abel Lumber — Aegis OS · ${new Date().toISOString().slice(0, 10)}
Read-only diagnostic. No database writes performed.
`

  writeFileSync(REPORT_PATH, md, 'utf8')
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log(`  Report written: ${REPORT_PATH}`)
  console.log(`  Total refs: ${total}   Orphans: ${orphanTotal}   SHA: ${sha}`)
  console.log('═══════════════════════════════════════════════════════════')
}

run()
  .catch((e) => {
    console.error('FATAL:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

// ──────────────────────────────────────────────────────────────────────
// Abel Lumber — Aegis OS · Relationship Integrity Check
// READ-ONLY. No writes. Safe to run against prod.
// ──────────────────────────────────────────────────────────────────────
