/**
 * Pitch generator agent — sibling of enrich-prospect.ts.
 *
 * Reads a Prospect row + its 1:1 PitchContext row, composes a system prompt
 * from `skills/pitch-voice.md` + element fragments under
 * `skills/pitch-elements/`, calls Sonnet 4.6 (NEVER Opus per repo CLAUDE.md
 * cost rules) with prompt caching on the assembled brand-voice prompt, and
 * outputs a single-file HTML microsite + draft outreach email.
 *
 * Hard rules (binding):
 *   - Model: claude-sonnet-4-6 only (CLAUDE.md "default to Sonnet")
 *   - Per-job budget cap: $2 (slightly higher than enrichment's $1 because
 *     pitch generation produces longer HTML output)
 *   - Brand voice ban list enforced via the pitch-voice.md system prompt;
 *     output validated post-hoc against the same list (defense-in-depth)
 *   - Output ALWAYS lands in ReviewQueue with status PENDING. Never auto-
 *     deploys to a customer-visible URL or auto-sends email — CLAUDE.md
 *     hard rule: "external customer emails need explicit approval."
 *   - Audit log on every state change (QUEUED → GENERATING → PREVIEW →
 *     APPROVED/FAILED).
 *
 * Source citations for voice rules embedded below:
 *   - `memory/brand/voice.md` — banned phrases, three dials, length/cadence
 *   - `memory/brand/messaging-pillars.md` — 6 pillars, audience-pillar map
 *   - `memory/brand/visual-identity.md` — palette, typography, no-go imagery
 *   - `memory/brand/html-build-defaults.md` — token block, Chart.js defaults
 *   - `CLAUDE.md` (workspace) — "Brand voice matters" preferences section
 */

import { promises as fs } from 'fs'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { logAudit } from '@/lib/audit'
import { runAgent, makeBudgetGuard } from './claude-client'
import {
  PitchRunInput,
  PitchRunResult,
  PitchElement,
  PitchStyle,
  PITCH_ELEMENTS,
} from './types'
// Agent C provides this tool — import will not type-check until that lands,
// but we keep the import path stable so the wiring is correct on merge.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { deployVercelPreview } from './tools/deploy-vercel'

// ── Constants ─────────────────────────────────────────────────────────────
const MODEL = 'claude-sonnet-4-6'
const PER_JOB_USD_CAP = 2.0
const SKILLS_ROOT = path.join(process.cwd(), 'src', 'lib', 'agents', 'skills')

// Brand-voice ban list. Mirrored from `memory/brand/voice.md` "Phrases we
// avoid" + `pitch-voice.md` BANNED section. Defense in depth — if Claude
// emits any of these despite the system prompt, we throw and re-queue.
const BANNED_PHRASES: string[] = [
  // From memory/brand/voice.md "Phrases we avoid"
  'best-in-class',
  'world-class',
  'industry-leading',
  'we are excited to announce',
  'we are excited',
  'we are thrilled',
  'thrilled to share',
  // From CLAUDE.md hard rules
  'leverage', // verb form is the issue but substring catch is fine
  'cutting-edge',
  'synergy',
  // Common offenders we explicitly call out
  'solutions provider',
  'passionate about doors',
  'disrupting',
  'click here',
  'industry 4.0',
  'digital transformation',
]

// ── Cached skill loader (memoized after first read) ───────────────────────
let _voicePrompt: string | null = null
const _elementCache = new Map<PitchElement, string>()

async function loadVoicePrompt(): Promise<string> {
  if (_voicePrompt) return _voicePrompt
  const p = path.join(SKILLS_ROOT, 'pitch-voice.md')
  _voicePrompt = await fs.readFile(p, 'utf-8')
  return _voicePrompt
}

async function loadElementFragment(el: PitchElement): Promise<string> {
  const cached = _elementCache.get(el)
  if (cached) return cached
  const p = path.join(SKILLS_ROOT, 'pitch-elements', `${el}.md`)
  const text = await fs.readFile(p, 'utf-8')
  _elementCache.set(el, text)
  return text
}

// ── Prospect + PitchContext loaders (raw SQL — new tables not in client) ─
interface ProspectRow {
  id: string
  companyName: string
  contactName: string | null
  city: string | null
  state: string | null
  domain: string | null
  founderName: string | null
  icpTier: string | null
  email: string | null
}

interface PitchContextRow {
  id: string
  prospectId: string
  targetPlans: unknown
  currentVendor: string | null
  estBuildVolume: number | null
  dealStage: string | null
  positioningNotes: string | null
}

async function loadProspect(prospectId: string): Promise<ProspectRow | null> {
  const rows = await prisma.$queryRawUnsafe<ProspectRow[]>(
    `SELECT id, "companyName", "contactName", city, state, domain, "founderName", "icpTier", email
     FROM "Prospect" WHERE id = $1 LIMIT 1`,
    prospectId
  )
  return rows?.[0] ?? null
}

async function loadPitchContext(prospectId: string): Promise<PitchContextRow | null> {
  const rows = await prisma.$queryRawUnsafe<PitchContextRow[]>(
    `SELECT id, "prospectId", "targetPlans", "currentVendor", "estBuildVolume",
            "dealStage", "positioningNotes"
     FROM "PitchContext" WHERE "prospectId" = $1 LIMIT 1`,
    prospectId
  )
  return rows?.[0] ?? null
}

// ── State transitions on PitchRun (raw SQL — new table) ───────────────────
async function insertPitchRunQueued(input: PitchRunInput): Promise<string> {
  // cuid-ish id; Prisma's @default(cuid()) only fires through the generated
  // client. Generate one here for the raw insert. Keep the prefix recognizable.
  const id = 'ptr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PitchRun"
       ("id", "prospectId", "style", "layout", "elements", "status", "generatedBy", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'QUEUED', $6, NOW(), NOW())`,
    id,
    input.prospectId,
    input.style,
    input.layout,
    input.elements,
    input.generatedBy ?? null
  )
  return id
}

async function setPitchRunStatus(
  pitchRunId: string,
  status: 'GENERATING' | 'PREVIEW' | 'FAILED',
  patch: {
    htmlContent?: string
    previewUrl?: string
    emailDraft?: string
    costEstimate?: number
    errorMessage?: string
  } = {}
): Promise<void> {
  const fields: string[] = ['"status" = $2', '"updatedAt" = NOW()']
  const values: unknown[] = [pitchRunId, status]
  let idx = 3
  if (patch.htmlContent !== undefined) {
    fields.push(`"htmlContent" = $${idx++}`)
    values.push(patch.htmlContent)
  }
  if (patch.previewUrl !== undefined) {
    fields.push(`"previewUrl" = $${idx++}`)
    values.push(patch.previewUrl)
  }
  if (patch.emailDraft !== undefined) {
    fields.push(`"emailDraft" = $${idx++}`)
    values.push(patch.emailDraft)
  }
  if (patch.costEstimate !== undefined) {
    fields.push(`"costEstimate" = $${idx++}`)
    values.push(patch.costEstimate)
  }
  if (patch.errorMessage !== undefined) {
    fields.push(`"errorMessage" = $${idx++}`)
    values.push(patch.errorMessage)
  }
  await prisma.$executeRawUnsafe(
    `UPDATE "PitchRun" SET ${fields.join(', ')} WHERE id = $1`,
    ...values
  )
}

async function insertReviewQueueEntry(
  pitchRunId: string,
  companyName: string
): Promise<string> {
  const id = 'rvq' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ReviewQueue"
       ("id", "entityType", "entityId", "reason", "summary", "status", "createdAt")
     VALUES ($1, 'PITCH_RUN', $2, 'pitch_ready_review', $3, 'PENDING', NOW())`,
    id,
    pitchRunId,
    `Pitch ready for ${companyName}`
  )
  return id
}

// ── Helpers ───────────────────────────────────────────────────────────────
function slugify(input: string): string {
  // kebab-case slug for Vercel project name (per Agent C deployVercelPreview spec).
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'pitch'
  )
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

interface ParsedAgentOutput {
  html: string
  emailDraft: string
  costEstimate?: { imageGenUsd?: number; vercelDeployUsd?: number; notes?: string }
}

function parseAgentJsonBlock(text: string): ParsedAgentOutput {
  // Claude is told to emit exactly one fenced JSON block (see pitch-voice.md
  // "Output schema"). Be lenient: match the largest ```json ... ``` block,
  // fall back to the largest balanced { ... }, fail loudly if neither parses.
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/i)
  const candidate = fenceMatch?.[1]?.trim() ?? extractBalancedJson(text)
  if (!candidate) {
    throw new Error('Agent output did not contain a JSON block')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Agent JSON did not parse: ${msg}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Agent JSON was not an object')
  }
  const obj = parsed as Record<string, unknown>
  if (typeof obj.html !== 'string' || typeof obj.emailDraft !== 'string') {
    throw new Error('Agent JSON missing required fields html / emailDraft')
  }
  return {
    html: obj.html,
    emailDraft: obj.emailDraft,
    costEstimate: (obj.costEstimate as ParsedAgentOutput['costEstimate']) ?? undefined,
  }
}

function extractBalancedJson(text: string): string | null {
  // Find first '{' and walk to its matching '}'. Good enough for our shape;
  // we don't accept arrays at top level.
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function validateHtmlPreamble(html: string): void {
  // Voice rule from pitch-voice.md: html must start with <!doctype html>.
  const head = html.trimStart().slice(0, 16).toLowerCase()
  if (!head.startsWith('<!doctype html>')) {
    throw new Error('Agent HTML did not start with <!doctype html>')
  }
}

function validateBannedPhrases(html: string, emailDraft: string): void {
  // CLAUDE.md hard rule: brand voice ban list. Defense in depth — if Claude
  // emitted a banned phrase despite the system prompt, fail the run rather
  // than ship oversold copy.
  const haystack = (html + '\n' + emailDraft).toLowerCase()
  const hits = BANNED_PHRASES.filter((p) => haystack.includes(p.toLowerCase()))
  if (hits.length > 0) {
    throw new Error(
      `Generated copy contains banned phrase(s) [${hits.join(', ')}] — ` +
        'see memory/brand/voice.md "Phrases we avoid"'
    )
  }
}

function buildUserMessage(
  prospect: ProspectRow,
  context: PitchContextRow,
  input: PitchRunInput
): string {
  // Hand Claude a tight, structured payload. Don't restate brand rules here —
  // those live in the cached system prompt to maximize cache hit rate.
  const lines = [
    `# Pitch generation request`,
    ``,
    `**Prospect**`,
    `- companyName: ${prospect.companyName}`,
    `- founderName: ${prospect.founderName ?? '(unknown — open with "Hi —")'}`,
    `- contactName: ${prospect.contactName ?? '(none)'}`,
    `- city: ${prospect.city ?? '(unknown)'}`,
    `- state: ${prospect.state ?? '(unknown)'}`,
    `- domain: ${prospect.domain ?? '(unknown)'}`,
    `- icpTier: ${prospect.icpTier ?? '(unknown)'}`,
    ``,
    `**Pitch context (from PitchContext, filled by Dalton or auto-pulled)**`,
    `- currentVendor: ${context.currentVendor ?? '(unknown)'}`,
    `- estBuildVolume: ${context.estBuildVolume ?? '(unknown)'}`,
    `- dealStage: ${context.dealStage ?? 'COLD'}`,
    `- targetPlans: ${
      context.targetPlans ? JSON.stringify(context.targetPlans) : '[]'
    }`,
    `- positioningNotes: ${context.positioningNotes ?? '(none)'}`,
    ``,
    `**Output config**`,
    `- style: ${input.style}`,
    `- layout: ${input.layout}`,
    `- elements (in order): ${input.elements.join(', ')}`,
    `- today: ${todayIsoDate()}`,
    ``,
    `Compose ONE single-file HTML microsite that includes the requested elements ` +
      `in the order given. Plus the email draft. Output the JSON block per the ` +
      `schema in your system prompt — nothing else.`,
  ]
  return lines.join('\n')
}

// ── Public API ────────────────────────────────────────────────────────────
export async function generatePitch(input: PitchRunInput): Promise<PitchRunResult> {
  // Validate elements up front — the elements[] array comes from a user
  // form and could contain typos that would crash the file loader later.
  for (const el of input.elements) {
    if (!(PITCH_ELEMENTS as readonly string[]).includes(el)) {
      throw new Error(`Unknown pitch element: ${el}`)
    }
  }

  // 1. Insert PitchRun (QUEUED). Audit immediately so the queue has a row
  //    even if the agent crashes before producing output.
  const pitchRunId = await insertPitchRunQueued(input)
  await logAudit({
    staffId: input.generatedBy ?? '',
    action: 'PITCH_GENERATE_QUEUED',
    entity: 'PitchRun',
    entityId: pitchRunId,
    details: {
      prospectId: input.prospectId,
      style: input.style,
      layout: input.layout,
      elements: input.elements,
    },
  }).catch(() => {})

  // 2. GENERATING
  await setPitchRunStatus(pitchRunId, 'GENERATING')

  try {
    // 3. Load Prospect + PitchContext (raw SQL since the new model isn't in
    //    the generated Prisma client per Agent F's migration plan).
    const prospect = await loadProspect(input.prospectId)
    if (!prospect) throw new Error(`Prospect ${input.prospectId} not found`)
    const context = await loadPitchContext(input.prospectId)
    if (!context) {
      throw new Error(
        `No PitchContext for prospect ${input.prospectId} — Dalton must fill ` +
          `the admin form before generating a pitch`
      )
    }

    // 4. Build the cached system prompt: pitch-voice.md +
    //    pitch-elements/<el>.md fragments concatenated for the elements[]
    //    selected. Keep byte-stable: include every fragment in canonical
    //    order regardless of input order, so the cache doesn't fragment
    //    across runs that pick different element orderings.
    const voice = await loadVoicePrompt()
    const fragmentTexts: string[] = []
    for (const el of PITCH_ELEMENTS) {
      if (input.elements.includes(el as PitchElement)) {
        fragmentTexts.push(
          `\n\n## Element fragment: ${el}\n\n${await loadElementFragment(el as PitchElement)}`
        )
      }
    }
    const systemPrompt = voice + '\n\n---\n# Element fragments\n' + fragmentTexts.join('')

    // 5. Build user message
    const userMessage = buildUserMessage(prospect, context, input)

    // 6. runAgent(). No server-tools (pitch is generation, not research).
    //    Effort: high for EXECUTIVE (data-dense, banker context); medium
    //    otherwise.
    const effort: 'medium' | 'high' = input.style === ('EXECUTIVE' as PitchStyle) ? 'high' : 'medium'
    const result = await runAgent({
      systemPrompt,
      userMessage,
      model: MODEL,
      effort,
      maxTokens: 8192, // pitches produce more output than enrichment
      caller: `generate-pitch:${pitchRunId}`,
    })

    // 7. Per-job budget guard. Throws if costUsd exceeded $2 cap.
    const guard = makeBudgetGuard({ capUsd: PER_JOB_USD_CAP })
    guard(result.costUsd)

    // 8. Parse JSON output + validate.
    const parsed = parseAgentJsonBlock(result.text)
    validateHtmlPreamble(parsed.html)
    validateBannedPhrases(parsed.html, parsed.emailDraft)

    // 9. If layout === MICROSITE, deploy to Vercel preview via Agent C's
    //    deployVercelPreview(). Other layouts (DECK, ONE_PAGER) fall through
    //    Phase 2; for now just leave previewUrl unset.
    let previewUrl: string | undefined
    if (input.layout === 'MICROSITE') {
      const deployResp = await deployVercelPreview({
        projectName: `${slugify(prospect.companyName)}-pitch`,
        html: parsed.html,
      })
      if (deployResp.ok && deployResp.data) {
        previewUrl = deployResp.data.url
      } else {
        // Don't fail the whole run if Vercel preview is sluggish — surface
        // the error but keep the HTML in the DB so a human can deploy
        // manually from the admin UI.
        logger.warn('pitch_preview_deploy_failed', {
          pitchRunId,
          error: deployResp.error,
        })
      }
    }

    // 10. Update PitchRun: status=PREVIEW.
    await setPitchRunStatus(pitchRunId, 'PREVIEW', {
      htmlContent: parsed.html,
      previewUrl,
      emailDraft: parsed.emailDraft,
      costEstimate: result.costUsd,
    })

    // 11. Insert ReviewQueue (PENDING). CLAUDE.md hard rule: external
    //     customer emails need explicit approval. This is the gate.
    await insertReviewQueueEntry(pitchRunId, prospect.companyName)

    // 12. Audit success.
    await logAudit({
      staffId: input.generatedBy ?? '',
      action: 'PITCH_GENERATE',
      entity: 'PitchRun',
      entityId: pitchRunId,
      details: {
        style: input.style,
        layout: input.layout,
        elements: input.elements,
        costUsd: result.costUsd,
        previewUrl: previewUrl ?? null,
        cachedInputTokens: result.cachedInputTokens,
        outputTokens: result.outputTokens,
      },
    }).catch(() => {})

    return {
      pitchRunId,
      status: 'PREVIEW',
      previewUrl,
      htmlContent: parsed.html,
      emailDraft: parsed.emailDraft,
      costUsd: result.costUsd,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('pitch_generate_failed', err, { pitchRunId, prospectId: input.prospectId })

    await setPitchRunStatus(pitchRunId, 'FAILED', { errorMessage: message })

    await logAudit({
      staffId: input.generatedBy ?? '',
      action: 'PITCH_GENERATE_FAILED',
      entity: 'PitchRun',
      entityId: pitchRunId,
      details: {
        prospectId: input.prospectId,
        error: message,
      },
      severity: 'WARN',
    }).catch(() => {})

    // Re-throw — the API route surfaces the failure to the caller.
    throw err
  }
}
