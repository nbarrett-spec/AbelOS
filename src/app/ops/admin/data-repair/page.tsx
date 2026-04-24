'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader, Card, CardBody, Dialog, Button } from '@/components/ui'

// ────────────────────────────────────────────────────────────────────────────
// /ops/admin/data-repair
// Human-in-the-loop drift review queue. ADMIN + ACCOUNTING only (gated at
// middleware + permissions.ts).
// ────────────────────────────────────────────────────────────────────────────

interface OrderItem {
  id: string
  description: string
  qty: number
  unitPrice: number
  lineTotal: number
}

interface FlaggedOrder {
  id: string
  orderNumber: string
  builderName: string | null
  builderId: string
  storedSubtotal: number
  storedTax: number
  storedShipping: number
  storedTotal: number
  computedItemSum: number
  computedTax: number
  computedFreight: number
  computedTotal: number
  delta: number
  classification: string
  suggestedAction: string
  items: OrderItem[]
  lastUpdatedAt: string
  createdAt: string
  notes: string
}

interface BuilderBucket {
  builderId: string
  builderName: string
  orders: number
  hidden: number
}

interface ApiResponse {
  orders: FlaggedOrder[]
  summary: {
    flaggedCount: number
    totalHiddenRevenue: number
    recoveredSoFar: number
    acceptedCount: number
    rejectedCount: number
  }
  builderBreakdown: BuilderBucket[]
}

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

export default function DataRepairPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<FlaggedOrder | null>(null)
  const [actionInFlight, setActionInFlight] = useState<null | 'accept' | 'reject' | 'flag'>(null)
  const [note, setNote] = useState('')
  const [flashMsg, setFlashMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/ops/admin/data-repair/drift-flagged', { cache: 'no-store' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Failed to load (${res.status})`)
      }
      const json = (await res.json()) as ApiResponse
      setData(json)
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const openOrder = (o: FlaggedOrder) => {
    setSelected(o)
    setNote('')
  }
  const closeOrder = () => {
    if (actionInFlight) return
    setSelected(null)
    setNote('')
  }

  const doAction = async (
    kind: 'accept' | 'reject' | 'flag',
    orderId: string,
    payload: Record<string, unknown>,
  ) => {
    const urls: Record<typeof kind, string> = {
      accept: '/api/ops/admin/data-repair/accept-fix',
      reject: '/api/ops/admin/data-repair/reject-fix',
      flag: '/api/ops/admin/data-repair/flag-for-review',
    }
    try {
      setActionInFlight(kind)
      const res = await fetch(urls[kind], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, ...payload }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `Action failed (${res.status})`)
      }
      if (kind === 'accept') {
        setFlashMsg({
          kind: 'ok',
          text: `${json.orderNumber} rebuilt: ${fmtMoney(json.oldTotal)} → ${fmtMoney(
            json.newTotal,
          )} (+${fmtMoney(json.delta)})${json.zeroResidual ? ' · drift cleared' : ' · residual remains'}`,
        })
      } else if (kind === 'reject') {
        setFlashMsg({
          kind: 'ok',
          text: `${json.orderNumber} left as-is · rejection logged`,
        })
      } else {
        setFlashMsg({
          kind: 'ok',
          text: `${json.orderNumber} flagged for Nate · InboxItem ${json.inboxItemId}`,
        })
      }
      setSelected(null)
      setNote('')
      await fetchData()
    } catch (err: any) {
      setFlashMsg({ kind: 'err', text: err.message })
    } finally {
      setActionInFlight(null)
    }
  }

  const totalBig = useMemo(() => {
    if (!data) return 0
    return data.orders.filter((o) => o.delta > 1000).length
  }, [data])

  return (
    <div className="space-y-5">
      <PageHeader
        title="Data Repair — Drift Review"
        description="Orders flagged CORRUPT_HEADER_TRUST_ITEMS by scripts/drift-deep-dive.mjs. Header is decimal-shifted or truncated; items are the truth. Accept to rebuild header from items; reject to keep stored total (intentional discount); flag to escalate."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Admin', href: '/ops/admin' },
          { label: 'Data Repair' },
        ]}
      />

      {flashMsg && (
        <div
          className={
            flashMsg.kind === 'ok'
              ? 'rounded-md border border-green-200 bg-green-50 text-green-800 px-3 py-2 text-sm'
              : 'rounded-md border border-red-200 bg-red-50 text-red-800 px-3 py-2 text-sm'
          }
        >
          {flashMsg.text}
          <button
            onClick={() => setFlashMsg(null)}
            className="ml-2 text-xs underline opacity-75 hover:opacity-100"
          >
            dismiss
          </button>
        </div>
      )}

      {loading && !data ? (
        <div className="animate-pulse grid grid-cols-12 gap-4">
          <div className="col-span-8 h-96 rounded bg-surface-muted" />
          <div className="col-span-4 h-96 rounded bg-surface-muted" />
        </div>
      ) : error && !data ? (
        <div className="rounded-md border border-red-200 bg-red-50 text-red-700 p-4 text-sm">
          {error}
          <button
            onClick={fetchData}
            className="ml-3 text-red-900 underline text-xs"
          >
            retry
          </button>
        </div>
      ) : !data ? null : (
        <div className="grid grid-cols-12 gap-4">
          {/* ── Main queue ─────────────────────────────────────────────── */}
          <div className="col-span-12 lg:col-span-8 space-y-3">
            <Card>
              <CardBody className="p-0">
                <div className="px-4 py-3 border-b border-border bg-surface-muted flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-fg">
                      Flagged orders ({data.orders.length})
                    </h2>
                    <p className="text-xs text-fg-muted mt-0.5">
                      {totalBig} with delta &gt; $1,000
                    </p>
                  </div>
                  <button
                    onClick={fetchData}
                    disabled={loading}
                    className="text-xs text-fg-muted hover:text-fg disabled:opacity-50"
                  >
                    {loading ? 'loading…' : 'refresh'}
                  </button>
                </div>
                {data.orders.length === 0 ? (
                  <div className="p-8 text-center text-sm text-fg-muted">
                    No drift-flagged orders. Everything has been reviewed.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-muted text-xs uppercase tracking-wide text-fg-muted">
                        <tr>
                          <th className="px-4 py-2 text-left font-semibold">Order</th>
                          <th className="px-4 py-2 text-left font-semibold">Builder</th>
                          <th className="px-4 py-2 text-right font-semibold">Stored</th>
                          <th className="px-4 py-2 text-right font-semibold">Computed</th>
                          <th className="px-4 py-2 text-right font-semibold">Delta</th>
                          <th className="px-4 py-2 text-right font-semibold">Items</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {data.orders.map((o) => {
                          const big = o.delta > 1000
                          return (
                            <tr
                              key={o.id}
                              onClick={() => openOrder(o)}
                              className="cursor-pointer hover:bg-row-hover"
                            >
                              <td className="px-4 py-2 font-mono text-xs text-fg">
                                {o.orderNumber}
                              </td>
                              <td className="px-4 py-2 text-fg">
                                {o.builderName ?? <span className="text-fg-subtle">—</span>}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums text-fg-muted">
                                {fmtMoney(o.storedTotal)}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums text-fg">
                                {fmtMoney(o.computedTotal)}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums">
                                <span
                                  className={
                                    big
                                      ? 'inline-block px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-semibold'
                                      : 'text-fg-muted'
                                  }
                                >
                                  {o.delta > 0 ? '+' : ''}
                                  {fmtMoney(o.delta)}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums text-fg-muted">
                                {o.items.length}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>

            <p className="text-xs text-fg-muted leading-relaxed">
              Classification source: <code>scripts/drift-deep-dive.mjs</code>. Accept writes{' '}
              <code>subtotal = Σ lineTotal</code> and <code>total = subtotal + tax + shipping</code>{' '}
              in a single transaction, then re-checks residual drift. Every action is recorded in{' '}
              <code>AuditLog</code>.
            </p>
          </div>

          {/* ── Summary sidebar ────────────────────────────────────────── */}
          <aside className="col-span-12 lg:col-span-4 space-y-3">
            <Card>
              <CardBody>
                <h3 className="text-xs uppercase text-fg-muted font-semibold">
                  Hidden revenue (currently flagged)
                </h3>
                <p className="text-3xl font-semibold text-fg mt-1 tabular-nums">
                  {fmtMoney(data.summary.totalHiddenRevenue)}
                </p>
                <p className="text-xs text-fg-muted mt-1">
                  Sum of positive deltas across {data.summary.flaggedCount} orders.
                </p>
              </CardBody>
            </Card>

            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardBody>
                  <h3 className="text-xs uppercase text-fg-muted font-semibold">Recovered</h3>
                  <p className="text-xl font-semibold text-green-700 mt-1 tabular-nums">
                    {fmtMoney(data.summary.recoveredSoFar)}
                  </p>
                  <p className="text-[11px] text-fg-muted">
                    {data.summary.acceptedCount} accepted
                  </p>
                </CardBody>
              </Card>
              <Card>
                <CardBody>
                  <h3 className="text-xs uppercase text-fg-muted font-semibold">Rejected</h3>
                  <p className="text-xl font-semibold text-fg mt-1 tabular-nums">
                    {data.summary.rejectedCount}
                  </p>
                  <p className="text-[11px] text-fg-muted">kept stored total</p>
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardBody>
                <h3 className="text-xs uppercase text-fg-muted font-semibold mb-2">
                  Builder breakdown
                </h3>
                {data.builderBreakdown.length === 0 ? (
                  <p className="text-xs text-fg-muted">Nothing flagged.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.builderBreakdown.map((b) => (
                      <li
                        key={b.builderId}
                        className="flex items-baseline justify-between text-sm"
                      >
                        <span className="text-fg truncate pr-2">{b.builderName}</span>
                        <span className="tabular-nums text-fg whitespace-nowrap">
                          {b.orders} order{b.orders === 1 ? '' : 's'} · {fmtMoney(b.hidden)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </aside>
        </div>
      )}

      {/* ── Modal ────────────────────────────────────────────────────── */}
      <Dialog
        open={!!selected}
        onClose={closeOrder}
        size="xl"
        title={
          selected ? (
            <span className="flex items-baseline gap-3">
              <span className="font-mono">{selected.orderNumber}</span>
              <span className="text-xs font-normal text-fg-muted">
                {selected.builderName ?? 'Unknown builder'}
              </span>
            </span>
          ) : undefined
        }
        description={selected?.suggestedAction}
        footer={
          selected ? (
            <div className="flex items-center gap-2 flex-wrap w-full">
              <div className="flex-1 min-w-0 text-[11px] text-fg-muted">
                {selected.items.length} line items · last updated{' '}
                {new Date(selected.lastUpdatedAt).toLocaleDateString()}
              </div>
              <Button
                variant="ghost"
                disabled={!!actionInFlight}
                onClick={() =>
                  note.trim()
                    ? doAction('flag', selected.id, { reason: note.trim() })
                    : setFlashMsg({ kind: 'err', text: 'Add a reason to flag for review.' })
                }
              >
                {actionInFlight === 'flag' ? 'Flagging…' : 'Flag for review'}
              </Button>
              <Button
                variant="secondary"
                disabled={!!actionInFlight}
                onClick={() =>
                  note.trim()
                    ? doAction('reject', selected.id, { reason: note.trim() })
                    : setFlashMsg({
                        kind: 'err',
                        text: 'Add a reason (e.g. "intentional discount") before rejecting.',
                      })
                }
              >
                {actionInFlight === 'reject' ? 'Rejecting…' : 'Reject · keep stored'}
              </Button>
              <Button
                variant="primary"
                disabled={!!actionInFlight}
                onClick={() =>
                  doAction('accept', selected.id, { actorNote: note.trim() || undefined })
                }
              >
                {actionInFlight === 'accept'
                  ? 'Applying…'
                  : `Accept fix · rebuild → ${fmtMoney(selected.computedTotal)}`}
              </Button>
            </div>
          ) : undefined
        }
      >
        {selected && (
          <div className="space-y-4">
            {/* Stored vs computed */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-border bg-surface-muted p-3">
                <h4 className="text-xs font-semibold uppercase text-fg-muted mb-2">
                  Stored (current DB)
                </h4>
                <dl className="text-sm space-y-1">
                  <Row label="Subtotal" value={fmtMoney(selected.storedSubtotal)} />
                  <Row label="Tax" value={fmtMoney(selected.storedTax)} />
                  <Row label="Shipping" value={fmtMoney(selected.storedShipping)} />
                  <Row
                    label="Total"
                    value={fmtMoney(selected.storedTotal)}
                    bold
                  />
                </dl>
              </div>
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
                <h4 className="text-xs font-semibold uppercase text-blue-700 mb-2">
                  Computed from items
                </h4>
                <dl className="text-sm space-y-1">
                  <Row label="Σ lineTotal" value={fmtMoney(selected.computedItemSum)} />
                  <Row label="Tax (stored)" value={fmtMoney(selected.computedTax)} />
                  <Row label="Freight (stored)" value={fmtMoney(selected.computedFreight)} />
                  <Row
                    label="Computed total"
                    value={fmtMoney(selected.computedTotal)}
                    bold
                  />
                  <div className="pt-1 mt-1 border-t border-blue-200 flex justify-between text-sm font-semibold">
                    <span className="text-blue-800">Delta (+hidden)</span>
                    <span className="tabular-nums text-blue-900">
                      {selected.delta > 0 ? '+' : ''}
                      {fmtMoney(selected.delta)}
                    </span>
                  </div>
                </dl>
              </div>
            </div>

            <div className="text-xs text-gray-600 bg-amber-50 border border-amber-200 rounded-md p-2 leading-relaxed">
              <strong>Note:</strong> {selected.notes}
            </div>

            {/* Line items */}
            <div className="rounded-md border border-border overflow-hidden">
              <div className="px-3 py-2 bg-surface-muted border-b border-border text-xs font-semibold text-fg-muted">
                Line items ({selected.items.length})
              </div>
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface sticky top-0 text-[11px] uppercase text-fg-muted border-b border-border">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">Description</th>
                      <th className="px-3 py-1.5 text-right font-medium">Qty</th>
                      <th className="px-3 py-1.5 text-right font-medium">Unit</th>
                      <th className="px-3 py-1.5 text-right font-medium">Line total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {selected.items.map((it) => (
                      <tr key={it.id}>
                        <td className="px-3 py-1.5 text-fg truncate max-w-xl">
                          {it.description}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{it.qty}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {fmtMoney(it.unitPrice)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                          {fmtMoney(it.lineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-muted font-semibold text-sm">
                      <td className="px-3 py-1.5" colSpan={3}>
                        Σ line totals
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {fmtMoney(selected.computedItemSum)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Note input */}
            <label className="block">
              <span className="block text-xs font-semibold text-fg-muted mb-1">
                Reason / note
                <span className="font-normal text-fg-muted">
                  {' '}
                  (required for reject / flag · optional for accept)
                </span>
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                disabled={!!actionInFlight}
                className="w-full px-3 py-2 text-sm border border-border-strong rounded-md bg-surface text-fg focus:ring-1 focus:ring-signal focus:border-signal disabled:bg-surface-muted disabled:opacity-70"
                placeholder="e.g. intentional discount per Dawn / escalating to Nate — Toll batch bug unclear"
              />
            </label>
          </div>
        )}
      </Dialog>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold pt-1 border-t border-border mt-1' : ''}`}>
      <span className="text-fg-muted">{label}</span>
      <span className="tabular-nums text-fg">{value}</span>
    </div>
  )
}
