'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────

interface Stop {
  activityId: string
  builderId: string | null
  companyName: string | null
  scheduledAt: string | null
  activityType: string
  subject: string
  city?: string | null
  state?: string | null
  source: 'activity' | 'deal'
}

interface Touch {
  id: string
  kind: string
  subject: string | null
  summary: string | null
  at: string
  staffName: string | null
}

interface NextStopData {
  ok: true
  builder: {
    id: string
    companyName: string
    contactName?: string | null
    city?: string | null
    state?: string | null
    phone?: string | null
    email?: string | null
    builderType?: string | null
    paymentTerm?: string | null
    territory?: string | null
    lastTouchAt: string | null
  }
  touches: Touch[]
  openItems: {
    quotesPending: number
    quotes: Array<{ id: string; quoteNumber: string; total: number; status: string; validUntil?: string | null; createdAt: string }>
    ordersInFlight: number
    orders: Array<{ id: string; orderNumber: string; total: number; status: string; createdAt: string; deliveryDate?: string | null }>
    openInvoicesTotal: number
    overdueInvoicesCount: number
  }
  ar: { outstanding: number; overdue30: number; overdue60: number; flag: 'CRITICAL' | 'WARNING' | null }
  recentOrders: Array<{ id: string; orderNumber: string; total: number; status: string; createdAt: string }>
  pipeline: Array<{ id: string; dealNumber: string; stage: string; dealValue: number; expectedCloseDate?: string | null; probability: number }>
}

interface BuilderOption { id: string; companyName: string }

// ─── Formatters ───────────────────────────────────────────────────────────

const fmtMoney = (n: number) => '$' + Math.round(n || 0).toLocaleString('en-US')
const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'
const fmtTime = (d?: string | null) =>
  d ? new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''
const daysAgo = (d?: string | null) => {
  if (!d) return null
  const diff = Date.now() - new Date(d).getTime()
  const days = Math.floor(diff / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

const kindIcon: Record<string, string> = {
  email: '✉',
  call: '☎',
  visit: '📍',
  sms: '💬',
  quote: '📄',
  issue: '⚠',
  note: '📝',
  system: '⚙',
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function NextStopPage() {
  const router = useRouter()
  const params = useSearchParams()
  const initialBuilderId = params?.get('builderId') || null

  const [stops, setStops] = useState<Stop[]>([])
  const [stopIndex, setStopIndex] = useState(0)
  const [selectedBuilderId, setSelectedBuilderId] = useState<string | null>(initialBuilderId)
  const [data, setData] = useState<NextStopData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingStops, setLoadingStops] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [builderOptions, setBuilderOptions] = useState<BuilderOption[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [builderSearch, setBuilderSearch] = useState('')

  const [aiSnapshot, setAiSnapshot] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  const [voiceLoading, setVoiceLoading] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [voiceScript, setVoiceScript] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const [logVisitOpen, setLogVisitOpen] = useState(false)
  const [logNotes, setLogNotes] = useState('')
  const [logAction, setLogAction] = useState('')
  const [logFollowUp, setLogFollowUp] = useState('')
  const [logSubmitting, setLogSubmitting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // ─── Stops (today) ──
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoadingStops(true)
      try {
        const res = await fetch('/api/ops/portal/sales/today-stops')
        if (!res.ok) throw new Error('Failed to load today stops')
        const j = await res.json()
        if (cancelled) return
        setStops(j.stops || [])
        // If no query string builder, default to the first stop's builder
        if (!initialBuilderId && j.stops?.[0]?.builderId) {
          setSelectedBuilderId(j.stops[0].builderId)
        }
      } catch (err: any) {
        // non-fatal — picker still works
        console.error(err)
      } finally {
        if (!cancelled) setLoadingStops(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [initialBuilderId])

  // Sync stopIndex when stops come in and selectedBuilder was set by URL
  useEffect(() => {
    if (!stops.length) return
    const idx = stops.findIndex(s => s.builderId === selectedBuilderId)
    if (idx >= 0) setStopIndex(idx)
  }, [stops, selectedBuilderId])

  // ─── Main next-stop payload ──
  const loadStop = useCallback(async (builderId: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ops/portal/sales/next-stop?builderId=${encodeURIComponent(builderId)}`)
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to load next stop')
      const j = (await res.json()) as NextStopData
      setData(j)
    } catch (err: any) {
      setError(err?.message || 'Failed to load')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedBuilderId) loadStop(selectedBuilderId)
  }, [selectedBuilderId, loadStop])

  // ─── AI snapshot (cached first, regeneratable) ──
  const fetchAi = useCallback(async (force = false) => {
    if (!selectedBuilderId) return
    setAiLoading(true)
    try {
      const res = await fetch('/api/ops/ai/builder-snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ builderId: selectedBuilderId, force }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'AI snapshot failed')
      const j = await res.json()
      setAiSnapshot(j.snapshot || null)
    } catch (err: any) {
      console.error('[ai snapshot]', err)
      setAiSnapshot(null)
    } finally {
      setAiLoading(false)
    }
  }, [selectedBuilderId])

  useEffect(() => {
    if (selectedBuilderId) fetchAi(false)
  }, [selectedBuilderId, fetchAi])

  // ─── Builder picker search ──
  useEffect(() => {
    if (!pickerOpen) return
    let cancelled = false
    const handle = setTimeout(async () => {
      const q = builderSearch.trim()
      try {
        const res = await fetch(`/api/ops/builders?limit=20&page=1${q ? `&search=${encodeURIComponent(q)}` : '&sortBy=companyName&sortDir=asc'}`)
        if (!res.ok) return
        const j = await res.json()
        if (!cancelled) setBuilderOptions((j.builders || []).map((b: any) => ({ id: b.id, companyName: b.companyName })))
      } catch (_e) { /* ignore */ }
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [builderSearch, pickerOpen])

  // ─── Voice briefing ──
  const playVoice = useCallback(async () => {
    setVoiceLoading(true)
    setVoiceError(null)
    setVoiceScript(null)
    try {
      const payload = {
        stops: stops.map(s => ({ builderId: s.builderId, scheduledAt: s.scheduledAt, companyName: s.companyName })),
      }
      const res = await fetch('/api/ops/portal/sales/voice-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.status === 503) {
        const j = await res.json()
        setVoiceScript(j.script || null)
        setVoiceError('Voice not configured — showing text briefing')
        return
      }
      if (!res.ok) throw new Error(`Voice briefing failed (${res.status})`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      if (audioRef.current) {
        audioRef.current.src = url
        await audioRef.current.play().catch(() => { /* autoplay guard */ })
      }
    } catch (err: any) {
      setVoiceError(err?.message || 'Voice briefing failed')
    } finally {
      setVoiceLoading(false)
    }
  }, [stops])

  // ─── Log visit ──
  const submitVisit = useCallback(async () => {
    if (!selectedBuilderId || !logNotes.trim()) return
    setLogSubmitting(true)
    try {
      const staffId = (document.cookie.match(/abel_staff_id=([^;]+)/) || [])[1]
      const res = await fetch('/api/ops/communication-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          builderId: selectedBuilderId,
          staffId: staffId || null,
          channel: 'IN_PERSON',
          direction: 'OUTBOUND',
          subject: logAction ? `Visit — next: ${logAction}` : 'Visit',
          body: [
            logNotes.trim(),
            logAction ? `\nNext action: ${logAction.trim()}` : '',
            logFollowUp ? `\nFollow up: ${new Date(logFollowUp).toLocaleDateString('en-US')}` : '',
          ].join(''),
          sentAt: new Date().toISOString(),
          status: logFollowUp ? 'NEEDS_FOLLOW_UP' : 'LOGGED',
        }),
      })
      if (!res.ok) throw new Error('Failed to log')
      setLogVisitOpen(false)
      setLogNotes('')
      setLogAction('')
      setLogFollowUp('')
      setToast('Visit logged')
      setTimeout(() => setToast(null), 3500)
      // Refresh data to show the touch
      if (selectedBuilderId) loadStop(selectedBuilderId)
    } catch (err: any) {
      setToast(err?.message || 'Failed to log')
      setTimeout(() => setToast(null), 3500)
    } finally {
      setLogSubmitting(false)
    }
  }, [selectedBuilderId, logNotes, logAction, logFollowUp, loadStop])

  // ─── Swipe through stops ──
  const goPrev = () => {
    if (!stops.length) return
    const next = (stopIndex - 1 + stops.length) % stops.length
    setStopIndex(next)
    if (stops[next]?.builderId) setSelectedBuilderId(stops[next].builderId)
  }
  const goNext = () => {
    if (!stops.length) return
    const next = (stopIndex + 1) % stops.length
    setStopIndex(next)
    if (stops[next]?.builderId) setSelectedBuilderId(stops[next].builderId)
  }

  // ─── Render ──
  const currentStop = stops[stopIndex]
  const hasStops = stops.length > 0

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-24 sm:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Next Stop</h1>
          <p className="text-xs text-gray-500">
            {loadingStops ? 'Loading stops…' : hasStops ? `${stopIndex + 1} of ${stops.length} today` : 'No calendar stops — pick a builder'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={playVoice}
            disabled={voiceLoading || !hasStops}
            className="px-3 py-2 rounded-lg bg-[#0f2a3e] text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1"
            aria-label="Play voice briefing"
          >
            {voiceLoading ? '…' : '▶'} <span className="hidden sm:inline">Brief me</span>
          </button>
          <button
            onClick={() => setPickerOpen(true)}
            className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700"
          >
            Switch
          </button>
        </div>
      </div>

      <audio ref={audioRef} className="hidden" />
      {voiceError && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
          {voiceError}
          {voiceScript && <div className="mt-1 text-gray-700">{voiceScript}</div>}
        </div>
      )}

      {/* Stops strip */}
      {hasStops && (
        <div className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 py-1">
          <button onClick={goPrev} aria-label="Previous stop" className="flex-shrink-0 w-8 h-8 rounded-full border border-gray-300 text-gray-700">‹</button>
          {stops.map((s, i) => (
            <button
              key={s.activityId}
              onClick={() => {
                setStopIndex(i)
                if (s.builderId) setSelectedBuilderId(s.builderId)
              }}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs border ${
                i === stopIndex
                  ? 'bg-[#0f2a3e] text-white border-[#0f2a3e]'
                  : 'bg-white text-gray-700 border-gray-300'
              }`}
            >
              {fmtTime(s.scheduledAt) || `Stop ${i + 1}`} · {(s.companyName || 'builder').slice(0, 18)}
            </button>
          ))}
          <button onClick={goNext} aria-label="Next stop" className="flex-shrink-0 w-8 h-8 rounded-full border border-gray-300 text-gray-700">›</button>
        </div>
      )}

      {/* Main card */}
      {loading && (
        <div className="rounded-2xl border bg-white p-6 flex items-center justify-center text-gray-500">
          <div className="w-6 h-6 border-4 border-[#0f2a3e] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-800 p-4 text-sm">
          {error}
          <button onClick={() => selectedBuilderId && loadStop(selectedBuilderId)} className="ml-2 underline">Retry</button>
        </div>
      )}

      {!loading && !error && !selectedBuilderId && (
        <div className="rounded-2xl border bg-white p-8 text-center">
          <p className="text-3xl mb-2">🗺</p>
          <p className="text-gray-700 font-medium">Pick a builder to prep for your visit</p>
          <button onClick={() => setPickerOpen(true)} className="mt-3 px-4 py-2 rounded-lg bg-[#0f2a3e] text-white text-sm">Select builder</button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* AR CRITICAL banner */}
          {data.ar.flag === 'CRITICAL' && (
            <div className="rounded-xl border-2 border-red-500 bg-red-50 p-4">
              <div className="flex items-start gap-2">
                <div className="text-2xl">⚠</div>
                <div className="flex-1 text-sm text-red-900">
                  <p className="font-bold uppercase tracking-wide">AR issue</p>
                  <p className="mt-1">
                    {fmtMoney(data.ar.overdue60)} overdue (60+ days). Address before asking for new work.
                  </p>
                </div>
              </div>
            </div>
          )}
          {data.ar.flag === 'WARNING' && (
            <div className="rounded-xl border border-amber-400 bg-amber-50 p-3">
              <p className="text-sm text-amber-900">
                <span className="font-semibold">AR watch:</span> {fmtMoney(data.ar.overdue30)} past 30 days.
              </p>
            </div>
          )}

          {/* Builder hero */}
          <div className="rounded-2xl border bg-white p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-lg bg-[#0f2a3e] text-white flex items-center justify-center font-bold text-lg flex-shrink-0">
                {(data.builder.companyName || '?').charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <Link href={`/ops/accounts/${data.builder.id}`} className="block">
                  <h2 className="text-lg font-bold text-gray-900 truncate">{data.builder.companyName}</h2>
                </Link>
                <p className="text-xs text-gray-500 truncate">
                  {data.builder.city ? `${data.builder.city}${data.builder.state ? ', ' + data.builder.state : ''}` : data.builder.territory || '—'}
                  {' · '}Last touch: {daysAgo(data.builder.lastTouchAt) || 'none on record'}
                </p>
                {currentStop?.scheduledAt && (
                  <p className="text-xs text-gray-500 mt-0.5">Meeting {fmtTime(currentStop.scheduledAt)} — {currentStop.subject}</p>
                )}
                <div className="flex flex-wrap gap-2 mt-2 text-xs">
                  {data.builder.phone && <a href={`tel:${data.builder.phone}`} className="px-2 py-1 rounded-full bg-gray-100 text-gray-700">☎ {data.builder.phone}</a>}
                  {data.builder.email && <a href={`mailto:${data.builder.email}`} className="px-2 py-1 rounded-full bg-gray-100 text-gray-700">✉ email</a>}
                  {data.builder.paymentTerm && <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700">{data.builder.paymentTerm.replace('_', ' ')}</span>}
                </div>
              </div>
            </div>
          </div>

          {/* AI prep */}
          <div className="rounded-2xl border bg-gradient-to-br from-indigo-50 to-white p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">AI prep</p>
              <button
                onClick={() => fetchAi(true)}
                disabled={aiLoading}
                className="text-xs text-[#0f2a3e] hover:underline disabled:opacity-50"
              >
                {aiLoading ? '…' : 'Regenerate'}
              </button>
            </div>
            {aiLoading && !aiSnapshot ? (
              <div className="space-y-1.5">
                <div className="h-3 bg-gray-200 rounded animate-pulse" />
                <div className="h-3 bg-gray-200 rounded animate-pulse w-5/6" />
                <div className="h-3 bg-gray-200 rounded animate-pulse w-4/6" />
              </div>
            ) : aiSnapshot ? (
              <p className="text-sm text-gray-800 leading-relaxed">{aiSnapshot}</p>
            ) : (
              <p className="text-sm text-gray-500">No AI prep yet. Tap Regenerate.</p>
            )}
          </div>

          {/* Open items */}
          <div className="grid grid-cols-3 gap-2">
            <OpenChip label="Quotes pending" value={data.openItems.quotesPending} />
            <OpenChip label="Orders in flight" value={data.openItems.ordersInFlight} />
            <OpenChip
              label="Overdue invoices"
              value={data.openItems.overdueInvoicesCount}
              tone={data.openItems.overdueInvoicesCount > 0 ? 'ember' : 'neutral'}
            />
          </div>

          {/* Last 3 touches */}
          <div className="rounded-2xl border bg-white">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Last 3 touches</p>
            </div>
            {data.touches.length === 0 ? (
              <div className="p-4 text-sm text-gray-500">No communication on record.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.touches.map(t => (
                  <li key={t.id} className="p-3 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm flex-shrink-0">
                      {kindIcon[t.kind] || '•'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{t.subject || `${t.kind.toUpperCase()}`}</p>
                      {t.summary && <p className="text-xs text-gray-600 line-clamp-2">{t.summary}</p>}
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {t.staffName ? `${t.staffName} · ` : ''}{daysAgo(t.at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Recent orders */}
          {data.recentOrders.length > 0 && (
            <div className="rounded-2xl border bg-white">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Recent orders</p>
                <Link href={`/ops/accounts/${data.builder.id}`} className="text-xs text-[#0f2a3e] hover:underline">All →</Link>
              </div>
              <ul className="divide-y divide-gray-100">
                {data.recentOrders.map(o => (
                  <li key={o.id} className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{o.orderNumber}</p>
                      <p className="text-[11px] text-gray-500">{o.status.replace(/_/g, ' ')} · {fmtDate(o.createdAt)}</p>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{fmtMoney(o.total)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Pipeline */}
          {data.pipeline.length > 0 && (
            <div className="rounded-2xl border bg-white">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Open deals</p>
              </div>
              <ul className="divide-y divide-gray-100">
                {data.pipeline.map(d => (
                  <li key={d.id}>
                    <Link href={`/deals/${d.id}`} className="p-3 flex items-center justify-between gap-3 hover:bg-gray-50 block">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{d.dealNumber}</p>
                        <p className="text-[11px] text-gray-500">
                          {d.stage.replace(/_/g, ' ')} · {d.probability}% · close {fmtDate(d.expectedCloseDate)}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">{fmtMoney(d.dealValue)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* Sticky action bar */}
      {selectedBuilderId && (
        <div className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-gray-200 p-3 sm:static sm:border-0 sm:p-0 sm:bg-transparent">
          <div className="max-w-2xl mx-auto flex items-center gap-2">
            <button
              onClick={() => setLogVisitOpen(true)}
              className="flex-1 px-4 py-3 rounded-xl bg-[#0f2a3e] text-white text-sm font-semibold"
            >
              Log visit
            </button>
            <button
              onClick={() => router.push(`/ops/quotes/new?builderId=${selectedBuilderId}`)}
              className="flex-1 px-4 py-3 rounded-xl border border-[#0f2a3e] text-[#0f2a3e] text-sm font-semibold"
            >
              Took order? Quote now
            </button>
          </div>
        </div>
      )}

      {/* Builder picker */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-2">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="p-3 border-b border-gray-200 flex items-center gap-2">
              <input
                autoFocus
                value={builderSearch}
                onChange={e => setBuilderSearch(e.target.value)}
                placeholder="Search builders…"
                className="flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm"
              />
              <button onClick={() => setPickerOpen(false)} className="text-sm text-gray-600 px-2">Cancel</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {builderOptions.length === 0 ? (
                <p className="text-center text-gray-500 text-sm py-6">Start typing…</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {builderOptions.map(b => (
                    <li key={b.id}>
                      <button
                        onClick={() => {
                          setSelectedBuilderId(b.id)
                          setPickerOpen(false)
                          setBuilderSearch('')
                          router.replace(`/ops/portal/sales/next-stop?builderId=${b.id}`)
                        }}
                        className="w-full text-left px-3 py-3 text-sm text-gray-900 hover:bg-gray-50"
                      >
                        {b.companyName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Log visit modal */}
      {logVisitOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-2">
          <div className="bg-white rounded-2xl w-full max-w-md p-4 sm:p-5">
            <h3 className="text-lg font-bold text-gray-900 mb-3">Log visit — {data?.builder.companyName}</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">What we discussed</label>
                <textarea
                  value={logNotes}
                  onChange={e => setLogNotes(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm resize-none"
                  placeholder="Covered Rev 4 pricing, VE proposal, overdue invoice…"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Next action item</label>
                <input
                  value={logAction}
                  onChange={e => setLogAction(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
                  placeholder="Send revised quote by Friday"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Follow up on</label>
                <input
                  type="date"
                  value={logFollowUp}
                  onChange={e => setLogFollowUp(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setLogVisitOpen(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={submitVisit}
                disabled={logSubmitting || !logNotes.trim()}
                className="flex-1 px-4 py-2 rounded-lg bg-[#0f2a3e] text-white text-sm font-semibold disabled:opacity-50"
              >
                {logSubmitting ? 'Saving…' : 'Save visit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-20 sm:bottom-4 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────

function OpenChip({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'ember' }) {
  const ember = tone === 'ember' && value > 0
  return (
    <div
      className={`rounded-xl border p-3 ${
        ember ? 'bg-red-50 border-red-300' : 'bg-white border-gray-200'
      }`}
    >
      <p className={`text-xs ${ember ? 'text-red-800' : 'text-gray-500'}`}>{label}</p>
      <p className={`text-2xl font-bold ${ember ? 'text-red-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}
