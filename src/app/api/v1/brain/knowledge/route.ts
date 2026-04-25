/**
 * GET /api/v1/brain/knowledge?type=...&limit=...&q=...
 *
 * Proxies to the NUC Brain. The Brain has no /knowledge/list endpoint —
 * its data model is entities + events. This route maps to /brain/entities
 * (with optional ?type= filter) or /brain/search (when ?q= is given).
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
  const type = url.searchParams.get('type') || url.searchParams.get('category')
  const limit = url.searchParams.get('limit') || '50'
  const q = url.searchParams.get('q')

  const qs = new URLSearchParams()
  qs.set('limit', limit)
  if (q) qs.set('q', q)
  if (type) qs.set('type', type)
  const path = q ? `/brain/search` : `/brain/entities`
  const tail = `?${qs.toString()}`

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
  const brainApiKey = process.env.BRAIN_API_KEY
  if (brainApiKey) {
    headers['X-API-Key'] = brainApiKey
    headers['Authorization'] = `Bearer ${brainApiKey}` // CF strips X-API-Key
  }

  try {
    const res = await fetch(`${BRAIN_BASE_URL}${path}${tail}`, {
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
        { error: 'Brain entity/search failed', status: res.status, body: data },
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
