/**
 * POST /api/v1/brain/synthesize
 *
 * Staff-triggered knowledge synthesis. The NUC Brain exposes three pipeline
 * triggers — /brain/trigger/{ingest,polish,narrate} — and this route fires
 * them in sequence so a single button press digests new events end-to-end.
 *
 * Body (optional): { stages?: ('ingest'|'polish'|'narrate')[] } — defaults
 * to all three. force/categories accepted but currently unused (Brain side
 * has no synthesis filter API).
 *
 * Auth: staff session (requireStaffAuth — same as other v1 routes).
 *
 * Coordinator (port 8400) is currently hung; this calls the Brain directly.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 70

import { NextRequest, NextResponse } from 'next/server'
import { requireStaffAuth } from '@/lib/api-auth'

const BRAIN_BASE_URL = process.env.NUC_BRAIN_URL || 'https://brain.abellumber.com'

export async function POST(req: NextRequest) {
  const auth = await requireStaffAuth(req)
  if (auth.error) return auth.error

  let body: { stages?: Array<'ingest' | 'polish' | 'narrate'> } = {}
  try {
    const text = await req.text()
    if (text) body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const stages = body.stages?.length ? body.stages : (['ingest', 'polish', 'narrate'] as const)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AbelOS-BrainSynthesize/1.0',
  }
  const cfId = process.env.CF_ACCESS_CLIENT_ID
  const cfSecret = process.env.CF_ACCESS_CLIENT_SECRET
  if (cfId && cfSecret) {
    headers['CF-Access-Client-Id'] = cfId
    headers['CF-Access-Client-Secret'] = cfSecret
  }

  const results: Array<{ stage: string; status: number; ok: boolean; body?: unknown }> = []
  for (const stage of stages) {
    try {
      const res = await fetch(`${BRAIN_BASE_URL}/brain/trigger/${stage}`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(60_000),
        redirect: 'manual',
      })
      const raw = await res.text().catch(() => '')
      let data: unknown = raw
      try { data = JSON.parse(raw) } catch {}
      results.push({ stage, status: res.status, ok: res.ok, body: data })
    } catch (err: any) {
      results.push({ stage, status: 504, ok: false, body: err?.message || 'fetch failed' })
    }
  }
  const ok = results.every((r) => r.ok)
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 502 })
}
