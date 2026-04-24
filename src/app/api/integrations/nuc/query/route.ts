/**
 * GET /api/integrations/nuc/query
 *
 * Thin read-only dispatcher for NUC brain data. Today supports:
 *   ?type=knowledge&q=<query>                  → /brain/knowledge/search
 *   ?type=scores&entity=customer|product&id=X  → /brain/scores/<entity>[?id=]
 *
 * Write paths (actions, ingests, halts) are intentionally NOT exposed here —
 * those will land in a separate mutation route behind admin-only auth.
 *
 * Like /api/integrations/nuc/health, this route ALWAYS returns 200. The
 * `ok` field inside the body is the source of truth for client rendering;
 * HTTP 200 avoids spurious monitor pages when the NUC subsystem is down.
 *
 * Auth: staff session required (checkStaffAuth).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { nucQueryKnowledge, nucGetScores } from '@/lib/nuc-bridge'

type QueryType = 'knowledge' | 'scores'
const VALID_TYPES: QueryType[] = ['knowledge', 'scores']
const VALID_SCORE_ENTITIES = ['customer', 'product'] as const
type ScoreEntity = (typeof VALID_SCORE_ENTITIES)[number]

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const checkedAt = new Date().toISOString()
  const { searchParams } = new URL(request.url)
  const type = (searchParams.get('type') || '').toLowerCase()

  if (!VALID_TYPES.includes(type as QueryType)) {
    return NextResponse.json({
      ok: false,
      error: 'INVALID_TYPE',
      detail: `type must be one of: ${VALID_TYPES.join(', ')}`,
      checkedAt,
    })
  }

  if (type === 'knowledge') {
    const q = searchParams.get('q')
    if (!q || !q.trim()) {
      return NextResponse.json({
        ok: false,
        error: 'INVALID_QUERY',
        detail: 'knowledge query requires non-empty ?q=',
        checkedAt,
      })
    }
    const result = await nucQueryKnowledge(q.trim())
    if (!result.ok) {
      return NextResponse.json({
        ok: false,
        error: result.error,
        detail: result.detail,
        status: result.status,
        durationMs: result.durationMs,
        checkedAt,
      })
    }
    return NextResponse.json({
      ok: true,
      type: 'knowledge',
      query: q.trim(),
      data: result.data,
      durationMs: result.durationMs,
      checkedAt,
    })
  }

  // type === 'scores'
  const entity = (searchParams.get('entity') || '').toLowerCase() as ScoreEntity
  const id = searchParams.get('id') || undefined

  if (!VALID_SCORE_ENTITIES.includes(entity)) {
    return NextResponse.json({
      ok: false,
      error: 'INVALID_ENTITY',
      detail: `entity must be one of: ${VALID_SCORE_ENTITIES.join(', ')}`,
      checkedAt,
    })
  }

  const result = await nucGetScores(entity, id)
  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      error: result.error,
      detail: result.detail,
      status: result.status,
      durationMs: result.durationMs,
      checkedAt,
    })
  }
  return NextResponse.json({
    ok: true,
    type: 'scores',
    entity,
    id: id || null,
    data: result.data,
    durationMs: result.durationMs,
    checkedAt,
  })
}
