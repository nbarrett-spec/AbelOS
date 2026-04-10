'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

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
  city: string | null
  state: string | null
  categories: string[]
  paymentTerms: string
  leadTimeDays: number
  minOrderAmount: number
  qualityRating: number
  onTimeRate: number
  active: boolean
  notes: string | null
  productCount: number
}

type Tab = 'categories' | 'suppliers'

export default function CatalogManagementPage() {
  const [tab, setTab] = useState<Tab>('categories')
  const [categories, setCategories] = useState<Category[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [supplierStats, setSupplierStats] = useState({ total: 0, activeCount: 0, manufacturers: 0, distributors: 0 })
  const [loading, setLoading] = useState(true)
  const [migrationRequired, setMigrationRequired] = useState(false)
  const [expandedCat, setExpandedCat] = useState<string | null>(null)
  const [supplierSearch, setSupplierSearch] = useState('')
  const [supplierType, setSupplierType] = useState('')

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
      } else {
        alert('Error: ' + (data.error || 'Failed to create'))
      }
    } catch (err) {
      alert('Failed to create category')
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
      } else {
        alert('Error: ' + (data.error || 'Failed to create'))
      }
    } catch (err) {
      alert('Failed to create supplier')
    }
  }

  async function runMigration() {
    if (!confirm('This will create ProductCategory, Supplier, and SupplierProduct tables. Continue?')) return
    try {
      const resp = await fetch('/api/ops/migrate/product-expansion', { method: 'POST' })
      const data = await resp.json()
      if (data.success) {
        alert(`Migration complete: ${data.message}`)
        setMigrationRequired(false)
        loadCategories()
        loadSuppliers()
      } else {
        alert('Migration had issues: ' + data.message)
      }
    } catch (err) {
      alert('Migration failed')
    }
  }

  // ── MIGRATION REQUIRED STATE ──
  if (migrationRequired) {
    return (
      <div style={{ padding: 32, maxWidth: 800, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f2937', marginBottom: 8 }}>Catalog Management</h1>
        <div style={{
          marginTop: 32, padding: 40, backgroundColor: 'white', borderRadius: 16,
          border: '2px dashed #E67E22', textAlign: 'center',
        }}>
          <p style={{ fontSize: 48, marginBottom: 12 }}>🔧</p>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1f2937', marginBottom: 8 }}>Product Expansion Migration Required</h2>
          <p style={{ fontSize: 14, color: '#6b7280', maxWidth: 500, margin: '0 auto 24px' }}>
            The ProductCategory and Supplier tables haven&apos;t been created yet.
            Run the product expansion migration to set up categories, suppliers, and the builder application system.
          </p>
          <button
            onClick={runMigration}
            style={{
              padding: '12px 32px', borderRadius: 12, backgroundColor: '#E67E22',
              color: 'white', border: 'none', fontSize: 15, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Run Product Expansion Migration
          </button>
        </div>
      </div>
    )
  }

  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db',
    fontSize: 14, outline: 'none', fontFamily: 'inherit',
  } as const

  return (
    <div style={{ padding: 32, maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f2937' }}>Catalog Management</h1>
          <p style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>
            Manage product categories, suppliers, and catalog structure
          </p>
        </div>
        <Link href="/ops/products" style={{
          padding: '8px 16px', borderRadius: 8, backgroundColor: '#1B4F72', color: 'white',
          fontSize: 13, fontWeight: 500, textDecoration: 'none',
        }}>
          View Products
        </Link>
      </div>

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
              style={{
                padding: '8px 20px', borderRadius: 8, backgroundColor: '#E67E22', color: 'white',
                border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              + Add Category
            </button>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>Loading...</div>
          ) : categories.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, backgroundColor: 'white', borderRadius: 12, border: '1px solid #e5e7eb' }}>
              <p style={{ fontSize: 18, fontWeight: 600, color: '#1f2937' }}>No categories found</p>
              <p style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>Run the product expansion migration to seed categories</p>
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
                          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1f2937' }}>{cat.name}</h3>
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
                        <p style={{ fontSize: 18, fontWeight: 700, color: '#1B4F72' }}>{cat.liveProductCount || 0}</p>
                        <p style={{ fontSize: 11, color: '#9ca3af' }}>Products</p>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <p style={{ fontSize: 18, fontWeight: 700, color: '#10B981' }}>{Math.round((cat.marginTarget || 0.35) * 100)}%</p>
                        <p style={{ fontSize: 11, color: '#9ca3af' }}>Target Margin</p>
                      </div>
                      {cat.children && cat.children.length > 0 && (
                        <div style={{ textAlign: 'center' }}>
                          <p style={{ fontSize: 14, fontWeight: 600, color: '#6b7280' }}>{cat.children.length} sub</p>
                          <span style={{ fontSize: 16, color: '#9ca3af', transform: expandedCat === cat.id ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform 0.2s' }}>▼</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Sub-categories */}
                  {expandedCat === cat.id && cat.children && cat.children.length > 0 && (
                    <div style={{ borderTop: '1px solid #f3f4f6', padding: '8px 20px 16px 56px' }}>
                      {cat.children.map(sub => (
                        <div key={sub.id} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '10px 16px', borderRadius: 8, marginTop: 4,
                          backgroundColor: '#f9fafb',
                        }}>
                          <div>
                            <p style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{sub.name}</p>
                            <p style={{ fontSize: 12, color: '#9ca3af' }}>{sub.description}</p>
                          </div>
                          <p style={{ fontSize: 14, fontWeight: 600, color: '#1B4F72' }}>{sub.liveProductCount || 0} products</p>
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
              { label: 'Total Suppliers', value: supplierStats.total, color: '#1B4F72' },
              { label: 'Active', value: supplierStats.activeCount, color: '#10B981' },
              { label: 'Manufacturers', value: supplierStats.manufacturers, color: '#E67E22' },
              { label: 'Distributors', value: supplierStats.distributors, color: '#6366F1' },
            ].map(s => (
              <div key={s.label} style={{ padding: 16, backgroundColor: 'white', borderRadius: 12, border: '1px solid #e5e7eb' }}>
                <p style={{ fontSize: 26, fontWeight: 700, color: s.color }}>{s.value}</p>
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
              style={{
                padding: '8px 20px', borderRadius: 8, backgroundColor: '#E67E22', color: 'white',
                border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginLeft: 'auto',
              }}
            >
              + Add Supplier
            </button>
          </div>

          {/* Supplier Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 12 }}>
            {suppliers.map(sup => (
              <div key={sup.id} style={{
                padding: 20, backgroundColor: 'white', borderRadius: 12, border: '1px solid #e5e7eb',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1f2937' }}>{sup.name}</h3>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                      backgroundColor: sup.type === 'MANUFACTURER' ? '#FEF3C7' : '#EBF5FF',
                      color: sup.type === 'MANUFACTURER' ? '#92400E' : '#1B4F72',
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
            <div style={{ textAlign: 'center', padding: 60, backgroundColor: 'white', borderRadius: 12, border: '1px solid #e5e7eb' }}>
              <p style={{ fontSize: 18, fontWeight: 600, color: '#1f2937' }}>No suppliers found</p>
            </div>
          )}
        </div>
      )}

      {/* ═══ NEW CATEGORY MODAL ═══ */}
      {showNewCat && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 32, maxWidth: 500, width: '100%' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>New Product Category</h3>
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
              <button onClick={createCategory} disabled={!newCat.name} style={{ padding: '8px 20px', borderRadius: 8, backgroundColor: '#E67E22', color: 'white', border: 'none', fontWeight: 600, cursor: 'pointer', opacity: newCat.name ? 1 : 0.5 }}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ NEW SUPPLIER MODAL ═══ */}
      {showNewSupplier && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ backgroundColor: 'white', borderRadius: 16, padding: 32, maxWidth: 560, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>New Supplier</h3>
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
              <button onClick={createSupplier} disabled={!newSupplier.name || !newSupplier.code} style={{ padding: '8px 20px', borderRadius: 8, backgroundColor: '#E67E22', color: 'white', border: 'none', fontWeight: 600, cursor: 'pointer', opacity: newSupplier.name && newSupplier.code ? 1 : 0.5 }}>Create Supplier</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
