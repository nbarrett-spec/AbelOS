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
 * bearer token that the coordinator's auth_middleware expects.
 *
 * NUC_TAILSCALE_URL  e.g. http://100.84.113.47:8400
 * NUC_AGENT_TOKEN    must match COORDINATOR_API_KEY on the NUC
 */
export async function forwardToNuc(
  path: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const base = process.env.NUC_TAILSCALE_URL
  const token = process.env.NUC_AGENT_TOKEN
  if (!base || !token) {
    throw new Error('NUC_TAILSCALE_URL or NUC_AGENT_TOKEN not configured')
  }
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), init?.timeoutMs ?? 65_000)
  try {
    return await fetch(`${base}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {}),
      },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(t)
  }
}
