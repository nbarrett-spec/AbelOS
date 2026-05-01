/**
 * /api/v1/brain/insights
 *
 * Proxies to the NUC Brain's /brain/insights and /brain/learn/feedback
 * endpoints. Mirrors the auth pattern used by ../synthesize/route.ts:
 * staff session via requireStaffAuth, then forwards to Brain with
 * X-API-Key + Authorization Bearer (CF strips X-API-Key on the
 * brain.abellumber.com hostname).
 *
 * GET  ?limit=&min_confidence=&kind=&entity_id=  →  /brain/insights
 * POST { insight_id, outcome }                   →  /brain/learn/feedback
 *
 * Also passes a couple sibling endpoints through:
 *   GET ?view=calibration  → /brain/learn/calibration
 *   GET ?view=summary      → /brain/learn/summary
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 70

import { NextRequest, NextResponse } from 'next/server'
import { requireStaffAuth } from '@/lib/api-auth'

const BRAIN_BASE_URL = process.env.NUC_BRAIN_URL || 'https://brain.abellumber.com'

function brainHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AbelOS-BrainInsights/1.0',
  }
  const cfId = process.env.CF_ACCESS_CLIENT_ID
  const cfSecret = process.env.CF_ACCESS_CLIENT_SECRET
  if (cfId && cfSecret) {
    headers['CF-Access-Client-Id'] = cfId
    headers['CF-Access-Client-Secret'] = cfSecret
  }
  const brainApiKey = process.env.BRAIN_API_KEY
  if (brainApiKey) {
    headers['X-API-Key'] = brainApiKey
    headers['Authorization'] = `Bearer ${brainApiKey}` // CF strips X-API-Key
  }
  return headers
}

export async function GET(req: NextRequest) {
  const auth = await requireStaffAuth(req)
  if (auth.error) return auth.error

  const url = new URL(req.url)
  const view = url.searchParams.get('view') // optional pivot to calibration/summary

  let path = '/brain/insights'
  const qs = new URLSearchParams()

  if (view === 'calibration') {
    path = '/brain/learn/calibration'
  } else if (view === 'summary') {
    path = '/brain/learn/summary'
  } else {
    const limit = url.searchParams.get('limit')
    const minConf = url.searchParams.get('min_confidence')
    const kind = url.searchParams.get('kind')
    const entityId = url.searchParams.get('entity_id')
    if (limit) qs.set('limit', limit)
    if (minConf) qs.set('min_confidence', minConf)
    if (kind && kind !== 'all') qs.set('kind', kind)
    if (entityId) qs.set('entity_id', entityId)
  }

  const tail = qs.toString() ? `?${qs.toString()}` : ''

  try {
    const res = await fetch(`${BRAIN_BASE_URL}${path}${tail}`, {
      method: 'GET',
      headers: brainHeaders(),
      signal: AbortSignal.timeout(60_000),
      redirect: 'manual',
    })
    const raw = await res.text()
    let data: unknown = raw
    try { data = JSON.parse(raw) } catch {}
    if (!res.ok) {
      return NextResponse.json(
        { error: 'Brain insights fetch failed', status: res.status, body: data },
        { status: res.status >= 500 ? 502 : res.status }
      )
    }
    return NextResponse.json(data)
  } catch (err: any) {
    console.error('[GET /api/v1/brain/insights] error', err)
    return NextResponse.json(
      { error: err?.message || 'Brain unreachable', status: 504 },
      { status: 504 }
    )
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireStaffAuth(req)
  if (auth.error) return auth.error

  let body: { insight_id?: string; outcome?: string; notes?: string } = {}
  try {
    const text = await req.text()
    if (text) body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.insight_id || !body.outcome) {
    return NextResponse.json(
      { error: 'insight_id and outcome are required' },
      { status: 400 }
    )
  }

  try {
    const res = await fetch(`${BRAIN_BASE_URL}/brain/learn/feedback`, {
      method: 'POST',
      headers: brainHeaders(),
      body: JSON.stringify({
        insight_id: body.insight_id,
        outcome: body.outcome,
        notes: body.notes,
        actor: auth.session.email,
      }),
      signal: AbortSignal.timeout(60_000),
      redirect: 'manual',
    })
    const raw = await res.text()
    let data: unknown = raw
    try { data = JSON.parse(raw) } catch {}
    if (!res.ok) {
      return NextResponse.json(
        { error: 'Brain feedback failed', status: res.status, body: data },
        { status: res.status >= 500 ? 502 : res.status }
      )
    }
    return NextResponse.json({ ok: true, body: data })
  } catch (err: any) {
    console.error('[POST /api/v1/brain/insights] error', err)
    return NextResponse.json(
      { error: err?.message || 'Brain unreachable', status: 504 },
      { status: 504 }
    )
  }
}
