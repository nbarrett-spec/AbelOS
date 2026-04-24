/**
 * GET /api/v1/brain/knowledge?category=...&limit=...
 *
 * Proxies to the NUC Brain at brain.abellumber.com/brain/knowledge/list
 * behind CF Access. Lets the Aegis UI read synthesized knowledge.
 *
 * Auth: staff session (requireStaffAuth — same as other v1 routes).
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireStaffAuth } from '@/lib/api-auth'

const BRAIN_BASE_URL = process.env.NUC_BRAIN_URL || 'https://brain.abellumber.com'

export async function GET(req: NextRequest) {
  const auth = await requireStaffAuth(req)
  if (auth.error) return auth.error

  const url = new URL(req.url)
  const category = url.searchParams.get('category')
  const limit = url.searchParams.get('limit')

  const qs = new URLSearchParams()
  if (category) qs.set('category', category)
  if (limit) qs.set('limit', limit)
  const tail = qs.toString() ? `?${qs.toString()}` : ''

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AbelOS-BrainKnowledge/1.0',
  }
  const cfId = process.env.CF_ACCESS_CLIENT_ID
  const cfSecret = process.env.CF_ACCESS_CLIENT_SECRET
  if (cfId && cfSecret) {
    headers['CF-Access-Client-Id'] = cfId
    headers['CF-Access-Client-Secret'] = cfSecret
  }

  try {
    const res = await fetch(`${BRAIN_BASE_URL}/brain/knowledge/list${tail}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(60_000),
      redirect: 'manual',
    })

    const raw = await res.text()
    let data: any = raw
    try { data = JSON.parse(raw) } catch {}

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Brain knowledge/list failed', status: res.status, body: data },
        { status: res.status >= 500 ? 502 : res.status }
      )
    }
    return NextResponse.json(data)
  } catch (err: any) {
    console.error('[GET /api/v1/brain/knowledge] error', err)
    return NextResponse.json(
      { error: err?.message || 'Brain unreachable', status: 504 },
      { status: 504 }
    )
  }
}
