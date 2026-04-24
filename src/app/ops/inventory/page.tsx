'use client'

/**
 * Inventory list — Aegis Glass v3 rebuild.
 * KPIs (AnimatedCounter) + filters + datatable. Click a row → product detail.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Package } from 'lucide-react'
import { AnimatedCounter } from '@/components/ui/experience'
import EmptyState from '@/components/ui/EmptyState'

type StatusKey = '' | 'healthy' | 'low' | 'critical' | 'out' | 'overstocked'

interface Row {
  id: string
  sku: string
  name: string
  displayName: string | null
  category: string | null
  subcategory: string | null
  manufacturer: string | null
  basePrice: number | null
  cost: number | null
  imageUrl: string | null
  thumbnailUrl: string | null
  leadTimeDays: number | null
  active: boolean
  inStock: boolean
  onHand: number
  committed: number
  available: number
  onOrder: number
  reorderPoint: number
  reorderQty: number
  safetyStock: number
  maxStock: number | null
  unitCost: number | null
  warehouseZone: string | null
  binLocation: string | null
  invStatus: string | null
  lastCountedAt: string | null
  lastReceivedAt: string | null
  avgDailyUsage: number | null
  daysOfSupply: number | null
}

interface Kpis {
  totalSkus: number
  trackedSkus: number
  totalOnHand: number
  totalOnHandValue: number
  belowReorder: number
  outOfStock: number
  overstocked: number
  avgInventoryTurns: number
  lowStockUrgency: number
  criticalItems: Array<{
    id: string
    sku: string
    name: string
    onHand: number
    available: number
    reorderPoint: number
  }>
}

function deriveStatus(r: Row): { key: 'out' | 'critical' | 'low' | 'healthy' | 'overstocked'; label: string; tone: 'danger' | 'warning' | 'success' | 'info' | 'neutral' } {
  if (r.onHand <= 0) return { key: 'out', label: 'Out', tone: 'danger' }
  if (r.onHand <= r.safetyStock) return { key: 'critical', label: 'Critical', tone: 'danger' }
  if (r.onHand <= r.reorderPoint) return { key: 'low', label: 'Low', tone: 'warning' }
  if (r.maxStock != null && r.onHand > r.maxStock) return { key: 'overstocked', label: 'Overstocked', tone: 'info' }
  return { key: 'healthy', label: 'Healthy', tone: 'success' }
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
  } catch { return '—' }
}

export default function InventoryListPage() {
  const router = useRouter()

  const [rows, setRows] = useState<Row[]>([])
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [zones, setZones] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState<StatusKey>('')
  const [zone, setZone] = useState('')
  const [sort, setSort] = useState('name')
  const [dir, setDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  const loadKpis = useCallback(async () => {
    try {
      const res = await fetch('/api/ops/inventory/kpis')
      if (res.ok) setKpis(await res.json())
    } catch (e) {
      console.error('[Inventory] kpi load failed:', e)
    }
  }, [])

  const loadRows = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (search) qs.set('search', search)
      if (category) qs.set('category', category)
      if (status) qs.set('status', status)
      if (zone) qs.set('zone', zone)
      qs.set('sort', sort)
      qs.set('dir', dir)
      qs.set('page', String(page))
      qs.set('limit', '50')
      const res = await fetch(`/api/ops/inventory?${qs.toString()}`)
      if (res.ok) {
        const d = await res.json()
        setRows(d.products || [])
        setCategories(d.categories || [])
        setZones(d.zones || [])
        setTotalPages(d.totalPages || 1)
        setTotal(d.total || 0)
      }
    } catch (e) {
      console.error('[Inventory] list load failed:', e)
    } finally {
      setLoading(false)
    }
  }, [search, category, status, zone, sort, dir, page])

  useEffect(() => { loadKpis() }, [loadKpis])
  useEffect(() => { loadRows() }, [loadRows])
  useEffect(() => { setPage(1) }, [search, category, status, zone, sort, dir])

  const handleSort = (col: string) => {
    if (sort === col) {
      setDir(dir === 'asc' ? 'desc' : 'asc')
    } else {
      setSort(col)
      setDir(['onHand', 'available', 'lastMovement'].includes(col) ? 'desc' : 'asc')
    }
  }

  const sortIndicator = (col: string) =>
    sort !== col ? '' : (dir === 'asc' ? ' ↑' : ' ↓')

  const ariaSort = (col: string): 'ascending' | 'descending' | 'none' =>
    sort !== col ? 'none' : (dir === 'asc' ? 'ascending' : 'descending')

  const showingFrom = useMemo(() => total === 0 ? 0 : (page - 1) * 50 + 1, [page, total])
  const showingTo = useMemo(() => Math.min(total, page * 50), [page, total])

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1600, margin: '0 auto' }}>
      {/* ── Header ── */}
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
        <div>
          <div className="eyebrow">Supply Chain</div>
          <h1 className="heading-gradient" style={{ fontSize: 32, fontWeight: 700, margin: '4px 0 0', letterSpacing: '-0.02em' }}>
            Inventory
          </h1>
          <p style={{ color: 'var(--fg-muted)', margin: '6px 0 0', fontSize: 14 }}>
            {total.toLocaleString()} products tracked across {zones.length} warehouse zones
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => { loadKpis(); loadRows() }}>
            Refresh
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              const qs = new URLSearchParams()
              qs.set('format', 'csv')
              if (search) qs.set('search', search)
              if (category) qs.set('category', category)
              if (status) qs.set('status', status)
              if (zone) qs.set('zone', zone)
              qs.set('sort', sort)
              qs.set('dir', dir)
              window.location.href = `/api/ops/inventory?${qs.toString()}`
            }}
          >
            Export CSV
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </header>

      {/* ── KPI Bar ── */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="kpi-card glass-card glass-card-shimmer">
          <div className="kpi-card-title">Total SKUs</div>
          <div className="kpi-card-value">
            <AnimatedCounter value={kpis?.totalSkus ?? 0} />
          </div>
          <div className="kpi-card-delta" style={{ color: 'var(--fg-subtle)' }}>
            {kpis?.trackedSkus ?? 0} with stock records
          </div>
        </div>
        <div className="kpi-card glass-card glass-card-shimmer">
          <div className="kpi-card-title">On-Hand Value</div>
          <div className="kpi-card-value">
            <AnimatedCounter value={Math.round(kpis?.totalOnHandValue ?? 0)} prefix="$" />
          </div>
          <div className="kpi-card-delta" style={{ color: 'var(--fg-subtle)' }}>
            {(kpis?.totalOnHand ?? 0).toLocaleString()} units
          </div>
        </div>
        <div className="kpi-card glass-card glass-card-shimmer">
          <div className="kpi-card-title">Below Reorder</div>
          <div className="kpi-card-value" style={{ color: (kpis?.belowReorder ?? 0) > 0 ? 'var(--data-warning)' : 'var(--fg)' }}>
            <AnimatedCounter value={kpis?.belowReorder ?? 0} />
          </div>
          <div className="kpi-card-delta">
            <button
              className="btn btn-ghost btn-sm"
              style={{ height: 22, padding: '0 6px', fontSize: 11 }}
              onClick={() => setStatus('low')}
            >
              View ›
            </button>
          </div>
        </div>
        <div className="kpi-card glass-card glass-card-shimmer">
          <div className="kpi-card-title">Out of Stock</div>
          <div className="kpi-card-value" style={{ color: (kpis?.outOfStock ?? 0) > 0 ? 'var(--data-negative)' : 'var(--fg)' }}>
            <AnimatedCounter value={kpis?.outOfStock ?? 0} />
          </div>
          <div className="kpi-card-delta">
            <button
              className="btn btn-ghost btn-sm"
              style={{ height: 22, padding: '0 6px', fontSize: 11 }}
              onClick={() => setStatus('out')}
            >
              View ›
            </button>
          </div>
        </div>
        <div className="kpi-card glass-card glass-card-shimmer">
          <div className="kpi-card-title">Inventory Turns</div>
          <div className="kpi-card-value">
            <AnimatedCounter value={kpis?.avgInventoryTurns ?? 0} suffix="x" />
          </div>
          <div className="kpi-card-delta" style={{ color: 'var(--fg-subtle)' }}>
            Annualized (180d basis)
          </div>
        </div>
      </section>

      {/* ── Filters ── */}
      <section className="glass-card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) repeat(4, minmax(140px, 1fr))', gap: 10, alignItems: 'end' }}>
          <div>
            <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Search</label>
            <input
              className="input"
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="SKU, name, description"
              aria-label="Search inventory"
            />
          </div>
          <div>
            <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Category</label>
            <select className="input" value={category} onChange={e => setCategory(e.target.value)} aria-label="Filter by category">
              <option value="">All categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Status</label>
            <select className="input" value={status} onChange={e => setStatus(e.target.value as StatusKey)} aria-label="Filter by status">
              <option value="">Any status</option>
              <option value="healthy">Healthy</option>
              <option value="low">Below reorder</option>
              <option value="critical">Critical</option>
              <option value="out">Out of stock</option>
              <option value="overstocked">Overstocked</option>
            </select>
          </div>
          <div>
            <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Zone</label>
            <select className="input" value={zone} onChange={e => setZone(e.target.value)} aria-label="Filter by warehouse zone">
              <option value="">All zones</option>
              {zones.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div>
            <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Sort</label>
            <select className="input" value={`${sort}:${dir}`} onChange={e => {
              const [s, d] = e.target.value.split(':')
              setSort(s); setDir(d as 'asc' | 'desc')
            }}>
              <option value="name:asc">Name A–Z</option>
              <option value="name:desc">Name Z–A</option>
              <option value="sku:asc">SKU A–Z</option>
              <option value="category:asc">Category A–Z</option>
              <option value="onHand:desc">On-hand high→low</option>
              <option value="onHand:asc">On-hand low→high</option>
              <option value="available:desc">Available high→low</option>
              <option value="available:asc">Available low→high</option>
              <option value="lastMovement:desc">Recent movement</option>
            </select>
          </div>
        </div>
        {(search || category || status || zone) && (
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>Active filters:</span>
            {search && <span className="badge badge-info">Search: {search}</span>}
            {category && <span className="badge badge-info">Category: {category}</span>}
            {status && <span className="badge badge-info">Status: {status}</span>}
            {zone && <span className="badge badge-info">Zone: {zone}</span>}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setSearch(''); setCategory(''); setStatus(''); setZone('') }}
            >
              Clear all
            </button>
          </div>
        )}
      </section>

      {/* ── Table ── */}
      <section className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 80, textAlign: 'center', color: 'var(--fg-muted)' }}>
            Loading inventory…
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Package className="w-8 h-8 text-fg-subtle" />}
            title="No items match your filters"
            description="Try clearing a filter or adjusting the search term."
            action={
              (search || category || status || zone)
                ? {
                    label: 'Clear filters',
                    onClick: () => { setSearch(''); setCategory(''); setStatus(''); setZone('') },
                  }
                : undefined
            }
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="datatable density-comfortable" style={{ minWidth: 1100 }}>
              <thead>
                <tr>
                  <th style={{ width: 56 }}></th>
                  <th aria-sort={ariaSort('sku')} onClick={() => handleSort('sku')}>SKU{sortIndicator('sku')}</th>
                  <th aria-sort={ariaSort('name')} onClick={() => handleSort('name')}>Name{sortIndicator('name')}</th>
                  <th aria-sort={ariaSort('category')} onClick={() => handleSort('category')}>Category{sortIndicator('category')}</th>
                  <th className="num" aria-sort={ariaSort('onHand')} onClick={() => handleSort('onHand')}>
                    On Hand{sortIndicator('onHand')}
                  </th>
                  <th className="num">Committed</th>
                  <th className="num" aria-sort={ariaSort('available')} onClick={() => handleSort('available')}>
                    Available{sortIndicator('available')}
                  </th>
                  <th>Zone / Bin</th>
                  <th className="num">Reorder Pt</th>
                  <th>Status</th>
                  <th aria-sort={ariaSort('lastMovement')} onClick={() => handleSort('lastMovement')}>
                    Last Movement{sortIndicator('lastMovement')}
                  </th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const s = deriveStatus(r)
                  const borderColor =
                    s.key === 'out' ? 'var(--data-negative)' :
                    s.key === 'critical' ? 'var(--data-negative)' :
                    s.key === 'low' ? 'var(--data-warning)' :
                    'transparent'
                  return (
                    <tr
                      key={r.id}
                      onClick={() => router.push(`/ops/inventory/${r.id}`)}
                      style={{
                        cursor: 'pointer',
                        boxShadow: borderColor !== 'transparent' ? `inset 3px 0 0 ${borderColor}` : undefined,
                      }}
                    >
                      <td>
                        {r.thumbnailUrl || r.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.thumbnailUrl || r.imageUrl || ''}
                            alt={r.name}
                            style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--border)' }}
                          />
                        ) : (
                          <div style={{
                            width: 40, height: 40, borderRadius: 6,
                            border: '1px dashed var(--border)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'var(--fg-subtle)', fontSize: 10
                          }}>
                            ▢
                          </div>
                        )}
                      </td>
                      <td>
                        <span className="data-mono" style={{ fontSize: 12 }}>{r.sku}</span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{r.displayName || r.name}</div>
                        {r.manufacturer && (
                          <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>{r.manufacturer}</div>
                        )}
                      </td>
                      <td>
                        <div>{r.category || '—'}</div>
                        {r.subcategory && (
                          <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>{r.subcategory}</div>
                        )}
                      </td>
                      <td className="num data-mono">{r.onHand.toLocaleString()}</td>
                      <td className="num data-mono" style={{ color: 'var(--fg-muted)' }}>{r.committed.toLocaleString()}</td>
                      <td className="num data-mono" style={{ fontWeight: 600 }}>{r.available.toLocaleString()}</td>
                      <td>
                        {r.warehouseZone ? (
                          <span className="data-mono" style={{ fontSize: 12 }}>
                            {r.warehouseZone}{r.binLocation ? ` · ${r.binLocation}` : ''}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--fg-subtle)' }}>—</span>
                        )}
                      </td>
                      <td className="num data-mono" style={{ color: 'var(--fg-muted)' }}>
                        {r.reorderPoint > 0 ? r.reorderPoint.toLocaleString() : '—'}
                      </td>
                      <td>
                        <span className={`badge badge-${s.tone} badge-dot`}>{s.label}</span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                        {fmtDate(r.lastReceivedAt)}
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => router.push(`/ops/inventory/${r.id}`)}
                          aria-label={`Open ${r.name}`}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Pagination ── */}
        {!loading && rows.length > 0 && (
          <div style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 8,
          }}>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
              Showing <strong>{showingFrom.toLocaleString()}–{showingTo.toLocaleString()}</strong> of {total.toLocaleString()}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                ‹ Previous
              </button>
              <span style={{ fontSize: 12, color: 'var(--fg-muted)', padding: '0 8px' }}>
                Page {page} / {totalPages}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >
                Next ›
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Critical items quick link ── */}
      {kpis && kpis.criticalItems.length > 0 && (
        <section className="glass-card" style={{ padding: 16, marginTop: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>⚠ Top Critical Items</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
            {kpis.criticalItems.map(c => (
              <button
                key={c.id}
                onClick={() => router.push(`/ops/inventory/${c.id}`)}
                style={{
                  textAlign: 'left',
                  padding: 10,
                  borderRadius: 8,
                  border: '1px solid var(--data-negative)',
                  background: 'var(--data-negative-bg)',
                  cursor: 'pointer',
                  color: 'var(--data-negative-fg)',
                }}
              >
                <div className="data-mono" style={{ fontSize: 11 }}>{c.sku}</div>
                <div style={{ fontWeight: 600, fontSize: 13, marginTop: 2 }}>{c.name}</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>
                  {c.onHand} on hand · reorder at {c.reorderPoint}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
