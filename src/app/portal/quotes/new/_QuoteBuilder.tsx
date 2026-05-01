'use client'

/**
 * Builder Portal — Quote Builder (multi-step).
 *
 * §4.5 BUILDER-PORTAL-SPEC. Four steps:
 *   1. Project — pick community + project name (free-text "address" works
 *      too; the API will create or attach a Project by name)
 *   2. Items — search catalog inline, add lines (qty input)
 *   3. Review — edit qty/remove inline, special instructions, requested date
 *   4. Submit — confirmation, success-redirect to /portal/quotes
 *
 * Items hydrate from the existing cart cookie so "Add to quote" from a
 * product detail flows in here naturally.
 */

import { useReducer, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  FilePlus,
  MapPin,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { PortalCard } from '@/components/portal/PortalCard'
import { usePortal } from '@/components/portal/PortalContext'
import type { CatalogProduct, CatalogResponse } from '@/types/portal'

export interface CartItem {
  productId: string
  quantity: number
  unitPrice: number
  description: string
  sku: string
}

type Step = 1 | 2 | 3 | 4

interface QuoteBuilderState {
  step: Step
  communityId: string | null
  projectName: string
  projectAddress: string
  items: CartItem[]
  notes: string
  requestedDate: string
}

type Action =
  | { type: 'SET_STEP'; step: Step }
  | { type: 'SET_COMMUNITY'; communityId: string | null }
  | { type: 'SET_PROJECT_NAME'; value: string }
  | { type: 'SET_PROJECT_ADDRESS'; value: string }
  | { type: 'ADD_ITEM'; item: CartItem }
  | { type: 'UPDATE_QTY'; productId: string; quantity: number }
  | { type: 'REMOVE_ITEM'; productId: string }
  | { type: 'SET_NOTES'; value: string }
  | { type: 'SET_REQUESTED_DATE'; value: string }
  | { type: 'HYDRATE_CART'; items: CartItem[] }

function reducer(s: QuoteBuilderState, a: Action): QuoteBuilderState {
  switch (a.type) {
    case 'SET_STEP':
      return { ...s, step: a.step }
    case 'SET_COMMUNITY':
      return { ...s, communityId: a.communityId }
    case 'SET_PROJECT_NAME':
      return { ...s, projectName: a.value }
    case 'SET_PROJECT_ADDRESS':
      return { ...s, projectAddress: a.value }
    case 'ADD_ITEM': {
      const existing = s.items.find((i) => i.productId === a.item.productId)
      if (existing) {
        return {
          ...s,
          items: s.items.map((i) =>
            i.productId === a.item.productId
              ? { ...i, quantity: i.quantity + a.item.quantity }
              : i,
          ),
        }
      }
      return { ...s, items: [...s.items, a.item] }
    }
    case 'UPDATE_QTY':
      return {
        ...s,
        items: s.items.map((i) =>
          i.productId === a.productId
            ? { ...i, quantity: Math.max(1, a.quantity) }
            : i,
        ),
      }
    case 'REMOVE_ITEM':
      return { ...s, items: s.items.filter((i) => i.productId !== a.productId) }
    case 'SET_NOTES':
      return { ...s, notes: a.value }
    case 'SET_REQUESTED_DATE':
      return { ...s, requestedDate: a.value }
    case 'HYDRATE_CART':
      return { ...s, items: a.items }
    default:
      return s
  }
}

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: 'Project' },
  { n: 2, label: 'Items' },
  { n: 3, label: 'Review' },
  { n: 4, label: 'Submit' },
]

function fmtUsd(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

interface QuoteBuilderProps {
  initialCart: CartItem[]
}

export function QuoteBuilder({ initialCart }: QuoteBuilderProps) {
  const router = useRouter()
  const { activeCommunity, communities, builder } = usePortal()

  const [state, dispatch] = useReducer(reducer, {
    step: initialCart.length > 0 ? 2 : 1,
    communityId: activeCommunity ?? null,
    projectName: '',
    projectAddress: '',
    items: initialCart,
    notes: '',
    requestedDate: '',
  })

  const subtotal = useMemo(
    () => state.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
    [state.items],
  )

  const canAdvance = useMemo(() => {
    if (state.step === 1) return !!state.projectName.trim()
    if (state.step === 2) return state.items.length > 0
    if (state.step === 3) return state.items.length > 0
    return false
  }, [state])

  return (
    <div className="space-y-6">
      <Link
        href="/portal/quotes"
        className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
        style={{
          color: 'var(--c1)',
          fontFamily: 'var(--font-portal-body)',
        }}
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to quotes
      </Link>

      {/* Header */}
      <div>
        <div className="portal-eyebrow mb-2">4-Step Quote Builder</div>
        <h1 className="portal-page-title">New Quote</h1>
        <p
          className="text-[15px] mt-2"
          style={{
            color: 'var(--portal-text-muted)',
            fontFamily: 'var(--font-portal-body)',
          }}
        >
          Build your quote in 4 steps. {builder.companyName} will receive a
          confirmation email when it&apos;s submitted.
        </p>
      </div>

      {/* Stepper */}
      <Stepper current={state.step} />

      {/* Step content */}
      {state.step === 1 && (
        <Step1
          state={state}
          dispatch={dispatch}
          communities={communities}
        />
      )}
      {state.step === 2 && <Step2 state={state} dispatch={dispatch} />}
      {state.step === 3 && <Step3 state={state} dispatch={dispatch} subtotal={subtotal} />}
      {state.step === 4 && (
        <Step4 state={state} subtotal={subtotal} onSubmitted={() => router.push('/portal/quotes')} />
      )}

      {/* Nav buttons */}
      {state.step !== 4 && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: 'SET_STEP',
                step: Math.max(1, state.step - 1) as Step,
              })
            }
            disabled={state.step === 1}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: 'var(--portal-bg-card, #FFFFFF)',
              color: 'var(--portal-text-strong, #3E2A1E)',
              border: '1px solid var(--portal-border, #E8DFD0)',
            }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
          <div
            className="text-xs"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            Step {state.step} of {STEPS.length}
          </div>
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: 'SET_STEP',
                step: Math.min(4, state.step + 1) as Step,
              })
            }
            disabled={!canAdvance}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-sm font-medium transition-shadow disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background:
                'var(--grad)',
              color: 'white',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            {state.step === 3 ? 'Review & submit' : 'Continue'}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

function Stepper({ current }: { current: Step }) {
  return (
    <ol className="flex items-center gap-2 md:gap-3" aria-label="Quote builder steps">
      {STEPS.map((s, i) => {
        const state: 'complete' | 'current' | 'upcoming' =
          s.n < current ? 'complete' : s.n === current ? 'current' : 'upcoming'
        return (
          <li key={s.n} className="flex items-center gap-2 md:gap-3">
            <div
              className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-[12px] font-semibold transition-colors"
              style={
                state === 'complete'
                  ? {
                      background: 'var(--grad)',
                      color: 'white',
                    }
                  : state === 'current'
                    ? {
                        background:
                          'var(--grad)',
                        color: 'white',
                        boxShadow: '0 0 0 4px rgba(201,130,43,0.18)',
                      }
                    : {
                        background: 'var(--portal-bg-elevated, #FAF5E8)',
                        color: 'var(--portal-text-muted, #6B6056)',
                        border: '1px solid var(--portal-border, #E8DFD0)',
                      }
              }
            >
              {state === 'complete' ? <Check className="w-4 h-4" /> : s.n}
            </div>
            <span
              className="text-xs hidden md:inline font-medium"
              style={{
                color:
                  state === 'upcoming'
                    ? 'var(--portal-text-muted, #6B6056)'
                    : 'var(--portal-text-strong, #3E2A1E)',
              }}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <div
                className="hidden md:block w-8 h-[2px] rounded-full"
                style={{
                  background:
                    state === 'complete'
                      ? 'var(--grad)'
                      : 'var(--portal-border, #E8DFD0)',
                }}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Step 1 — Project
// ──────────────────────────────────────────────────────────────────────

function Step1({
  state,
  dispatch,
  communities,
}: {
  state: QuoteBuilderState
  dispatch: React.Dispatch<Action>
  communities: ReturnType<typeof usePortal>['communities']
}) {
  return (
    <PortalCard title="Project Details">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label
            className="block text-[10px] uppercase tracking-wider font-semibold mb-1.5"
            style={{ color: 'var(--portal-text-subtle)', fontFamily: 'var(--font-portal-mono)', letterSpacing: '0.1em' }}
          >
            Community
          </label>
          {communities.length > 0 ? (
            <select
              value={state.communityId ?? ''}
              onChange={(e) =>
                dispatch({
                  type: 'SET_COMMUNITY',
                  communityId: e.target.value || null,
                })
              }
              className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
              style={{
                background: 'var(--portal-bg-card, #FFFFFF)',
                border: '1px solid var(--portal-border, #E8DFD0)',
                color: 'var(--portal-text-strong, #3E2A1E)',
              }}
            >
              <option value="">No specific community</option>
              {communities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.city ? ` — ${c.city}` : ''}
                  {c.state ? `, ${c.state}` : ''}
                </option>
              ))}
            </select>
          ) : (
            <p
              className="text-xs"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              No communities on file. Use the project name field below to
              identify the job.
            </p>
          )}
        </div>

        <div>
          <label
            className="block text-[10px] uppercase tracking-wider font-semibold mb-1.5"
            style={{ color: 'var(--portal-text-subtle)', fontFamily: 'var(--font-portal-mono)', letterSpacing: '0.1em' }}
          >
            Project / Lot Name <span style={{ color: '#7E2417' }}>*</span>
          </label>
          <input
            type="text"
            value={state.projectName}
            onChange={(e) =>
              dispatch({ type: 'SET_PROJECT_NAME', value: e.target.value })
            }
            placeholder="e.g. Lot 24, Maple Run"
            className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
            style={{
              background: 'var(--portal-bg-card, #FFFFFF)',
              border: '1px solid var(--portal-border, #E8DFD0)',
              color: 'var(--portal-text-strong, #3E2A1E)',
            }}
          />
        </div>

        <div>
          <label
            className="block text-[10px] uppercase tracking-wider font-semibold mb-1.5"
            style={{ color: 'var(--portal-text-subtle)', fontFamily: 'var(--font-portal-mono)', letterSpacing: '0.1em' }}
          >
            Job Address (optional)
          </label>
          <input
            type="text"
            value={state.projectAddress}
            onChange={(e) =>
              dispatch({ type: 'SET_PROJECT_ADDRESS', value: e.target.value })
            }
            placeholder="123 Main St, Frisco, TX"
            className="h-10 w-full px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
            style={{
              background: 'var(--portal-bg-card, #FFFFFF)',
              border: '1px solid var(--portal-border, #E8DFD0)',
              color: 'var(--portal-text-strong, #3E2A1E)',
            }}
          />
        </div>
      </div>
      <p
        className="mt-3 text-xs flex items-center gap-1.5"
        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
      >
        <MapPin className="w-3 h-3" />
        We&apos;ll create a project record with this name if it doesn&apos;t exist yet.
      </p>
    </PortalCard>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Step 2 — Items (catalog search + add)
// ──────────────────────────────────────────────────────────────────────

function Step2({
  state,
  dispatch,
}: {
  state: QuoteBuilderState
  dispatch: React.Dispatch<Action>
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CatalogProduct[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(
          `/api/catalog?search=${encodeURIComponent(query)}&limit=20`,
          { credentials: 'include', signal: ctrl.signal },
        )
        if (res.ok) {
          const data = (await res.json()) as CatalogResponse
          setResults(data.products ?? [])
        }
      } catch {
        // aborted
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [query])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Catalog search */}
      <div className="lg:col-span-2 space-y-3">
        <PortalCard
          title="Add Products"
          subtitle="Search the catalog and add items to your quote"
        >
          <div className="relative mb-3">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products by name or SKU…"
              className="h-10 w-full pl-10 pr-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
              style={{
                background: 'var(--portal-bg-card, #FFFFFF)',
                border: '1px solid var(--portal-border, #E8DFD0)',
                color: 'var(--portal-text-strong, #3E2A1E)',
              }}
              autoFocus
            />
          </div>
          {loading && (
            <p
              className="text-xs"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              Searching…
            </p>
          )}
          {!loading && query && results.length === 0 && (
            <p
              className="text-sm py-6 text-center"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              No products match &ldquo;{query}&rdquo;.
            </p>
          )}
          {!query && (
            <p
              className="text-sm py-6 text-center"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              Start typing to search the catalog.
            </p>
          )}
          {results.length > 0 && (
            <ul className="space-y-2 max-h-[420px] overflow-y-auto">
              {results.map((p) => {
                const price = p.builderPrice ?? p.basePrice
                return (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 p-3 rounded-md"
                    style={{
                      border: '1px solid var(--portal-border-light, #F0E8DA)',
                      background: 'var(--portal-bg-card, #FFFFFF)',
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className="text-sm font-medium leading-tight truncate"
                        style={{
                          color: 'var(--portal-text-strong, #3E2A1E)',
                        }}
                      >
                        {p.displayName || p.name}
                      </div>
                      <div
                        className="text-[11px] font-mono"
                        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                      >
                        {p.sku} · {p.category}
                      </div>
                    </div>
                    <div
                      className="text-sm font-mono tabular-nums"
                      style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
                    >
                      ${fmtUsd(price)}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: 'ADD_ITEM',
                          item: {
                            productId: p.id,
                            quantity: 1,
                            unitPrice: price,
                            description: p.displayName || p.name,
                            sku: p.sku,
                          },
                        })
                      }
                      className="inline-flex items-center gap-1 px-3 h-8 rounded-md text-xs font-medium transition-shadow"
                      style={{
                        background:
                          'var(--grad)',
                        color: 'white',
                      }}
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </PortalCard>
      </div>

      {/* Running list */}
      <RunningList state={state} dispatch={dispatch} />
    </div>
  )
}

function RunningList({
  state,
  dispatch,
}: {
  state: QuoteBuilderState
  dispatch: React.Dispatch<Action>
}) {
  const subtotal = state.items.reduce(
    (sum, i) => sum + i.unitPrice * i.quantity,
    0,
  )
  return (
    <PortalCard
      title="Quote Items"
      subtitle={
        state.items.length > 0
          ? `${state.items.length} item${state.items.length === 1 ? '' : 's'} · $${fmtUsd(subtotal)}`
          : 'No items yet'
      }
      noBodyPadding
    >
      {state.items.length === 0 ? (
        <div
          className="px-4 py-8 text-center text-xs"
          style={{ color: 'var(--portal-text-muted, #6B6056)' }}
        >
          Items will appear here as you add them.
        </div>
      ) : (
        <ul className="divide-y" style={{ borderColor: 'var(--portal-border-light, #F0E8DA)' }}>
          {state.items.map((item) => (
            <li key={item.productId} className="px-4 py-3 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div
                  className="text-xs font-medium leading-tight line-clamp-2"
                  style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
                >
                  {item.description}
                </div>
                <div
                  className="text-[10px] font-mono tabular-nums"
                  style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                >
                  {item.quantity} × ${fmtUsd(item.unitPrice)}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  dispatch({ type: 'REMOVE_ITEM', productId: item.productId })
                }
                className="p-1 rounded hover:bg-[var(--portal-bg-elevated)]"
                aria-label={`Remove ${item.description}`}
              >
                <Trash2
                  className="w-3.5 h-3.5"
                  style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </PortalCard>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Step 3 — Review (edit qty, notes, requested date)
// ──────────────────────────────────────────────────────────────────────

function Step3({
  state,
  dispatch,
  subtotal,
}: {
  state: QuoteBuilderState
  dispatch: React.Dispatch<Action>
  subtotal: number
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Items */}
      <PortalCard
        title="Review Items"
        subtitle={`${state.items.length} ${state.items.length === 1 ? 'line' : 'lines'} · adjust quantity or remove`}
        className="lg:col-span-2"
        noBodyPadding
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-left text-[10px] uppercase tracking-wider"
                style={{ color: 'var(--portal-text-subtle)', fontFamily: 'var(--font-portal-mono)', letterSpacing: '0.1em' }}
              >
                <th className="px-4 py-3 font-semibold">Item</th>
                <th className="px-2 py-3 font-semibold text-right">Qty</th>
                <th className="px-2 py-3 font-semibold text-right">Unit</th>
                <th className="px-2 py-3 font-semibold text-right">Total</th>
                <th className="px-4 py-3" aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {state.items.map((item) => (
                <tr
                  key={item.productId}
                  className="border-t"
                  style={{
                    borderColor: 'var(--portal-border-light, #F0E8DA)',
                  }}
                >
                  <td className="px-4 py-3 align-top">
                    <div
                      className="text-xs font-medium leading-tight line-clamp-2"
                      style={{
                        color: 'var(--portal-text-strong, #3E2A1E)',
                      }}
                    >
                      {item.description}
                    </div>
                    <div
                      className="text-[10px] font-mono"
                      style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                    >
                      {item.sku}
                    </div>
                  </td>
                  <td className="px-2 py-3 align-top">
                    <input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) =>
                        dispatch({
                          type: 'UPDATE_QTY',
                          productId: item.productId,
                          quantity: parseInt(e.target.value, 10) || 1,
                        })
                      }
                      className="h-8 w-16 text-center text-xs tabular-nums font-mono rounded focus:outline-none focus:ring-1 focus:ring-[var(--c1)]"
                      style={{
                        background: 'var(--portal-bg-card, #FFFFFF)',
                        color: 'var(--portal-text-strong, #3E2A1E)',
                        border: '1px solid var(--portal-border, #E8DFD0)',
                      }}
                      aria-label="Quantity"
                    />
                  </td>
                  <td
                    className="px-2 py-3 text-right tabular-nums align-top font-mono text-xs"
                    style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                  >
                    ${fmtUsd(item.unitPrice)}
                  </td>
                  <td
                    className="px-2 py-3 text-right tabular-nums align-top font-mono"
                    style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
                  >
                    ${fmtUsd(item.unitPrice * item.quantity)}
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: 'REMOVE_ITEM',
                          productId: item.productId,
                        })
                      }
                      className="p-1 rounded hover:bg-[var(--portal-bg-elevated)]"
                      aria-label={`Remove ${item.description}`}
                    >
                      <Trash2
                        className="w-3.5 h-3.5"
                        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                      />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PortalCard>

      <div className="space-y-4">
        <PortalCard title="Subtotal">
          <div className="flex items-baseline justify-between">
            <span
              className="text-xs"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              Items total
            </span>
            <span
              className="text-2xl font-semibold tabular-nums"
              style={{
                fontFamily: 'var(--font-portal-display)',
                color: 'var(--portal-text-strong, #3E2A1E)',
                letterSpacing: '-0.02em',
              }}
            >
              ${fmtUsd(subtotal)}
            </span>
          </div>
          <p
            className="mt-2 text-[11px]"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            Final total may include payment-term adjustment based on your
            account.
          </p>
        </PortalCard>

        <PortalCard title="Notes & Date">
          <div className="space-y-3">
            <div>
              <label
                className="block text-[10px] uppercase tracking-wider font-semibold mb-1.5"
                style={{ color: 'var(--portal-text-subtle)', fontFamily: 'var(--font-portal-mono)', letterSpacing: '0.1em' }}
              >
                <Calendar className="w-3 h-3 inline mr-1" />
                Requested Delivery Date
              </label>
              <input
                type="date"
                value={state.requestedDate}
                onChange={(e) =>
                  dispatch({
                    type: 'SET_REQUESTED_DATE',
                    value: e.target.value,
                  })
                }
                className="h-9 w-full px-2 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                style={{
                  background: 'var(--portal-bg-card, #FFFFFF)',
                  border: '1px solid var(--portal-border, #E8DFD0)',
                  color: 'var(--portal-text-strong, #3E2A1E)',
                }}
              />
            </div>
            <div>
              <label
                className="block text-[10px] uppercase tracking-wider font-semibold mb-1.5"
                style={{ color: 'var(--portal-text-subtle)', fontFamily: 'var(--font-portal-mono)', letterSpacing: '0.1em' }}
              >
                Special Instructions
              </label>
              <textarea
                value={state.notes}
                onChange={(e) =>
                  dispatch({ type: 'SET_NOTES', value: e.target.value })
                }
                rows={4}
                placeholder="Anything we should know? Job-site access, color preferences, hardware notes…"
                className="w-full px-3 py-2 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30 resize-y"
                style={{
                  background: 'var(--portal-bg-card, #FFFFFF)',
                  border: '1px solid var(--portal-border, #E8DFD0)',
                  color: 'var(--portal-text-strong, #3E2A1E)',
                }}
              />
            </div>
          </div>
        </PortalCard>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Step 4 — Submit
// ──────────────────────────────────────────────────────────────────────

function Step4({
  state,
  subtotal,
  onSubmitted,
}: {
  state: QuoteBuilderState
  subtotal: number
  onSubmitted: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<{ quoteNumber: string } | null>(null)

  async function handleSubmit() {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const itemsForApi = state.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        description: i.description,
        sku: i.sku,
      }))
      const projectName = state.projectAddress
        ? `${state.projectName} — ${state.projectAddress}`
        : state.projectName
      const res = await fetch('/api/quotes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: itemsForApi,
          projectName,
          deliveryNotes: [
            state.requestedDate
              ? `Requested delivery: ${state.requestedDate}`
              : null,
            state.notes ? state.notes : null,
          ]
            .filter(Boolean)
            .join('\n\n'),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Failed to submit quote')
      }
      const data = await res.json()
      const quoteNumber = data?.quote?.quoteNumber || ''
      setSubmitted({ quoteNumber })
      // Clear cart so the next quote starts fresh.
      try {
        // best-effort: there's no DELETE-all endpoint — items will be cleared
        // server-side once the quote is created in some flows; for our cart
        // we simply ignore. The user is redirected away anyway.
      } catch {}
      // Auto-redirect after a beat.
      setTimeout(onSubmitted, 1500)
    } catch (e: any) {
      setError(e?.message || 'Submit failed')
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <PortalCard>
        <div className="text-center py-8 max-w-md mx-auto">
          <div
            className="w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-4"
            style={{
              background: 'rgba(56,128,77,0.16)',
              color: 'var(--portal-success, #1A4B21)',
            }}
          >
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h3
            className="text-xl font-medium"
            style={{
              fontFamily: 'var(--font-portal-display)',
              color: 'var(--portal-text-strong, #3E2A1E)',
            }}
          >
            Quote {submitted.quoteNumber || 'submitted'}!
          </h3>
          <p
            className="text-sm mt-1"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            We&apos;ll review and email you when it&apos;s ready. Redirecting to your quotes…
          </p>
        </div>
      </PortalCard>
    )
  }

  return (
    <div className="space-y-4">
      <PortalCard title="Confirm & Submit">
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <dt
              className="text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: 'var(--portal-text-subtle)', fontFamily: 'var(--font-portal-mono)', letterSpacing: '0.1em' }}
            >
              Project
            </dt>
            <dd
              className="mt-0.5"
              style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
            >
              {state.projectName}
            </dd>
            {state.projectAddress && (
              <dd
                className="text-xs"
                style={{ color: 'var(--portal-text-muted, #6B6056)' }}
              >
                {state.projectAddress}
              </dd>
            )}
          </div>
          <div>
            <dt
              className="text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: 'var(--portal-text-subtle)', fontFamily: 'var(--font-portal-mono)', letterSpacing: '0.1em' }}
            >
              Items
            </dt>
            <dd
              className="mt-0.5"
              style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
            >
              {state.items.length} line{state.items.length === 1 ? '' : 's'} · $
              {fmtUsd(subtotal)}
            </dd>
          </div>
          {state.requestedDate && (
            <div>
              <dt
                className="text-[10px] uppercase tracking-wider font-semibold"
                style={{ color: 'var(--portal-text-subtle)', fontFamily: 'var(--font-portal-mono)', letterSpacing: '0.1em' }}
              >
                Requested Date
              </dt>
              <dd
                className="mt-0.5"
                style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
              >
                {new Date(state.requestedDate).toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </dd>
            </div>
          )}
          {state.notes && (
            <div className="md:col-span-2">
              <dt
                className="text-[10px] uppercase tracking-wider font-semibold"
                style={{ color: 'var(--portal-text-subtle)', fontFamily: 'var(--font-portal-mono)', letterSpacing: '0.1em' }}
              >
                Notes
              </dt>
              <dd
                className="mt-0.5 text-sm whitespace-pre-line"
                style={{ color: 'var(--portal-text, #2C2C2C)' }}
              >
                {state.notes}
              </dd>
            </div>
          )}
        </dl>
      </PortalCard>

      {error && (
        <div
          className="px-4 py-3 rounded-md text-sm"
          style={{
            background: 'rgba(110,42,36,0.08)',
            border: '1px solid rgba(110,42,36,0.2)',
            color: '#7E2417',
          }}
        >
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Link
          href="/portal/quotes"
          className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-sm font-medium transition-colors"
          style={{
            background: 'var(--portal-bg-card, #FFFFFF)',
            color: 'var(--portal-text-strong, #3E2A1E)',
            border: '1px solid var(--portal-border, #E8DFD0)',
          }}
        >
          Cancel
        </Link>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 px-5 h-9 rounded-md text-sm font-medium transition-shadow disabled:opacity-60"
          style={{
            background:
              'var(--grad)',
            color: 'white',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {submitting ? (
            <>Submitting…</>
          ) : (
            <>
              <FilePlus className="w-3.5 h-3.5" />
              Submit Quote
              <ChevronRight className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </div>
    </div>
  )
}
