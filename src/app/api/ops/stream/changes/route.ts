export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { getRedis, getRecentEvents, EVENTS_LIST, type LiveEvent } from '@/lib/redis'

/**
 * GET /api/ops/stream/changes?topics=orders,pos,ar
 *
 * Server-sent events stream of mutation events published by `audit()`.
 *
 * Upstash's REST API doesn't give us a real pub/sub subscribe, so we tail
 * the `abel:events:recent` list with a short poll (every 1.2s) and forward
 * only events newer than the last timestamp we sent. Clients see near-realtime
 * without us running a long-lived websocket server.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const topicsParam = request.nextUrl.searchParams.get('topics')
  const topics = topicsParam
    ? new Set(topicsParam.split(',').map((t) => t.trim()).filter(Boolean))
    : null

  const redis = getRedis()
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      let lastAt = new Date().toISOString()

      const send = (evt: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(
            encoder.encode(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`)
          )
        } catch {
          closed = true
        }
      }

      // Initial hello so the client knows the stream is open
      send('ready', { at: new Date().toISOString(), topics: topicsParam || 'all' })

      // Heartbeat — keeps proxies from killing the connection
      const heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`))
        } catch {
          closed = true
        }
      }, 20_000)

      // Poll Redis for new events. Cheap — a single LRANGE(0, 20).
      const poll = async () => {
        if (closed || !redis) return
        try {
          const rows = await redis.lrange(EVENTS_LIST, 0, 30)
          // List is newest-first; reverse so we emit oldest→newest
          const parsed: LiveEvent[] = (rows as unknown as string[])
            .map((r) => {
              try { return typeof r === 'string' ? JSON.parse(r) : r } catch { return null }
            })
            .filter(Boolean) as LiveEvent[]
          const fresh = parsed
            .filter((e) => e.at > lastAt)
            .filter((e) => !topics || topics.has(e.topic))
            .reverse()
          for (const e of fresh) {
            send('change', e)
            if (e.at > lastAt) lastAt = e.at
          }
        } catch {
          // swallow
        }
      }

      const pollTimer = setInterval(poll, 1200)

      // If Redis is unavailable (local dev), at least send a "degraded" notice
      if (!redis) {
        send('degraded', { message: 'redis_unavailable', atInterval: 10_000 })
      }

      // Request abort → clean up
      request.signal.addEventListener('abort', () => {
        closed = true
        clearInterval(heartbeat)
        clearInterval(pollTimer)
        try { controller.close() } catch {}
      })
    },
    cancel() {
      // noop — handled by abort listener
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
