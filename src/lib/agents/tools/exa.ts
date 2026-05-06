/**
 * Exa.ai search wrapper — used by the builder-enrichment agent
 * (src/lib/agents/enrich-prospect.ts) when web_search alone hasn't surfaced
 * a personal email or founder name.
 *
 * Exa is neural-search complementary to keyword web search:
 *   - Better for "find the LinkedIn profile of the founder of X"
 *   - Better for "pages that look like {sample URL}"
 *   - Worse for fresh news / time-sensitive queries (use web_search there)
 *
 * Endpoint: POST https://api.exa.ai/search
 * Auth:     x-api-key header (env: EXA_API_KEY)
 * Docs:     https://docs.exa.ai/reference/search
 *
 * Graceful degradation: if EXA_API_KEY is unset, returns
 * { ok: false, error: 'EXA_API_KEY not set; skipping Exa search' } so the
 * agent can fall back to web_search alone without crashing.
 */
import type { ToolResult } from '../types'
import { logger } from '@/lib/logger'

const EXA_ENDPOINT = 'https://api.exa.ai/search'
const DEFAULT_RESULTS = 10
const MAX_RESULTS = 25
const SNIPPET_MAX_CHARS = 500
const REQUEST_TIMEOUT_MS = 10_000

export interface ExaSearchResult {
  url: string
  title: string
  snippet: string
  publishedDate?: string
}

export async function exaSearch(input: {
  query: string
  numResults?: number
}): Promise<ToolResult<{ results: ExaSearchResult[] }>> {
  const apiKey = process.env.EXA_API_KEY
  if (!apiKey) {
    return { ok: false, error: 'EXA_API_KEY not set; skipping Exa search' }
  }

  const numResults = Math.min(
    Math.max(1, input.numResults ?? DEFAULT_RESULTS),
    MAX_RESULTS
  )

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(EXA_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        query: input.query,
        numResults,
        type: 'auto',
        useAutoprompt: true,
        // Request text contents inline so we can populate snippets without a
        // second /contents call. Exa returns `result.text` when available.
        contents: { text: true },
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '<unreadable body>')
      const msg = `Exa search failed: ${res.status} ${res.statusText} — ${errText.slice(0, 200)}`
      logger.warn('exa_search_http_error', { status: res.status, query: input.query })
      return { ok: false, error: msg }
    }

    // Cast at the boundary; Exa's response shape isn't typed in this repo.
    const json = (await res.json()) as {
      results?: Array<{
        url?: string
        title?: string
        text?: string
        snippet?: string
        publishedDate?: string
      }>
    }

    const rawResults = Array.isArray(json.results) ? json.results : []
    const results: ExaSearchResult[] = rawResults
      .filter((r) => r.url)
      .map((r) => {
        const text = (r.text ?? r.snippet ?? '').trim()
        return {
          url: r.url as string,
          title: (r.title ?? '').trim(),
          snippet:
            text.length > SNIPPET_MAX_CHARS
              ? text.slice(0, SNIPPET_MAX_CHARS) + '…'
              : text,
          publishedDate: r.publishedDate,
        }
      })

    return { ok: true, data: { results } }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    // AbortError on timeout is expected under bad networks; warn (not error)
    // so it doesn't pollute Sentry with infra noise.
    logger.warn('exa_search_failed', { query: input.query, error: msg })
    return { ok: false, error: `Exa search error: ${msg}` }
  } finally {
    clearTimeout(timeoutId)
  }
}
