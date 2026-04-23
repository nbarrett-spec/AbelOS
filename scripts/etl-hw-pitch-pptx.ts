/**
 * scripts/etl-hw-pitch-pptx.ts
 *
 * Second-pass extractor for the Hancock Whitney pitch decks. The first pass
 * (`etl-hw-pitch.ts`) created high-level pointer InboxItems — this one opens
 * the PPTX files, walks the slides, and creates one InboxItem per slide with
 * substantive text so asks (term-sheet numbers, P-Card rebate %, volume
 * commitments, covenant proposals) are queryable from Nate's inbox before
 * the May 30 submission deadline.
 *
 * Files parsed:
 *   1 - Abel Lumber Master Bank Pitch - April 2026.pptx
 *   2 - Abel Lumber P-Card Partnership Proposal.pptx
 *
 * Parser approach:
 *   PPTX is a ZIP container. Rather than add a dependency, we read the ZIP
 *   central directory directly and inflate the `ppt/slides/slideN.xml`
 *   entries with Node's built-in `zlib`. Text runs live in <a:t>…</a:t>
 *   elements — simple regex is sufficient for content extraction (we do not
 *   need to preserve formatting).
 *
 * Target table: InboxItem only (Prisma model). No src/**, prisma/**,
 * Builder / Product / Inventory / Vendor writes.
 *
 * Source tag:  HW_PITCH_PPTX_APR2026
 * Due-by:      2026-05-30 (assumed HW submission)
 * Priority:    CRITICAL for slides with explicit asks (line size, rebate %,
 *              volume commit, covenant proposal, term sheet); HIGH/MEDIUM
 *              otherwise. Cap = 50 InboxItems across both files.
 *
 * Idempotency: deterministic ids (`hw-pptx-{file-slug}-slide-{n}`),
 * upsert pattern.
 *
 * Usage:
 *   npx tsx scripts/etl-hw-pitch-pptx.ts          # dry run (default)
 *   npx tsx scripts/etl-hw-pitch-pptx.ts --commit # write
 */

import { PrismaClient } from '@prisma/client'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as zlib from 'node:zlib'

const DRY_RUN = !process.argv.includes('--commit')
const SOURCE_TAG = 'HW_PITCH_PPTX_APR2026'
const DUE_BY = new Date('2026-05-30T23:59:00.000Z')
const MAX_INBOX_ITEMS = 50
const MIN_SLIDE_TEXT_LEN = 30

const FOLDER = 'C:/Users/natha/OneDrive/Abel Lumber/Hancock Whitney Pitch - April 2026'
const MASTER_DECK = '1 - Abel Lumber Master Bank Pitch - April 2026.pptx'
const PCARD_DECK = '2 - Abel Lumber P-Card Partnership Proposal.pptx'

const prisma = new PrismaClient()

// ---------------------------------------------------------------------------
// Minimal ZIP reader (central-directory based, deflate + stored only).
// Returns a map of entry-name -> decompressed Buffer. Good enough for PPTX.
// ---------------------------------------------------------------------------

function readZip(filePath: string): Map<string, Buffer> {
  const buf = fs.readFileSync(filePath)
  const entries = new Map<string, Buffer>()

  // Find End-of-Central-Directory record. Signature 0x06054b50.
  // Scan from the end backwards (EOCD max size ~ 22 + comment).
  let eocdOffset = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset < 0) throw new Error(`No EOCD found in ${filePath}`)

  const totalEntries = buf.readUInt16LE(eocdOffset + 10)
  const cdSize = buf.readUInt32LE(eocdOffset + 12)
  const cdOffset = buf.readUInt32LE(eocdOffset + 16)

  let cursor = cdOffset
  for (let i = 0; i < totalEntries; i++) {
    // Central directory file header signature 0x02014b50.
    const sig = buf.readUInt32LE(cursor)
    if (sig !== 0x02014b50) break
    const method = buf.readUInt16LE(cursor + 10)
    const compSize = buf.readUInt32LE(cursor + 20)
    const uncompSize = buf.readUInt32LE(cursor + 24)
    const nameLen = buf.readUInt16LE(cursor + 28)
    const extraLen = buf.readUInt16LE(cursor + 30)
    const commentLen = buf.readUInt16LE(cursor + 32)
    const localHdrOffset = buf.readUInt32LE(cursor + 42)
    const name = buf.slice(cursor + 46, cursor + 46 + nameLen).toString('utf8')
    cursor += 46 + nameLen + extraLen + commentLen

    // Jump to local file header to find actual data offset.
    const localNameLen = buf.readUInt16LE(localHdrOffset + 26)
    const localExtraLen = buf.readUInt16LE(localHdrOffset + 28)
    const dataStart = localHdrOffset + 30 + localNameLen + localExtraLen
    const rawData = buf.slice(dataStart, dataStart + compSize)

    let data: Buffer
    if (method === 0) {
      // Stored
      data = rawData
    } else if (method === 8) {
      // Deflate (raw, no zlib header)
      try {
        data = zlib.inflateRawSync(rawData)
      } catch {
        // Try regular inflate as fallback
        try {
          data = zlib.inflateSync(rawData)
        } catch {
          continue // skip entry we can't decode
        }
      }
    } else {
      continue // unsupported compression
    }
    // Sanity: verify uncompressed length when known
    if (uncompSize && uncompSize !== 0xffffffff && data.length !== uncompSize) {
      // still keep it — just note the mismatch
    }
    entries.set(name, data)
  }
  return entries
}

// ---------------------------------------------------------------------------
// Slide text extraction
// ---------------------------------------------------------------------------

interface SlideContent {
  index: number // 1-based
  name: string // e.g. "slide3.xml"
  runs: string[] // text runs in order
  text: string // joined, cleaned
  charCount: number
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
}

function extractSlideRuns(xml: string): string[] {
  const runs: string[] = []
  // <a:t>...</a:t>   (text run content). May have attributes on the tag.
  const rx = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g
  let m: RegExpExecArray | null
  while ((m = rx.exec(xml)) !== null) {
    const raw = m[1]
    if (raw == null) continue
    const clean = decodeXmlEntities(raw).replace(/\s+/g, ' ').trim()
    if (clean.length > 0) runs.push(clean)
  }
  return runs
}

function extractSlides(zipEntries: Map<string, Buffer>): SlideContent[] {
  const slides: SlideContent[] = []
  // Collect ppt/slides/slideN.xml entries (skip rels).
  const names = Array.from(zipEntries.keys()).filter(
    (n) => /^ppt\/slides\/slide(\d+)\.xml$/.test(n),
  )
  names.sort((a, b) => {
    const ai = Number(a.match(/slide(\d+)\.xml$/)![1])
    const bi = Number(b.match(/slide(\d+)\.xml$/)![1])
    return ai - bi
  })
  for (const name of names) {
    const buf = zipEntries.get(name)!
    const xml = buf.toString('utf8')
    const idx = Number(name.match(/slide(\d+)\.xml$/)![1])
    const runs = extractSlideRuns(xml)
    const text = runs.join('  |  ')
    slides.push({
      index: idx,
      name: path.basename(name),
      runs,
      text,
      charCount: text.length,
    })
  }
  return slides
}

// ---------------------------------------------------------------------------
// Ask detection + prioritization
// ---------------------------------------------------------------------------

// Terms that indicate a concrete ask/commitment we need to surface.
const CRITICAL_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\brebate\b/i, label: 'rebate' },
  { re: /\b(basis points?|bps)\b/i, label: 'bps' },
  { re: /\bcovenant/i, label: 'covenant' },
  { re: /\bterm sheet\b/i, label: 'term-sheet' },
  { re: /\bline (of credit|size|amount)\b/i, label: 'line-size' },
  { re: /\b(revolver|revolving credit)\b/i, label: 'revolver' },
  { re: /\bvolume commit/i, label: 'volume-commit' },
  { re: /\bcommit(ment)? (of|to|level)\b/i, label: 'commitment' },
  { re: /\bannual spend\b/i, label: 'annual-spend' },
  { re: /\bp-?card\b/i, label: 'p-card' },
  { re: /\binterest rate\b/i, label: 'interest-rate' },
  { re: /\b(borrow(ing)? base|advance rate)\b/i, label: 'borrowing-base' },
  { re: /\bSOFR\b/i, label: 'SOFR' },
  { re: /\$\s?\d[\d,\.]*\s?(M|MM|million|K|thousand)\b/i, label: 'dollar-amount' },
  { re: /\b\d+(\.\d+)?\s?%/, label: 'percent' },
]

function detectAsks(text: string): string[] {
  const hits = new Set<string>()
  for (const p of CRITICAL_PATTERNS) {
    if (p.re.test(text)) hits.add(p.label)
  }
  return Array.from(hits)
}

function choosePriority(asks: string[], charCount: number): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' {
  const hardAsks = asks.filter((a) =>
    [
      'rebate',
      'bps',
      'covenant',
      'term-sheet',
      'line-size',
      'volume-commit',
      'commitment',
      'annual-spend',
      'borrowing-base',
      'SOFR',
      'interest-rate',
    ].includes(a),
  )
  if (hardAsks.length > 0) return 'CRITICAL'
  if (asks.includes('dollar-amount') || asks.includes('percent') || asks.includes('p-card')) return 'HIGH'
  if (charCount > 300) return 'MEDIUM'
  return 'LOW'
}

function slugifyDeck(name: string): string {
  if (name.startsWith('1 -')) return 'master'
  if (name.startsWith('2 -')) return 'pcard'
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)
}

function firstHeadline(runs: string[]): string {
  // Heuristic: first non-trivial run (>= 4 chars), truncated.
  for (const r of runs) {
    const t = r.trim()
    if (t.length >= 4 && !/^\d+$/.test(t)) {
      return t.length > 80 ? t.slice(0, 77) + '…' : t
    }
  }
  return runs[0] ?? '(no text)'
}

// ---------------------------------------------------------------------------
// InboxItem writer
// ---------------------------------------------------------------------------

async function upsertInbox(
  id: string,
  data: {
    title: string
    description: string
    priority: string
    actionData: any
  },
) {
  if (DRY_RUN) {
    console.log(`\n[dry] InboxItem ${id} (${data.priority})`)
    console.log(`  title: ${data.title}`)
    console.log(`  desc[0..200]: ${data.description.slice(0, 200).replace(/\n/g, ' ⏎ ')}`)
    return
  }
  await prisma.inboxItem.upsert({
    where: { id },
    create: {
      id,
      type: 'AGENT_TASK',
      source: SOURCE_TAG,
      title: data.title,
      description: data.description,
      priority: data.priority,
      status: 'PENDING',
      entityType: 'BankPitch',
      entityId: SOURCE_TAG,
      dueBy: DUE_BY,
      actionData: data.actionData,
    },
    update: {
      title: data.title,
      description: data.description,
      priority: data.priority,
      status: 'PENDING',
      dueBy: DUE_BY,
      actionData: data.actionData,
    },
  })
}

// ---------------------------------------------------------------------------
// Fallback item (when PPTX parsing fails)
// ---------------------------------------------------------------------------

async function writeFallbackItem(deckFile: string, err: string) {
  const slug = slugifyDeck(deckFile)
  const id = `hw-pptx-${slug}-parse-failed`
  const size = fs.existsSync(path.join(FOLDER, deckFile))
    ? fs.statSync(path.join(FOLDER, deckFile)).size
    : 0
  await upsertInbox(id, {
    title: `HW pitch PPTX parse failed — review ${deckFile} manually`,
    description: [
      `PPTX slide extraction failed for ${deckFile} (${(size / 1024).toFixed(0)} KB).`,
      ``,
      `Error: ${err}`,
      ``,
      `ACTION: open the deck manually, pull key asks (line size, term, covenants,`,
      `rebate %, volume commit) and update this inbox item.`,
    ].join('\n'),
    priority: 'HIGH',
    actionData: {
      sourceTag: SOURCE_TAG,
      sourceFile: deckFile,
      status: 'PARSE_FAILED',
      error: err,
    },
  })
}

// ---------------------------------------------------------------------------
// Main per-file processor
// ---------------------------------------------------------------------------

async function processDeck(deckFile: string, remainingBudget: number): Promise<{ created: number; slides: number; asks: string[] }> {
  const fullPath = path.join(FOLDER, deckFile)
  const deckSlug = slugifyDeck(deckFile)
  const asksCollected: string[] = []

  if (!fs.existsSync(fullPath)) {
    console.log(`  [skip] missing: ${deckFile}`)
    return { created: 0, slides: 0, asks: asksCollected }
  }

  let slides: SlideContent[]
  try {
    const entries = readZip(fullPath)
    slides = extractSlides(entries)
  } catch (e: any) {
    console.log(`  [fallback] parse failed for ${deckFile}: ${e?.message ?? e}`)
    await writeFallbackItem(deckFile, String(e?.message ?? e))
    return { created: 1, slides: 0, asks: asksCollected }
  }

  console.log(`  [${deckFile}] found ${slides.length} slide(s)`)
  let created = 0

  for (const s of slides) {
    if (created >= remainingBudget) {
      console.log(`  [cap] reached max-inbox-items budget; stopping at slide ${s.index}`)
      break
    }
    if (s.charCount < MIN_SLIDE_TEXT_LEN) {
      continue // skip title / divider / empty
    }
    const asks = detectAsks(s.text)
    asksCollected.push(...asks)
    const priority = choosePriority(asks, s.charCount)
    if (priority === 'LOW' && asks.length === 0) {
      // Skip low-value slides to preserve budget, but keep asks ones.
      // Will still keep MEDIUM+ content.
      continue
    }

    const headline = firstHeadline(s.runs)
    const id = `hw-pptx-${deckSlug}-slide-${s.index}`
    const asksStr = asks.length ? ` [${asks.join(', ')}]` : ''
    const title = `HW PPTX ${deckSlug} slide ${s.index}: ${headline}${asksStr}`

    // Compose description: first 30 runs (if many) to keep payload compact.
    const runsSample = s.runs.slice(0, 40)
    const truncated = s.runs.length > runsSample.length
    const descLines = [
      `Source deck: ${deckFile}`,
      `Slide number: ${s.index} of ${slides.length}`,
      `Detected asks: ${asks.length ? asks.join(', ') : '(none)'}`,
      `Priority rationale: ${priority}${asks.length ? ' (ask keywords matched)' : ''}`,
      ``,
      `--- Slide content (text runs, in order) ---`,
      ...runsSample.map((r, i) => `  ${i + 1}. ${r}`),
      ...(truncated ? [`  … (${s.runs.length - runsSample.length} more runs truncated)`] : []),
      ``,
      `Character count: ${s.charCount}`,
      asks.length
        ? `ACTION (due 2026-05-30): confirm the numbers/terms on this slide and flag any gaps before the HW meeting.`
        : `Context slide — reference only.`,
    ]

    await upsertInbox(id, {
      title: title.length > 160 ? title.slice(0, 157) + '…' : title,
      description: descLines.join('\n'),
      priority,
      actionData: {
        sourceTag: SOURCE_TAG,
        sourceFile: deckFile,
        slideIndex: s.index,
        slideName: s.name,
        charCount: s.charCount,
        asks,
        runs: s.runs,
      },
    })
    created += 1
  }

  return { created, slides: slides.length, asks: asksCollected }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`[etl-hw-pitch-pptx] ${DRY_RUN ? 'DRY RUN' : 'COMMIT'}`)
  console.log(`[etl-hw-pitch-pptx] source tag: ${SOURCE_TAG}`)
  console.log(`[etl-hw-pitch-pptx] due-by: ${DUE_BY.toISOString()}`)
  console.log(`[etl-hw-pitch-pptx] max inbox items: ${MAX_INBOX_ITEMS}\n`)

  let remaining = MAX_INBOX_ITEMS
  const results: Record<string, { created: number; slides: number; asks: string[] }> = {}

  for (const deck of [MASTER_DECK, PCARD_DECK]) {
    console.log(`\n[deck] ${deck}`)
    const r = await processDeck(deck, remaining)
    results[deck] = r
    remaining -= r.created
    console.log(`  → created ${r.created} InboxItem(s) from ${r.slides} slide(s)`)
  }

  // Summary ask counts
  const allAsks: Record<string, number> = {}
  for (const r of Object.values(results)) {
    for (const a of r.asks) allAsks[a] = (allAsks[a] ?? 0) + 1
  }
  const topAsks = Object.entries(allAsks)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  console.log(`\n[summary]`)
  for (const [deck, r] of Object.entries(results)) {
    console.log(`  ${deck}: ${r.slides} slides → ${r.created} items`)
  }
  console.log(`  Total items created: ${MAX_INBOX_ITEMS - remaining}`)
  console.log(`  Top ask keywords: ${topAsks.map(([k, v]) => `${k}×${v}`).join(', ') || '(none)'}`)
  console.log(`  Due-by: ${DUE_BY.toISOString()}`)
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'COMMITTED'}`)
  if (DRY_RUN) console.log(`  Re-run with --commit to persist.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
