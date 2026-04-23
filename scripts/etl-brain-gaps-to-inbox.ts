/**
 * scripts/etl-brain-gaps-to-inbox.ts
 *
 * Pulls Brain's knowledge-gap list (entities with missing attributes) from the
 * jarvis-command-center proxy and materializes each gap as an Aegis InboxItem
 * so Nate can work the backfill queue from the unified inbox.
 *
 * Source tag: BRAIN_GAP_BACKFILL
 *   - InboxItem IDs are deterministic (hashed from source tag + gap_id) so the
 *     script is safe to re-run — existing items update in place, no dupes.
 *   - Capped at 100 items per run to avoid flooding the inbox.
 *
 * Proxy: https://jarvis-command-center-navy.vercel.app/api/brain?endpoint=/brain/gaps
 *
 * Usage:
 *   npx tsx scripts/etl-brain-gaps-to-inbox.ts            # DRY-RUN (default)
 *   npx tsx scripts/etl-brain-gaps-to-inbox.ts --commit   # write to DB
 */

import { PrismaClient } from '@prisma/client'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')

const PROXY_URL =
  'https://jarvis-command-center-navy.vercel.app/api/brain?endpoint=/brain/gaps'
const SOURCE_TAG = 'BRAIN_GAP_BACKFILL'
const MAX_ITEMS = 100

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface BrainGap {
  id: string
  entity_id: string
  field?: string
  description: string
  priority?: string // P1 | P2 | P3 ...
  gap_type?: string
  suggested_resolution?: string | null
  assigned_agent?: string | null
  estimated_effort?: string | null
  status?: string
  detected_at?: string
  detected_by?: string
}

interface InboxData {
  id: string
  type: string
  source: string
  title: string
  description: string
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  entityType?: string
  entityId?: string
  actionData?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hashId(sourceTag: string, gapId: string): string {
  return (
    'ib_braingap_' +
    crypto
      .createHash('sha256')
      .update(`${sourceTag}::${gapId}`)
      .digest('hex')
      .slice(0, 20)
  )
}

function mapPriority(p?: string): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' {
  const v = (p ?? '').toUpperCase().trim()
  if (v === 'P0') return 'CRITICAL'
  if (v === 'P1') return 'HIGH'
  if (v === 'P2') return 'MEDIUM'
  if (v === 'P3' || v === 'P4') return 'LOW'
  return 'MEDIUM'
}

function entityNameFromId(entityId: string): string {
  // Turn "cust_brookfield" -> "Cust Brookfield", "vend_boise_cascade" -> "Vend Boise Cascade"
  // It's intentionally lossy; Brain's entity_id is the canonical reference.
  return entityId
    .split(/[_\-:]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

async function fetchGaps(): Promise<BrainGap[]> {
  // The proxy caps each call at 50 gaps and ignores pagination params; we try
  // a couple of known knobs and de-dupe. Brain reports ~234 total; if the
  // proxy only hands back 50, we work with what we get — still useful.
  const seen = new Map<string, BrainGap>()
  const attempts: string[] = [
    PROXY_URL,
    `${PROXY_URL}&limit=300`,
    `${PROXY_URL}&offset=50`,
    `${PROXY_URL}&offset=100`,
    `${PROXY_URL}&offset=150`,
    `${PROXY_URL}&offset=200`,
    `${PROXY_URL}&status=open`,
    `${PROXY_URL}&priority=P1`,
    `${PROXY_URL}&priority=P2`,
  ]
  for (const url of attempts) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      const body = (await res.json()) as { gaps?: BrainGap[] }
      const gaps = body?.gaps ?? []
      for (const g of gaps) {
        if (g && g.id && !seen.has(g.id)) seen.set(g.id, g)
      }
    } catch (e) {
      console.warn(`  fetch failed for ${url}:`, (e as Error).message)
    }
  }
  return Array.from(seen.values())
}

function toInboxItem(gap: BrainGap): InboxData {
  const entityName = entityNameFromId(gap.entity_id || 'unknown')
  const priority = mapPriority(gap.priority)
  const title = `[BRAIN GAP] ${entityName}: ${gap.description}`.slice(0, 240)

  const descParts: string[] = []
  descParts.push(`Entity: ${gap.entity_id}`)
  if (gap.field) descParts.push(`Missing field: ${gap.field}`)
  if (gap.gap_type) descParts.push(`Gap type: ${gap.gap_type}`)
  descParts.push(`What's missing: ${gap.description}`)
  if (gap.suggested_resolution) descParts.push(`Suggested: ${gap.suggested_resolution}`)
  if (gap.assigned_agent) descParts.push(`Assigned agent: ${gap.assigned_agent}`)
  if (gap.estimated_effort) descParts.push(`Effort: ${gap.estimated_effort}`)
  if (gap.detected_at) descParts.push(`Detected: ${gap.detected_at}`)
  if (gap.detected_by) descParts.push(`Detected by: ${gap.detected_by}`)
  descParts.push(`Brain gap ID: ${gap.id}`)
  descParts.push(`Source: ${SOURCE_TAG}`)

  return {
    id: hashId(SOURCE_TAG, gap.id),
    type: 'ACTION_REQUIRED',
    source: 'brain-gaps',
    title,
    description: descParts.join('\n').slice(0, 2000),
    priority,
    entityType: 'BrainEntity',
    entityId: gap.entity_id,
    actionData: {
      brainGapId: gap.id,
      field: gap.field ?? null,
      gapType: gap.gap_type ?? null,
      rawPriority: gap.priority ?? null,
      detectedAt: gap.detected_at ?? null,
      detectedBy: gap.detected_by ?? null,
      suggestedResolution: gap.suggested_resolution ?? null,
      sourceTag: SOURCE_TAG,
    },
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`ETL brain gaps → inbox — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)

  console.log(`Fetching gaps from proxy: ${PROXY_URL}`)
  const gaps = await fetchGaps()
  console.log(`  Pulled ${gaps.length} unique gaps from Brain`)
  if (gaps.length === 0) {
    console.log('No gaps returned — nothing to do.')
    return
  }

  // Sort so highest-priority gaps land in the inbox first (we cap at 100).
  const priOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 }
  const sorted = [...gaps].sort((a, b) => {
    const ap = priOrder[(a.priority ?? 'P9').toUpperCase()] ?? 9
    const bp = priOrder[(b.priority ?? 'P9').toUpperCase()] ?? 9
    if (ap !== bp) return ap - bp
    return (a.detected_at ?? '').localeCompare(b.detected_at ?? '')
  })

  const capped = sorted.slice(0, MAX_ITEMS)
  if (capped.length < sorted.length) {
    console.log(`  Capping at ${MAX_ITEMS} (dropping ${sorted.length - capped.length} lower-priority gaps)`)
  }

  const items = capped.map(toInboxItem)

  // Dedup by deterministic id (belt + suspenders — fetchGaps already dedupes)
  const byId = new Map<string, InboxData>()
  for (const it of items) byId.set(it.id, it)
  const finalItems = Array.from(byId.values())

  const byPriority: Record<string, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  }
  const byGapType: Record<string, number> = {}
  for (const it of finalItems) {
    byPriority[it.priority]++
    const gt =
      ((it.actionData?.gapType as string | null | undefined) ??
        (it.actionData?.field as string | null | undefined) ??
        'unspecified') || 'unspecified'
    byGapType[gt] = (byGapType[gt] ?? 0) + 1
  }
  const topGapTypes = Object.entries(byGapType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  console.log()
  console.log(`Total InboxItems prepared: ${finalItems.length}`)
  console.log('Priority mix:', byPriority)
  console.log('Top 5 gap types:')
  for (const [k, v] of topGapTypes) console.log(`  ${v.toString().padStart(3)}  ${k}`)
  console.log()
  console.log('Sample (first 5):')
  finalItems.slice(0, 5).forEach((it) => {
    console.log(`  [${it.priority.padEnd(8)}] ${it.title.slice(0, 110)}`)
  })
  console.log()

  if (DRY_RUN) {
    console.log('DRY-RUN complete — re-run with --commit to write to the database.')
    return
  }

  const prisma = new PrismaClient()
  let created = 0
  let updated = 0
  let failed = 0
  try {
    for (const it of finalItems) {
      try {
        const existing = await prisma.inboxItem.findUnique({
          where: { id: it.id },
          select: { id: true },
        })
        await prisma.inboxItem.upsert({
          where: { id: it.id },
          create: {
            id: it.id,
            type: it.type,
            source: it.source,
            title: it.title,
            description: it.description,
            priority: it.priority,
            status: 'PENDING',
            entityType: it.entityType,
            entityId: it.entityId,
            actionData: it.actionData as any,
          },
          update: {
            title: it.title,
            description: it.description,
            priority: it.priority,
            entityType: it.entityType,
            entityId: it.entityId,
            actionData: it.actionData as any,
          },
        })
        if (existing) updated++
        else created++
      } catch (e) {
        failed++
        console.error(`  FAIL ${it.id}:`, (e as Error).message.slice(0, 140))
      }
    }
    console.log(`Committed: created=${created}, updated=${updated}, failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
