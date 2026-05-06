/**
 * Shared types for builder-enrichment + pitch-generator agents.
 * Lives at src/lib/agents/types.ts.
 *
 * Both agents (enrich-prospect, generate-pitch) and their tools import from
 * here to avoid drift. If you change a type here, update everywhere it's used.
 */

// ── Confidence model ──────────────────────────────────────────────────────
// CLAUDE.md hard rule: source_url required for any CONFIRMED claim.
// LIKELY = pattern-inferred from 2+ same-domain samples.
// UNVERIFIED = generic info@ only or no personal email surfaced.
export type EnrichmentConfidence = 'CONFIRMED' | 'LIKELY' | 'UNVERIFIED'

// ── ICP tier ──────────────────────────────────────────────────────────────
// Matches the brand-voice skill heuristic:
//   PREMIUM: >30 homes/yr, $18k+/home material spend
//   MID:     15-30/yr, $12-18k
//   GROWTH:  <15/yr, <$12k
export type IcpTier = 'PREMIUM' | 'MID' | 'GROWTH'

// ── Single sourced finding (one URL = one claim) ──────────────────────────
export interface SourcedFinding {
  field: 'domain' | 'founder' | 'email' | 'phone' | 'volume' | 'other'
  value: string
  sourceUrl: string
  sourceName?: string // 'Houzz Pro' | 'BBB' | 'LinkedIn' | 'Exa' | 'Web Search'
  confidence: EnrichmentConfidence
}

// ── Enrichment shape (output of enrich-prospect agent) ────────────────────
export interface EnrichmentResult {
  prospectId: string
  domain: string | null
  founderName: string | null
  contactEmail: string | null
  contactPhone: string | null
  emailPattern: string | null // e.g., 'firstname.lastname'
  confidence: EnrichmentConfidence
  icpTier: IcpTier | null
  sourceUrls: string[]
  findings: SourcedFinding[]
  notes: string // free-form summary the agent generated
  costUsd: number
  searchesPerformed: number
}

// ── Pitch generation shape ────────────────────────────────────────────────
export type PitchStyle = 'HERITAGE' | 'EXECUTIVE' | 'BUILDER_FIELD'
export type PitchLayout = 'MICROSITE' | 'DECK' | 'ONE_PAGER'

// Single source of truth for available element modules.
// Add new elements here; admin UI's checkbox list pulls from this.
export const PITCH_ELEMENTS = [
  'cover',
  'exec_summary',
  'pricing',
  'plan_breakdown',
  'value_eng',
  'scope',
  'capabilities',
  'team',
  'financials',
  'references',
  'timeline',
  'terms',
] as const
export type PitchElement = (typeof PITCH_ELEMENTS)[number]

export const PITCH_ELEMENT_LABELS: Record<PitchElement, string> = {
  cover: 'Cover (builder logo + Abel)',
  exec_summary: 'Executive summary',
  pricing: 'Pricing schedule',
  plan_breakdown: 'Per-plan COGS breakdown',
  value_eng: 'Value engineering proposals',
  scope: 'Scope of supply (doors / trim / hardware tiers)',
  capabilities: 'Capabilities (warehouse / fleet / MRP / AMP)',
  team: 'Team intro',
  financials: 'Financial stability (HW line + 2026 P&L)',
  references: 'References / case studies',
  timeline: 'Timeline + next steps',
  terms: 'Terms + disclaimers',
}

export interface PitchRunInput {
  prospectId: string
  style: PitchStyle
  layout: PitchLayout
  elements: PitchElement[]
  generatedBy?: string // staffId (null when auto-triggered)
}

export interface PitchRunResult {
  pitchRunId: string
  status: 'PREVIEW' | 'FAILED'
  previewUrl?: string
  htmlContent?: string
  emailDraft?: string
  errorMessage?: string
  costUsd: number
}

// ── Tool result envelope (for agent tools — pattern-engine, exa, etc.) ────
export interface ToolResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}

// ── Slack alert payload ───────────────────────────────────────────────────
export interface SlackAlert {
  text: string // mrkdwn fallback
  blocks?: Array<Record<string, unknown>> // Block Kit blocks (richer format)
}

// ── Review queue entry types ──────────────────────────────────────────────
export type ReviewEntityType =
  | 'PROSPECT_ENRICHMENT'
  | 'PITCH_RUN'
  | 'EMAIL_SEND'
  | 'BOUNCE_RECHECK'

export interface ReviewQueueEntry {
  id: string
  entityType: ReviewEntityType
  entityId: string
  reason: string
  summary: string | null
  suggestedAction: Record<string, unknown> | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED'
  createdAt: Date
  expiresAt: Date | null
}
