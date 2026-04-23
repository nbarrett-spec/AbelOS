/**
 * scripts/etl-file-triage.ts
 *
 * FILE_TRIAGE_APR2026 — triages two loose root-level files sitting in
 * OneDrive/Abel Lumber/ that had unclear purposes until now. Pointer-only.
 * NO CONTENT LOADING for either file — classification + file-path pointer
 * records only. The NUC team / caller handles any actual ingestion.
 *
 * Source files (paths relative to "C:/Users/natha/OneDrive/Abel Lumber/"):
 *   1. Abel-1000-Nano-Banana-Prompts.md                   — POINTER (AI image prompt library)
 *   2. Abel_OS_Seed_Data.xlsx                             — POINTER (Aegis seed-data candidate)
 *
 * Writes: InboxItem rows only. NO Builder / Product / InventoryItem / Staff.
 *
 * Cap: 3 InboxItems total (2 pointers + optional cross-link).
 *
 * Usage:
 *   npx tsx scripts/etl-file-triage.ts           # DRY-RUN
 *   npx tsx scripts/etl-file-triage.ts --commit  # persist
 */

import { PrismaClient } from '@prisma/client'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const SRC_TAG = 'FILE_TRIAGE_APR2026'

function hashId(k: string): string {
  return 'ftri_' + crypto.createHash('sha256').update(`${SRC_TAG}::${k}`).digest('hex').slice(0, 18)
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
  // 1) Abel-1000-Nano-Banana-Prompts.md — AI image prompt library.
  //    Inferred purpose: 1,000 text-to-image prompts written for Nano
  //    Banana / Gemini / Midjourney / Ideogram / Flux to generate brand
  //    imagery for Abel Doors & Trim (entry doors, interior doors, slab
  //    manufacturing line, etc.). Created for the brand asset pipeline
  //    (see Abel-Image-Pipeline/01_brand/brand_dna.json — canonical
  //    visual source of truth). Prompts are NOT business records and
  //    must NOT be expanded into InboxItem rows verbatim — pointer only.
  // --------------------------------------------------------------------
  {
    key: 'nano-banana-prompts-pointer',
    type: 'SYSTEM',
    title: '[POINTER] Abel-1000-Nano-Banana-Prompts.md — AI image prompt library (88 KB)',
    description:
      'Pointer record for "Abel-1000-Nano-Banana-Prompts.md" (88 KB, ~1,000 prompts). ' +
      'Classification: BRAND_ASSET_PROMPTS. Inferred purpose: master image-prompt library ' +
      'for Abel Doors & Trim, written for Nano Banana / Gemini / Midjourney / Ideogram / Flux. ' +
      'Sections cover entry doors, interior doors, Gainesville slab-manufacturing line, etc. ' +
      'NOT business data — do NOT expand prompts into individual InboxItems. Belongs with the ' +
      'brand-asset pipeline (see memory/brand/ and Abel-Image-Pipeline/01_brand/brand_dna.json). ' +
      'When the visual team needs prompts for a campaign, pull directly from the file.',
    priority: 'LOW',
    actionData: {
      sourceTag: SRC_TAG,
      kind: 'pointer',
      classification: 'BRAND_ASSET_PROMPTS',
      filePath: ROOT + 'Abel-1000-Nano-Banana-Prompts.md',
      sizeKb: 88,
      extractedContent: false,
      promptCount: 1000,
      targetModels: ['Nano Banana', 'Gemini', 'Midjourney', 'Ideogram', 'Flux'],
      subject: 'Abel Doors & Trim (entry doors, interior doors, slab-mfg line, trim/millwork)',
      relatedBrandSources: [
        'memory/brand/voice.md',
        'memory/brand/messaging-pillars.md',
        'Abel-Image-Pipeline/01_brand/brand_dna.json',
      ],
      owners: ['Nate Barrett', 'Marketing / brand lead'],
      doNotIngest: true,
    },
  },

  // --------------------------------------------------------------------
  // 2) Abel_OS_Seed_Data.xlsx — Aegis seed-data candidate workbook.
  //    Inspection (sheet names + row counts only, no content loaded):
  //      README, Enums, Staff (17), Vendors (14), Products (34),
  //      Builders (16), BuilderPricing (25), OrderTemplates (10),
  //      Deals (12), Contracts (11), Projects (14).
  //    Tabs map 1:1 to Aegis Prisma models. Likely a pre-April-13 seed
  //    draft. NUC team owns seeding plan — recommend they diff this
  //    against their canonical seed set before ingesting to avoid
  //    duplicate records in prod (already live at app.abellumber.com
  //    and tagged pre-seed-april-13-2026).
  // --------------------------------------------------------------------
  {
    key: 'aegis-seed-data-xlsx-pointer',
    type: 'SYSTEM',
    title: '[POINTER] Abel_OS_Seed_Data.xlsx — Aegis seed-data candidate (NUC team review)',
    description:
      'Pointer record for "Abel_OS_Seed_Data.xlsx" (48 KB). Classification: AEGIS_SEED_CANDIDATE. ' +
      'Appears to be a pre-go-live (pre April 13 2026) seed workbook for Aegis / Abel OS. ' +
      '11 sheets map 1:1 to Prisma models: README, Enums, Staff, Vendors, Products, Builders, ' +
      'BuilderPricing, OrderTemplates, Deals, Contracts, Projects. Content NOT loaded by this ' +
      'ETL — seeding is the NUC team / Aegis ops owners\' call. Recommendation: NUC team inspect ' +
      'for overlap with their current seed plan before any ingest (prod is already live and seeded; ' +
      'risk of duplicate Staff / Builder / Product rows). If superseded, archive; if still useful, ' +
      'route through a dedicated seed script with upsert-by-natural-key.',
    priority: 'MEDIUM',
    actionData: {
      sourceTag: SRC_TAG,
      kind: 'pointer',
      classification: 'AEGIS_SEED_CANDIDATE',
      filePath: ROOT + 'Abel_OS_Seed_Data.xlsx',
      sizeKb: 48,
      extractedContent: false,
      sheets: [
        { name: 'README', rows: 22 },
        { name: 'Enums', rows: 12 },
        { name: 'Staff', rows: 17 },
        { name: 'Vendors', rows: 14 },
        { name: 'Products', rows: 34 },
        { name: 'Builders', rows: 16 },
        { name: 'BuilderPricing', rows: 25 },
        { name: 'OrderTemplates', rows: 10 },
        { name: 'Deals', rows: 12 },
        { name: 'Contracts', rows: 11 },
        { name: 'Projects', rows: 14 },
      ],
      recommendedOwner: 'NUC team',
      recommendation:
        'NUC team: inspect this workbook for overlap with the canonical Aegis seed plan. ' +
        'Prod is already live (tagged go-live-2026-04-13). Do NOT bulk-import without ' +
        'upsert-by-natural-key guards — Staff/Builders/Products/Contracts are already populated.',
      risks: [
        'Duplicate Staff rows (13 active users already in prod)',
        'Duplicate Builder rows (top-12 builders already loaded via etl-builder-accounts.ts)',
        'Stale Pulte-era rows — Pulte account lost 2026-04-20, seed may still list as active',
      ],
      doNotIngest: true,
    },
  },
]

async function main() {
  console.log(`ETL File Triage (Apr 2026) — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`Source tag: ${SRC_TAG}`)
  console.log(`Items to upsert: ${items.length} (cap: 3)`)
  console.log()
  for (const it of items) {
    const fin = it.financialImpact != null ? ` [$${it.financialImpact.toLocaleString()}]` : ''
    const due = it.dueBy ? ` [due ${it.dueBy.toISOString().slice(0, 10)}]` : ''
    console.log(`  + ${it.priority.padEnd(6)} ${it.title}${fin}${due}`)
  }
  console.log()

  if (items.length > 3) {
    throw new Error(`Cap exceeded: ${items.length} > 3`)
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
          source: 'file-triage-apr2026',
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
