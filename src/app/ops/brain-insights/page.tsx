'use client'

/**
 * Brain Insights — staff-facing view of the NUC Brain's ranked insights.
 *
 * Pulls /api/v1/brain/insights (proxy → /brain/insights) and renders a
 * filterable card list. Calibration sidebar surfaces the patterns the
 * Brain trusts most (per /brain/learn/calibration). Mark-useful /
 * mark-incorrect post back to /brain/learn/feedback so the calibrator
 * keeps tightening.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Brain,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  Activity,
  ActivitySquare,
  TrendingUp,
  Link2,
  Clock,
  AlertTriangle,
  Sparkles,
  ArrowLeftRight,
  Filter,
} from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'

// ── Types ─────────────────────────────────────────────────────────────────

interface Insight {
  id: string
  kind: string
  pattern_type?: string
  entity_ids: string[]
  narrative: string
  evidence?: Record<string, unknown>
  raw_confidence: number
  adjusted_confidence: number
  generated_at: string
  ttl_seconds?: number
  tags?: string[]
}

interface CalibrationRow {
  pattern_type: string
  hits: number
  misses: number
  hit_rate: number
  sample_size: number
  trust_weight?: number
}

const KINDS = [
  'all',
  'activity_spike',
  'activity_silence',
  'trend_shift',
  'cooccurrence_signal',
  'temporal_lag_signal',
  'forecast_breach',
  'cross_entity',
] as const

const KIND_LABELS: Record<string, string> = {
  activity_spike: 'Activity Spike',
  activity_silence: 'Activity Silence',
  trend_shift: 'Trend Shift',
  cooccurrence_signal: 'Co-occurrence',
  temporal_lag_signal: 'Temporal Lag',
  forecast_breach: 'Forecast Breach',
  cross_entity: 'Cross-Entity',
}

const KIND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  activity_spike: TrendingUp,
  activity_silence: Activity,
  trend_shift: ActivitySquare,
  cooccurrence_signal: Link2,
  temporal_lag_signal: Clock,
  forecast_breach: AlertTriangle,
  cross_entity: ArrowLeftRight,
}

// ── Helpers ───────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  try {
    const t = new Date(iso).getTime()
    const diff = Date.now() - t
    if (Number.isNaN(t)) return iso
    const m = Math.round(diff / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.round(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.round(h / 24)
    return `${d}d ago`
  } catch {
    return iso
  }
}

function confidenceTone(c: number): 'positive' | 'warning' | 'neutral' {
  if (c >= 0.85) return 'positive'
  if (c >= 0.6) return 'warning'
  return 'neutral'
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  const tone = confidenceTone(value)
  const color =
    tone === 'positive'
      ? 'bg-data-positive'
      : tone === 'warning'
        ? 'bg-data-warning'
        : 'bg-fg-subtle'
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="h-1.5 flex-1 rounded-full bg-surface-muted overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-mono tabular-nums text-fg-muted w-10 text-right">
        {pct.toFixed(0)}%
      </span>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function BrainInsightsPage() {
  const [insights, setInsights] = useState<Insight[]>([])
  const [calibration, setCalibration] = useState<CalibrationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedbackState, setFeedbackState] = useState<Record<string, 'useful' | 'incorrect' | 'pending'>>({})

  // Filters
  const [kind, setKind] = useState<string>('all')
  const [minConfidence, setMinConfidence] = useState<number>(0)

  const fetchAll = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      qs.set('limit', '50')
      qs.set('min_confidence', String(minConfidence))
      if (kind !== 'all') qs.set('kind', kind)

      const [insRes, calRes] = await Promise.all([
        fetch(`/api/v1/brain/insights?${qs.toString()}`, { credentials: 'include' }),
        fetch(`/api/v1/brain/insights?view=calibration`, { credentials: 'include' }),
      ])

      if (!insRes.ok) {
        const t = await insRes.text().catch(() => '')
        throw new Error(`Insights fetch failed (${insRes.status}): ${t.slice(0, 200)}`)
      }
      const insData = await insRes.json()

      // Tolerate either {insights: [...]} or [...] shape
      const list: Insight[] = Array.isArray(insData)
        ? insData
        : Array.isArray(insData?.insights)
          ? insData.insights
          : Array.isArray(insData?.items)
            ? insData.items
            : []
      setInsights(list)

      if (calRes.ok) {
        const calData = await calRes.json()
        const calList: CalibrationRow[] = Array.isArray(calData)
          ? calData
          : Array.isArray(calData?.calibration)
            ? calData.calibration
            : Array.isArray(calData?.patterns)
              ? calData.patterns
              : []
        setCalibration(calList)
      }
      setLastRefresh(new Date())
    } catch (err: any) {
      console.error('[brain-insights] fetch error', err)
      setError(err?.message || 'Failed to load insights')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [kind, minConfidence])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  async function submitFeedback(insightId: string, outcome: 'useful' | 'incorrect') {
    setFeedbackState((s) => ({ ...s, [insightId]: 'pending' }))
    try {
      const res = await fetch('/api/v1/brain/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ insight_id: insightId, outcome }),
      })
      if (!res.ok) throw new Error(`feedback ${res.status}`)
      setFeedbackState((s) => ({ ...s, [insightId]: outcome }))
    } catch (err) {
      console.error('feedback error', err)
      setFeedbackState((s) => {
        const copy = { ...s }
        delete copy[insightId]
        return copy
      })
    }
  }

  const topPatterns = useMemo(() => {
    return [...calibration]
      .filter((r) => (r.sample_size ?? r.hits + r.misses) >= 3)
      .sort((a, b) => (b.hit_rate ?? 0) - (a.hit_rate ?? 0))
      .slice(0, 5)
  }, [calibration])

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations Brain"
        title="Brain Insights"
        description="Ranked signals from the NUC Brain. Mark insights useful or incorrect — feedback retrains the pattern calibrator."
        crumbs={[{ label: 'Ops', href: '/ops' }, { label: 'Brain Insights' }]}
        actions={
          <>
            <Badge variant="neutral" size="md">
              {loading ? '…' : `${insights.length} live`}
            </Badge>
            {lastRefresh && (
              <span className="text-[11px] text-fg-subtle font-mono tabular-nums">
                {relativeTime(lastRefresh.toISOString())}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />}
              onClick={() => fetchAll()}
              disabled={refreshing}
            >
              Refresh
            </Button>
          </>
        }
      />

      {/* Filters */}
      <Card variant="elevated" padding="sm">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-fg-subtle" />
            <span className="text-xs font-medium text-fg-muted uppercase tracking-wide">Kind</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="h-8 px-2.5 text-xs rounded-md border border-border bg-surface-muted text-fg focus:outline-none focus:ring-2 focus:ring-signal/40"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k === 'all' ? 'All kinds' : KIND_LABELS[k] ?? k}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 flex-1 min-w-[260px]">
            <span className="text-xs font-medium text-fg-muted uppercase tracking-wide">
              Min confidence
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={minConfidence * 100}
              onChange={(e) => setMinConfidence(Number(e.target.value) / 100)}
              className="flex-1 max-w-[260px] accent-signal"
            />
            <span className="text-[11px] font-mono tabular-nums text-fg-muted w-10 text-right">
              {(minConfidence * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      </Card>

      {/* Main grid: insights + calibration sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5">
        {/* Insights list */}
        <div className="space-y-3">
          {error && (
            <Card variant="default" padding="md">
              <div className="flex items-start gap-3 text-data-negative-fg">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Couldn't reach the Brain</p>
                  <p className="text-xs text-fg-muted mt-0.5">{error}</p>
                </div>
              </div>
            </Card>
          )}

          {loading && !insights.length ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <Card key={i} variant="default" padding="md">
                  <div className="animate-pulse space-y-2">
                    <div className="h-3 w-1/3 bg-surface-muted rounded" />
                    <div className="h-4 w-3/4 bg-surface-muted rounded" />
                    <div className="h-3 w-1/2 bg-surface-muted rounded" />
                  </div>
                </Card>
              ))}
            </div>
          ) : insights.length === 0 && !error ? (
            <EmptyState
              icon={<Brain className="w-10 h-10" />}
              title="No insights match these filters"
              description="Try lowering the minimum confidence or selecting a different kind. The Brain re-ranks insights every cycle."
            />
          ) : (
            insights.map((ins) => (
              <InsightCardRow
                key={ins.id}
                insight={ins}
                feedback={feedbackState[ins.id]}
                onFeedback={(outcome) => submitFeedback(ins.id, outcome)}
              />
            ))
          )}
        </div>

        {/* Calibration sidebar */}
        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <Card variant="elevated" padding="md">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-3.5 h-3.5 text-signal" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-fg">
                Most-trusted patterns
              </h3>
            </div>
            {topPatterns.length === 0 ? (
              <p className="text-xs text-fg-subtle">
                Not enough feedback yet — mark insights useful/incorrect and patterns will rank here.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {topPatterns.map((p) => {
                  const sample = p.sample_size ?? p.hits + p.misses
                  return (
                    <li key={p.pattern_type} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-medium text-fg truncate">
                          {KIND_LABELS[p.pattern_type] ?? p.pattern_type}
                        </span>
                        <span className="text-[10px] font-mono tabular-nums text-fg-muted shrink-0">
                          {(p.hit_rate * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-1 rounded-full bg-surface-muted overflow-hidden">
                        <div
                          className="h-full bg-signal"
                          style={{ width: `${(p.hit_rate * 100).toFixed(0)}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-fg-subtle font-mono">
                        n={sample}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <Card variant="ghost" padding="sm" className="border border-border">
            <p className="text-[11px] leading-relaxed text-fg-subtle">
              Confidence is the Brain's calibrated probability that an insight will pan out. We
              weight the raw pattern signal by historical hit-rate per pattern type.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  )
}

// ── Insight card ──────────────────────────────────────────────────────────

function InsightCardRow({
  insight,
  feedback,
  onFeedback,
}: {
  insight: Insight
  feedback?: 'useful' | 'incorrect' | 'pending'
  onFeedback: (outcome: 'useful' | 'incorrect') => void
}) {
  const Icon = KIND_ICONS[insight.kind] || Brain
  const tone = confidenceTone(insight.adjusted_confidence)
  const toneRing =
    tone === 'positive'
      ? 'border-l-data-positive'
      : tone === 'warning'
        ? 'border-l-data-warning'
        : 'border-l-border-strong'

  return (
    <Card
      variant="elevated"
      padding="md"
      className={`border-l-2 ${toneRing} transition-shadow hover:shadow-glass`}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-9 h-9 rounded-lg bg-surface-muted flex items-center justify-center">
          <Icon className="w-4 h-4 text-signal" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <Badge variant="neutral" size="xs">
              {KIND_LABELS[insight.kind] ?? insight.kind}
            </Badge>
            {insight.pattern_type && insight.pattern_type !== insight.kind && (
              <span className="text-[10px] font-mono text-fg-subtle uppercase tracking-wider">
                {insight.pattern_type}
              </span>
            )}
            <span className="text-[10px] font-mono text-fg-subtle ml-auto">
              {relativeTime(insight.generated_at)}
            </span>
          </div>

          <p className="text-[13px] text-fg leading-snug mb-2.5">{insight.narrative}</p>

          {/* Confidence bar */}
          <div className="flex items-center gap-3 mb-2.5">
            <ConfidenceBar value={insight.adjusted_confidence} />
            {Math.abs(insight.adjusted_confidence - insight.raw_confidence) > 0.02 && (
              <span className="text-[10px] font-mono text-fg-subtle">
                raw {(insight.raw_confidence * 100).toFixed(0)}%
              </span>
            )}
          </div>

          {/* Entities + tags */}
          {(insight.entity_ids?.length || insight.tags?.length) ? (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(insight.entity_ids || []).slice(0, 6).map((e) => (
                <span
                  key={e}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-muted text-fg-muted border border-border"
                >
                  {e}
                </span>
              ))}
              {(insight.tags || []).slice(0, 4).map((t) => (
                <Badge key={t} variant="signal" size="xs">
                  {t}
                </Badge>
              ))}
            </div>
          ) : null}

          {/* Actions */}
          <div className="flex items-center gap-2 mt-2">
            <Button
              variant={feedback === 'useful' ? 'primary' : 'ghost'}
              size="xs"
              icon={<ThumbsUp className="w-3 h-3" />}
              disabled={feedback === 'pending' || feedback === 'useful'}
              onClick={() => onFeedback('useful')}
            >
              {feedback === 'useful' ? 'Marked useful' : 'Useful'}
            </Button>
            <Button
              variant={feedback === 'incorrect' ? 'danger' : 'ghost'}
              size="xs"
              icon={<ThumbsDown className="w-3 h-3" />}
              disabled={feedback === 'pending' || feedback === 'incorrect'}
              onClick={() => onFeedback('incorrect')}
            >
              {feedback === 'incorrect' ? 'Marked incorrect' : 'Incorrect'}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
