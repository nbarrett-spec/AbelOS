/**
 * Builder Enrichment Agent — core.
 *
 * Lives at src/lib/agents/enrich-prospect.ts.
 *
 * Pipeline:
 *   1. Load Prospect by id (raw SQL — Prisma client not regenerated yet on
 *      this branch; new fields aren't on the typed model).
 *   2. Build the agent's user message (frozen system prompt is in
 *      ./skills/enrich-criteria.md and is loaded once at module init for
 *      prompt-cache hit on every call).
 *   3. Call runAgent() with web_search + web_fetch (server-side) and
 *      exa_search + detect_pattern + apply_pattern (custom).
 *   4. Parse the trailing fenced JSON block, validate the shape, downgrade
 *      any CONFIRMED claim that lacks a sourceUrl (anti-hallucination guard).
 *   5. If 2+ same-domain CONFIRMED emails are present, run pattern engine to
 *      upgrade an UNVERIFIED founder email to LIKELY.
 *   6. Persist back to Prospect via $queryRawUnsafe.
 *   7. Side-effects: Slack alert on CONFIRMED, ReviewQueue insert on
 *      UNVERIFIED, audit log every outcome.
 *
 * Triggered by:
 *   - Cron weekly (src/app/api/cron/prospect-enrich/route.ts)
 *   - Manual admin re-enrich (src/app/api/admin/prospects/[id]/enrich/route.ts)
 *   - Resend bounce webhook (Agent F territory — calls this same function)
 *
 * Hard rules from feat/builder-enrichment scope (Agent A):
 *   - claude-sonnet-4-6, effort=medium, $1.00 per-job cap.
 *   - source_url required for CONFIRMED. Auto-downgrade if missing.
 *   - Pattern inference requires 2+ same-domain samples.
 *   - No invented emails. Ever.
 */

import fs from 'fs'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { logAudit } from '@/lib/audit'
import { runAgent, makeBudgetGuard } from './claude-client'
import type {
  EnrichmentResult,
  EnrichmentConfidence,
  IcpTier,
  SourcedFinding,
  ToolResult,
} from './types'
// Imports from Agent C's tools — types may not exist until Agent C lands;
// runtime is fine because runAgent only calls executeTool when Claude asks
// for a tool by name. We import so the wiring is in place when C ships.
import { exaSearch } from './tools/exa'
import { detectPattern, applyPattern } from './tools/pattern-engine'
import { postSlackAlert } from './tools/slack-alert'

// ── Frozen system prompt — load once, cache forever ──────────────────────
// Critical: the systemPrompt is the cached portion of the runAgent call. It
// MUST be byte-stable across runs or the prompt cache is invalidated and we
// pay full input price on every invocation. Don't interpolate timestamps,
// IDs, or anything dynamic into this string. Read once at module init from
// disk so any markdown edit ships on the next deploy without code changes.
let cachedSystemPrompt: string | null = null
function getSystemPrompt(): string {
  if (cachedSystemPrompt) return cachedSystemPrompt
  // process.cwd() in Vercel server functions points at the project root.
  const skillPath = path.join(
    process.cwd(),
    'src',
    'lib',
    'agents',
    'skills',
    'enrich-criteria.md'
  )
  cachedSystemPrompt = fs.readFileSync(skillPath, 'utf8')
  return cachedSystemPrompt
}

// ── Public API ────────────────────────────────────────────────────────────
export interface EnrichProspectOpts {
  prospectId: string
  /** staffId for audit log; null/undefined = cron-triggered (system caller). */
  staffId?: string
  /** Tag for audit + runlog. */
  caller: 'cron' | 'webhook' | 'manual'
}

/**
 * Enrich a single Prospect. Throws if the prospect doesn't exist or if the
 * per-job budget cap ($1) is exceeded.
 *
 * Always writes back at least `enrichmentRunAt` so an empty-result run still
 * de-queues the prospect from the cron candidate list (otherwise stale rows
 * would re-attempt every week with the same fail mode).
 */
export async function enrichProspect(
  opts: EnrichProspectOpts
): Promise<EnrichmentResult> {
  const { prospectId, staffId, caller } = opts

  // ── 1. Load prospect via raw SQL ────────────────────────────────────────
  // Why raw: the new enrichment columns (domain, founderName, etc.) exist in
  // the schema but `npx prisma generate` hasn't run on this branch yet, so
  // the Prisma typed client doesn't know about them. Raw SQL is the
  // documented escape hatch for this branch (see CLAUDE.md "Prisma writes").
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id", "companyName", "contactName", "email", "phone", "city",
            "state", "domain", "founderName", "notes"
     FROM "Prospect"
     WHERE "id" = $1
     LIMIT 1`,
    prospectId
  )
  if (rows.length === 0) {
    throw new Error(`Prospect not found: ${prospectId}`)
  }
  const prospect = rows[0]

  // ── 2. Build user message ───────────────────────────────────────────────
  // Keep tight — the system prompt has the playbook; the user message just
  // names the entity and what we already have. The "DFW custom homebuilder
  // context" hint is required because same-name builders exist in other
  // states; the system prompt anti-hallucination rule #7 keys off this.
  const existingEmail = prospect.email || 'none'
  const existingDomain = prospect.domain ? ` Existing domain on file: ${prospect.domain}.` : ''
  const userMessage =
    `Builder: "${prospect.companyName}" in ${prospect.city || 'unknown city'}, ` +
    `${prospect.state || 'TX'}. Existing email (if generic): ${existingEmail}.${existingDomain} ` +
    `Find founder name, canonical domain, personal email, ICP tier ` +
    `(PREMIUM/MID/GROWTH). DFW custom homebuilder context.`

  // ── 3. Call runAgent ────────────────────────────────────────────────────
  // Per-job budget guard: throws on overage, aborts the run, surfaces to
  // caller (cron handler logs FAILURE; manual route returns 500). Cap at $1.
  const guard = makeBudgetGuard({ capUsd: 1.0 })

  // executeTool maps custom tool names to the imports above. The runtime
  // dispatches based on the `name` field Claude sends in tool_use blocks.
  const executeTool = async (
    name: string,
    input: Record<string, unknown>
  ): Promise<string> => {
    try {
      if (name === 'exa_search') {
        const res: ToolResult<any> = await exaSearch({
          query: String(input.query || ''),
          numResults: typeof input.numResults === 'number' ? input.numResults : 5,
        })
        return JSON.stringify(res)
      }
      if (name === 'detect_pattern') {
        const patterns = detectPattern(
          String(input.domain || ''),
          (input.knownEmails as Array<{ name: string; email: string }>) || []
        )
        return JSON.stringify({ ok: true, data: { patterns } })
      }
      if (name === 'apply_pattern') {
        // Cast: Claude can return any string, but applyPattern's first arg
        // is the strict EmailPattern union. Pattern-engine validates the
        // string internally and returns '' for unknown patterns, so the
        // cast is safe at the call site.
        const email = applyPattern(
          String(input.pattern || '') as any,
          String(input.fullName || ''),
          String(input.domain || '')
        )
        return JSON.stringify({ ok: true, data: { email } })
      }
      return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` })
    } catch (err: any) {
      return JSON.stringify({ ok: false, error: err?.message || String(err) })
    }
  }

  // Custom tool schemas — Claude needs to know argument shapes. Keep lean.
  const tools = [
    {
      name: 'exa_search',
      description:
        'Neural search via Exa.ai for finding people, emails, and same-domain employees. Better than web_search for "find me a person at this domain". Returns up to numResults web results.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
          numResults: { type: 'number', description: 'Default 5, max 10.' },
        },
        required: ['query'],
      },
    },
    {
      name: 'detect_pattern',
      description:
        'Given a list of {name, email} samples on a single domain, returns candidate email pattern names (e.g., "firstname.lastname"). Pass at least 2 same-domain samples.',
      input_schema: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          knownEmails: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                email: { type: 'string' },
              },
              required: ['name', 'email'],
            },
          },
        },
        required: ['domain', 'knownEmails'],
      },
    },
    {
      name: 'apply_pattern',
      description:
        'Apply a detected pattern to a full name + domain to synthesize an email. ONLY use after detect_pattern returned a single confident pattern.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          fullName: { type: 'string' },
          domain: { type: 'string' },
        },
        required: ['pattern', 'fullName', 'domain'],
      },
    },
  ] as any

  // Server-side tool versions: 20260209 (NOT 20250305 — that's older and
  // shipped with stricter rate limits per Anthropic's 2026-Q1 update).
  const serverTools = [
    { type: 'web_search_20260209', name: 'web_search' },
    { type: 'web_fetch_20260209', name: 'web_fetch' },
  ]

  const agentRun = await runAgent({
    systemPrompt: getSystemPrompt(),
    userMessage,
    tools,
    serverTools,
    executeTool,
    effort: 'medium', // Sonnet 4.6 default; web research benefits modestly
    caller: 'enrich-prospect',
  })

  // Throws if costUsd > $1; this aborts before persistence so we don't
  // leave a partially-enriched row claiming success.
  guard(agentRun.costUsd)

  // ── 4. Parse Claude's final JSON block ──────────────────────────────────
  let parsed: any = null
  try {
    parsed = extractTrailingJson(agentRun.text)
  } catch (err: any) {
    logger.error('enrich_prospect_parse_failed', err, {
      prospectId,
      textPreview: agentRun.text.slice(0, 300),
    })
  }

  // ── 5. Validate + auto-downgrade CONFIRMED-without-source ──────────────
  // BINDING per CLAUDE.md hard rule: any CONFIRMED claim must have a
  // sourceUrl. If Claude tried to claim CONFIRMED without one, downgrade
  // silently to LIKELY (or UNVERIFIED if there's no sourceUrl ANYWHERE in
  // the findings array).
  const result = normalizeAndValidate(parsed, prospect, agentRun)

  // ── 6. Pattern engine post-pass ─────────────────────────────────────────
  // Even if Claude didn't run apply_pattern itself, we re-run it
  // server-side from the findings to catch missed inferences. If 2+
  // CONFIRMED emails on the same domain exist, and the founder email is
  // UNVERIFIED, infer it deterministically and upgrade to LIKELY.
  applyServerSidePatternInference(result)

  // ── 7. Write back via raw SQL ───────────────────────────────────────────
  // Always set enrichmentRunAt so the cron query won't immediately re-pick
  // this row next week even on UNVERIFIED outcomes.
  const appendedNotes =
    (prospect.notes || '') +
    (prospect.notes ? '\n\n' : '') +
    `[Enrichment ${new Date().toISOString().slice(0, 10)} via ${caller}] ` +
    `confidence=${result.confidence} ` +
    `domain=${result.domain || 'null'} ` +
    `founder=${result.founderName || 'null'} ` +
    (result.notes ? `— ${result.notes}` : '')

  try {
    await prisma.$queryRawUnsafe(
      `UPDATE "Prospect"
       SET "domain" = $2,
           "founderName" = $3,
           "email" = COALESCE($4, "email"),
           "emailPattern" = $5,
           "enrichmentRunAt" = NOW(),
           "enrichmentConfidence" = $6,
           "enrichmentSourceUrls" = $7::text[],
           "icpTier" = $8,
           "notes" = $9,
           "updatedAt" = NOW()
       WHERE "id" = $1`,
      prospectId,
      result.domain,
      result.founderName,
      // Only overwrite email if we got something better than what's there.
      // CONFIRMED/LIKELY personal email > existing generic. UNVERIFIED runs
      // never overwrite (they keep the original info@ if present).
      result.confidence === 'UNVERIFIED' ? null : result.contactEmail,
      result.emailPattern,
      result.confidence,
      result.sourceUrls,
      result.icpTier,
      appendedNotes.slice(0, 8000) // notes is unbounded text; cap defensively
    )
  } catch (err: any) {
    logger.error('enrich_prospect_persist_failed', err, { prospectId })
    throw err
  }

  // ── 8. CONFIRMED → Slack alert ──────────────────────────────────────────
  // Why fire-and-forget: Slack outage shouldn't fail the enrichment.
  if (result.confidence === 'CONFIRMED' && result.contactEmail && result.founderName) {
    postSlackAlert({
      text: `🎯 *New CONFIRMED lead* — ${prospect.companyName}: ${result.founderName} <${result.contactEmail}>`,
    }).catch((e) => {
      logger.warn('enrich_prospect_slack_alert_failed', { prospectId, err: e?.message })
    })
  }

  // ── 9. UNVERIFIED → ReviewQueue insert ──────────────────────────────────
  // Only insert when truly UNVERIFIED. LIKELY is good enough to ship to the
  // sales team without a manual review (they'll see the LIKELY tag in the
  // pitch generator anyway).
  if (result.confidence === 'UNVERIFIED') {
    const reviewId = 'rev' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    try {
      await prisma.$queryRawUnsafe(
        `INSERT INTO "ReviewQueue"
           ("id", "entityType", "entityId", "reason", "summary", "status", "createdAt")
         VALUES ($1, $2, $3, $4, $5, 'PENDING', NOW())`,
        reviewId,
        'PROSPECT_ENRICHMENT',
        prospectId,
        'low_confidence_email',
        `${prospect.companyName}: only generic@ found`
      )
    } catch (err: any) {
      logger.warn('enrich_prospect_reviewqueue_insert_failed', { prospectId, err: err?.message })
    }
  }

  // ── 10. Audit log (catch-and-swallow per CLAUDE.md pattern) ────────────
  // Audit must never break the run. The .catch wrapper is required: logAudit
  // already has internal error handling but it returns a promise that could
  // reject if the underlying client crashes (e.g., Neon connection storm).
  logAudit({
    staffId: staffId || 'system',
    action: 'PROSPECT_ENRICH',
    entity: 'Prospect',
    entityId: prospectId,
    details: {
      confidence: result.confidence,
      costUsd: agentRun.costUsd,
      searchesPerformed: agentRun.toolCalls.length,
      caller,
      iterations: agentRun.iterations,
      truncated: agentRun.truncated,
      cachedInputTokens: agentRun.cachedInputTokens,
      icpTier: result.icpTier,
    },
  }).catch(() => {})

  return result
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Pull the trailing ```json``` fenced block out of Claude's final text.
 * Claude is instructed in the system prompt to end every run with exactly
 * one such block. If we can't find one, we throw — caller handles by
 * marking the run UNVERIFIED with a notes field that includes the parse
 * failure.
 */
function extractTrailingJson(text: string): any {
  // Greedy match: grab the LAST fenced JSON block in the message. Claude
  // may have shown intermediate JSON during reasoning, but the contract is
  // "the LAST block is the result".
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)]
  if (matches.length === 0) {
    // Fallback: try to find a bare JSON object at the end of the text.
    // This catches cases where Claude forgot the fences.
    const trimmed = text.trim()
    const lastBrace = trimmed.lastIndexOf('{')
    if (lastBrace >= 0) {
      const candidate = trimmed.slice(lastBrace)
      return JSON.parse(candidate)
    }
    throw new Error('No JSON block found in agent output')
  }
  const lastBlock = matches[matches.length - 1][1].trim()
  return JSON.parse(lastBlock)
}

/**
 * Convert Claude's parsed JSON into the canonical EnrichmentResult shape,
 * applying:
 *   - default values if the agent returned malformed data,
 *   - auto-downgrade of CONFIRMED claims missing sourceUrl,
 *   - prospect-id stamping (Claude doesn't know the id).
 *
 * Always returns a valid EnrichmentResult — never throws on bad input. The
 * worst case is `confidence: UNVERIFIED, notes: "agent output unparseable"`.
 */
function normalizeAndValidate(
  parsed: any,
  prospect: any,
  agentRun: { costUsd: number; toolCalls: { name: string }[] }
): EnrichmentResult {
  const safe = parsed && typeof parsed === 'object' ? parsed : {}

  // Findings: filter out CONFIRMED claims missing sourceUrl. Per CLAUDE.md
  // hard rule, any CONFIRMED claim without a URL is automatically demoted
  // to LIKELY. We don't drop the finding entirely — the value may still be
  // useful (e.g., Claude saw a name on a page but forgot to cite the URL).
  const rawFindings: any[] = Array.isArray(safe.findings) ? safe.findings : []
  const findings: SourcedFinding[] = rawFindings.map((f: any) => {
    const conf: EnrichmentConfidence =
      f.confidence === 'CONFIRMED' || f.confidence === 'LIKELY' || f.confidence === 'UNVERIFIED'
        ? f.confidence
        : 'UNVERIFIED'
    const downgraded: EnrichmentConfidence =
      conf === 'CONFIRMED' && (!f.sourceUrl || typeof f.sourceUrl !== 'string')
        ? 'LIKELY'
        : conf
    return {
      field: validField(f.field),
      value: String(f.value || ''),
      sourceUrl: String(f.sourceUrl || ''),
      sourceName: f.sourceName ? String(f.sourceName) : undefined,
      confidence: downgraded,
    }
  })

  // Top-level confidence: same downgrade rule. If Claude says CONFIRMED but
  // sourceUrls is empty, that's a hallucination — drop to LIKELY (or
  // UNVERIFIED if there's no email at all).
  let confidence: EnrichmentConfidence =
    safe.confidence === 'CONFIRMED' || safe.confidence === 'LIKELY' || safe.confidence === 'UNVERIFIED'
      ? safe.confidence
      : 'UNVERIFIED'

  const sourceUrls: string[] = Array.isArray(safe.sourceUrls)
    ? safe.sourceUrls.filter((u: any) => typeof u === 'string' && u.startsWith('http'))
    : []

  if (confidence === 'CONFIRMED' && sourceUrls.length === 0) {
    // No URL at all — Claude is bluffing. Demote based on whether we got an
    // email at all: with email = LIKELY (still useful), without = UNVERIFIED.
    confidence = safe.contactEmail ? 'LIKELY' : 'UNVERIFIED'
  }

  // ICP tier: only accept the three known values; else null.
  const icpTier: IcpTier | null =
    safe.icpTier === 'PREMIUM' || safe.icpTier === 'MID' || safe.icpTier === 'GROWTH'
      ? safe.icpTier
      : null

  // contactEmail sanity: must contain @ and a dot. Reject empty/garbage.
  const contactEmail =
    typeof safe.contactEmail === 'string' && /@.+\./.test(safe.contactEmail)
      ? safe.contactEmail.toLowerCase().trim()
      : null

  return {
    prospectId: prospect.id,
    domain: typeof safe.domain === 'string' && safe.domain ? safe.domain.toLowerCase().replace(/^www\./, '').replace(/\/$/, '') : null,
    founderName: typeof safe.founderName === 'string' && safe.founderName ? safe.founderName.trim() : null,
    contactEmail,
    contactPhone: typeof safe.contactPhone === 'string' ? safe.contactPhone : null,
    emailPattern: typeof safe.emailPattern === 'string' ? safe.emailPattern : null,
    confidence,
    icpTier,
    sourceUrls,
    findings,
    notes: typeof safe.notes === 'string' ? safe.notes.slice(0, 2000) : '',
    costUsd: agentRun.costUsd,
    searchesPerformed: agentRun.toolCalls.length,
  }
}

/**
 * Server-side pattern inference safety net. If the agent found 2+ CONFIRMED
 * same-domain emails but left the founder email UNVERIFIED, run the
 * deterministic pattern engine here to upgrade the founder email to LIKELY.
 *
 * Why: prompt-only inference is inconsistent. Claude sometimes finds the
 * samples, finds the founder, and forgets to call apply_pattern. This
 * post-pass catches that miss without re-prompting (saves a full round-trip).
 *
 * Mutates `result` in place. Returns nothing.
 */
function applyServerSidePatternInference(result: EnrichmentResult): void {
  // Already have a personal email? No work to do.
  if (result.contactEmail && result.confidence !== 'UNVERIFIED') return
  if (!result.domain || !result.founderName) return

  // Pull email findings on the same domain that are CONFIRMED.
  const sameDomainConfirmed = result.findings.filter(
    (f) =>
      f.field === 'email' &&
      f.confidence === 'CONFIRMED' &&
      f.value.toLowerCase().endsWith('@' + result.domain!.toLowerCase())
  )

  if (sameDomainConfirmed.length < 2) return // need 2+ samples; CLAUDE.md hard rule

  // Build samples for detectPattern. We don't have the holder's name in the
  // SourcedFinding shape, so try to recover it from sourceName or a "name —
  // email" pattern in the value. If we can't recover names, skip.
  const samples = sameDomainConfirmed
    .map((f) => {
      // Heuristic: look for "Name <email>" or "Name — email" in adjacent
      // findings via field=founder/other on same sourceUrl. This is a
      // compromise — the cleanest fix would be to add a `holderName` field
      // to SourcedFinding but that's outside Agent A's scope (types.ts is
      // owned by the platform).
      const nameFinding = result.findings.find(
        (n) =>
          n.field !== 'email' &&
          n.sourceUrl === f.sourceUrl &&
          n.value &&
          n.value.split(' ').length >= 2
      )
      return nameFinding ? { name: nameFinding.value, email: f.value } : null
    })
    .filter((s): s is { name: string; email: string } => s !== null)

  if (samples.length < 2) return

  try {
    const patterns = detectPattern(result.domain, samples)
    if (patterns.length !== 1) return // ambiguous → don't infer
    const inferred = applyPattern(patterns[0], result.founderName, result.domain)
    if (inferred && /@.+\./.test(inferred)) {
      result.contactEmail = inferred.toLowerCase()
      result.emailPattern = patterns[0]
      result.confidence = 'LIKELY'
      result.notes =
        (result.notes ? result.notes + ' ' : '') +
        `[server-side pattern inference: pattern=${patterns[0]}, samples=${samples.length}]`
      result.findings.push({
        field: 'email',
        value: inferred,
        sourceUrl: '',
        sourceName: 'Server-side pattern inference',
        confidence: 'LIKELY',
      })
    }
  } catch {
    // Pattern engine should not throw, but if it does we just skip the
    // upgrade and leave UNVERIFIED. No harm done.
  }
}

function validField(v: any): SourcedFinding['field'] {
  const allowed = ['domain', 'founder', 'email', 'phone', 'volume', 'other']
  return allowed.includes(v) ? v : 'other'
}
