/**
 * scripts/etl-misc-docs.ts
 *
 * MISC_DOCS_TRIAGE — triages five remaining workspace docs sitting loose at
 * the root of OneDrive/Abel Lumber/. For each we classify and either create
 * a pointer InboxItem (location + classification, no content extraction)
 * or an actionable InboxItem with specific next steps.
 *
 * Source files (paths relative to "C:/Users/natha/OneDrive/Abel Lumber/"):
 *   1. Abel Lumber Handbook.docx                                    — POINTER  (HR narrative)
 *   2. Abel Lumber - Delivery RFQ.docx                              — REFERENCE (already covered
 *       by A30 / DELIVERY_OUTSOURCING_EVAL_APR2026 rfq-deadline item — cross-link only)
 *   3. AMP – Pre Bid Walkthrough Checklist (Model Homes & ...).docx — ACTIONABLE (field ops SOP)
 *   4. Abel_Lumber_AI_Master_Plan.docx                              — POINTER  (strategy narrative)
 *   5. Abel Lumber v MG Financial - Evidence Summary for Counsel.docx — POINTER (litigation, sensitive)
 *
 * Writes: InboxItem rows only. NO Builder / Product / InventoryItem / Vendor.
 *
 * Usage:
 *   npx tsx scripts/etl-misc-docs.ts           # DRY-RUN
 *   npx tsx scripts/etl-misc-docs.ts --commit  # persist
 */

import { PrismaClient } from '@prisma/client'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const SRC_TAG = 'MISC_DOCS_TRIAGE'

function hashId(k: string): string {
  return 'misc_' + crypto.createHash('sha256').update(`${SRC_TAG}::${k}`).digest('hex').slice(0, 18)
}

type Item = {
  key: string
  type: string
  title: string
  description: string
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  financialImpact?: number | null
  dueBy?: Date | null
  actionData: Record<string, unknown>
}

const ROOT = 'C:/Users/natha/OneDrive/Abel Lumber/'

const items: Item[] = [
  // --------------------------------------------------------------------
  // 1) Handbook — POINTER. HR narrative, no content extraction.
  // --------------------------------------------------------------------
  {
    key: 'handbook-pointer',
    type: 'SYSTEM',
    title: '[POINTER] Abel Lumber Employee Handbook — located at OneDrive root',
    description:
      'Pointer record for the current Abel Lumber Employee Handbook (992 KB .docx). ' +
      'Narrative HR document — classification: HR_POLICY. Do NOT extract content into ' +
      'InboxItem (sensitive policy text, personnel data). Use this pointer when Dawn ' +
      '(Accounting Mgr) or Clint (COO) need to reference or revise. Next revision ' +
      'trigger: Josh buyout cap table update + Clint 1/3 ownership reflected in ' +
      'ownership section.',
    priority: 'LOW',
    actionData: {
      sourceTag: SRC_TAG,
      kind: 'pointer',
      classification: 'HR_POLICY',
      filePath: ROOT + 'Abel Lumber Handbook.docx',
      sizeKb: 992,
      extractedContent: false,
      owners: ['Dawn Meehan', 'Clint Vinson'],
      revisionTriggers: [
        'April 2026 Josh buyout — update ownership/cap table section',
        'Clint 1/3 ownership reflection',
      ],
    },
  },

  // --------------------------------------------------------------------
  // 2) Delivery RFQ — REFERENCE only (already covered by A30).
  // --------------------------------------------------------------------
  {
    key: 'delivery-rfq-crosslink',
    type: 'SYSTEM',
    title: '[XREF] Delivery RFQ doc — root-level copy; duplicate of DELIVERY_OUTSOURCING_EVAL item',
    description:
      'A copy of "Abel Lumber - Delivery RFQ.docx" also lives at the OneDrive root ' +
      '(13 KB). This content is ALREADY covered by the DELIVERY_OUTSOURCING_EVAL_APR2026 ' +
      'source tag (rfq-deadline InboxItem, due 4/30/2026). This row exists only as a ' +
      'cross-link so the root-level copy does not get re-ingested later. No action — ' +
      'the canonical version lives in Delivery Outsourcing/ folder.',
    priority: 'LOW',
    actionData: {
      sourceTag: SRC_TAG,
      kind: 'crosslink',
      classification: 'DUPLICATE_REFERENCE',
      filePath: ROOT + 'Abel Lumber - Delivery RFQ.docx',
      canonicalPath: ROOT + 'Delivery Outsourcing/Abel Lumber - Delivery RFQ.docx',
      canonicalSourceTag: 'DELIVERY_OUTSOURCING_EVAL_APR2026',
      canonicalKey: 'rfq-deadline',
      sizeKb: 13,
    },
  },

  // --------------------------------------------------------------------
  // 3) Pre-Bid Walkthrough Checklist — ACTIONABLE. Field ops SOP.
  //    Purpose: verify takeoffs match real site conditions before bidding
  //    on a new community/plan. Used by estimator (Lisa) + PMs.
  // --------------------------------------------------------------------
  {
    key: 'prebid-checklist-operationalize',
    type: 'AGENT_TASK',
    title: '[AMP] Operationalize Pre-Bid Walkthrough Checklist — turn .docx SOP into estimator workflow',
    description:
      'AMP Pre-Bid Walkthrough Checklist v1.0 (Aug 2025) is a field SOP for verifying ' +
      'takeoffs against real site conditions before bidding on a new community or plan ' +
      '(model homes + homes under construction). Covers: cover sheet, builder-standards ' +
      'reference (door sizes, jamb width, baseboard, casing, hardware), global conditions ' +
      '(ceilings, wall finishes, flooring transitions), exterior openings, interior door ' +
      'schedule, stairs, hardware, attic/closets, photo shot list. Currently lives as a ' +
      'loose .docx. NEXT STEPS: (1) convert to a form in Abel OS under Estimating module; ' +
      '(2) tie each walkthrough to a CommunityFloorPlan row so field deviations flow back ' +
      'to pricing; (3) assign default walker = Lisa Adams (estimator) or PM on account; ' +
      '(4) require walk-completion before any new-plan quote goes out. High leverage — ' +
      'most bid misses trace back to skipped walk or missing photos.',
    priority: 'HIGH',
    actionData: {
      sourceTag: SRC_TAG,
      kind: 'actionable',
      classification: 'FIELD_OPS_SOP',
      filePath: ROOT + 'AMP – Pre Bid Walkthrough Checklist (Model Homes & Homes Under Construction).docx',
      docVersion: '1.0',
      docDate: '2025-08-19',
      sizeKb: 30,
      nextSteps: [
        'Convert .docx checklist to Abel OS form under Estimating module',
        'Link each walkthrough to a CommunityFloorPlan row',
        'Default walker = Lisa Adams; fallback = PM on account',
        'Gate: require walk-completion before new-plan quote is sent',
      ],
      checklistSections: [
        'Cover Sheet (job + plan info)',
        'Builder Standards Reference',
        'Global Conditions',
        'Exterior Doors & Openings',
        'Interior Door Schedule',
        'Stairs / Rails',
        'Hardware / Attic / Closets',
        'Photo Shot List',
      ],
      owners: ['Lisa Adams', 'Chad Zeh', 'Brittney Werner', 'Thomas Robinson', 'Ben Wilson'],
    },
  },

  // --------------------------------------------------------------------
  // 4) AI Master Plan — POINTER. Strategy narrative.
  // --------------------------------------------------------------------
  {
    key: 'ai-master-plan-pointer',
    type: 'SYSTEM',
    title: '[POINTER] Abel Lumber AI Master Plan — strategy narrative at OneDrive root',
    description:
      'Pointer record for Abel_Lumber_AI_Master_Plan.docx (23 KB). Strategy narrative ' +
      'covering the Abel OS + NUC cluster vision. Classification: STRATEGY_NARRATIVE. ' +
      'Not extracted — living roadmap lives in ABEL-OS-ROADMAP.md and ' +
      'ABEL_NUC_MASTER_TRACKER.md which are the operational source of truth. Use this ' +
      '.docx only for external-facing narrative (bank, advisor, counsel) or when ' +
      're-grounding the long-view.',
    priority: 'LOW',
    actionData: {
      sourceTag: SRC_TAG,
      kind: 'pointer',
      classification: 'STRATEGY_NARRATIVE',
      filePath: ROOT + 'Abel_Lumber_AI_Master_Plan.docx',
      sizeKb: 23,
      extractedContent: false,
      livingDocs: ['ABEL-OS-ROADMAP.md', 'ABEL_NUC_MASTER_TRACKER.md'],
      audience: 'external narrative — bank / advisor / counsel',
    },
  },

  // --------------------------------------------------------------------
  // 5) MG Financial Evidence Summary — POINTER. Privileged, sensitive.
  // --------------------------------------------------------------------
  {
    key: 'mg-evidence-summary-pointer',
    type: 'SYSTEM',
    title: '[POINTER] MG Financial Evidence Summary for Counsel — do NOT extract (privileged)',
    description:
      'Pointer record for "Abel Lumber v MG Financial - Evidence Summary for Counsel.docx" ' +
      '(31 KB). LITIGATION / ATTORNEY-CLIENT PRIVILEGED. Classification: LEGAL_PRIVILEGED. ' +
      'Content deliberately NOT extracted. Related evidence package sits in ' +
      '"MG Financial Evidence for Counsel/" folder and has its own ETL tag ' +
      '(see etl-mg-financial.ts). This row exists so the root-level summary .docx is ' +
      'accounted for but opaque to the inbox. Access: Nate only; share only with outside ' +
      'counsel.',
    priority: 'LOW',
    actionData: {
      sourceTag: SRC_TAG,
      kind: 'pointer',
      classification: 'LEGAL_PRIVILEGED',
      filePath: ROOT + 'Abel Lumber v MG Financial - Evidence Summary for Counsel.docx',
      sizeKb: 31,
      extractedContent: false,
      relatedFolder: ROOT + 'MG Financial Evidence for Counsel/',
      relatedEtlScript: 'scripts/etl-mg-financial.ts',
      access: 'Nate + outside counsel only',
    },
  },
]

async function main() {
  console.log(`ETL Misc Docs Triage — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`Source tag: ${SRC_TAG}`)
  console.log(`Items to upsert: ${items.length} (cap: 10)`)
  console.log()
  for (const it of items) {
    const fin = it.financialImpact != null ? ` [$${it.financialImpact.toLocaleString()}]` : ''
    const due = it.dueBy ? ` [due ${it.dueBy.toISOString().slice(0, 10)}]` : ''
    console.log(`  + ${it.priority.padEnd(6)} ${it.title}${fin}${due}`)
  }
  console.log()

  if (items.length > 10) {
    throw new Error(`Cap exceeded: ${items.length} > 10`)
  }

  if (DRY_RUN) {
    console.log('DRY-RUN — re-run with --commit to persist.')
    return
  }

  const prisma = new PrismaClient()
  try {
    let created = 0
    let updated = 0
    for (const it of items) {
      const id = hashId(it.key)
      const res = await prisma.inboxItem.upsert({
        where: { id },
        create: {
          id,
          type: it.type,
          source: 'misc-docs-triage',
          title: it.title,
          description: it.description,
          priority: it.priority,
          status: 'PENDING',
          financialImpact: it.financialImpact ?? null,
          dueBy: it.dueBy ?? null,
          actionData: it.actionData as any,
        },
        update: {
          title: it.title,
          description: it.description,
          priority: it.priority,
          financialImpact: it.financialImpact ?? null,
          dueBy: it.dueBy ?? null,
          actionData: it.actionData as any,
        },
        select: { createdAt: true, updatedAt: true },
      })
      if (res.createdAt.getTime() === res.updatedAt.getTime()) created++
      else updated++
    }
    console.log(`InboxItems: created=${created} updated=${updated}`)
    console.log('DONE.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
