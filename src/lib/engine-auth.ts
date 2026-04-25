/**
 * engine-auth.ts — Bearer-token auth for the NUC engine control plane.
 *
 * Protects every /api/v1/engine/* route. The NUC presents
 * `Authorization: Bearer <ENGINE_BRIDGE_TOKEN>` along with an `X-Workspace-Id`
 * header so downstream logs/RLS know which workspace the call belongs to.
 *
 * Usage:
 *   const auth = await verifyEngineToken(req)
 *   if (!auth.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
 */

import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'

export interface EngineAuth {
  ok: boolean
  workspaceId: string
  source: string
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export async function verifyEngineToken(req: NextRequest): Promise<EngineAuth> {
  const expected = process.env.ENGINE_BRIDGE_TOKEN || ''
  if (!expected) {
    // Fail closed — if the env var isn't set, nothing validates.
    return { ok: false, workspaceId: '', source: '' }
  }

  const header = req.headers.get('authorization') || ''
  const token = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : ''

  if (!safeEqual(token, expected)) {
    return { ok: false, workspaceId: '', source: '' }
  }

  return {
    ok: true,
    workspaceId: req.headers.get('x-workspace-id') || '',
    source: req.headers.get('x-source') || 'nuc-engine',
  }
}

/**
 * Convenience: forward a request to the NUC coordinator, adding the agent
 * bearer token that the coordinator's auth_middleware expects. Optionally
 * attaches Cloudflare Access service-token headers so requests survive a
 * Zero-Trust Access policy in front of the tunnel hostname.
 *
 * Env:
 *   NUC_URL                  public base URL (e.g. https://nuc.abellumber.com).
 *                            Legacy NUC_TAILSCALE_URL is still read as a fallback.
 *   NUC_AGENT_TOKEN          must match COORDINATOR_API_KEY on the NUC
 *   BRAIN_API_KEY            (optional) shared secret for the Brain's new
 *                            app-level auth middleware (AUTH_API_KEY on the NUC).
 *                            Sent as X-API-Key. Coexists with CF Access during
 *                            the cutover window.
 *   CF_ACCESS_CLIENT_ID      (optional) CF Access service-token client ID
 *   CF_ACCESS_CLIENT_SECRET  (optional) CF Access service-token client secret
 */
export async function forwardToNuc(
  path: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const base = process.env.NUC_URL || process.env.NUC_TAILSCALE_URL
  const token = process.env.NUC_AGENT_TOKEN
  if (!base || !token) {
    throw new Error('NUC_URL or NUC_AGENT_TOKEN not configured')
  }
  const cfId = process.env.CF_ACCESS_CLIENT_ID
  const cfSecret = process.env.CF_ACCESS_CLIENT_SECRET
  const cfAccessHeaders: Record<string, string> =
    cfId && cfSecret
      ? {
          'CF-Access-Client-Id': cfId,
          'CF-Access-Client-Secret': cfSecret,
        }
      : {}

  // X-API-Key header for the Brain's app-level auth middleware. When this env
  // var is set, outbound requests carry both auth modes so we can flip CF
  // Access off without coordinated code/env changes.
  const brainApiKey = process.env.BRAIN_API_KEY
  // Send both X-API-Key (works direct-to-NUC) and Authorization Bearer (works
  // through CF; CF strips X-API-Key on the brain.abellumber.com hostname).
  // forwardToNuc already sets Authorization for the NUC_AGENT_TOKEN, so for
  // brain-targeted callers using BRAIN_API_KEY we use X-API-Key only here —
  // the brain-facing routes set their own Authorization header explicitly.
  const appAuthHeaders: Record<string, string> = brainApiKey
    ? { 'X-API-Key': brainApiKey }
    : {}

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), init?.timeoutMs ?? 65_000)
  try {
    return await fetch(`${base}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...cfAccessHeaders,
        ...appAuthHeaders,
        ...(init?.headers || {}),
      },
      signal: controller.signal,
      // Don't follow CF Access login redirects — we want the 302 to bubble up
      // as a visible failure so we can diagnose service-token misconfiguration.
      redirect: 'manual',
    })
  } finally {
    clearTimeout(t)
  }
}
