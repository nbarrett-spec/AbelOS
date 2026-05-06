/**
 * Vercel preview-deploy tool — used by the pitch-generator agent
 * (src/lib/agents/generate-pitch.ts) to publish a single-file HTML microsite
 * to a unique preview URL that Nate can review before approving outbound send.
 *
 * Endpoint: POST https://api.vercel.com/v13/deployments
 * Auth:     Bearer ${VERCEL_TOKEN}
 * Docs:     https://vercel.com/docs/rest-api/reference/endpoints/deployments/create-a-new-deployment
 *
 * Graceful degradation: if VERCEL_TOKEN is unset, returns
 * { ok: false, error: 'VERCEL_TOKEN not set; preview deploy skipped' } and
 * the pitch generator falls back to storing HTML in PitchRun.htmlContent only
 * (still reviewable from the admin UI, just no shareable preview URL).
 */
import type { ToolResult } from '../types'
import { logger } from '@/lib/logger'

const VERCEL_DEPLOY_ENDPOINT = 'https://api.vercel.com/v13/deployments'
const REQUEST_TIMEOUT_MS = 30_000

export async function deployVercelPreview(input: {
  projectName: string
  html: string
}): Promise<ToolResult<{ url: string; deploymentId: string }>> {
  const token = process.env.VERCEL_TOKEN
  if (!token) {
    return { ok: false, error: 'VERCEL_TOKEN not set; preview deploy skipped' }
  }

  // Vercel project names: lowercase letters, digits, hyphens, max 100 chars.
  // Sanitize defensively — caller may pass a friendlier slug.
  const safeName = input.projectName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'pitch-preview'

  // Vercel's deployments API expects file contents base64-encoded for the
  // single-file static deploy shape (vs. inline `data` strings, which work
  // for some endpoints but have looser size/encoding guarantees).
  const htmlBase64 = Buffer.from(input.html, 'utf8').toString('base64')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(VERCEL_DEPLOY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: safeName,
        files: [
          {
            file: 'index.html',
            data: htmlBase64,
            encoding: 'base64',
          },
        ],
        // Static single-file deploy — no framework auto-detect needed.
        projectSettings: { framework: null },
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '<unreadable body>')
      const msg = `Vercel deploy failed: ${res.status} ${res.statusText} — ${errText.slice(0, 300)}`
      logger.warn('vercel_deploy_http_error', {
        status: res.status,
        projectName: safeName,
      })
      return { ok: false, error: msg }
    }

    // Cast at the boundary — Vercel's response shape isn't typed in this repo.
    const json = (await res.json()) as {
      id?: string
      url?: string
      alias?: string[]
    }

    const deploymentId = json.id ?? ''
    // The `url` field is the canonical *.vercel.app domain (no protocol).
    // Prefix with https:// so callers can hand it directly to email/UI.
    const rawUrl = json.url ?? ''
    if (!deploymentId || !rawUrl) {
      return {
        ok: false,
        error: 'Vercel deploy succeeded but response missing id/url',
      }
    }

    const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`
    return { ok: true, data: { url, deploymentId } }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn('vercel_deploy_failed', { projectName: safeName, error: msg })
    return { ok: false, error: `Vercel deploy error: ${msg}` }
  } finally {
    clearTimeout(timeoutId)
  }
}
