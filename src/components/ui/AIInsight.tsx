'use client'

import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Sparkles, RefreshCw, AlertCircle } from 'lucide-react'

interface AIInsightResponse {
  ok?: boolean
  cached?: boolean
  generatedAt?: string
  summary?: string
  snapshot?: string
  briefing?: string
  model?: string
  costEstimate?: number
  error?: string
}

export interface AIInsightProps {
  /** API endpoint to POST to (e.g. '/api/ops/ai/order-summary') */
  endpoint: string
  /** Body to POST (e.g. { orderId: 'abc' }) */
  input: Record<string, any>
  /** Display label for the insight (e.g. "AI order summary") */
  label?: string
  /** If true, load cached version on mount; otherwise wait for click. */
  autoLoadCached?: boolean
  className?: string
}

/**
 * AIInsight — small card that fetches and renders an AI-generated blurb with
 * a subtle shimmer while loading and a timestamp when done.
 *
 * Never auto-generates fresh insight on page load (cost control). If
 * `autoLoadCached` is on, it requests the cached version; if there is none,
 * it simply shows a "Generate" button.
 */
export default function AIInsight({
  endpoint,
  input,
  label = 'AI insight',
  autoLoadCached = true,
  className,
}: AIInsightProps) {
  const [data, setData] = useState<AIInsightResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchIt = useCallback(
    async (force: boolean) => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...input, force }),
          credentials: 'include',
        })
        const json = (await res.json()) as AIInsightResponse
        if (!res.ok) {
          setError(json?.error || `HTTP ${res.status}`)
        } else {
          setData(json)
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to load')
      } finally {
        setLoading(false)
      }
    },
    [endpoint, JSON.stringify(input)]
  )

  useEffect(() => {
    if (autoLoadCached) {
      // Only hit cached — the endpoint itself serves cached by default
      fetchIt(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoadCached, endpoint, JSON.stringify(input)])

  const text = data?.summary || data?.snapshot || data?.briefing || ''

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface/60 p-4',
        'relative overflow-hidden',
        className
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-accent" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            {label}
          </span>
          {data?.cached && (
            <span className="text-[10px] text-fg-subtle">cached</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => fetchIt(true)}
          disabled={loading}
          className="inline-flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg transition-colors disabled:opacity-40"
          aria-label="Regenerate"
        >
          <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
          {text ? 'Regenerate' : 'Generate'}
        </button>
      </div>

      {loading && !text && <ShimmerBlock />}

      {error && (
        <div className="flex items-start gap-2 text-[12px] text-data-warning">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {text && (
        <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-fg">
          {text}
        </div>
      )}

      {data?.generatedAt && (
        <div className="mt-2 pt-2 border-t border-border flex items-center justify-between text-[10px] text-fg-subtle tabular-nums">
          <span>
            Last generated{' '}
            {new Date(data.generatedAt).toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          {data.model && <span className="font-mono">{data.model}</span>}
        </div>
      )}
    </div>
  )
}

function ShimmerBlock() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-2.5 bg-surface-muted rounded w-[92%]" />
      <div className="h-2.5 bg-surface-muted rounded w-[78%]" />
      <div className="h-2.5 bg-surface-muted rounded w-[85%]" />
      <div className="h-2.5 bg-surface-muted rounded w-[55%]" />
    </div>
  )
}
