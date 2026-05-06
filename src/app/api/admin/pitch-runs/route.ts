/**
 * POST /api/admin/pitch-runs
 *
 * Queues a pitch generation. Body: PitchRunInput. Response: PitchRunResult.
 *
 * Auth: ADMIN or SALES_REP (Dalton + Nate).
 *
 * Feature flag: gated by FEATURE_PITCH_GENERATOR_ENABLED. Returns 503 when
 * the flag is not 'true' — see CLAUDE.md hard rule on staged rollout
 * (default off; flip on after smoke).
 *
 * Approval gate: the agent NEVER auto-deploys to a customer-visible URL or
 * auto-sends email. Output lands in ReviewQueue with status=PENDING. Nate
 * approves via POST /api/admin/pitch-runs/[id] before anything ships.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireStaffAuth } from '@/lib/api-auth'
import { logAudit } from '@/lib/audit'
import { generatePitch } from '@/lib/agents/generate-pitch'
import {
  PitchRunInput,
  PitchStyle,
  PitchLayout,
  PitchElement,
  PITCH_ELEMENTS,
} from '@/lib/agents/types'

const VALID_STYLES: readonly PitchStyle[] = ['HERITAGE', 'EXECUTIVE', 'BUILDER_FIELD']
const VALID_LAYOUTS: readonly PitchLayout[] = ['MICROSITE', 'DECK', 'ONE_PAGER']

function isFeatureEnabled(): boolean {
  return process.env.FEATURE_PITCH_GENERATOR_ENABLED === 'true'
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 })
}

interface ParsedInput extends PitchRunInput {}

function parseBody(raw: unknown): ParsedInput | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Body must be a JSON object' }
  const body = raw as Record<string, unknown>

  if (typeof body.prospectId !== 'string' || !body.prospectId.trim()) {
    return { error: 'prospectId is required (string)' }
  }
  if (typeof body.style !== 'string' || !VALID_STYLES.includes(body.style as PitchStyle)) {
    return { error: `style must be one of: ${VALID_STYLES.join(', ')}` }
  }
  if (typeof body.layout !== 'string' || !VALID_LAYOUTS.includes(body.layout as PitchLayout)) {
    return { error: `layout must be one of: ${VALID_LAYOUTS.join(', ')}` }
  }
  if (!Array.isArray(body.elements) || body.elements.length === 0) {
    return { error: 'elements must be a non-empty array' }
  }
  for (const el of body.elements) {
    if (typeof el !== 'string' || !(PITCH_ELEMENTS as readonly string[]).includes(el)) {
      return {
        error: `Unknown element "${String(el)}". Allowed: ${PITCH_ELEMENTS.join(', ')}`,
      }
    }
  }
  return {
    prospectId: body.prospectId,
    style: body.style as PitchStyle,
    layout: body.layout as PitchLayout,
    elements: body.elements as PitchElement[],
    generatedBy: typeof body.generatedBy === 'string' ? body.generatedBy : undefined,
  }
}

export async function POST(request: NextRequest) {
  // Feature flag (hard rule from task brief).
  if (!isFeatureEnabled()) {
    return NextResponse.json(
      { error: 'Pitch generator is not enabled in this environment' },
      { status: 503 }
    )
  }

  // Auth: ADMIN or SALES_REP. Dalton (BD Manager) is SALES_REP; Nate is ADMIN.
  const auth = await requireStaffAuth(request, {
    allowedRoles: ['ADMIN', 'SALES_REP'],
  })
  if (auth.error) return auth.error
  const { session } = auth

  // Parse + validate input.
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return badRequest('Body is not valid JSON')
  }
  const parsed = parseBody(raw)
  if ('error' in parsed) return badRequest(parsed.error)

  // Stamp generatedBy with the staff id from the session if the caller didn't
  // pass one (typical case from the admin form).
  const input: PitchRunInput = {
    ...parsed,
    generatedBy: parsed.generatedBy ?? session.staffId,
  }

  // Audit the request itself before kicking off the agent — gives us a row
  // even if the agent errors immediately.
  await logAudit({
    staffId: session.staffId,
    action: 'PITCH_RUN_REQUEST',
    entity: 'PitchRun',
    details: {
      prospectId: input.prospectId,
      style: input.style,
      layout: input.layout,
      elements: input.elements,
    },
  }).catch(() => {})

  try {
    const result = await generatePitch(input)
    return NextResponse.json(result, { status: 200 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: 'Pitch generation failed', detail: message },
      { status: 500 }
    )
  }
}
