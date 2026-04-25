/**
 * Brain Proxy — Aegis frontend → NUC Brain API
 *
 * Catch-all proxy that forwards requests to brain.abellumber.com
 * with CF Access credentials injected server-side.
 *
 * Usage from frontend:
 *   fetch('/api/ops/brain/proxy?path=health')          → GET brain.abellumber.com/brain/health
 *   fetch('/api/ops/brain/proxy?path=entities&limit=10') → GET brain.abellumber.com/brain/entities?limit=10
 *   fetch('/api/ops/brain/proxy?path=ask', { method: 'POST', body: ... })
 *        → POST brain.abellumber.com/brain/ask
 *
 * Auth: Staff session required (via middleware headers)
 * Outbound: CF Access service token headers added automatically
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { audit } from '@/lib/audit'

const BRAIN_BASE_URL = process.env.NUC_BRAIN_URL || 'https://brain.abellumber.com'

export async function GET(request: NextRequest) {
  return proxyToBrain(request, 'GET')
}

export async function POST(request: NextRequest) {
  return proxyToBrain(request, 'POST')
}

async function proxyToBrain(request: NextRequest, method: string) {
  // Require staff auth (set by middleware)
  const staffId = request.headers.get('x-staff-id')
  if (!staffId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const brainPath = searchParams.get('path')

    if (!brainPath) {
      return NextResponse.json(
        { error: 'Missing ?path= parameter. Example: ?path=health' },
        { status: 400 }
      )
    }

    // Allowlist of safe brain endpoints
    const allowedPrefixes = [
      'health', 'status', 'entities', 'entity/', 'search',
      'scores', 'score/', 'brief/', 'timeline/', 'actions',
      'gaps', 'watchlists', 'anomalies', 'agents', 'resilience',
      'ask',
    ]
    const isAllowed = allowedPrefixes.some(p => brainPath.startsWith(p))
    if (!isAllowed) {
      return NextResponse.json(
        { error: `Path "${brainPath}" is not in the allowed list` },
        { status: 403 }
      )
    }

    // Block dangerous endpoints from proxy (halt/resume/trigger are admin-only)
    const blockedPrefixes = ['halt', 'resume', 'trigger/', 'ingest']
    const isBlocked = blockedPrefixes.some(p => brainPath.startsWith(p))
    if (isBlocked) {
      return NextResponse.json(
        { error: `Path "${brainPath}" is blocked via proxy. Use direct NUC access.` },
        { status: 403 }
      )
    }

    // Build target URL — forward remaining query params (minus 'path')
    const forwardParams = new URLSearchParams()
    searchParams.forEach((value, key) => {
      if (key !== 'path') forwardParams.set(key, value)
    })
    const queryString = forwardParams.toString()
    const targetUrl = `${BRAIN_BASE_URL}/brain/${brainPath}${queryString ? '?' + queryString : ''}`

    // Build headers with CF Access credentials
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'AbelOS-Proxy/1.0',
    }

    // Add Cloudflare Access service token if configured (legacy — still honored
    // while CF Access is in the path; no-op after cutover).
    const cfClientId = process.env.CF_ACCESS_CLIENT_ID
    const cfClientSecret = process.env.CF_ACCESS_CLIENT_SECRET
    if (cfClientId && cfClientSecret) {
      headers['CF-Access-Client-Id'] = cfClientId
      headers['CF-Access-Client-Secret'] = cfClientSecret
    }
    // Add app-level Brain API key (new primary machine-to-machine auth).
    const brainApiKey = process.env.BRAIN_API_KEY
    if (brainApiKey) headers['X-API-Key'] = brainApiKey

    // Forward the request
    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(30000), // 30s timeout
    }

    if (method === 'POST') {
      try {
        const body = await request.json()
        fetchOptions.body = JSON.stringify(body)
      } catch {
        // No body — that's fine for some POST endpoints
      }
    }

    const response = await fetch(targetUrl, fetchOptions)
    const data = await response.json()

    if (method === 'POST') {
      await audit(request, 'PROXY', 'NUCBrain', brainPath, { method, status: response.status })
    }
    return NextResponse.json(data, { status: response.status })
  } catch (error: any) {
    logger.error('brain_proxy_failed', { error: error?.message })

    // Differentiate between connection errors and other failures
    if (error?.cause?.code === 'ECONNREFUSED' || error?.message?.includes('fetch failed')) {
      return NextResponse.json(
        { error: 'Brain engine is unreachable. The NUC may be offline.' },
        { status: 502 }
      )
    }

    return NextResponse.json(
      { error: error?.message || 'Proxy request failed' },
      { status: 500 }
    )
  }
}
