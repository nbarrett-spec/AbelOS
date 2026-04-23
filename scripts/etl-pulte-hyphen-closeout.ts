/**
 * scripts/etl-pulte-hyphen-closeout.ts
 *
 * Two-track close-out ETL (flag-only, no destructive writes):
 *
 *  Track 1 — PULTE_HUBSPOT_CLOSEOUT (4 items)
 *    Pulte / PulteGroup / Centex / Del Webb confirmed LOST 2026-04-20.
 *    Creates HubSpot-facing close-out reminders. Note: does NOT mutate
 *    Builder.status for Pulte — winddown rules defer that to Nate.
 *
 *  Track 2 — HYPHEN_DIAGNOSTIC (2 items)
 *    Brookfield (BWP) is now top active builder. Hyphen integration is
 *    partially broken: only a fraction of Brookfield Jobs have a linked
 *    hyphenJobId, blocking Rev4 ship-date visibility for Amanda Barham.
 *    Script queries the Aegis DB for live linkage stats, writes the
 *    actual number into the CRITICAL InboxItem title/description.
 *
 * Idempotent upsert on (source, entityType, entityId). Safe to re-run.
 *
 * Modes:
 *   (default)  DRY-RUN — prints plan, writes nothing.
 *   --commit   applies upserts.
 *
 * Usage:
 *   npx tsx scripts/etl-pulte-hyphen-closeout.ts
 *   npx tsx scripts/etl-pulte-hyphen-closeout.ts --commit
 *
 * Footer boilerplate — see etl-pulte-winddown.ts for the sibling ETL that
 * flags the 21 open PO cancel/reduce actions. This script is the tier-up
 * closeout (HubSpot, goodbye email, Aegis status) + the Hyphen diagnostic.
 */

import { PrismaClient } from '@prisma/client'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const DRY_RUN = !process.argv.includes('--commit')
const PULTE_SOURCE_TAG = 'PULTE_HUBSPOT_CLOSEOUT'
const HYPHEN_SOURCE_TAG = 'HYPHEN_DIAGNOSTIC'
const WINDDOWN_CONFIRMED_DATE = '2026-04-20'
const TODAY = new Date('2026-04-22T00:00:00Z') // pinned to CLAUDE.md currentDate
const BROOKFIELD_PO_REF_TOTAL = 80 // per CLAUDE.md note "0/80 linked"

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

function daysFromToday(n: number): Date {
  const d = new Date(TODAY)
  d.setUTCDate(d.getUTCDate() + n)
  return d
}

async function upsertInboxItem(
  prisma: PrismaClient,
  args: {
    source: string
    entityType: string
    entityId: string
    type: string
    title: string
    description: string
    priority: Priority
    financialImpact: number | null
    dueBy: Date | null
    actionData: Record<string, unknown>
  },
): Promise<'created' | 'updated' | 'skipped'> {
  type ExistingRow = { id: string; status: string }
  const existing = await prisma.$queryRawUnsafe<ExistingRow[]>(
    `SELECT id, status FROM "InboxItem"
       WHERE source = $1 AND "entityType" = $2 AND "entityId" = $3
       LIMIT 1`,
    args.source,
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
             "financialImpact" = $5,
             "dueBy" = $6,
             "actionData" = $7::jsonb,
             "updatedAt" = NOW()
         WHERE id = $8`,
      args.type,
      args.title,
      args.description,
      args.priority,
      args.financialImpact,
      args.dueBy,
      JSON.stringify(args.actionData),
      hit.id,
    )
    return 'updated'
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "InboxItem"
       (id, type, source, title, description, priority, status,
        "entityType", "entityId", "financialImpact", "dueBy",
        "actionData", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,NOW(),NOW())`,
    cuidish(),
    args.type,
    args.source,
    args.title,
    args.description,
    args.priority,
    'PENDING',
    args.entityType,
    args.entityId,
    args.financialImpact,
    args.dueBy,
    JSON.stringify(args.actionData),
  )
  return 'created'
}

async function getHyphenLinkageStats(prisma: PrismaClient): Promise<{
  brookfieldJobsTotal: number
  brookfieldJobsLinked: number
  hyphenOrdersIngested: number
  linkagePct: number
}> {
  const total = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS n FROM "Job" WHERE LOWER("builderName") LIKE '%brookfield%'`,
  )
  const linked = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS n FROM "Job"
       WHERE LOWER("builderName") LIKE '%brookfield%'
         AND "hyphenJobId" IS NOT NULL`,
  )
  const orders = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int AS n FROM "HyphenOrder"`,
  )
  const brookfieldJobsTotal = total[0]?.n ?? 0
  const brookfieldJobsLinked = linked[0]?.n ?? 0
  const hyphenOrdersIngested = orders[0]?.n ?? 0
  const linkagePct =
    brookfieldJobsTotal === 0
      ? 0
      : Math.round((brookfieldJobsLinked / brookfieldJobsTotal) * 1000) / 10
  return {
    brookfieldJobsTotal,
    brookfieldJobsLinked,
    hyphenOrdersIngested,
    linkagePct,
  }
}

async function main() {
  console.log('═'.repeat(64))
  console.log('  PULTE HUBSPOT CLOSEOUT + HYPHEN DIAGNOSTIC — flag-only ETL')
  console.log(`  Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'COMMIT'}`)
  console.log(`  Pulte LOST confirmed: ${WINDDOWN_CONFIRMED_DATE}`)
  console.log('═'.repeat(64))

  const prisma = new PrismaClient()
  try {
    // ── Diagnostic query: actual Hyphen linkage stats ─────────────────
    const stats = await getHyphenLinkageStats(prisma)
    console.log('\nHyphen linkage diagnostic:')
    console.log(`  Brookfield Jobs total:         ${stats.brookfieldJobsTotal}`)
    console.log(`  Brookfield Jobs w/ hyphenJobId:${stats.brookfieldJobsLinked}`)
    console.log(`  HyphenOrder rows ingested:     ${stats.hyphenOrdersIngested}`)
    console.log(`  Linkage:                       ${stats.linkagePct}%`)
    console.log(`  Reference target per CLAUDE.md note: ${BROOKFIELD_PO_REF_TOTAL} Brookfield POs`)

    let created = 0
    let updated = 0
    let skipped = 0
    const bump = (r: 'created' | 'updated' | 'skipped') => {
      if (r === 'created') created++
      else if (r === 'updated') updated++
      else skipped++
    }

    // ── Track 1: PULTE HUBSPOT CLOSEOUT ────────────────────────────────
    console.log('\n--- Track 1: Pulte HubSpot Closeout ---')

    bump(
      await upsertInboxItem(prisma, {
        source: PULTE_SOURCE_TAG,
        entityType: 'Deal',
        entityId: 'PULTE-HUBSPOT-CLOSED-LOST',
        type: 'DEAL_FOLLOWUP',
        title: 'Mark Pulte deal Closed Lost in HubSpot',
        description:
          `Pulte / PulteGroup / Centex / Del Webb account confirmed LOST on ${WINDDOWN_CONFIRMED_DATE}. ` +
          `Doug Gough (Senior Procurement) confirmed Treeline → 84 Lumber; Mobberly Farms moved March. ` +
          `In-person meeting declined.\n\n` +
          `Action: open HubSpot, set Pulte deal stage to "Closed Lost" with reason "Incumbent vendor ` +
          `switch (84 Lumber)". Log Doug Gough conversation summary on the contact. Archive associated ` +
          `deal line-items.`,
        priority: 'CRITICAL',
        financialImpact: null,
        dueBy: daysFromToday(1),
        actionData: {
          source: PULTE_SOURCE_TAG,
          hubspotAction: 'set_deal_stage',
          targetStage: 'Closed Lost',
          lostReason: 'Incumbent vendor switch (84 Lumber)',
          winddownConfirmedDate: WINDDOWN_CONFIRMED_DATE,
        },
      }),
    )

    bump(
      await upsertInboxItem(prisma, {
        source: PULTE_SOURCE_TAG,
        entityType: 'Contact',
        entityId: 'PULTE-DOUG-GOUGH-GOODBYE',
        type: 'OUTREACH_REVIEW',
        title: 'Send Doug Gough goodbye email — offer future consideration',
        description:
          `Professional closeout email to Doug Gough (Senior Procurement, Pulte). Acknowledge the ` +
          `decision, thank him for the relationship, leave the door open for future DFW divisions or ` +
          `product categories where 84 Lumber can't cover. Keep tone quietly competent — no oversell, ` +
          `no bitterness. Per brand voice rules (memory/brand/voice.md) before sending.\n\n` +
          `Talking points: we respect the call; continue to cover open POs in winddown; reach out any ` +
          `time on doors/trim/hardware where Treeline falls short.`,
        priority: 'HIGH',
        financialImpact: null,
        dueBy: daysFromToday(3),
        actionData: {
          source: PULTE_SOURCE_TAG,
          recipient: 'Doug Gough',
          recipientTitle: 'Senior Procurement, PulteGroup',
          brandVoiceRef: 'memory/brand/voice.md',
          tone: 'quiet-competence',
        },
      }),
    )

    bump(
      await upsertInboxItem(prisma, {
        source: PULTE_SOURCE_TAG,
        entityType: 'Deal',
        entityId: 'PULTE-OPEN-POS-CANCEL-21',
        type: 'PO_APPROVAL',
        title: 'Cancel 21 open Pulte POs per A15 winddown items',
        description:
          `21 open POs (~$32.5K exposure) tagged in pulte-winddown ETL (15 CANCEL + 6 REDUCE). ` +
          `Each has its own InboxItem under source='pulte-winddown'. This is the umbrella/rollup ` +
          `reminder: confirm all 21 are worked before closing the Pulte account file.\n\n` +
          `Filter inbox by source='pulte-winddown' to see per-PO items. Check vendor restocking ` +
          `fees and in-transit items before cancelling.`,
        priority: 'HIGH',
        financialImpact: 32500,
        dueBy: daysFromToday(7),
        actionData: {
          source: PULTE_SOURCE_TAG,
          relatedSource: 'pulte-winddown',
          cancelCount: 15,
          reduceCount: 6,
          totalOpenPos: 21,
          estimatedExposure: 32500,
        },
      }),
    )

    bump(
      await upsertInboxItem(prisma, {
        source: PULTE_SOURCE_TAG,
        entityType: 'Builder',
        entityId: 'PULTE-BUILDER-STATUS-UPDATE',
        type: 'SYSTEM',
        title: 'Update Aegis Builder.status for Pulte to LOST',
        description:
          `Per winddown rules, Claude does NOT modify Builder.status directly for Pulte — Nate owns ` +
          `that change. This item is a reminder only.\n\n` +
          `Action (Nate): open Aegis builders admin, find Pulte/PulteGroup/Centex/Del Webb builder ` +
          `rows, set status → LOST (or INACTIVE if LOST isn't in AccountStatus enum yet; check enum ` +
          `in prisma/schema.prisma). Add note citing ${WINDDOWN_CONFIRMED_DATE} Doug Gough confirmation.`,
        priority: 'MEDIUM',
        financialImpact: null,
        dueBy: daysFromToday(14),
        actionData: {
          source: PULTE_SOURCE_TAG,
          builderNames: ['Pulte', 'PulteGroup', 'Centex', 'Del Webb'],
          targetStatus: 'LOST',
          fallbackStatus: 'INACTIVE',
          note: 'Reminder only. Do not auto-modify Builder.status — deferred to Nate per winddown rules.',
        },
      }),
    )

    // ── Track 2: HYPHEN DIAGNOSTIC ─────────────────────────────────────
    console.log('\n--- Track 2: Hyphen Diagnostic ---')

    const linkedDisplay = `${stats.brookfieldJobsLinked} of ${BROOKFIELD_PO_REF_TOTAL}`
    const hyphenTitle =
      `Hyphen integration: ${linkedDisplay} Brookfield POs linked — blocking Rev4 ship-date ` +
      `visibility for Amanda Barham`

    bump(
      await upsertInboxItem(prisma, {
        source: HYPHEN_SOURCE_TAG,
        entityType: 'Integration',
        entityId: 'HYPHEN-BROOKFIELD-LINKAGE',
        type: 'SYSTEM',
        title: hyphenTitle,
        description:
          `Hyphen is Brookfield's PM portal. Aegis pulls HyphenOrder rows but cross-linking to our ` +
          `Job.hyphenJobId is failing / not running.\n\n` +
          `Live counts (as of ${TODAY.toISOString().slice(0, 10)}):\n` +
          `  • Brookfield Jobs in Aegis:          ${stats.brookfieldJobsTotal}\n` +
          `  • Brookfield Jobs w/ hyphenJobId:    ${stats.brookfieldJobsLinked}\n` +
          `  • HyphenOrder rows ingested:         ${stats.hyphenOrdersIngested}\n` +
          `  • Linkage:                           ${stats.linkagePct}%\n\n` +
          `Business impact: Amanda Barham (Brookfield) received Rev4 Plan Breakdown 4/20. Without ` +
          `Hyphen→Job linkage, we cannot surface ship-date visibility back into her portal, which ` +
          `blocks the value-engineering proposal follow-through. Rev4 timeline is exposed.\n\n` +
          `Diagnostic path:\n` +
          `  1. Check src/lib/integrations/hyphen.ts for matcher logic.\n` +
          `  2. Review scripts/diagnose-hyphen-overlap.mjs output.\n` +
          `  3. Run/build the PO-matching backfill (see linked HIGH item).`,
        priority: 'CRITICAL',
        financialImpact: null,
        dueBy: daysFromToday(2),
        actionData: {
          source: HYPHEN_SOURCE_TAG,
          diagnostic: stats,
          referenceTotalPos: BROOKFIELD_PO_REF_TOTAL,
          linkedDisplay,
          stakeholder: 'Amanda Barham (Brookfield)',
          blockingProposal: 'Rev4 Plan Breakdown ship-date visibility',
          codePaths: [
            'src/lib/integrations/hyphen.ts',
            'scripts/diagnose-hyphen-overlap.mjs',
            'scripts/import-hyphen-brookfield.mjs',
          ],
        },
      }),
    )

    bump(
      await upsertInboxItem(prisma, {
        source: HYPHEN_SOURCE_TAG,
        entityType: 'Integration',
        entityId: 'HYPHEN-BACKFILL-PO-MATCH',
        type: 'AGENT_TASK',
        title: 'Run manual Hyphen PO-matching backfill script if one exists, else build one',
        description:
          `No dedicated Hyphen PO-matching backfill was found in scripts/ (only _hyphen-quick-check.mjs, ` +
          `diagnose-hyphen-overlap.mjs, import-hyphen-brookfield.mjs). Existing import script may not ` +
          `cross-link HyphenOrder rows to Job.hyphenJobId.\n\n` +
          `Steps:\n` +
          `  1. Audit scripts/import-hyphen-brookfield.mjs — does it set Job.hyphenJobId on write?\n` +
          `  2. If not, build scripts/backfill-hyphen-job-links.ts that matches HyphenOrder rows to ` +
          `     Job rows on (lotBlock, community, builderName≈Brookfield) and sets hyphenJobId.\n` +
          `  3. Dry-run first, verify match quality against a sample, then --commit.\n` +
          `  4. Once ≥80% linked, close the sibling CRITICAL (HYPHEN-BROOKFIELD-LINKAGE) item.`,
        priority: 'HIGH',
        financialImpact: null,
        dueBy: daysFromToday(5),
        actionData: {
          source: HYPHEN_SOURCE_TAG,
          existingScripts: [
            'scripts/_hyphen-quick-check.mjs',
            'scripts/diagnose-hyphen-overlap.mjs',
            'scripts/import-hyphen-brookfield.mjs',
          ],
          proposedNewScript: 'scripts/backfill-hyphen-job-links.ts',
          successThreshold: '≥80% of Brookfield Jobs with hyphenJobId',
        },
      }),
    )

    // ── Summary ─────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(64))
    console.log(`  ${DRY_RUN ? 'Would' : 'Did'} create: ${created}`)
    console.log(`  ${DRY_RUN ? 'Would' : 'Did'} update: ${updated}`)
    console.log(`  Skipped (already resolved): ${skipped}`)
    console.log(
      `  Total InboxItems: ${created + updated + skipped} (expected 6: 4 Pulte + 2 Hyphen)`,
    )
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
