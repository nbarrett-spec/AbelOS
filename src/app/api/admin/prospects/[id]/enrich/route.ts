/**
 * POST /api/admin/prospects/[id]/enrich — manual "re-enrich now" endpoint.
 *
 * Used from the /admin/prospects/[id] page (Agent E owns the UI) when a
 * sales rep wants to re-run enrichment immediately on a single prospect —
 * common when a previously UNVERIFIED row becomes important (e.g., we get
 * an inbound email from someone at the company and want to fill in the
 * founder name + ICP tier before pitching).
 *
 * Why this is admin-scoped, not staff:
 *   - Each call costs up to $1 against the Anthropic API and uses the
 *     shared monthly budget cap. Nate's CLAUDE.md hard rule: $400/mo cap.
 *   - SALES_REP role is allowed alongside ADMIN per scope spec — they're
 *     the primary user. Other roles (DRIVER, PRODUCTION) shouldn't burn
 *     research budget.
 *
 * Response shape: full EnrichmentResult so the UI can refresh in place
 * without a follow-up GET on the prospect row.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireStaffAuth } from '@/lib/api-auth'
import { enrichProspect } from '@/lib/agents/enrich-prospect'
import { audit } from '@/lib/audit'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Next.js 15 makes route params a Promise. Awaiting once at the top
  // matches the rest of the codebase (e.g., the order detail handlers).
  const { id } = await params

  // ── Auth: ADMIN or SALES_REP only ───────────────────────────────────────
  // requireStaffAuth handles header→cookie fallback and logs a
  // SecurityEvent on AUTH_FAIL. ADMIN is implicitly allowed even when not
  // listed (allowedRoles is the union of ADMIN ∪ explicit list).
  const auth = await requireStaffAuth(request, {
    allowedRoles: ['ADMIN', 'SALES_REP'],
  })
  if (auth.error) return auth.error
  const { session } = auth

  // ── Run enrichment ──────────────────────────────────────────────────────
  // The agent itself enforces the $1 per-job cap (makeBudgetGuard inside
  // enrichProspect). It also writes the audit log + Slack alert + ReviewQueue
  // row internally — this route doesn't need to repeat any of that.
  try {
    const result = await enrichProspect({
      prospectId: id,
      staffId: session.staffId,
      caller: 'manual',
    })

    // The agent layer also audits internally, but record the route-level
    // entry so the sweep can attribute the cost ($1/call) to the staffer.
    audit(request, 'PROSPECT_MANUAL_ENRICH', 'Prospect', id, { caller: 'manual' }, 'WARN').catch(()=>{})

    return NextResponse.json({
      ok: true,
      result,
    })
  } catch (err: any) {
    const msg = err?.message || String(err)

    // 404: prospect not found. The agent throws "Prospect not found: {id}".
    if (msg.startsWith('Prospect not found')) {
      return NextResponse.json({ ok: false, error: 'Prospect not found' }, { status: 404 })
    }

    // 402: budget guard tripped. Distinct status so the UI can surface a
    // "this run cost too much, contact ops" message rather than a generic
    // 500. 402 = Payment Required is the closest semantic match.
    if (msg.startsWith('Per-job budget cap exceeded')) {
      logger.warn('prospect_enrich_manual_budget_cap', { prospectId: id, msg })
      return NextResponse.json(
        { ok: false, error: 'Enrichment budget cap exceeded — contact ops' },
        { status: 402 }
      )
    }

    // 500: anything else (Anthropic API down, Neon glitch, parse failure).
    // The agent has already audited the failed attempt internally.
    logger.error('prospect_enrich_manual_failed', err, {
      prospectId: id,
      staffId: session.staffId,
    })
    return NextResponse.json(
      { ok: false, error: 'Enrichment failed', detail: msg },
      { status: 500 }
    )
  }
}
