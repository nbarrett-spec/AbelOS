'use client'

/**
 * /admin/pitch-generator/new — pitch generation form.
 *
 * Client component (form behavior is interactive end-to-end). On submit,
 * POSTs PitchRunInput to /api/admin/pitch-runs (Agent B owns the API route)
 * and redirects to the resulting detail page.
 *
 * Auth + feature flag are checked client-side here because the page is a
 * client component. The /admin/pitch-generator parent route also gates this
 * server-side via the layout's session cookie middleware (canAccessAPI).
 *
 * Validation:
 *   - Prospect required + must have a PitchContext row (server-side and
 *     client-side check; if missing, link to /admin/prospects/{id}).
 *   - At least 3 elements selected.
 *   - Layout = MICROSITE only at MVP (DECK / ONE_PAGER are visually disabled).
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Search, AlertTriangle, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import {
  PITCH_ELEMENTS,
  PITCH_ELEMENT_LABELS,
  type PitchElement,
  type PitchStyle,
  type PitchLayout,
  type PitchRunInput,
} from '@/lib/agents/types'

// ── Style + layout option metadata (UI only; values match Prisma enums) ────

interface StyleOption {
  value: PitchStyle
  label: string
  blurb: string
}

const STYLE_OPTIONS: StyleOption[] = [
  {
    value: 'HERITAGE',
    label: 'Heritage',
    blurb: 'Walnut + cream. Quiet authority. Default for established builders.',
  },
  {
    value: 'EXECUTIVE',
    label: 'Executive',
    blurb: 'Crisp, neutral, slate-forward. Best for procurement audiences.',
  },
  {
    value: 'BUILDER_FIELD',
    label: 'Builder Field',
    blurb: 'Warmer, on-site palette. Best for ops + superintendents.',
  },
]

interface LayoutOption {
  value: PitchLayout
  label: string
  blurb: string
  enabled: boolean
}

const LAYOUT_OPTIONS: LayoutOption[] = [
  {
    value: 'MICROSITE',
    label: 'Microsite',
    blurb: 'Hosted preview link, fully responsive. Recommended.',
    enabled: true,
  },
  {
    value: 'DECK',
    label: 'Deck (.pptx)',
    blurb: 'Coming Phase 2. Microsite only at launch.',
    enabled: false,
  },
  {
    value: 'ONE_PAGER',
    label: 'One-pager (PDF)',
    blurb: 'Coming Phase 2. Microsite only at launch.',
    enabled: false,
  },
]

const DEFAULT_ELEMENTS: PitchElement[] = ['cover', 'exec_summary', 'pricing']

// ── Prospect autocomplete row ──────────────────────────────────────────────

interface ProspectRow {
  id: string
  companyName: string
  enrichmentConfidence?: 'CONFIRMED' | 'LIKELY' | 'UNVERIFIED' | null
  hasPitchContext?: boolean
}

function confidenceBadge(c: ProspectRow['enrichmentConfidence']) {
  if (!c) return null
  const cls =
    c === 'CONFIRMED'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : c === 'LIKELY'
        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
        : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
  return (
    <span
      className={`inline-flex px-1.5 py-0.5 text-[10px] font-medium rounded border ${cls}`}
    >
      {c}
    </span>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Page
// ───────────────────────────────────────────────────────────────────────────

export default function NewPitchPage() {
  const router = useRouter()
  const flagEnabled =
    process.env.NEXT_PUBLIC_FEATURE_PITCH_GENERATOR_ENABLED === 'true'

  // Form state
  const [prospect, setProspect] = useState<ProspectRow | null>(null)
  const [style, setStyle] = useState<PitchStyle>('HERITAGE')
  const [layout, setLayout] = useState<PitchLayout>('MICROSITE')
  const [elements, setElements] = useState<PitchElement[]>(DEFAULT_ELEMENTS)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Autocomplete state
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<ProspectRow[]>([])
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced prospect search
  useEffect(() => {
    if (!flagEnabled) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!search || search.length < 2) {
      setResults([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/prospects?q=${encodeURIComponent(search)}&limit=10`
        )
        if (!res.ok) {
          setResults([])
          return
        }
        const data = await res.json()
        setResults(
          (data.prospects || data.data || []).map((p: ProspectRow) => ({
            id: p.id,
            companyName: p.companyName,
            enrichmentConfidence: p.enrichmentConfidence ?? null,
            hasPitchContext: p.hasPitchContext ?? undefined,
          }))
        )
      } catch {
        setResults([])
      }
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search, flagEnabled])

  const toggleElement = useCallback((el: PitchElement) => {
    setElements((prev) =>
      prev.includes(el) ? prev.filter((x) => x !== el) : [...prev, el]
    )
  }, [])

  // Validation
  const validation = useMemo(() => {
    const issues: string[] = []
    if (!prospect) issues.push('Pick a prospect.')
    if (prospect && prospect.hasPitchContext === false) {
      issues.push(
        `${prospect.companyName} has no PitchContext yet — fill it in on the prospect page first.`
      )
    }
    if (elements.length < 3) issues.push('Pick at least 3 elements.')
    if (layout !== 'MICROSITE')
      issues.push('Only MICROSITE is supported at MVP.')
    return issues
  }, [prospect, elements, layout])

  const isValid = validation.length === 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid || !prospect) return
    setError(null)
    setSubmitting(true)

    const body: PitchRunInput = {
      prospectId: prospect.id,
      style,
      layout,
      elements,
    }

    try {
      const res = await fetch('/api/admin/pitch-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(
          data.error?.message || data.error || data.message || `Request failed (${res.status})`
        )
      }
      const data = await res.json()
      const newId = data.id || data.pitchRunId || data.data?.id
      if (!newId) throw new Error('No pitch run ID returned')
      router.push(`/admin/pitch-generator/${newId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start pitch run')
      setSubmitting(false)
    }
  }

  // ── Disabled-state render (feature flag off) ─────────────────────────────
  if (!flagEnabled) {
    return (
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-3xl font-bold text-fg">New pitch</h1>
          <p className="text-fg-muted mt-2">
            Generate a builder pitch microsite.
          </p>
        </div>
        <div className="glass-card p-6 border border-glass-border rounded-lg space-y-3">
          <p className="text-fg">The pitch generator is disabled.</p>
          <p className="text-sm text-fg-muted">
            Set{' '}
            <code className="text-c1">
              NEXT_PUBLIC_FEATURE_PITCH_GENERATOR_ENABLED=true
            </code>{' '}
            to enable. See <code className="text-c1">.env.example</code>.
          </p>
          <Link
            href="/admin/pitch-generator"
            className="inline-flex items-center gap-1 text-sm text-c1 hover:underline"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to pitch list
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <Link
          href="/admin/pitch-generator"
          className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg transition w-fit"
        >
          <ChevronLeft className="w-4 h-4" />
          Pitches
        </Link>
        <h1 className="text-3xl font-bold text-fg">New pitch</h1>
        <p className="text-fg-muted">
          Pick a prospect, choose a style and layout, and select which elements
          to include. Generation usually takes 30–90 seconds.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Prospect picker */}
        <section className="glass-card border border-glass-border rounded-lg p-5 space-y-3">
          <header>
            <h2 className="text-lg font-semibold text-fg">Prospect</h2>
            <p className="text-sm text-fg-muted">
              Type to search by company name.
            </p>
          </header>

          {prospect ? (
            <div className="flex items-center justify-between gap-3 p-3 rounded-md bg-canvas/60 border border-glass-border">
              <div className="flex items-center gap-3">
                <div>
                  <div className="font-medium text-fg">
                    {prospect.companyName}
                  </div>
                  <div className="flex gap-2 mt-1 items-center">
                    {confidenceBadge(prospect.enrichmentConfidence)}
                    {prospect.hasPitchContext === false && (
                      <Link
                        href={`/admin/prospects/${prospect.id}`}
                        className="text-xs text-amber-300 hover:underline inline-flex items-center gap-1"
                      >
                        <AlertTriangle className="w-3 h-3" />
                        No PitchContext — fill in
                      </Link>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setProspect(null)
                  setSearch('')
                }}
                className="text-sm text-fg-muted hover:text-fg transition"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setOpen(true)
                }}
                onFocus={() => setOpen(true)}
                placeholder="Search prospects..."
                className="w-full pl-10 pr-3 py-2.5 rounded-md bg-canvas/60 border border-glass-border text-fg placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-c1/40"
                autoComplete="off"
              />
              {open && results.length > 0 && (
                <div className="absolute z-10 mt-1 w-full glass-card border border-glass-border rounded-md max-h-72 overflow-y-auto shadow-lg">
                  {results.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setProspect(r)
                        setOpen(false)
                        setSearch('')
                        setResults([])
                      }}
                      className="w-full text-left px-3 py-2.5 hover:bg-white/10 transition flex items-center justify-between gap-3 border-b border-glass-border/40 last:border-0"
                    >
                      <span className="text-fg">{r.companyName}</span>
                      {confidenceBadge(r.enrichmentConfidence)}
                    </button>
                  ))}
                </div>
              )}
              {open && search.length >= 2 && results.length === 0 && (
                <div className="absolute z-10 mt-1 w-full glass-card border border-glass-border rounded-md p-3 text-sm text-fg-muted">
                  No prospects match "{search}".
                </div>
              )}
            </div>
          )}
        </section>

        {/* Style */}
        <section className="glass-card border border-glass-border rounded-lg p-5 space-y-4">
          <header>
            <h2 className="text-lg font-semibold text-fg">Style</h2>
            <p className="text-sm text-fg-muted">
              Visual direction for the microsite.
            </p>
          </header>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {STYLE_OPTIONS.map((opt) => {
              const active = style === opt.value
              return (
                <motion.button
                  key={opt.value}
                  type="button"
                  onClick={() => setStyle(opt.value)}
                  whileHover={{ y: -2 }}
                  className={`text-left p-4 rounded-lg border transition ${
                    active
                      ? 'border-c1 bg-c1/10'
                      : 'border-glass-border bg-canvas/40 hover:border-glass-border'
                  }`}
                >
                  <div className="aspect-[4/3] rounded-md bg-canvas/60 border border-glass-border mb-3 flex items-center justify-center text-xs text-fg-muted">
                    {opt.label}
                  </div>
                  <div className="font-semibold text-fg">{opt.label}</div>
                  <div className="text-xs text-fg-muted mt-1">{opt.blurb}</div>
                </motion.button>
              )
            })}
          </div>
        </section>

        {/* Layout */}
        <section className="glass-card border border-glass-border rounded-lg p-5 space-y-4">
          <header>
            <h2 className="text-lg font-semibold text-fg">Layout</h2>
            <p className="text-sm text-fg-muted">
              Microsite is the only supported layout at MVP.
            </p>
          </header>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {LAYOUT_OPTIONS.map((opt) => {
              const active = layout === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={!opt.enabled}
                  onClick={() => opt.enabled && setLayout(opt.value)}
                  className={`text-left p-4 rounded-lg border transition ${
                    !opt.enabled
                      ? 'border-glass-border bg-canvas/20 opacity-50 cursor-not-allowed'
                      : active
                        ? 'border-c1 bg-c1/10'
                        : 'border-glass-border bg-canvas/40 hover:border-glass-border'
                  }`}
                >
                  <div className="font-semibold text-fg">{opt.label}</div>
                  <div className="text-xs text-fg-muted mt-1">{opt.blurb}</div>
                  {!opt.enabled && (
                    <div className="text-[10px] uppercase tracking-wide text-amber-300 mt-2">
                      Phase 2
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </section>

        {/* Elements */}
        <section className="glass-card border border-glass-border rounded-lg p-5 space-y-4">
          <header className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-fg">Elements</h2>
              <p className="text-sm text-fg-muted">
                Pick at least 3. Cover, executive summary, and pricing are
                checked by default.
              </p>
            </div>
            <span className="text-xs text-fg-muted">
              {elements.length} selected
            </span>
          </header>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PITCH_ELEMENTS.map((el) => {
              const checked = elements.includes(el)
              return (
                <label
                  key={el}
                  className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition ${
                    checked
                      ? 'border-c1/50 bg-c1/5'
                      : 'border-glass-border bg-canvas/40 hover:border-glass-border'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleElement(el)}
                    className="mt-0.5 accent-c1"
                  />
                  <span className="text-sm text-fg">
                    {PITCH_ELEMENT_LABELS[el]}
                  </span>
                </label>
              )
            })}
          </div>
        </section>

        {/* Validation + submit */}
        {validation.length > 0 && (
          <div className="glass-card p-4 border border-amber-500/30 bg-amber-500/5 rounded-lg space-y-1">
            <div className="flex items-center gap-2 text-amber-300 text-sm font-semibold">
              <AlertTriangle className="w-4 h-4" />
              Fix before submitting
            </div>
            <ul className="text-sm text-fg-muted list-disc list-inside space-y-0.5">
              {validation.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div className="glass-card p-4 border border-rose-500/30 bg-rose-500/10 rounded-lg text-sm text-rose-200">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <Link
            href="/admin/pitch-generator"
            className="text-sm text-fg-muted hover:text-fg transition"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={!isValid || submitting}
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition ${
              !isValid || submitting
                ? 'bg-white/10 text-fg-muted cursor-not-allowed'
                : 'bg-c1 text-canvas hover:bg-c1/90 shadow-sm'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            {submitting ? 'Starting...' : 'Generate pitch'}
          </button>
        </div>
      </form>
    </div>
  )
}
