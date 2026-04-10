'use client'

import { useState, useEffect, useCallback } from 'react'

interface Supplier {
  id: string; name: string; code: string; type: string; country: string; region: string
  contactName: string; contactEmail: string; contactPhone: string; website: string
  address: string; city: string; state: string; zip: string; paymentTerms: string
  currency: string; minOrderValue: number; avgLeadTimeDays: number; shippingMethod: string
  dutyRate: number; freightCostPct: number; qualityRating: number; reliabilityScore: number
  onTimeDeliveryPct: number; categories: string[]; notes: string; status: string
  productCount: number; poCount: number; spend12mo: number
  createdAt: string
}

export default function VendorsPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<{ type: string; status: string; search: string }>({ type: '', status: 'ACTIVE', search: '' })
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<any>({
    name: '', code: '', type: 'DOMESTIC', country: 'US', region: '', contactName: '', contactEmail: '',
    contactPhone: '', website: '', address: '', city: '', state: '', zip: '', paymentTerms: 'NET_30',
    currency: 'USD', minOrderValue: 0, avgLeadTimeDays: 7, shippingMethod: '', dutyRate: 0,
    freightCostPct: 0, categories: [], notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [catInput, setCatInput] = useState('')

  const fetchSuppliers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filter.type) params.set('type', filter.type)
      if (filter.status) params.set('status', filter.status)
      if (filter.search) params.set('search', filter.search)
      const res = await fetch(`/api/ops/procurement/suppliers?${params}`)
      if (res.ok) { const d = await res.json(); setSuppliers(d.suppliers || []) }
    } catch (err) {
      console.error('[Vendors] Failed to load suppliers:', err)
    } finally { setLoading(false) }
  }, [filter])

  useEffect(() => {
    fetch('/api/ops/procurement/setup', { method: 'POST' }).then(() => fetchSuppliers())
  }, []) // eslint-disable-line

  useEffect(() => { fetchSuppliers() }, [fetchSuppliers])

  const saveSupplier = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/ops/procurement/suppliers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        setShowAdd(false)
        setForm({ name: '', code: '', type: 'DOMESTIC', country: 'US', region: '', contactName: '', contactEmail: '', contactPhone: '', website: '', address: '', city: '', state: '', zip: '', paymentTerms: 'NET_30', currency: 'USD', minOrderValue: 0, avgLeadTimeDays: 7, shippingMethod: '', dutyRate: 0, freightCostPct: 0, categories: [], notes: '' })
        fetchSuppliers()
      }
    } catch (err) {
      console.error('[Vendors] Failed to save supplier:', err)
    } finally { setSaving(false) }
  }

  const addCategory = () => {
    if (catInput.trim() && !form.categories.includes(catInput.trim())) {
      setForm({ ...form, categories: [...form.categories, catInput.trim()] })
      setCatInput('')
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1B4F72', margin: 0 }}>🏢 Supplier Management</h1>
          <p style={{ color: '#6B7280', fontSize: 14, marginTop: 4 }}>Manage domestic and overseas suppliers for procurement</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)}
          style={{ padding: '10px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#1B4F72', color: '#fff', fontWeight: 600, fontSize: 14 }}>
          + Add Supplier
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <input placeholder="Search suppliers..." value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, minWidth: 200 }} />
        <select value={filter.type} onChange={e => setFilter({ ...filter, type: e.target.value })}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14 }}>
          <option value="">All Types</option>
          <option value="DOMESTIC">Domestic</option>
          <option value="OVERSEAS">Overseas</option>
        </select>
        <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14 }}>
          <option value="ACTIVE">Active</option>
          <option value="ALL">All</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>

      {/* Add Supplier Form */}
      {showAdd && (
        <div style={{ background: '#fff', borderRadius: 12, border: '2px solid #1B4F72', padding: 24, marginBottom: 24 }}>
          <h2 style={{ margin: '0 0 20px', color: '#1B4F72', fontSize: 18 }}>Add New Supplier</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
            <Field label="Company Name *" value={form.name} onChange={v => setForm({ ...form, name: v })} />
            <Field label="Supplier Code" value={form.code} onChange={v => setForm({ ...form, code: v })} placeholder="Auto-generated" />
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Type *</label>
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14 }}>
                <option value="DOMESTIC">Domestic</option>
                <option value="OVERSEAS">Overseas</option>
              </select>
            </div>
            <Field label="Country" value={form.country} onChange={v => setForm({ ...form, country: v })} />
            <Field label="Region" value={form.region} onChange={v => setForm({ ...form, region: v })} placeholder="e.g. Asia, Europe" />
            <Field label="Contact Name" value={form.contactName} onChange={v => setForm({ ...form, contactName: v })} />
            <Field label="Email" value={form.contactEmail} onChange={v => setForm({ ...form, contactEmail: v })} />
            <Field label="Phone" value={form.contactPhone} onChange={v => setForm({ ...form, contactPhone: v })} />
            <Field label="Website" value={form.website} onChange={v => setForm({ ...form, website: v })} />
            <Field label="Address" value={form.address} onChange={v => setForm({ ...form, address: v })} />
            <Field label="City" value={form.city} onChange={v => setForm({ ...form, city: v })} />
            <Field label="State" value={form.state} onChange={v => setForm({ ...form, state: v })} />
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Payment Terms</label>
              <select value={form.paymentTerms} onChange={e => setForm({ ...form, paymentTerms: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14 }}>
                <option value="NET_30">Net 30</option><option value="NET_60">Net 60</option>
                <option value="NET_90">Net 90</option><option value="PREPAID">Prepaid</option>
                <option value="COD">COD</option><option value="LC">Letter of Credit</option>
              </select>
            </div>
            <Field label="Min Order Value ($)" value={form.minOrderValue} onChange={v => setForm({ ...form, minOrderValue: Number(v) })} type="number" />
            <Field label="Avg Lead Time (days)" value={form.avgLeadTimeDays} onChange={v => setForm({ ...form, avgLeadTimeDays: Number(v) })} type="number" />
            <Field label="Duty Rate (%)" value={form.dutyRate} onChange={v => setForm({ ...form, dutyRate: Number(v) })} type="number" />
            <Field label="Freight Cost (%)" value={form.freightCostPct} onChange={v => setForm({ ...form, freightCostPct: Number(v) })} type="number" />
          </div>

          {/* Categories */}
          <div style={{ marginTop: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Product Categories</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {form.categories.map((c: string, i: number) => (
                <span key={i} style={{ background: '#EBF5FB', color: '#1B4F72', padding: '4px 10px', borderRadius: 16, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {c}
                  <button onClick={() => setForm({ ...form, categories: form.categories.filter((_: string, j: number) => j !== i) })}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', fontSize: 14, padding: 0 }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={catInput} onChange={e => setCatInput(e.target.value)} placeholder="e.g. Trim, Hardware, MDF"
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addCategory())}
                style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, flex: 1 }} />
              <button onClick={addCategory} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#E67E22', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Add</button>
            </div>
          </div>

          {/* Notes */}
          <div style={{ marginTop: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, resize: 'vertical' }} />
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
            <button onClick={saveSupplier} disabled={saving || !form.name}
              style={{ padding: '10px 24px', borderRadius: 8, border: 'none', cursor: 'pointer', background: !form.name ? '#9CA3AF' : '#1B4F72', color: '#fff', fontWeight: 600 }}>
              {saving ? '⏳ Saving...' : 'Save Supplier'}
            </button>
            <button onClick={() => setShowAdd(false)}
              style={{ padding: '10px 24px', borderRadius: 8, border: '1px solid #D1D5DB', cursor: 'pointer', background: '#fff', color: '#374151' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Supplier List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>Loading suppliers...</div>
      ) : suppliers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, background: '#F9FAFB', borderRadius: 12 }}>
          <div style={{ fontSize: 48 }}>🏢</div>
          <h3 style={{ color: '#1B4F72' }}>No suppliers yet</h3>
          <p style={{ color: '#6B7280' }}>Add your first supplier to start building your procurement network.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {suppliers.map(s => (
            <div key={s.id} style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 16, color: '#111' }}>{s.name}</span>
                  <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: s.type === 'OVERSEAS' ? '#DBEAFE' : '#F3F4F6', color: s.type === 'OVERSEAS' ? '#1E40AF' : '#374151' }}>{s.type}</span>
                  <span style={{ fontSize: 12, color: '#6B7280', fontFamily: 'monospace' }}>{s.code}</span>
                </div>
                <div style={{ fontSize: 13, color: '#6B7280' }}>
                  {s.country}{s.contactName ? ` • ${s.contactName}` : ''}{s.contactEmail ? ` • ${s.contactEmail}` : ''} • Lead time: {s.avgLeadTimeDays}d
                </div>
                {s.categories?.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                    {s.categories.map((c, i) => (
                      <span key={i} style={{ background: '#EBF5FB', color: '#1B4F72', padding: '2px 8px', borderRadius: 12, fontSize: 11 }}>{c}</span>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#6B7280' }}>Products</div>
                  <div style={{ fontWeight: 700, fontSize: 18, color: '#1B4F72' }}>{s.productCount}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#6B7280' }}>POs</div>
                  <div style={{ fontWeight: 700, fontSize: 18, color: '#1B4F72' }}>{s.poCount}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#6B7280' }}>12mo Spend</div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: '#16A34A' }}>${Number(s.spend12mo || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {s.dutyRate > 0 && <span style={{ fontSize: 11, background: '#FEF3C7', color: '#92400E', padding: '2px 6px', borderRadius: 4 }}>Duty: {s.dutyRate}%</span>}
                  {s.freightCostPct > 0 && <span style={{ fontSize: 11, background: '#FEE2E2', color: '#991B1B', padding: '2px 6px', borderRadius: 4 }}>Freight: {s.freightCostPct}%</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type }: { label: string; value: any; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>{label}</label>
      <input type={type || 'text'} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14 }} />
    </div>
  )
}
