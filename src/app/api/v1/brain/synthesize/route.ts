/**
 * POST /api/v1/brain/synthesize
 *
 * Staff-triggered knowledge synthesis. Proxies to the NUC Brain at
 * brain.abellumber.com/brain/knowledge/synthesize behind CF Access.
 *
 * Body: { categories?: string[], force?: boolean }
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

  let body: { categories?: string[]; force?: boolean } = {}
  try {
    const text = await req.text()
    if (text) body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

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

  try {
    const res = await fetch(`${BRAIN_BASE_URL}/brain/knowledge/synthesize`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
      redirect: 'manual',
    })

    const raw = await res.text()
    let data: any = raw
    try { data = JSON.parse(raw) } catch {}

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Brain synthesize failed', status: res.status, body: data },
        { status: res.status >= 500 ? 502 : res.status }
      )
    }
    return NextResponse.json(data)
  } catch (err: any) {
    console.error('[POST /api/v1/brain/synthesize] error', err)
    return NextResponse.json(
      { error: err?.message || 'Brain unreachable', status: 504 },
      { status: 504 }
    )
  }
}
