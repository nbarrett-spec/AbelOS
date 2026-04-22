'use client'

/**
 * Product Detail — Aegis Glass v3
 * Hero + image gallery + AnimatedCounter quick stats + TabBarInk with 5 tabs.
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AnimatedCounter, TabBarInk } from '@/components/ui/experience'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface Product {
  id: string
  sku: string
  name: string
  displayName: string | null
  description: string | null
  category: string | null
  subcategory: string | null
  manufacturer: string | null
  cost: number | null
  basePrice: number | null
  minMargin: number | null
  doorSize: string | null
  handing: string | null
  coreType: string | null
  panelStyle: string | null
  jambSize: string | null
  casingCode: string | null
  hardwareFinish: string | null
  material: string | null
  fireRating: string | null
  imageUrl: string | null
  thumbnailUrl: string | null
  imageAlt: string | null
  active: boolean
  inStock: boolean
  leadTimeDays: number | null
  inflowId: string | null
  inflowCategory: string | null
  lastSyncedAt: string | null
}

interface Inventory {
  id: string
  onHand: number
  committed: number
  available: number
  onOrder: number
  reorderPoint: number
  reorderQty: number
  safetyStock: number
  maxStock: number | null
  unitCost: number | null
  avgDailyUsage: number | null
  daysOfSupply: number | null
  warehouseZone: string | null
  binLocation: string | null
  location: string | null
  status: string | null
  lastCountedAt: string | null
  lastReceivedAt: string | null
}

interface BomChild {
  id: string
  componentId: string
  sku: string
  name: string
  category: string | null
  thumbnailUrl: string | null
  imageUrl: string | null
  quantity: number
  componentType: string | null
  onHand: number
  available: number
}

interface BomParent {
  id: string
  parentId: string
  sku: string
  name: string
  category: string | null
  thumbnailUrl: string | null
  imageUrl: string | null
  quantity: number
  componentType: string | null
}

interface DetailData {
  product: Product
  inventory: Inventory | null
  bom: { components: BomChild[]; usedIn: BomParent[]; isParent: boolean; isComponent: boolean }
  builderPricing: Array<{
    id: string
    builderId: string
    companyName: string
    contactName: string | null
    customPrice: number | null
    margin: number | null
    effectiveDate: string | null
  }>
  allocations: Array<{
    id: string
    quantity: number
    pickedQty: number
    status: string
    zone: string | null
    createdAt: string
    jobId: string | null
    jobNumber: string | null
    address: string | null
    jobStatus: string | null
    builderName: string | null
  }>
  futureDemand: { pickCount: number; qtyDue: number }
  avgMonthlyUsage: number
}

interface Transaction {
  type: 'RECEIPT' | 'ISSUE'
  id: string
  quantity: number
  unitCost: number | null
  value: number | null
  ts: string | null
  reference: string | null
  counterparty: string | null
  subStatus: string | null
  damagedQty: number | null
  jobNumber: string | null
  builderName: string | null
}

interface SalesData {
  items: Array<{
    id: string
    quantity: number
    unitPrice: number | null
    lineTotal: number | null
    description: string | null
    orderId: string
    orderNumber: string
    orderStatus: string | null
    orderDate: string | null
    builderId: string | null
    companyName: string | null
  }>
  total: number
  monthly: Array<{ month: string; qty: number; revenue: number }>
  topBuilders: Array<{ builderId: string | null; companyName: string | null; totalQty: number; totalRevenue: number; orderCount: number }>
  totals: { lifetimeQty: number; lifetimeRevenue: number; orderCount: number }
}

interface PurchaseData {
  items: Array<{
    id: string
    quantity: number
    unitCost: number | null
    lineTotal: number | null
    receivedQty: number
    damagedQty: number | null
    vendorSku: string | null
    description: string | null
    poId: string
    poNumber: string
    poStatus: string | null
    orderedAt: string | null
    expectedDate: string | null
    receivedAt: string | null
    vendorId: string | null
    vendorName: string | null
    avgLeadDays: number | null
    onTimeRate: number | null
  }>
  total: number
  costTrend: Array<{ poNumber: string; orderedAt: string | null; unitCost: number | null; vendorName: string | null }>
  leadTime: { avgDays: number; minDays: number; maxDays: number; sampleCount: number }
  totals: { totalReceived: number; totalOrdered: number; avgUnitCost: number; poCount: number }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function fmtMoney(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: decimals, minimumFractionDigits: decimals })
}
function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return '—' }
}
function fmtMonth(s: string): string {
  try {
    const [y, m] = s.split('-')
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  } catch { return s }
}

function inventoryHealth(inv: Inventory | null): { tone: 'success' | 'warning' | 'danger' | 'info'; label: string; detail: string } {
  if (!inv) return { tone: 'info', label: 'Untracked', detail: 'No inventory record yet — counts have not been entered.' }
  if (inv.onHand <= 0) return { tone: 'danger', label: 'Out of Stock', detail: 'Zero units on hand. Replenishment required.' }
  if (inv.onHand <= inv.safetyStock) return { tone: 'danger', label: 'Critical', detail: `Below safety stock (${inv.safetyStock}). Risk of stockout.` }
  if (inv.onHand <= inv.reorderPoint) return { tone: 'warning', label: 'Low', detail: `At or below reorder point (${inv.reorderPoint}). Trigger PO.` }
  if (inv.maxStock != null && inv.onHand > inv.maxStock) return { tone: 'info', label: 'Overstocked', detail: `Above max stock (${inv.maxStock}). Capital tied up.` }
  return { tone: 'success', label: 'Healthy', detail: 'Stock levels within target band.' }
}

function tabIcon(emoji: string, label: string) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span aria-hidden style={{ fontSize: 14 }}>{emoji}</span>
      {label}
    </span>
  )
}

// Image placeholder component
function ImagePlaceholder({ label }: { label: string }) {
  return (
    <div style={{
      width: '100%', aspectRatio: '1 / 1',
      border: '1px dashed var(--border)',
      borderRadius: 12,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 6, color: 'var(--fg-subtle)',
      background: 'var(--surface-muted)',
    }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M8 12l3 3 5-7" />
      </svg>
      <div style={{ fontSize: 11 }}>{label}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function ProductDetailPage() {
  const params = useParams()
  const router = useRouter()
  const productId = String(params?.productId || '')

  const [data, setData] = useState<DetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('overview')

  // Image gallery
  const [primaryImage, setPrimaryImage] = useState<string | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  // Tab data
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [txnPage, setTxnPage] = useState(1)
  const [txnPages, setTxnPages] = useState(1)
  const [salesData, setSalesData] = useState<SalesData | null>(null)
  const [purchaseData, setPurchaseData] = useState<PurchaseData | null>(null)

  // Edit state for description/reorder settings
  const [editingDescription, setEditingDescription] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [editingReorder, setEditingReorder] = useState(false)
  const [reorderDraft, setReorderDraft] = useState({ reorderPoint: 0, reorderQty: 0, safetyStock: 0, maxStock: '' as string | number, warehouseZone: '', binLocation: '' })
  const [saving, setSaving] = useState(false)

  // ── Load detail ──
  const loadDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ops/inventory/${productId}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Failed to load (${res.status})`)
      }
      const d: DetailData = await res.json()
      setData(d)
      setPrimaryImage(d.product.imageUrl || d.product.thumbnailUrl || null)
      setDescriptionDraft(d.product.description || '')
      if (d.inventory) {
        setReorderDraft({
          reorderPoint: d.inventory.reorderPoint,
          reorderQty: d.inventory.reorderQty,
          safetyStock: d.inventory.safetyStock,
          maxStock: d.inventory.maxStock ?? '',
          warehouseZone: d.inventory.warehouseZone || '',
          binLocation: d.inventory.binLocation || '',
        })
      }
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => { if (productId) loadDetail() }, [productId, loadDetail])

  // ── Lazy-load tab data ──
  const loadTransactions = useCallback(async (p: number = 1) => {
    try {
      const res = await fetch(`/api/ops/inventory/${productId}/transactions?page=${p}&limit=20`)
      if (res.ok) {
        const d = await res.json()
        setTransactions(d.transactions || [])
        setTxnPage(d.page || 1)
        setTxnPages(d.totalPages || 1)
      }
    } catch (e) { console.error('[Inventory detail] txn load:', e) }
  }, [productId])

  const loadSales = useCallback(async () => {
    try {
      const res = await fetch(`/api/ops/inventory/${productId}/sales-history?limit=50`)
      if (res.ok) setSalesData(await res.json())
    } catch (e) { console.error('[Inventory detail] sales load:', e) }
  }, [productId])

  const loadPurchases = useCallback(async () => {
    try {
      const res = await fetch(`/api/ops/inventory/${productId}/purchase-history?limit=50`)
      if (res.ok) setPurchaseData(await res.json())
    } catch (e) { console.error('[Inventory detail] purchase load:', e) }
  }, [productId])

  useEffect(() => {
    if (!data) return
    if (activeTab === 'inventory' && transactions.length === 0) loadTransactions(1)
    if (activeTab === 'sales' && !salesData) loadSales()
    if (activeTab === 'purchase' && !purchaseData) loadPurchases()
  }, [activeTab, data, transactions.length, salesData, purchaseData, loadTransactions, loadSales, loadPurchases])

  // ── Save handlers ──
  const saveDescription = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/ops/inventory/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: descriptionDraft }),
      })
      if (res.ok) {
        setEditingDescription(false)
        loadDetail()
      }
    } finally { setSaving(false) }
  }

  const saveReorder = async () => {
    setSaving(true)
    try {
      const body: any = {
        reorderPoint: Number(reorderDraft.reorderPoint) || 0,
        reorderQty: Number(reorderDraft.reorderQty) || 0,
        safetyStock: Number(reorderDraft.safetyStock) || 0,
        warehouseZone: reorderDraft.warehouseZone,
        binLocation: reorderDraft.binLocation,
      }
      if (reorderDraft.maxStock !== '' && reorderDraft.maxStock !== null) {
        body.maxStock = Number(reorderDraft.maxStock)
      }
      const res = await fetch(`/api/ops/inventory/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setEditingReorder(false)
        loadDetail()
      }
    } finally { setSaving(false) }
  }

  // ── Computed: monthly bar chart max ──
  const monthlyMax = useMemo(() => {
    if (!salesData) return 0
    return Math.max(1, ...salesData.monthly.map(m => m.qty))
  }, [salesData])

  // ── Render guards ──
  if (loading) {
    return (
      <div style={{ padding: 80, textAlign: 'center', color: 'var(--fg-muted)' }}>
        Loading product…
      </div>
    )
  }
  if (error) {
    return (
      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        <div className="glass-card" style={{ padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚠</div>
          <h2 style={{ marginTop: 0 }}>Couldn&rsquo;t load product</h2>
          <p style={{ color: 'var(--fg-muted)' }}>{error}</p>
          <button className="btn btn-secondary" onClick={() => router.push('/ops/inventory')}>
            ← Back to Inventory
          </button>
        </div>
      </div>
    )
  }
  if (!data) return null

  const { product, inventory, bom, builderPricing, allocations, futureDemand, avgMonthlyUsage } = data
  const health = inventoryHealth(inventory)

  // Image gallery items (primary + thumbs)
  const galleryItems = [
    { url: product.imageUrl, label: '2D Drawing / Render', key: 'primary' },
    { url: product.thumbnailUrl, label: '3D Rendering', key: 'thumb' },
    { url: null, label: 'Lifestyle Shot', key: 'lifestyle' },
    { url: null, label: 'Product Shot', key: 'product' },
  ]

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1600, margin: '0 auto' }}>
      {/* ── Breadcrumb ── */}
      <nav style={{ marginBottom: 16, fontSize: 12, color: 'var(--fg-muted)' }}>
        <button
          onClick={() => router.push('/ops/inventory')}
          style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: 0 }}
        >
          ← Inventory
        </button>
        <span style={{ margin: '0 8px' }}>/</span>
        <span>{product.category || 'Uncategorized'}</span>
        <span style={{ margin: '0 8px' }}>/</span>
        <span style={{ color: 'var(--fg)' }}>{product.sku}</span>
      </nav>

      {/* ── Hero ── */}
      <header style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 360px) 1fr', gap: 24, marginBottom: 24 }}>
        {/* Image gallery */}
        <div>
          <div
            onClick={() => primaryImage && setLightboxOpen(true)}
            style={{
              cursor: primaryImage ? 'zoom-in' : 'default',
              marginBottom: 8,
            }}
          >
            {primaryImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={primaryImage}
                alt={product.imageAlt || product.name}
                style={{
                  width: '100%', aspectRatio: '1 / 1',
                  borderRadius: 12, objectFit: 'cover',
                  border: '1px solid var(--border)',
                  background: 'var(--surface-muted)',
                }}
              />
            ) : (
              <ImagePlaceholder label="No image — click to upload" />
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {galleryItems.map(g => (
              <button
                key={g.key}
                onClick={() => g.url && setPrimaryImage(g.url)}
                aria-label={`View ${g.label}`}
                style={{
                  padding: 0, border: 0, background: 'none', cursor: g.url ? 'pointer' : 'default',
                  borderRadius: 6, overflow: 'hidden',
                  outline: g.url === primaryImage ? '2px solid var(--c1)' : 'none',
                  outlineOffset: 2,
                }}
              >
                {g.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={g.url}
                    alt={g.label}
                    style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', display: 'block', border: '1px solid var(--border)' }}
                  />
                ) : (
                  <div style={{
                    width: '100%', aspectRatio: '1 / 1',
                    border: '1px dashed var(--border)', borderRadius: 6,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--fg-subtle)', fontSize: 9, padding: 4, textAlign: 'center',
                  }}>
                    {g.label}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Title + meta + quick stats */}
        <div>
          <div className="eyebrow">{product.category || 'Product'}{product.subcategory ? ` · ${product.subcategory}` : ''}</div>
          <h1 className="heading-gradient" style={{ fontSize: 32, fontWeight: 700, margin: '4px 0', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            {product.displayName || product.name}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <span className="data-mono" style={{ fontSize: 13, color: 'var(--fg-muted)' }}>{product.sku}</span>
            <span className={`badge badge-${product.active ? 'success' : 'neutral'}`}>
              {product.active ? 'Active' : 'Inactive'}
            </span>
            <span className={`badge badge-${health.tone} badge-dot`}>{health.label}</span>
            {product.manufacturer && (
              <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>by {product.manufacturer}</span>
            )}
          </div>

          {/* Quick stats — AnimatedCounter row */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 12, marginTop: 16,
          }}>
            <QuickStat label="On Hand" value={inventory?.onHand ?? 0} />
            <QuickStat label="Committed" value={inventory?.committed ?? 0} muted />
            <QuickStat label="Available" value={inventory?.available ?? 0} accent />
            <QuickStat label="Reorder Pt" value={inventory?.reorderPoint ?? 0} muted />
            <QuickStat label="Avg Mo. Usage" value={Math.round(avgMonthlyUsage)} />
          </div>
        </div>
      </header>

      {/* ── Smart Callouts ── */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 20 }}>
        <Callout
          tone={health.tone}
          eyebrow="Inventory Health"
          title={health.label}
          body={health.detail}
        />
        <Callout
          tone={futureDemand.qtyDue > (inventory?.available ?? 0) ? 'warning' : 'info'}
          eyebrow="Future Demand"
          title={`${futureDemand.qtyDue.toLocaleString()} units due`}
          body={`${futureDemand.pickCount} pending pick(s) in next 30 days · ${(inventory?.available ?? 0).toLocaleString()} available now`}
        />
        <Callout
          tone="info"
          eyebrow="Suggested Action"
          title={suggestedActionTitle(inventory, futureDemand, avgMonthlyUsage)}
          body={suggestedActionBody(inventory, futureDemand, avgMonthlyUsage, product.leadTimeDays)}
        />
      </section>

      {/* ── Tabs ── */}
      <TabBarInk
        tabs={[
          { id: 'overview',  label: tabIcon('📋', 'Overview') },
          { id: 'inventory', label: tabIcon('📦', 'Inventory') },
          { id: 'bom',       label: tabIcon('🧩', 'BOM') },
          { id: 'purchase',  label: tabIcon('🛒', 'Purchase History') },
          { id: 'sales',     label: tabIcon('💰', 'Sales History') },
        ]}
        activeId={activeTab}
        onChange={setActiveTab}
      />

      <div style={{ marginTop: 20 }}>
        {/* ───────────────────────── TAB 1: OVERVIEW ───────────────────────── */}
        {activeTab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 16 }}>
            <div className="glass-card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Description</h2>
                {!editingDescription ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingDescription(true)}>Edit</button>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setEditingDescription(false); setDescriptionDraft(product.description || '') }}>Cancel</button>
                    <button className="btn btn-primary btn-sm" disabled={saving} onClick={saveDescription}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                )}
              </div>
              {editingDescription ? (
                <textarea
                  className="input"
                  value={descriptionDraft}
                  onChange={e => setDescriptionDraft(e.target.value)}
                  rows={6}
                  style={{ width: '100%', minHeight: 140, fontFamily: 'inherit' }}
                  placeholder="Add a product description…"
                />
              ) : (
                <p style={{ margin: 0, color: product.description ? 'var(--fg)' : 'var(--fg-subtle)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                  {product.description || 'No description yet. Click Edit to add one.'}
                </p>
              )}
            </div>

            <div className="glass-card" style={{ padding: 20 }}>
              <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>Pricing</h2>
              <div style={{ display: 'grid', gap: 8 }}>
                <Field label="Base Cost" value={fmtMoney(product.cost)} mono />
                <Field label="List Price" value={fmtMoney(product.basePrice)} mono />
                <Field label="Min Margin" value={product.minMargin != null ? `${product.minMargin}%` : '—'} mono />
                <Field
                  label="Calculated Margin"
                  value={
                    product.basePrice && product.cost
                      ? `${(((product.basePrice - product.cost) / product.basePrice) * 100).toFixed(1)}%`
                      : '—'
                  }
                  mono
                />
                {inventory?.unitCost != null && (
                  <Field label="Latest Unit Cost" value={fmtMoney(inventory.unitCost)} mono />
                )}
              </div>
            </div>

            <div className="glass-card" style={{ padding: 20, gridColumn: '1 / -1' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>Specifications</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <Field label="SKU" value={product.sku} mono />
                <Field label="Category" value={product.category || '—'} />
                <Field label="Subcategory" value={product.subcategory || '—'} />
                <Field label="Manufacturer" value={product.manufacturer || '—'} />
                <Field label="Material" value={product.material || '—'} />
                <Field label="Door Size" value={product.doorSize || '—'} />
                <Field label="Handing" value={product.handing || '—'} />
                <Field label="Core Type" value={product.coreType || '—'} />
                <Field label="Panel Style" value={product.panelStyle || '—'} />
                <Field label="Jamb Size" value={product.jambSize || '—'} />
                <Field label="Casing Code" value={product.casingCode || '—'} />
                <Field label="Hardware Finish" value={product.hardwareFinish || '—'} />
                <Field label="Fire Rating" value={product.fireRating || '—'} />
                <Field label="Lead Time" value={product.leadTimeDays != null ? `${product.leadTimeDays} days` : '—'} />
                <Field label="InFlow ID" value={product.inflowId || '—'} mono />
                <Field label="Last Synced" value={fmtDate(product.lastSyncedAt)} />
              </div>
            </div>

            {builderPricing.length > 0 && (
              <div className="glass-card" style={{ padding: 20, gridColumn: '1 / -1' }}>
                <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>Builder Pricing</h2>
                <table className="datatable density-compact">
                  <thead>
                    <tr>
                      <th>Builder</th>
                      <th>Contact</th>
                      <th className="num">Custom Price</th>
                      <th className="num">Margin</th>
                      <th>Effective</th>
                    </tr>
                  </thead>
                  <tbody>
                    {builderPricing.map(bp => (
                      <tr key={bp.id}>
                        <td>{bp.companyName}</td>
                        <td style={{ color: 'var(--fg-muted)' }}>{bp.contactName || '—'}</td>
                        <td className="num data-mono">{fmtMoney(bp.customPrice)}</td>
                        <td className="num data-mono">{bp.margin != null ? `${bp.margin}%` : '—'}</td>
                        <td style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{fmtDate(bp.effectiveDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ───────────────────────── TAB 2: INVENTORY ───────────────────────── */}
        {activeTab === 'inventory' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
            {/* Stock card */}
            <div className="glass-card" style={{ padding: 20 }}>
              <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>Stock Position</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                <StockTile label="On Hand" value={inventory?.onHand ?? 0} tone={(inventory?.onHand ?? 0) <= 0 ? 'danger' : 'neutral'} />
                <StockTile label="Committed" value={inventory?.committed ?? 0} tone="muted" />
                <StockTile label="Available" value={inventory?.available ?? 0} tone={(inventory?.available ?? 0) <= 0 ? 'danger' : 'success'} />
                <StockTile label="On Order" value={inventory?.onOrder ?? 0} tone="info" />
              </div>
              {inventory?.location && (
                <div style={{ marginTop: 12, fontSize: 13, color: 'var(--fg-muted)' }}>
                  Warehouse: <span style={{ color: 'var(--fg)' }}>{inventory.location}</span>
                </div>
              )}
              {inventory && (
                <div style={{ marginTop: 12, fontSize: 12, color: 'var(--fg-subtle)' }}>
                  Last counted: {fmtDate(inventory.lastCountedAt)} · Last received: {fmtDate(inventory.lastReceivedAt)}
                </div>
              )}
            </div>

            {/* Reorder settings */}
            <div className="glass-card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Reorder Settings</h2>
                {!editingReorder ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingReorder(true)}>Edit</button>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingReorder(false)}>Cancel</button>
                    <button className="btn btn-primary btn-sm" disabled={saving} onClick={saveReorder}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                )}
              </div>
              {!editingReorder ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <Field label="Reorder Point" value={String(inventory?.reorderPoint ?? 0)} mono />
                  <Field label="Reorder Qty" value={String(inventory?.reorderQty ?? 0)} mono />
                  <Field label="Safety Stock" value={String(inventory?.safetyStock ?? 0)} mono />
                  <Field label="Max Stock" value={inventory?.maxStock != null ? String(inventory.maxStock) : '—'} mono />
                  <Field label="Warehouse Zone" value={inventory?.warehouseZone || '—'} mono />
                  <Field label="Bin Location" value={inventory?.binLocation || '—'} mono />
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  <ReorderInput label="Reorder Point" value={reorderDraft.reorderPoint} onChange={v => setReorderDraft({ ...reorderDraft, reorderPoint: Number(v) || 0 })} />
                  <ReorderInput label="Reorder Qty" value={reorderDraft.reorderQty} onChange={v => setReorderDraft({ ...reorderDraft, reorderQty: Number(v) || 0 })} />
                  <ReorderInput label="Safety Stock" value={reorderDraft.safetyStock} onChange={v => setReorderDraft({ ...reorderDraft, safetyStock: Number(v) || 0 })} />
                  <ReorderInput label="Max Stock" value={reorderDraft.maxStock} onChange={v => setReorderDraft({ ...reorderDraft, maxStock: v })} placeholder="(optional)" />
                  <ReorderInput label="Warehouse Zone" type="text" value={reorderDraft.warehouseZone} onChange={v => setReorderDraft({ ...reorderDraft, warehouseZone: String(v) })} />
                  <ReorderInput label="Bin Location" type="text" value={reorderDraft.binLocation} onChange={v => setReorderDraft({ ...reorderDraft, binLocation: String(v) })} />
                </div>
              )}
            </div>

            {/* Movement timeline */}
            <div className="glass-card" style={{ padding: 20, gridColumn: '1 / -1' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Movement Timeline</h2>
                <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Receipts (POs) and issues (picks)</span>
              </div>
              {transactions.length === 0 ? (
                <div className="empty-state" style={{ padding: 32 }}>
                  <p style={{ margin: 0, color: 'var(--fg-muted)' }}>No movement recorded yet.</p>
                </div>
              ) : (
                <>
                  <table className="datatable density-compact">
                    <thead>
                      <tr>
                        <th style={{ width: 90 }}>Type</th>
                        <th>Date</th>
                        <th className="num">Quantity</th>
                        <th>Reference</th>
                        <th>Counterparty</th>
                        <th className="num">Unit Cost</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map(tx => (
                        <tr key={`${tx.type}-${tx.id}`}>
                          <td>
                            <span className={`badge badge-${tx.type === 'RECEIPT' ? 'success' : 'info'}`}>
                              {tx.type === 'RECEIPT' ? '+ Receipt' : '− Issue'}
                            </span>
                          </td>
                          <td style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{fmtDate(tx.ts)}</td>
                          <td className="num data-mono" style={{ fontWeight: 600, color: tx.type === 'RECEIPT' ? 'var(--data-positive)' : 'var(--data-info)' }}>
                            {tx.type === 'RECEIPT' ? '+' : '−'}{Number(tx.quantity).toLocaleString()}
                          </td>
                          <td className="data-mono" style={{ fontSize: 12 }}>{tx.reference || '—'}</td>
                          <td>{tx.counterparty || '—'}</td>
                          <td className="num data-mono">{fmtMoney(tx.unitCost)}</td>
                          <td><span className="badge badge-neutral" style={{ fontSize: 10 }}>{tx.subStatus || '—'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {txnPages > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 12 }}>
                      <button className="btn btn-secondary btn-sm" disabled={txnPage <= 1} onClick={() => loadTransactions(txnPage - 1)}>‹</button>
                      <span style={{ fontSize: 12, color: 'var(--fg-muted)', alignSelf: 'center', padding: '0 8px' }}>
                        {txnPage} / {txnPages}
                      </span>
                      <button className="btn btn-secondary btn-sm" disabled={txnPage >= txnPages} onClick={() => loadTransactions(txnPage + 1)}>›</button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Allocation breakdown */}
            <div className="glass-card" style={{ padding: 20, gridColumn: '1 / -1' }}>
              <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>Allocation Breakdown</h2>
              {allocations.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--fg-muted)' }}>No active allocations. All committed stock is unassigned.</p>
              ) : (
                <table className="datatable density-compact">
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Builder</th>
                      <th>Address</th>
                      <th className="num">Qty</th>
                      <th className="num">Picked</th>
                      <th>Status</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocations.map(a => (
                      <tr key={a.id}>
                        <td className="data-mono" style={{ fontSize: 12 }}>{a.jobNumber || '—'}</td>
                        <td>{a.builderName || '—'}</td>
                        <td style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{a.address || '—'}</td>
                        <td className="num data-mono">{a.quantity}</td>
                        <td className="num data-mono">{a.pickedQty}</td>
                        <td><span className={`badge badge-${a.status === 'PICKED' || a.status === 'VERIFIED' ? 'success' : a.status === 'SHORT' ? 'danger' : 'warning'}`}>{a.status}</span></td>
                        <td style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{fmtDate(a.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ───────────────────────── TAB 3: BOM ───────────────────────── */}
        {activeTab === 'bom' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
            {/* Components (parent view) */}
            <div className="glass-card" style={{ padding: 20 }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>Components</h2>
              <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--fg-muted)' }}>
                Parts that make up this assembly.
              </p>
              {bom.components.length === 0 ? (
                <div className="empty-state" style={{ padding: 24 }}>
                  <p style={{ margin: 0, color: 'var(--fg-muted)' }}>This is not a parent assembly.</p>
                </div>
              ) : (
                <table className="datatable density-compact">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Component</th>
                      <th className="num">Qty</th>
                      <th className="num">On Hand</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bom.components.map(c => (
                      <tr key={c.id} onClick={() => router.push(`/ops/inventory/${c.componentId}`)} style={{ cursor: 'pointer' }}>
                        <td className="data-mono" style={{ fontSize: 12 }}>{c.sku}</td>
                        <td>
                          <div>{c.name}</div>
                          {c.componentType && <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>{c.componentType}</div>}
                        </td>
                        <td className="num data-mono">{c.quantity}</td>
                        <td className="num data-mono">{c.onHand}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Used in (component view) */}
            <div className="glass-card" style={{ padding: 20 }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>Used In</h2>
              <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--fg-muted)' }}>
                Assemblies that include this product.
              </p>
              {bom.usedIn.length === 0 ? (
                <div className="empty-state" style={{ padding: 24 }}>
                  <p style={{ margin: 0, color: 'var(--fg-muted)' }}>Not used in any assemblies.</p>
                </div>
              ) : (
                <table className="datatable density-compact">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Assembly</th>
                      <th className="num">Qty Used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bom.usedIn.map(u => (
                      <tr key={u.id} onClick={() => router.push(`/ops/inventory/${u.parentId}`)} style={{ cursor: 'pointer' }}>
                        <td className="data-mono" style={{ fontSize: 12 }}>{u.sku}</td>
                        <td>{u.name}</td>
                        <td className="num data-mono">{u.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* BOM diagram placeholder */}
            <div className="glass-card" style={{ padding: 20, gridColumn: '1 / -1' }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>Assembly Diagram</h2>
              <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--fg-muted)' }}>
                Visual BOM diagram coming soon.
              </p>
              <div style={{
                border: '1px dashed var(--border)',
                borderRadius: 12,
                minHeight: 180,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--fg-subtle)',
                background: 'var(--surface-muted)',
              }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 32 }}>🧩</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>BOM tree visualization placeholder</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ───────────────────────── TAB 4: PURCHASE HISTORY ───────────────────────── */}
        {activeTab === 'purchase' && (
          <div style={{ display: 'grid', gap: 16 }}>
            {purchaseData ? (
              <>
                {/* Summary tiles */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                  <SummaryTile label="POs" value={purchaseData.totals.poCount} />
                  <SummaryTile label="Total Ordered" value={purchaseData.totals.totalOrdered} />
                  <SummaryTile label="Total Received" value={purchaseData.totals.totalReceived} />
                  <SummaryTile label="Avg Unit Cost" value={fmtMoney(purchaseData.totals.avgUnitCost)} isString />
                  <SummaryTile label="Avg Lead Time" value={purchaseData.leadTime.sampleCount > 0 ? `${purchaseData.leadTime.avgDays}d` : '—'} isString />
                </div>

                {/* Cost trend chart (CSS) */}
                <div className="glass-card" style={{ padding: 20 }}>
                  <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>Cost Trend (Last 6 POs)</h2>
                  {purchaseData.costTrend.length === 0 ? (
                    <p style={{ color: 'var(--fg-muted)', margin: 0 }}>No PO history yet.</p>
                  ) : (
                    <CostTrend data={purchaseData.costTrend} />
                  )}
                </div>

                {/* PO line items */}
                <div className="glass-card" style={{ padding: 20 }}>
                  <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>Recent Purchase Orders</h2>
                  {purchaseData.items.length === 0 ? (
                    <div className="empty-state" style={{ padding: 32 }}>
                      <p style={{ margin: 0, color: 'var(--fg-muted)' }}>No purchase history yet.</p>
                    </div>
                  ) : (
                    <table className="datatable density-compact">
                      <thead>
                        <tr>
                          <th>PO #</th>
                          <th>Vendor</th>
                          <th>Ordered</th>
                          <th>Received</th>
                          <th className="num">Qty Ord.</th>
                          <th className="num">Qty Rec.</th>
                          <th className="num">Unit Cost</th>
                          <th className="num">Line Total</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {purchaseData.items.map(it => (
                          <tr key={it.id}>
                            <td className="data-mono" style={{ fontSize: 12 }}>{it.poNumber}</td>
                            <td>{it.vendorName || '—'}</td>
                            <td style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{fmtDate(it.orderedAt)}</td>
                            <td style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{fmtDate(it.receivedAt)}</td>
                            <td className="num data-mono">{Number(it.quantity).toLocaleString()}</td>
                            <td className="num data-mono">{Number(it.receivedQty).toLocaleString()}</td>
                            <td className="num data-mono">{fmtMoney(it.unitCost)}</td>
                            <td className="num data-mono">{fmtMoney(it.lineTotal, 0)}</td>
                            <td><span className="badge badge-neutral" style={{ fontSize: 10 }}>{it.poStatus || '—'}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            ) : (
              <div className="glass-card" style={{ padding: 40, textAlign: 'center', color: 'var(--fg-muted)' }}>
                Loading purchase history…
              </div>
            )}
          </div>
        )}

        {/* ───────────────────────── TAB 5: SALES HISTORY ───────────────────────── */}
        {activeTab === 'sales' && (
          <div style={{ display: 'grid', gap: 16 }}>
            {salesData ? (
              <>
                {/* Lifetime totals */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                  <SummaryTile label="Lifetime Quantity" value={salesData.totals.lifetimeQty} />
                  <SummaryTile label="Lifetime Revenue" value={fmtMoney(salesData.totals.lifetimeRevenue, 0)} isString />
                  <SummaryTile label="Order Count" value={salesData.totals.orderCount} />
                </div>

                {/* Monthly volume chart */}
                <div className="glass-card" style={{ padding: 20 }}>
                  <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>Monthly Sales Volume (Last 12 Months)</h2>
                  {salesData.monthly.length === 0 ? (
                    <p style={{ color: 'var(--fg-muted)', margin: 0 }}>No sales in the last 12 months.</p>
                  ) : (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${salesData.monthly.length}, 1fr)`,
                      gap: 6,
                      alignItems: 'end',
                      height: 180,
                      paddingBottom: 24,
                      position: 'relative',
                    }}>
                      {salesData.monthly.map(m => (
                        <div key={m.month} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                          <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginBottom: 4 }}>{m.qty}</div>
                          <div style={{
                            width: '70%',
                            height: `${(m.qty / monthlyMax) * 100}%`,
                            minHeight: m.qty > 0 ? 4 : 0,
                            background: 'linear-gradient(180deg, var(--c1), var(--c3))',
                            borderRadius: '4px 4px 0 0',
                            transition: 'height 0.4s var(--ease)',
                          }} />
                          <div style={{ fontSize: 10, color: 'var(--fg-subtle)', marginTop: 6, transform: 'rotate(-30deg)', transformOrigin: 'top center' }}>
                            {fmtMonth(m.month)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Top builders */}
                {salesData.topBuilders.length > 0 && (
                  <div className="glass-card" style={{ padding: 20 }}>
                    <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>Top 5 Builders</h2>
                    <table className="datatable density-compact">
                      <thead>
                        <tr>
                          <th>Builder</th>
                          <th className="num">Total Qty</th>
                          <th className="num">Total Revenue</th>
                          <th className="num">Orders</th>
                        </tr>
                      </thead>
                      <tbody>
                        {salesData.topBuilders.map((b, idx) => (
                          <tr key={b.builderId || idx}>
                            <td>{b.companyName || 'Unknown'}</td>
                            <td className="num data-mono">{Number(b.totalQty).toLocaleString()}</td>
                            <td className="num data-mono">{fmtMoney(b.totalRevenue, 0)}</td>
                            <td className="num data-mono">{b.orderCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Recent order items */}
                <div className="glass-card" style={{ padding: 20 }}>
                  <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>Recent Orders</h2>
                  {salesData.items.length === 0 ? (
                    <div className="empty-state" style={{ padding: 32 }}>
                      <p style={{ margin: 0, color: 'var(--fg-muted)' }}>No order history yet.</p>
                    </div>
                  ) : (
                    <table className="datatable density-compact">
                      <thead>
                        <tr>
                          <th>Order #</th>
                          <th>Builder</th>
                          <th>Date</th>
                          <th className="num">Qty</th>
                          <th className="num">Unit Price</th>
                          <th className="num">Line Total</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {salesData.items.map(it => (
                          <tr key={it.id}>
                            <td className="data-mono" style={{ fontSize: 12 }}>{it.orderNumber}</td>
                            <td>{it.companyName || '—'}</td>
                            <td style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{fmtDate(it.orderDate)}</td>
                            <td className="num data-mono">{Number(it.quantity).toLocaleString()}</td>
                            <td className="num data-mono">{fmtMoney(it.unitPrice)}</td>
                            <td className="num data-mono">{fmtMoney(it.lineTotal, 0)}</td>
                            <td><span className="badge badge-neutral" style={{ fontSize: 10 }}>{it.orderStatus || '—'}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            ) : (
              <div className="glass-card" style={{ padding: 40, textAlign: 'center', color: 'var(--fg-muted)' }}>
                Loading sales history…
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Lightbox ── */}
      {lightboxOpen && primaryImage && (
        <div
          onClick={() => setLightboxOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Image lightbox"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, cursor: 'zoom-out', padding: 24,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={primaryImage}
            alt={product.imageAlt || product.name}
            style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8 }}
          />
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────
function QuickStat({ label, value, accent, muted }: { label: string; value: number; accent?: boolean; muted?: boolean }) {
  return (
    <div style={{
      padding: 12,
      borderRadius: 10,
      border: '1px solid var(--border)',
      background: 'var(--surface)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-subtle)' }}>
        {label}
      </div>
      <div style={{
        fontSize: 22, fontWeight: 700, marginTop: 2,
        color: accent ? 'var(--signal)' : muted ? 'var(--fg-muted)' : 'var(--fg)',
      }}>
        <AnimatedCounter value={value} />
      </div>
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontSize: 13 }}>
      <span style={{ color: 'var(--fg-muted)' }}>{label}</span>
      <span className={mono ? 'data-mono' : ''} style={{ textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function StockTile({ label, value, tone }: { label: string; value: number; tone: 'success' | 'danger' | 'info' | 'neutral' | 'muted' }) {
  const colorMap: Record<string, string> = {
    success: 'var(--data-positive)',
    danger: 'var(--data-negative)',
    info: 'var(--data-info)',
    neutral: 'var(--fg)',
    muted: 'var(--fg-muted)',
  }
  return (
    <div style={{
      padding: 14,
      borderRadius: 10,
      border: '1px solid var(--border)',
      background: 'var(--surface)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-subtle)' }}>
        {label}
      </div>
      <div className="data-mono" style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: colorMap[tone] }}>
        <AnimatedCounter value={value} />
      </div>
    </div>
  )
}

function ReorderInput({ label, value, onChange, type = 'number', placeholder }: { label: string; value: string | number; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', display: 'block', marginBottom: 4 }}>
        {label}
      </label>
      <input
        className="input"
        type={type}
        value={value as any}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}

function SummaryTile({ label, value, isString }: { label: string; value: number | string; isString?: boolean }) {
  return (
    <div className="glass-card" style={{ padding: 14 }}>
      <div className="eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <div className="data-mono" style={{ fontSize: 22, fontWeight: 700 }}>
        {isString ? value : <AnimatedCounter value={value as number} />}
      </div>
    </div>
  )
}

function Callout({ tone, eyebrow, title, body }: { tone: 'success' | 'warning' | 'danger' | 'info'; eyebrow: string; title: string; body: string }) {
  const bgMap: Record<string, string> = {
    success: 'var(--data-positive-bg)',
    warning: 'var(--data-warning-bg)',
    danger: 'var(--data-negative-bg)',
    info: 'var(--data-info-bg)',
  }
  const fgMap: Record<string, string> = {
    success: 'var(--data-positive-fg)',
    warning: 'var(--data-warning-fg)',
    danger: 'var(--data-negative-fg)',
    info: 'var(--data-info-fg)',
  }
  return (
    <div style={{
      padding: 14,
      borderRadius: 12,
      background: bgMap[tone],
      border: `1px solid ${fgMap[tone]}33`,
      color: fgMap[tone],
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.85 }}>
        {eyebrow}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>{title}</div>
      <div style={{ fontSize: 12, marginTop: 4, opacity: 0.9 }}>{body}</div>
    </div>
  )
}

function CostTrend({ data }: { data: Array<{ poNumber: string; orderedAt: string | null; unitCost: number | null; vendorName: string | null }> }) {
  const points = data.filter(d => d.unitCost != null)
  if (points.length === 0) return <p style={{ color: 'var(--fg-muted)' }}>No cost data.</p>
  const max = Math.max(...points.map(p => p.unitCost!))
  const min = Math.min(...points.map(p => p.unitCost!))
  const range = max - min || 1
  return (
    <div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${points.length}, 1fr)`,
        gap: 8,
        alignItems: 'end',
        height: 140,
      }}>
        {points.map((p, idx) => {
          const heightPct = ((p.unitCost! - min) / range) * 80 + 20
          const prevCost = idx > 0 ? points[idx - 1].unitCost : null
          const delta = prevCost != null && p.unitCost != null ? p.unitCost - prevCost : null
          return (
            <div key={p.poNumber} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
              <div style={{ fontSize: 11, color: 'var(--fg)', fontWeight: 600 }}>${p.unitCost!.toFixed(2)}</div>
              {delta != null && (
                <div style={{ fontSize: 10, color: delta > 0 ? 'var(--data-negative)' : delta < 0 ? 'var(--data-positive)' : 'var(--fg-subtle)' }}>
                  {delta > 0 ? '▲' : delta < 0 ? '▼' : '·'} {Math.abs(delta).toFixed(2)}
                </div>
              )}
              <div style={{
                width: '60%',
                height: `${heightPct}%`,
                background: 'linear-gradient(180deg, var(--c2), var(--c4))',
                borderRadius: '4px 4px 0 0',
                marginTop: 4,
              }} />
            </div>
          )
        })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${points.length}, 1fr)`, gap: 8, marginTop: 8 }}>
        {points.map(p => (
          <div key={p.poNumber} style={{ fontSize: 10, color: 'var(--fg-subtle)', textAlign: 'center' }}>
            <div className="data-mono">{p.poNumber}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Suggested-action logic
// ─────────────────────────────────────────────────────────────────────────────
function suggestedActionTitle(inv: Inventory | null, demand: { qtyDue: number }, _avgUsage: number): string {
  if (!inv) return 'Set up inventory tracking'
  if (inv.onHand <= 0) return 'Place emergency PO'
  if (inv.onHand <= inv.safetyStock) return 'Place urgent PO'
  if (inv.available < demand.qtyDue) return 'Insufficient available stock'
  if (inv.onHand <= inv.reorderPoint) return 'Trigger replenishment'
  if (inv.maxStock != null && inv.onHand > inv.maxStock) return 'Slow next reorder'
  return 'Stock levels healthy'
}

function suggestedActionBody(inv: Inventory | null, demand: { qtyDue: number }, avgUsage: number, leadTime: number | null): string {
  if (!inv) return 'Add this product to inventory tracking to enable reorder alerts.'
  const lt = leadTime ?? 14
  if (inv.onHand <= 0) {
    return `Out of stock with ${demand.qtyDue.toLocaleString()} units due. Lead time ~${lt} days.`
  }
  if (inv.onHand <= inv.reorderPoint) {
    const sugg = Math.max(inv.reorderQty, Math.round(avgUsage * (lt / 30) * 1.5))
    return `Suggested order qty: ${sugg.toLocaleString()} units (covers ~${Math.round(sugg / Math.max(avgUsage / 30, 1))} days of usage).`
  }
  if (inv.available < demand.qtyDue) {
    const short = demand.qtyDue - inv.available
    return `Short ${short.toLocaleString()} units against committed picks. Expedite an order or release allocations.`
  }
  if (inv.maxStock != null && inv.onHand > inv.maxStock) {
    return `Holding ${(inv.onHand - inv.maxStock).toLocaleString()} units above max. Pause replenishment until stock burns down.`
  }
  return `${Math.round((inv.onHand - inv.reorderPoint) / Math.max(avgUsage / 30, 1))} days of buffer above reorder point.`
}
