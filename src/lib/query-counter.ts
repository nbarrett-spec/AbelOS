import { AsyncLocalStorage } from 'async_hooks'
import { logger } from '@/lib/logger'

// ──────────────────────────────────────────────────────────────────────────
// Request-scoped query counter for N+1 detection.
//
// Tracks how many times each Prisma model+operation pair fires within a
// single HTTP request. If the same pair fires more than N_PLUS_ONE_THRESHOLD
// times, it logs a warning with the request context so developers can find
// and fix N+1 patterns.
//
// Usage:
//   1. Wrap your request handler with withQueryCounting(handler)
//   2. The Prisma $allOperations hook calls recordQuery() on each operation
//   3. At the end of the request, flushQueryCounts() logs any N+1 patterns
//
// This uses AsyncLocalStorage so it's safe across concurrent requests —
// each request gets its own counter map.
//
// Performance: adds one Map.get + Map.set per Prisma operation (~0.001ms).
// Only allocates the Map for requests that opt in via withQueryCounting.
// ──────────────────────────────────────────────────────────────────────────

const N_PLUS_ONE_THRESHOLD = parseInt(
  process.env.N_PLUS_ONE_THRESHOLD || '10',
  10
)

interface QueryCountStore {
  counts: Map<string, number>
  requestPath: string
  requestId: string | null
}

export const queryCountStorage = new AsyncLocalStorage<QueryCountStore>()

/**
 * Record a query execution in the current request's counter.
 * Called from the Prisma $allOperations hook.
 * No-op if not inside a withQueryCounting context.
 */
export function recordQuery(model: string, operation: string): void {
  const store = queryCountStorage.getStore()
  if (!store) return
  const key = `${model}.${operation}`
  store.counts.set(key, (store.counts.get(key) || 0) + 1)
}

/**
 * Check and log any N+1 patterns found in the current request.
 * Called at the end of the request lifecycle.
 */
export function flushQueryCounts(): void {
  const store = queryCountStorage.getStore()
  if (!store) return

  for (const [key, count] of store.counts) {
    if (count >= N_PLUS_ONE_THRESHOLD) {
      const [model, operation] = key.split('.')
      logger.warn('n_plus_one_detected', {
        model,
        operation,
        count,
        threshold: N_PLUS_ONE_THRESHOLD,
        requestPath: store.requestPath,
        requestId: store.requestId,
      })
    }
  }
}

/**
 * Wrap a request handler with query counting.
 * Use in API routes or middleware where you suspect N+1 patterns.
 *
 * Example:
 *   export const GET = withQueryCounting(async (request) => { ... })
 */
export function withQueryCounting<T>(
  handler: (request: Request) => Promise<T>
): (request: Request) => Promise<T> {
  return (request: Request) => {
    const url = new URL(request.url)
    const store: QueryCountStore = {
      counts: new Map(),
      requestPath: url.pathname,
      requestId: request.headers.get('x-request-id'),
    }
    return queryCountStorage.run(store, async () => {
      try {
        return await handler(request)
      } finally {
        flushQueryCounts()
      }
    })
  }
}
