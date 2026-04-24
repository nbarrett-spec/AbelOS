'use client'

// ──────────────────────────────────────────────────────────────────────────
// Catalog Management — Categories + Suppliers
//
// Migration screen behavior:
//   • This page is gated by `migrationRequired` from /api/ops/product-categories
//     and /api/ops/suppliers. Either API will set the flag if its underlying
//     table doesn't exist (Postgres relation-not-found error).
//   • The Run Migration button posts to /api/ops/migrate/product-expansion,
//     which executes idempotent CREATE TABLE IF NOT EXISTS / INSERT ... ON
//     CONFLICT DO NOTHING SQL. Safe to re-run; existing tables are skipped.
//   • Once the tables exist (in Prisma schema as ProductCategory, Supplier,
//     SupplierProduct since 2026-04 — see prisma/schema.prisma:5046+/5539+),
//     the GET endpoints will return data and `migrationRequired` will be
//     undefined, which lets the normal UI render.
//   • DO NOT auto-run on render — this stays behind the explicit button so
//     the orchestrator/Nate decides when to apply on prod.
// ──────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Package } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import Sheet from '@/components/ui/Sheet'

interface Category {
  id: string
  name: string
  slug: string
  parentId: string | null
  parentName: string | null
  description: string | null
  icon: string | null
  sortOrder: number
  active: boolean
  productCount: number
  liveProductCount: number
  marginTarget: number
  children?: Category[]
}

interface Supplier {
  id: string
  name: string
  code: string
  type: string
  contactName: string | null
  email: string | null
  phone: string | null
  website: string | null
  address?: string | null
  city: string | null
  state: string | null
  zip?: string | null
  categories: string[]
  paymentTerms: string
  leadTimeDays: number
  minOrderAmount: number
  freightPolicy?: string | null
  qualityRating: number
  onTimeRate: number
  active: boolean
  notes: string | null
  productCount: number
  createdAt?: string
  updatedAt?: string
}

interface MigrationResultRow {
  name: string
  status: 'ok' | 'error'
  error?: string
}

type Tab = 'categories' | 'suppliers'

export default function CatalogManagementPage() {
  const { addToast } = useToast()
  const [tab, setTab] = useState<Tab>('categories')
  const [categories, setCategories] = useState<Category[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [supplierStats, setSupplierStats] = useState({ total: 0, activeCount: 0, manufacturers: 0, distributors: 0 })
  const [loading, setLoading] = useState(true)
  const [migrationRequired, setMigrationRequired] = useState(false)
  const [migrationRunning, setMigrationRunning] = useState(false)
  const [migrationResults, setMigrationResults] = useState<MigrationResultRow[] | null>(null)
  const [migrationSummary, setMigrationSummary] = useState<string>('')
  const [migrationFailed, setMigrationFailed] = useState(false)
  const [expandedCat, setExpandedCat] = useState<string | null>(null)
  const [supplierSearch, setSupplierSearch] = useState('')
  const [supplierType, setSupplierType] = useState('')

  // Detail-panel state — opens a right-side Sheet with full record data.
  // Sheet component handles viewport positioning, escape-to-close, and
  // backdrop click. No custom absolute/fixed offsets — fixes the offscreen
  // bug seen on legacy product/supplier card click handlers.
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)

  // New category form
  const [showNewCat, setShowNewCat] = useState(false)
  const [newCat, setNewCat] = useState({ name: '', slug: '', parentId: '', description: '', marginTarget: '0.35' })

  // New supplier form
  const [showNewSupplier, setShowNewSupplier] = useState(false)
  const [newSupplier, setNewSupplier] = useState({
    name: '', code: '', type: 'DISTRIBUTOR', contactName: '', email: '', phone: '',
    website: '', city: '', state: 'TX', categories: '', paymentTerms: 'NET_30',
    leadTimeDays: '14', notes: '',
  })

  useEffect(() => {
    loadCategories()
    loadSuppliers()
  }, [])

  async function loadCategories() {
    try {
      const resp = await fetch('/api/ops/product-categories')
      const data = await resp.json()
      if (data.migrationRequired) {
        setMigrationRequired(true)
      } else {
        setCategories(data.categories || [])
      }
    } catch (err) {
      console.error('Failed to load categories:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadSuppliers() {
    try {
      const params = new URLSearchParams()
      if (supplierSearch) params.set('search', supplierSearch)
      if (supplierType) params.set('type', supplierType)
      const resp = await fetch(`/api/ops/suppliers?${params}`)
      const data = await resp.json()
      if (data.migrationRequired) {
        setMigrationRequired(true)
      } else {
        setSuppliers(data.suppliers || [])
        setSupplierStats(data.stats || { total: 0, activeCount: 0, manufacturers: 0, distributors: 0 })
      }
    } catch (err) {
      console.error('Failed to load suppliers:', err)
    }
  }

  async function createCategory() {
    try {
      const resp = await fetch('/api/ops/product-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCat.name,
          slug: newCat.slug || newCat.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          parentId: newCat.parentId || undefined,
          description: newCat.description || undefined,
          marginTarget: parseFloat(newCat.marginTarget) || 0.35,
        }),
      })
      const data = await resp.json()
      if (data.success) {
        setShowNewCat(false)
        setNewCat({ name: '', slug: '', parentId: '', description: '', marginTarget: '0.35' })
        loadCategories()
        addToast({ type: 'success', title: 'Category created', message: 'Product category created successfully' })
      } else {
        addToast({ type: 'error', title: 'Error', message: data.error || 'Failed to create category' })
      }
    } catch (err) {
      addToast({ type: 'error', title: 'Error', message: 'Failed to create category' })
    }
  }

  async function createSupplier() {
    try {
      const resp = await fetch('/api/ops/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSupplier.name,
          code: newSupplier.code,
          type: newSupplier.type,
          contactName: newSupplier.contactName || undefined,
          email: newSupplier.email || undefined,
          phone: newSupplier.phone || undefined,
          website: newSupplier.website || undefined,
          city: newSupplier.city || undefined,
          state: newSupplier.state || undefined,
          categories: newSupplier.categories ? newSupplier.categories.split(',').map(s => s.trim()) : [],
          paymentTerms: newSupplier.paymentTerms,
          leadTimeDays: parseInt(newSupplier.leadTimeDays) || 14,
          notes: newSupplier.notes || undefined,
        }),
      })
      const data = await resp.json()
      if (data.success) {
        setShowNewSupplier(false)
        setNewSupplier({ name: '', code: '', type: 'DISTRIBUTOR', contactName: '', email: '', phone: '', website: '', city: '', state: 'TX', categories: '', paymentTerms: 'NET_30', leadTimeDays: '14', notes: '' })
        loadSuppliers()
        addToast({ type: 'success', title: 'Supplier created', message: 'Supplier created successfully' })
      } else {
        addToast({ type: 'error', title: 'Error', message: data.error || 'Failed to create supplier' })
      }
    } catch (err) {
      addToast({ type: 'error', title: 'Error', message: 'Failed to create supplier' })
    }
  }

  async function runMigration() {
    if (migrationRunning) return
    if (!confirm('This will create ProductCategory, Supplier, SupplierProduct, and BuilderApplication tables (idempotent — safe to re-run). Continue?')) return
    setMigrationRunning(true)
    setMigrationResults(null)
    setMigrationSummary('')
    setMigrationFailed(false)
    try {
      const resp = await fetch('/api/ops/migrate/product-expansion', { method: 'POST' })
      const data = await resp.json()
      const results: MigrationResultRow[] = Array.isArray(data?.results) ? data.results : []
      setMigrationResults(results)
      setMigrationSummary(data?.message || '')
      if (data?.success) {
        setMigrationFailed(false)
        addToast({ type: 'success', title: 'Migration complete', message: data.message || 'All steps applied' })
        // Re-check whether tables exist now. If so, drop the migration screen.
        setMigrationRequired(false)
        loadCategories()
        loadSuppliers()
      } else {
        setMigrationFailed(true)
        addToast({ type: 'error', title: 'Migration failed', message: data?.message || 'See detail list below' })
      }
    } catch (err) {
      setMigrationFailed(true)
      addToast({ type: 'error', title: 'Error', message: 'Migration request failed (network or auth)' })
    } finally {
      setMigrationRunning(false)
    }
  }

  // ── MIGRATION REQUIRED STATE ──
  // Shows when either /api/ops/product-categories or /api/ops/suppliers
  // returned `migrationRequired: true` (table missing in Postgres).
  // The button POSTs to /api/ops/migrate/product-expansion which is
  // idempotent (CREATE TABLE IF NOT EXISTS / ON CONFLICT DO NOTHING).
  if (migrationRequired) {
    return (
      <div style={{ padding: 32, maxWidth: 800, margin: '0 auto' }}>
        <PageHeader title="Catalog Management" />
        <div
          className="border-signal"
          style={{
            marginTop: 32, padding: 40, backgroundColor: 'white', borderRadius: 16,
            borderWidth: 2, borderStyle: 'dashed', textAlign: 'center',
          }}
        >
          <p style={{ fontSize: 48, marginBottom: 12 }} aria-hidden>🔧</p>
          <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1f2937', marginBottom: 8 }}>Product Expansion Migration Required</h2>
          <p style={{ fontSize: 14, color: '#6b7280', maxWidth: 500, margin: '0 auto 24px' }}>
            The <code style={{ fontFamily: 'monospace', backgroundColor: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>ProductCategory</code> and{' '}
            <code style={{ fontFamily: 'monospace', backgroundColor: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>Supplier</code> tables haven&apos;t been created yet.
            Run the product expansion migration to set up categories, suppliers, and the builder application system.
            This operation is idempotent and safe to re-run.
          </p>
          <button
            onClick={runMigration}
            disabled={migrationRunning}
            className="bg-signal"
            aria-busy={migrationRunning}
            style={{
              padding: '12px 32px', borderRadius: 12,
              color: 'white', border: 'none', fontSize: 15, fontWeight: 600,
              cursor: migrationRunning ? 'wait' : 'pointer',
              opacity: migrationRunning ? 0.7 : 1,
              display: 'inline-flex', alignItems: 'center', gap: 10,
            }}
          >
            {migrationRunning && (
              <span
                aria-hidden
                style={{
                  width: 14, height: 14, borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.5)', borderTopColor: 'white',
                  animation: 'spin 0.8s linear infinite', display: 'inline-block',
                }}
              />
            )}
            {migrationRunning ? 'Running migration…' : 'Run Product Expansion Migration'}
          </button>

          {migrationResults && migrationResults.length > 0 && (
            <div
              role="status"
              aria-live="polite"
              style={{
                marginTop: 28, textAlign: 'left',
                backgroundColor: migrationFailed ? '#FEF2F2' : '#F0FDF4',
                border: `1px solid ${migrationFailed ? '#FECACA' : '#BBF7D0'}`,
                borderRadius: 10, padding: 16,
              }}
            >
              <p style={{ fontSize: 13, fontWeight: 600, color: migrationFailed ? '#991B1B' : '#166534', marginBottom: 8 }}>
                {migrationSummary || (migrationFailed ? 'Migration failed' : 'Migration complete')}
              </p>
              <ul style={{ fontSize: 12, fontFamily: 'monospace', maxHeight: 240, overflowY: 'auto', listStyle: 'none', padding: 0, margin: 0 }}>
                {migrationResults.map((r, idx) => (
                  <li
                    key={`${r.name}-${idx}`}
                    style={{
                      padding: '4px 0',
                      color: r.status === 'ok' ? '#15803D' : '#B91C1C',
                      borderBottom: idx < migrationResults.length - 1 ? '1px dashed rgba(0,0,0,0.06)' : 'none',
                      display: 'flex', justifyContent: 'space-between', gap: 12,
                    }}
                  >
                    <span>{r.status === 'ok' ? '✓' : '✗'} {r.name}</span>
                    {r.error && <span style={{ color: '#9CA3AF', fontSize: 11 }}>{r.error}</span>}
                  </li>
                ))}
              </ul>
              {!migrationFailed && (
                <p style={{ fontSize: 12, color: '#166534', marginTop: 12 }}>
                  Catalog will load momentarily…
                </p>
              )}
            </div>
          )}
        </div>
        <style jsx>{`
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    )
  }

  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db',
    fontSize: 14, outline: 'none', fontFamily: 'inherit',
  } as const

  return (
    <div style={{ padding: 32, maxWidth: 1200, margin: '0 auto' }}>
      <PageHeader
        title="Catalog Management"
        description="Manage product categories, suppliers, and catalog structure"
        actions={
          <Link
            href="/ops/products"
            style={{
              padding: '8px 16px', borderRadius: 8, backgroundColor: '#0f2a3e', color: 'white',
              fontSize: 13, fontWeight: 500, textDecoration: 'none',
            }}
          >
            View Products
          </Link>
        }
      />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, backgroundColor: '#f3f4f6', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {[
          { id: 'categories' as Tab, label: `Categories (${categories.reduce((sum, c) => sum + 1 + (c.children?.length || 0), 0)})` },
          { id: 'suppliers' as Tab, label: `Suppliers (${supplierStats.total})` },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 20px', borderRadius: 8, border: 'none',
              backgroundColor: tab === t.id ? 'white' : 'transparent',
              color: tab === t.id ? '#1f2937' : '#6b7280',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              boxShadow: tab === t.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══ CATEGORIES TAB ═══ */}
      {tab === 'categories' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button
              onClick={() => setShowNewCat(true)}
              className="bg-signal"
              style={{
                padding: '8px 20px', borderRadius: 8, color: 'white',
                border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              + Add Category
            </button>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>Loading...</div>
          ) : categories.length === 0 ? (
            <div style={{ backgroundColor: 'white', borderRadius: 12, border: '1px solid #e5e7eb' }}>
              <EmptyState
                icon={<Package className="w-8 h-8 text-fg-subtle" />}
                title="No categories found"
                description="Run the product expansion migration to seed categories"
              />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {categories.map(cat => (
                <div key={cat.id} style={{ backgroundColor: 'white', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                  <div
                    style={{
                      padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      cursor: cat.children && cat.children.length > 0 ? 'pointer' : 'default',
                    }}
                    onClick={() => cat.children && cat.children.length > 0 && setExpandedCat(expandedCat === cat.id ? null : cat.id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 24 }}>{cat.icon || '📦'}</span>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1f2937' }}>{cat.name}</h3>
                          {!cat.active && (
                            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                              Inactive
                            </span>
                          )}
                        </div>
                        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{cat.description}</p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                      <div style={{ textAlign: 'center' }}>
                        <p style={{ fontSize: 18, fontWeight: 600, color: '#0f2a3e' }}>{cat.liveProductCount || 0}</p>
                        <p style={{ fontSize: 11, color: '#9ca3af' }}>Products</p>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <p style={{ fontSize: 18, fontWeight: 600, color: '#10B981' }}>{Math.round((cat.marginTarget || 0.35) * 100)}%</p>
                        <p style={{ fontSize: 11, color: '#9ca3af' }}>Target Margin</p>
                      </div>
                      {cat.children && cat.children.length > 0 && (
                        <div style={{ textAlign: 'center' }}>
                          <p style={{ fontSize: 14, fontWeight: 600, color: '#6b7280' }}>{cat.children.length} sub</p>
                          <span style={{ fontSize: 16, color: '#9ca3af', transform: expandedCat === cat.id ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform 0.2s' }}>▼</span>
                        </div>
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); setSelectedCategory(cat) }}
                        style={{
                          padding: '6px 12px', borderRadius: 6, border: '1px solid #e5e7eb',
                          backgroundColor: 'white', color: '#374151', fontSize: 12, fontWeight: 500,
                          cursor: 'pointer',
                        }}
                        aria-label={`View details for ${cat.name}`}
                      >
                        Details
                      </button>
                    </div>
                  </div>

                  {/* Sub-categories — clickable to open detail Sheet */}
                  {expandedCat === cat.id && cat.children && cat.children.length > 0 && (
                    <div style={{ borderTop: '1px solid #f3f4f6', padding: '8px 20px 16px 56px' }}>
                      {cat.children.map(sub => (
                        <div
                          key={sub.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedCategory(sub)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedCategory(sub) } }}
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '10px 16px', borderRadius: 8, marginTop: 4,
                            backgroundColor: '#f9fafb', cursor: 'pointer',
                            transition: 'background-color 150ms',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f3f4f6' }}
                          onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#f9fafb' }}
                        >
                          <div>
                            <p style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{sub.name}</p>
                            <p style={{ fontSize: 12, color: '#9ca3af' }}>{sub.description}</p>
                          </div>
                          <p style={{ fontSize: 14, fontWeight: 600, color: '#0f2a3e' }}>{sub.liveProductCount || 0} products</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ SUPPLIERS TAB ═══ */}
      {tab === 'suppliers' && (
        <div>
          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Total Suppliers', value: supplierStats.total, color: '#0f2a3e' },
              { label: 'Active', value: supplierStats.activeCount, color: '#10B981' },
              { label: 'Manufacturers', value: supplierStats.manufacturers, color: '#C6A24E' },
              { label: 'Distributors', value: supplierStats.distributors, color: '#6366F1' },
            ].map(s => (
              <div key={s.label} style={{ padding: 16, backgroundColor: 'white', borderRadius: 12, border: '1px solid #e5e7eb' }}>
                <p style={{ fontSize: 26, fontWeight: 600, color: s.color }}>{s.value}</p>
                <p style={{ fontSize: 12, color: '#6b7280' }}>{s.label}</p>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <input
              placeholder="Search suppliers..."
              value={supplierSearch}
              onChange={e => setSupplierSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadSuppliers()}
              style={{ ...inputStyle, maxWidth: 300 }}
            />
            <select
              value={supplierType}
              onChange={e => { setSupplierType(e.target.value); setTimeout(loadSuppliers, 0) }}
              style={{ ...inputStyle, maxWidth: 200 }}
            >
              <option value="">All Types</option>
              <option value="MANUFACTURER">Manufacturers</option>
              <option value="DISTRIBUTOR">Distributors</option>
            </select>
            <button
              onClick={() => setShowNewSupplier(true)}
              className="bg-signal"
              style={{
                padding: '8px 20px', borderRadius: 8, color: 'white',
                border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginLeft: 'auto',
              }}
            >
              + Add Supplier
            </button>
          </div>

          {/* Supplier Cards — click to open detail Sheet (right-side slide-over,
              viewport-anchored, no offscreen positioning issues) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 12 }}>
            {suppliers.map(sup => (
              <div
                key={sup.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedSupplier(sup)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedSupplier(sup) } }}
                style={{
                  padding: 20, backgroundColor: 'white', borderRadius: 12, border: '1px solid #e5e7eb',
                  cursor: 'pointer', transition: 'border-color 150ms, box-shadow 150ms',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#C6A24E' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1f2937' }}>{sup.name}</h3>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                      backgroundColor: sup.type === 'MANUFACTURER' ? '#FEF3C7' : '#EBF5FF',
                      color: sup.type === 'MANUFACTURER' ? '#92400E' : '#0f2a3e',
                    }}>
                      {sup.type}
                    </span>
                  </div>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#9ca3af', backgroundColor: '#f3f4f6', padding: '4px 8px', borderRadius: 4 }}>
                    {sup.code}
                  </span>
                </div>

                {sup.categories && sup.categories.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
                    {sup.categories.map((c: string) => (
                      <span key={c} style={{
                        padding: '2px 8px', borderRadius: 99, fontSize: 11,
                        backgroundColor: '#f3f4f6', color: '#374151',
                      }}>
                        {c}
                      </span>
                    ))}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13, color: '#6b7280' }}>
                  {sup.contactName && <div>Contact: {sup.contactName}</div>}
                  {sup.email && <div>Email: {sup.email}</div>}
                  {sup.phone && <div>Phone: {sup.phone}</div>}
                  <div>Terms: {sup.paymentTerms || 'NET_30'}</div>
                  <div>Lead Time: {sup.leadTimeDays || 14} days</div>
                  <div>Products: {sup.productCount}</div>
                </div>

                {sup.notes && (
                  <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 8, fontStyle: 'italic' }}>{sup.notes}</p>
                )}
              </div>
            ))}
          </div>

          {suppliers.length === 0 && !loading && (
            <div style={{ backgroundColor: 'white', borderRadius: 12, border: '1px solid #e5e7eb' }}>
              <EmptyState
                icon={<Package className="w-8 h-8 text-fg-subtle" />}
                title="No suppliers found"
              />
            </div>
          )}
        </div>
      )}

      {/* ═══ NEW CATEGORY MODAL ═══ */}
      {showNewCat && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 32, maxWidth: 500, width: '100%' }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>New Product Category</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
                <input style={inputStyle} value={newCat.name} onChange={e => setNewCat({ ...newCat, name: e.target.value })} placeholder="e.g. Gutters" />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Slug</label>
                <input style={inputStyle} value={newCat.slug} onChange={e => setNewCat({ ...newCat, slug: e.target.value })} placeholder="auto-generated from name" />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Parent Category</label>
                <select style={inputStyle} value={newCat.parentId} onChange={e => setNewCat({ ...newCat, parentId: e.target.value })}>
                  <option value="">None (Top Level)</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
                <input style={inputStyle} value={newCat.description} onChange={e => setNewCat({ ...newCat, description: e.target.value })} placeholder="Brief description" />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Target Margin</label>
                <input style={inputStyle} type="number" step="0.01" min="0" max="1" value={newCat.marginTarget} onChange={e => setNewCat({ ...newCat, marginTarget: e.target.value })} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setShowNewCat(false)} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #e5e7eb', backgroundColor: 'white', cursor: 'pointer' }}>Cancel</button>
              <button onClick={createCategory} disabled={!newCat.name} className="bg-signal" style={{ padding: '8px 20px', borderRadius: 8, color: 'white', border: 'none', fontWeight: 600, cursor: 'pointer', opacity: newCat.name ? 1 : 0.5 }}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ NEW SUPPLIER MODAL ═══ */}
      {showNewSupplier && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 32, maxWidth: 560, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>New Supplier</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Name *</label>
                  <input style={inputStyle} value={newSupplier.name} onChange={e => setNewSupplier({ ...newSupplier, name: e.target.value })} placeholder="Supplier name" />
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Code *</label>
                  <input style={inputStyle} value={newSupplier.code} onChange={e => setNewSupplier({ ...newSupplier, code: e.target.value })} placeholder="e.g. ACME" />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Type</label>
                <select style={inputStyle} value={newSupplier.type} onChange={e => setNewSupplier({ ...newSupplier, type: e.target.value })}>
                  <option value="MANUFACTURER">Manufacturer</option>
                  <option value="DISTRIBUTOR">Distributor</option>
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Contact Name</label>
                  <input style={inputStyle} value={newSupplier.contactName} onChange={e => setNewSupplier({ ...newSupplier, contactName: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Email</label>
                  <input style={inputStyle} value={newSupplier.email} onChange={e => setNewSupplier({ ...newSupplier, email: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Phone</label>
                  <input style={inputStyle} value={newSupplier.phone} onChange={e => setNewSupplier({ ...newSupplier, phone: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Website</label>
                  <input style={inputStyle} value={newSupplier.website} onChange={e => setNewSupplier({ ...newSupplier, website: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>City</label>
                  <input style={inputStyle} value={newSupplier.city} onChange={e => setNewSupplier({ ...newSupplier, city: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>State</label>
                  <input style={inputStyle} value={newSupplier.state} onChange={e => setNewSupplier({ ...newSupplier, state: e.target.value })} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Categories (comma-separated slugs)</label>
                <input style={inputStyle} value={newSupplier.categories} onChange={e => setNewSupplier({ ...newSupplier, categories: e.target.value })} placeholder="doors, trim-millwork, windows" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Payment Terms</label>
                  <select style={inputStyle} value={newSupplier.paymentTerms} onChange={e => setNewSupplier({ ...newSupplier, paymentTerms: e.target.value })}>
                    <option value="NET_15">NET 15</option>
                    <option value="NET_30">NET 30</option>
                    <option value="NET_45">NET 45</option>
                    <option value="NET_60">NET 60</option>
                    <option value="COD">COD</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Lead Time (days)</label>
                  <input style={inputStyle} type="number" value={newSupplier.leadTimeDays} onChange={e => setNewSupplier({ ...newSupplier, leadTimeDays: e.target.value })} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 4 }}>Notes</label>
                <textarea style={{ ...inputStyle, resize: 'vertical' }} rows={2} value={newSupplier.notes} onChange={e => setNewSupplier({ ...newSupplier, notes: e.target.value })} placeholder="Strategic notes about this supplier..." />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setShowNewSupplier(false)} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #e5e7eb', backgroundColor: 'white', cursor: 'pointer' }}>Cancel</button>
              <button onClick={createSupplier} disabled={!newSupplier.name || !newSupplier.code} className="bg-signal" style={{ padding: '8px 20px', borderRadius: 8, color: 'white', border: 'none', fontWeight: 600, cursor: 'pointer', opacity: newSupplier.name && newSupplier.code ? 1 : 0.5 }}>Create Supplier</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ SUPPLIER DETAIL SHEET ═══
          Right-side slide-over via shared Sheet component (fixed inset-0 with
          right-aligned panel — always within viewport regardless of where the
          user clicked). Replaces the prior ad-hoc detail panes that could
          render offscreen. Shows full Supplier record fields. */}
      <Sheet
        open={!!selectedSupplier}
        onClose={() => setSelectedSupplier(null)}
        title={selectedSupplier?.name}
        subtitle={selectedSupplier ? `${selectedSupplier.type} · ${selectedSupplier.code}` : undefined}
        tabs={['details', 'raw']}
        raw={selectedSupplier ?? undefined}
        width="default"
      >
        {selectedSupplier && (
          <div className="space-y-4">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{
                padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                backgroundColor: selectedSupplier.type === 'MANUFACTURER' ? '#FEF3C7' : '#EBF5FF',
                color: selectedSupplier.type === 'MANUFACTURER' ? '#92400E' : '#0f2a3e',
              }}>{selectedSupplier.type}</span>
              <span style={{
                padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                backgroundColor: selectedSupplier.active ? '#DCFCE7' : '#FEE2E2',
                color: selectedSupplier.active ? '#166534' : '#991B1B',
              }}>{selectedSupplier.active ? 'Active' : 'Inactive'}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#6b7280', backgroundColor: '#f3f4f6', padding: '3px 8px', borderRadius: 4 }}>
                {selectedSupplier.code}
              </span>
            </div>

            <div>
              <h4 style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Contact</h4>
              <dl style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', fontSize: 13 }}>
                <dt style={{ color: '#6b7280' }}>Contact Name</dt>
                <dd style={{ color: '#111827' }}>{selectedSupplier.contactName || '—'}</dd>
                <dt style={{ color: '#6b7280' }}>Email</dt>
                <dd style={{ color: '#111827' }}>
                  {selectedSupplier.email ? (
                    <a href={`mailto:${selectedSupplier.email}`} style={{ color: '#0f2a3e', textDecoration: 'underline' }}>{selectedSupplier.email}</a>
                  ) : '—'}
                </dd>
                <dt style={{ color: '#6b7280' }}>Phone</dt>
                <dd style={{ color: '#111827' }}>
                  {selectedSupplier.phone ? (
                    <a href={`tel:${selectedSupplier.phone}`} style={{ color: '#0f2a3e', textDecoration: 'underline' }}>{selectedSupplier.phone}</a>
                  ) : '—'}
                </dd>
                <dt style={{ color: '#6b7280' }}>Website</dt>
                <dd style={{ color: '#111827' }}>
                  {selectedSupplier.website ? (
                    <a href={selectedSupplier.website} target="_blank" rel="noreferrer" style={{ color: '#0f2a3e', textDecoration: 'underline' }}>{selectedSupplier.website}</a>
                  ) : '—'}
                </dd>
              </dl>
            </div>

            <div>
              <h4 style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Address</h4>
              <dl style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', fontSize: 13 }}>
                <dt style={{ color: '#6b7280' }}>Street</dt>
                <dd style={{ color: '#111827' }}>{selectedSupplier.address || '—'}</dd>
                <dt style={{ color: '#6b7280' }}>City / State</dt>
                <dd style={{ color: '#111827' }}>
                  {[selectedSupplier.city, selectedSupplier.state].filter(Boolean).join(', ') || '—'}
                </dd>
                <dt style={{ color: '#6b7280' }}>ZIP</dt>
                <dd style={{ color: '#111827' }}>{selectedSupplier.zip || '—'}</dd>
              </dl>
            </div>

            <div>
              <h4 style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Categories Served</h4>
              {selectedSupplier.categories && selectedSupplier.categories.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selectedSupplier.categories.map(c => (
                    <span key={c} style={{
                      padding: '3px 10px', borderRadius: 99, fontSize: 11,
                      backgroundColor: '#f3f4f6', color: '#374151',
                    }}>{c}</span>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 13, color: '#9ca3af' }}>No categories listed</p>
              )}
            </div>

            <div>
              <h4 style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Commercial Terms</h4>
              <dl style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '6px 12px', fontSize: 13 }}>
                <dt style={{ color: '#6b7280' }}>Payment Terms</dt>
                <dd style={{ color: '#111827', fontWeight: 500 }}>{selectedSupplier.paymentTerms || 'NET_30'}</dd>
                <dt style={{ color: '#6b7280' }}>Lead Time</dt>
                <dd style={{ color: '#111827' }}>{selectedSupplier.leadTimeDays ?? 14} days</dd>
                <dt style={{ color: '#6b7280' }}>Min Order</dt>
                <dd style={{ color: '#111827' }}>
                  {typeof selectedSupplier.minOrderAmount === 'number' && selectedSupplier.minOrderAmount > 0
                    ? `$${selectedSupplier.minOrderAmount.toLocaleString()}`
                    : '—'}
                </dd>
                <dt style={{ color: '#6b7280' }}>Freight Policy</dt>
                <dd style={{ color: '#111827' }}>{selectedSupplier.freightPolicy || '—'}</dd>
              </dl>
            </div>

            <div>
              <h4 style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Performance</h4>
              <dl style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '6px 12px', fontSize: 13 }}>
                <dt style={{ color: '#6b7280' }}>Quality Rating</dt>
                <dd style={{ color: '#111827' }}>
                  {typeof selectedSupplier.qualityRating === 'number' && selectedSupplier.qualityRating > 0
                    ? `${selectedSupplier.qualityRating.toFixed(2)} / 5.00`
                    : 'Not rated'}
                </dd>
                <dt style={{ color: '#6b7280' }}>On-Time Rate</dt>
                <dd style={{ color: '#111827' }}>
                  {typeof selectedSupplier.onTimeRate === 'number' && selectedSupplier.onTimeRate > 0
                    ? `${(selectedSupplier.onTimeRate * 100).toFixed(0)}%`
                    : 'No history'}
                </dd>
                <dt style={{ color: '#6b7280' }}>Linked Products</dt>
                <dd style={{ color: '#111827', fontWeight: 600 }}>{selectedSupplier.productCount}</dd>
              </dl>
            </div>

            {selectedSupplier.notes && (
              <div>
                <h4 style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Notes</h4>
                <p style={{ fontSize: 13, color: '#374151', backgroundColor: '#f9fafb', padding: 12, borderRadius: 8, fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>
                  {selectedSupplier.notes}
                </p>
              </div>
            )}
          </div>
        )}
      </Sheet>

      {/* ═══ CATEGORY DETAIL SHEET ═══ */}
      <Sheet
        open={!!selectedCategory}
        onClose={() => setSelectedCategory(null)}
        title={selectedCategory?.name}
        subtitle={selectedCategory ? `Slug: ${selectedCategory.slug}` : undefined}
        tabs={['details', 'raw']}
        raw={selectedCategory ?? undefined}
        width="default"
      >
        {selectedCategory && (
          <div className="space-y-4">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                backgroundColor: selectedCategory.active ? '#DCFCE7' : '#FEE2E2',
                color: selectedCategory.active ? '#166534' : '#991B1B',
              }}>{selectedCategory.active ? 'Active' : 'Inactive'}</span>
              {selectedCategory.parentName && (
                <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, backgroundColor: '#f3f4f6', color: '#374151' }}>
                  Parent: {selectedCategory.parentName}
                </span>
              )}
            </div>

            <dl style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '6px 12px', fontSize: 13 }}>
              <dt style={{ color: '#6b7280' }}>Description</dt>
              <dd style={{ color: '#111827' }}>{selectedCategory.description || '—'}</dd>
              <dt style={{ color: '#6b7280' }}>Icon</dt>
              <dd style={{ color: '#111827', fontSize: 18 }}>{selectedCategory.icon || '—'}</dd>
              <dt style={{ color: '#6b7280' }}>Sort Order</dt>
              <dd style={{ color: '#111827' }}>{selectedCategory.sortOrder}</dd>
              <dt style={{ color: '#6b7280' }}>Target Margin</dt>
              <dd style={{ color: '#10B981', fontWeight: 600 }}>
                {Math.round((selectedCategory.marginTarget || 0.35) * 100)}%
              </dd>
              <dt style={{ color: '#6b7280' }}>Live Products</dt>
              <dd style={{ color: '#111827', fontWeight: 600 }}>{selectedCategory.liveProductCount || 0}</dd>
              {selectedCategory.children && selectedCategory.children.length > 0 && (
                <>
                  <dt style={{ color: '#6b7280' }}>Sub-categories</dt>
                  <dd style={{ color: '#111827' }}>{selectedCategory.children.length}</dd>
                </>
              )}
            </dl>
          </div>
        )}
      </Sheet>
    </div>
  )
}
