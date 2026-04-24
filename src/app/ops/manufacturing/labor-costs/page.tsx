'use client'
import { useState, useEffect, useCallback } from 'react'

interface CategoryRate {
  category: string
  productCount: number
  avgLaborCost: number
  avgOverheadCost: number
  avgTotalLabor: number
  hasLabor: number
  hasOverhead: number
  hasBOM: number
  avgEffectiveCost: number
  avgBasePrice: number
}

interface EditingRate {
  category: string
  laborCost: string
  overheadCost: string
}

interface TrimVendor {
  id: string
  name: string
  contactEmail: string | null
  contactPhone: string | null
  rates: Record<string, number> | null
  active: boolean
  notes: string | null
  createdAt: string
  updatedAt: string
}

type Tab = 'inhouse' | 'thirdparty'

export default function LaborCostsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('inhouse')

  const [rates, setRates] = useState<CategoryRate[]>([])
  const [editing, setEditing] = useState<Record<string, EditingRate>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  const fetchRates = useCallback(async () => {
    try {
      const res = await fetch('/api/ops/manufacturing/labor-rates')
      const data = await res.json()
      if (data.rates) {
        setRates(data.rates)
        // Initialize editing state from current values
        const edits: Record<string, EditingRate> = {}
        for (const r of data.rates) {
          edits[r.category] = {
            category: r.category,
            laborCost: (r.avgLaborCost || 0).toFixed(2),
            overheadCost: (r.avgOverheadCost || 0).toFixed(2),
          }
        }
        setEditing(edits)
      }
    } catch (e) {
      console.error('Failed to fetch rates:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRates() }, [fetchRates])

  const handleSave = async (category: string) => {
    const edit = editing[category]
    if (!edit) return

    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/ops/manufacturing/labor-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rates: [{
            category,
            laborCost: parseFloat(edit.laborCost) || 0,
            overheadCost: parseFloat(edit.overheadCost) || 0,
          }],
        }),
      })
      const data = await res.json()
      if (data.success) {
        setMessage({ type: 'success', text: `Updated ${category}: ${data.results?.[0]?.productsUpdated || 0} products` })
        fetchRates()
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save' })
      }
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAll = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const allRates = Object.values(editing).map(e => ({
        category: e.category,
        laborCost: parseFloat(e.laborCost) || 0,
        overheadCost: parseFloat(e.overheadCost) || 0,
      }))

      const res = await fetch('/api/ops/manufacturing/labor-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates: allRates }),
      })
      const data = await res.json()
      if (data.success) {
        setMessage({ type: 'success', text: `Updated ${data.totalProductsAffected} products across all categories` })
        fetchRates()
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save' })
      }
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  const updateEdit = (category: string, field: 'laborCost' | 'overheadCost', value: string) => {
    setEditing(prev => ({
      ...prev,
      [category]: { ...prev[category], [field]: value },
    }))
  }

  const getComponentCost = (rate: CategoryRate) => {
    return rate.avgEffectiveCost - (rate.avgLaborCost || 0) - (rate.avgOverheadCost || 0)
  }

  const getMarginWithoutLabor = (rate: CategoryRate) => {
    const compCost = getComponentCost(rate)
    if (rate.avgBasePrice <= 0) return null
    return ((rate.avgBasePrice - compCost) / rate.avgBasePrice * 100)
  }

  const getMarginWithLabor = (rate: CategoryRate, laborStr: string, overheadStr: string) => {
    const labor = parseFloat(laborStr) || 0
    const overhead = parseFloat(overheadStr) || 0
    const compCost = getComponentCost(rate)
    const fullCost = compCost + labor + overhead
    if (rate.avgBasePrice <= 0) return null
    return ((rate.avgBasePrice - fullCost) / rate.avgBasePrice * 100)
  }

  const hasChanges = (category: string) => {
    const rate = rates.find(r => r.category === category)
    const edit = editing[category]
    if (!rate || !edit) return false
    return (
      parseFloat(edit.laborCost).toFixed(2) !== (rate.avgLaborCost || 0).toFixed(2) ||
      parseFloat(edit.overheadCost).toFixed(2) !== (rate.avgOverheadCost || 0).toFixed(2)
    )
  }

  const anyChanges = rates.some(r => hasChanges(r.category))

  if (loading && activeTab === 'inhouse') {
    return (
      <div className="text-fg-muted" style={{ padding: 32, textAlign: 'center' }}>
        Loading labor cost data...
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 className="text-fg" style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>
            Labor &amp; Overhead Costs
          </h1>
          <p className="text-fg-muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
            Set in-house labor + overhead per category, and manage outsourced trim install vendor rates.
          </p>
        </div>
        {activeTab === 'inhouse' && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setShowHelp(!showHelp)}
              style={{
                padding: '8px 16px', borderRadius: 6, border: '1px solid #ddd',
                background: 'white', cursor: 'pointer', fontSize: 13, color: '#666',
              }}
            >
              {showHelp ? 'Hide' : 'How It Works'}
            </button>
            <button
              onClick={handleSaveAll}
              disabled={saving || !anyChanges}
              style={{
                padding: '8px 20px', borderRadius: 6, border: 'none',
                background: anyChanges ? '#C6A24E' : '#ccc',
                color: 'white', fontWeight: 600, cursor: anyChanges ? 'pointer' : 'default',
                fontSize: 14, opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving...' : 'Save All Changes'}
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #E5E7EB', marginBottom: 20 }}>
        <TabButton active={activeTab === 'inhouse'} onClick={() => setActiveTab('inhouse')}>
          In-House Labor &amp; Overhead
        </TabButton>
        <TabButton active={activeTab === 'thirdparty'} onClick={() => setActiveTab('thirdparty')}>
          Third-Party Trim Rates
        </TabButton>
      </div>

      {activeTab === 'inhouse' && (
        <>
          {/* Help Panel */}
          {showHelp && (
            <div style={{
              background: '#F0F7FF', border: '1px solid #BDD7EE', borderRadius: 8,
              padding: 20, marginBottom: 20, fontSize: 13, lineHeight: 1.7, color: '#333',
            }}>
              <strong style={{ color: '#0f2a3e' }}>How labor costs flow through the system:</strong>
              <div style={{ marginTop: 8 }}>
                Each assembled door's true cost = Component Costs (from BOM) + Labor Cost + Overhead Cost.
                This total is calculated by the <code>bom_cost()</code> function in the database and automatically used
                everywhere — pricing engine alerts, builder margin reports, executive dashboards, COGS calculations,
                and inventory valuations. When you change a rate here, every number across the platform updates in real time.
              </div>
              <div style={{ marginTop: 12 }}>
                <strong>Labor Cost</strong> = direct production wages allocated per door (assembly line workers).<br />
                <strong>Overhead Cost</strong> = indirect costs allocated per door (management, estimating, accounting, facility).
              </div>
            </div>
          )}

          {/* Message */}
          {message && (
            <div style={{
              padding: '10px 16px', borderRadius: 6, marginBottom: 16, fontSize: 13,
              background: message.type === 'success' ? '#D5F5E3' : '#FADBD8',
              color: message.type === 'success' ? '#1E8449' : '#C0392B',
              border: `1px solid ${message.type === 'success' ? '#82E0AA' : '#F1948A'}`,
            }}>
              {message.text}
            </div>
          )}

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#0f2a3e' }}>
                  {['Category', 'Products', 'Has BOM', 'Avg Component Cost', 'Labor Cost', 'Overhead Cost',
                    'Total Labor+OH', 'Avg Base Price', 'Margin w/o Labor', 'Margin w/ Labor', ''].map((h, i) => (
                    <th key={i} style={{
                      padding: '10px 12px', color: 'white', fontWeight: 600,
                      textAlign: i >= 2 ? 'right' : 'left', fontSize: 12,
                      borderBottom: '2px solid #0a1a28', whiteSpace: 'nowrap',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rates.map((rate, idx) => {
                  const edit = editing[rate.category]
                  if (!edit) return null
                  const laborVal = parseFloat(edit.laborCost) || 0
                  const overheadVal = parseFloat(edit.overheadCost) || 0
                  const totalLabor = laborVal + overheadVal
                  const marginWithout = getMarginWithoutLabor(rate)
                  const marginWith = getMarginWithLabor(rate, edit.laborCost, edit.overheadCost)
                  const marginDelta = (marginWithout !== null && marginWith !== null) ? marginWith - marginWithout : null
                  const changed = hasChanges(rate.category)

                  return (
                    <tr key={rate.category} style={{
                      background: changed ? '#FFF8E1' : idx % 2 === 0 ? 'white' : '#F8F9FA',
                      borderBottom: '1px solid #E5E7EB',
                    }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: '#0f2a3e' }}>
                        {rate.category}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#666' }}>
                        {rate.productCount}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <span style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 10,
                          background: rate.hasBOM > 0 ? '#D5F5E3' : '#F5F5F5',
                          color: rate.hasBOM > 0 ? '#1E8449' : '#999',
                        }}>
                          {rate.hasBOM}/{rate.productCount}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', color: '#333' }}>
                        ${(rate.avgEffectiveCost - (rate.avgLaborCost || 0) - (rate.avgOverheadCost || 0)).toFixed(2)}
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
                          <span style={{ color: '#999', fontSize: 12 }}>$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={edit.laborCost}
                            onChange={e => updateEdit(rate.category, 'laborCost', e.target.value)}
                            style={{
                              width: 80, padding: '5px 8px', border: '1px solid #ddd',
                              borderRadius: 4, textAlign: 'right', fontSize: 13,
                              fontFamily: 'monospace',
                              background: changed ? '#FFF3CD' : 'white',
                            }}
                          />
                        </div>
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
                          <span style={{ color: '#999', fontSize: 12 }}>$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={edit.overheadCost}
                            onChange={e => updateEdit(rate.category, 'overheadCost', e.target.value)}
                            style={{
                              width: 80, padding: '5px 8px', border: '1px solid #ddd',
                              borderRadius: 4, textAlign: 'right', fontSize: 13,
                              fontFamily: 'monospace',
                              background: changed ? '#FFF3CD' : 'white',
                            }}
                          />
                        </div>
                      </td>
                      <td style={{
                        padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace',
                        fontWeight: 600, color: totalLabor > 0 ? '#0f2a3e' : '#ccc',
                      }}>
                        ${totalLabor.toFixed(2)}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', color: '#333' }}>
                        {rate.avgBasePrice > 0 ? `$${rate.avgBasePrice.toFixed(2)}` : '—'}
                      </td>
                      <td style={{
                        padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace',
                        color: marginWithout === null ? '#ccc' : marginWithout < 20 ? '#C0392B' : marginWithout < 30 ? '#C6A24E' : '#27AE60',
                      }}>
                        {marginWithout !== null ? `${marginWithout.toFixed(1)}%` : '—'}
                      </td>
                      <td style={{
                        padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600,
                        color: marginWith === null ? '#ccc' : marginWith < 20 ? '#C0392B' : marginWith < 30 ? '#C6A24E' : '#1E8449',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                          <span>{marginWith !== null ? `${marginWith.toFixed(1)}%` : '—'}</span>
                          {marginDelta !== null && marginDelta < 0 && (
                            <span style={{
                              fontSize: 10, padding: '1px 5px', borderRadius: 4,
                              background: '#FADBD8', color: '#C0392B', fontWeight: 600,
                            }}>
                              {marginDelta.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        {changed && (
                          <button
                            onClick={() => handleSave(rate.category)}
                            disabled={saving}
                            style={{
                              padding: '4px 12px', borderRadius: 4, border: 'none',
                              background: '#27AE60', color: 'white', fontSize: 11,
                              fontWeight: 600, cursor: 'pointer',
                            }}
                          >
                            Save
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginTop: 24 }}>
            <SummaryCard
              label="Categories with Labor Set"
              value={`${rates.filter(r => (r.avgLaborCost || 0) > 0 || parseFloat(editing[r.category]?.laborCost || '0') > 0).length} / ${rates.length}`}
              color="#0f2a3e"
            />
            <SummaryCard
              label="Avg Labor + Overhead / Door"
              value={`$${(rates.reduce((s, r) => s + (r.avgLaborCost || 0) + (r.avgOverheadCost || 0), 0) / Math.max(rates.filter(r => (r.avgLaborCost || 0) > 0).length, 1)).toFixed(2)}`}
              color="#C6A24E"
            />
            <SummaryCard
              label="Products with BOM"
              value={`${rates.reduce((s, r) => s + r.hasBOM, 0)}`}
              sub={`of ${rates.reduce((s, r) => s + r.productCount, 0)} total`}
              color="#27AE60"
            />
            <SummaryCard
              label="Unsaved Changes"
              value={`${rates.filter(r => hasChanges(r.category)).length} categories`}
              color={anyChanges ? '#C0392B' : '#999'}
            />
          </div>
        </>
      )}

      {activeTab === 'thirdparty' && <TrimVendorsSection />}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 18px', border: 'none', background: 'transparent', cursor: 'pointer',
        fontSize: 13, fontWeight: 600,
        color: active ? '#0f2a3e' : '#888',
        borderBottom: active ? '2px solid #C6A24E' : '2px solid transparent',
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  )
}

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{
      background: 'white', borderRadius: 8, padding: 16,
      border: '1px solid #E5E7EB', borderLeft: `4px solid ${color}`,
    }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Third-Party Trim Vendor Management section
// ──────────────────────────────────────────────────────────────────────────

interface RateRow {
  key: string
  value: string
}

interface VendorFormState {
  id: string | null  // null = new vendor
  name: string
  contactEmail: string
  contactPhone: string
  notes: string
  rateRows: RateRow[]
}

function emptyForm(): VendorFormState {
  return {
    id: null,
    name: '',
    contactEmail: '',
    contactPhone: '',
    notes: '',
    rateRows: [{ key: '', value: '' }],
  }
}

function vendorToForm(v: TrimVendor): VendorFormState {
  const rates = v.rates && typeof v.rates === 'object' ? v.rates : {}
  const rateRows = Object.entries(rates).map(([key, val]) => ({
    key,
    value: typeof val === 'number' ? String(val) : String(val ?? ''),
  }))
  return {
    id: v.id,
    name: v.name,
    contactEmail: v.contactEmail || '',
    contactPhone: v.contactPhone || '',
    notes: v.notes || '',
    rateRows: rateRows.length ? rateRows : [{ key: '', value: '' }],
  }
}

function TrimVendorsSection() {
  const [vendors, setVendors] = useState<TrimVendor[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<VendorFormState>(emptyForm())

  const fetchVendors = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/ops/trim-vendors')
      const data = await res.json()
      if (Array.isArray(data.vendors)) {
        setVendors(data.vendors)
      } else if (data.error) {
        setMessage({ type: 'error', text: data.error })
      }
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Failed to load vendors' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchVendors() }, [fetchVendors])

  const openNew = () => {
    setForm(emptyForm())
    setModalOpen(true)
  }

  const openEdit = (v: TrimVendor) => {
    setForm(vendorToForm(v))
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setForm(emptyForm())
  }

  const updateField = <K extends keyof VendorFormState>(field: K, value: VendorFormState[K]) => {
    setForm(f => ({ ...f, [field]: value }))
  }

  const updateRateRow = (idx: number, field: 'key' | 'value', value: string) => {
    setForm(f => {
      const next = f.rateRows.slice()
      next[idx] = { ...next[idx], [field]: value }
      return { ...f, rateRows: next }
    })
  }

  const addRateRow = () => {
    setForm(f => ({ ...f, rateRows: [...f.rateRows, { key: '', value: '' }] }))
  }

  const removeRateRow = (idx: number) => {
    setForm(f => {
      const next = f.rateRows.filter((_, i) => i !== idx)
      return { ...f, rateRows: next.length ? next : [{ key: '', value: '' }] }
    })
  }

  const buildRatesPayload = (): Record<string, number> => {
    const rates: Record<string, number> = {}
    for (const row of form.rateRows) {
      const k = row.key.trim()
      if (!k) continue
      const n = parseFloat(row.value)
      if (!Number.isFinite(n)) continue
      rates[k] = n
    }
    return rates
  }

  const handleSubmit = async () => {
    const name = form.name.trim()
    if (!name) {
      setMessage({ type: 'error', text: 'Vendor name is required.' })
      return
    }

    setSaving(true)
    setMessage(null)
    try {
      const payload = {
        name,
        contactEmail: form.contactEmail.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
        notes: form.notes.trim() || null,
        rates: buildRatesPayload(),
      }

      const url = form.id
        ? `/api/ops/trim-vendors/${form.id}`
        : '/api/ops/trim-vendors'
      const method = form.id ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || 'Failed to save vendor' })
        return
      }
      setMessage({ type: 'success', text: form.id ? `Updated ${name}` : `Created ${name}` })
      closeModal()
      fetchVendors()
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Failed to save vendor' })
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async (v: TrimVendor) => {
    if (!confirm(`Deactivate ${v.name}? This is a soft delete — the vendor stays in history but is hidden from active lists.`)) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/ops/trim-vendors/${v.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || 'Failed to deactivate vendor' })
        return
      }
      setMessage({ type: 'success', text: `Deactivated ${v.name}` })
      fetchVendors()
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Failed to deactivate vendor' })
    } finally {
      setSaving(false)
    }
  }

  const handleReactivate = async (v: TrimVendor) => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/ops/trim-vendors/${v.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || 'Failed to reactivate vendor' })
        return
      }
      setMessage({ type: 'success', text: `Reactivated ${v.name}` })
      fetchVendors()
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Failed to reactivate vendor' })
    } finally {
      setSaving(false)
    }
  }

  const visibleVendors = showInactive ? vendors : vendors.filter(v => v.active)

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <div style={{ fontSize: 13, color: '#666' }}>
          Manage outsourced trim install vendors and their per-category rates. These rates are referenced when assigning trim work
          off the in-house line; they don't affect the in-house labor cost on Products.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ fontSize: 12, color: '#666', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
            />
            Show inactive
          </label>
          <button
            onClick={openNew}
            style={{
              padding: '8px 16px', borderRadius: 6, border: 'none',
              background: '#C6A24E', color: 'white', fontWeight: 600,
              cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap',
            }}
          >
            + Add Vendor
          </button>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div style={{
          padding: '10px 16px', borderRadius: 6, marginBottom: 16, fontSize: 13,
          background: message.type === 'success' ? '#D5F5E3' : '#FADBD8',
          color: message.type === 'success' ? '#1E8449' : '#C0392B',
          border: `1px solid ${message.type === 'success' ? '#82E0AA' : '#F1948A'}`,
        }}>
          {message.text}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#888', fontSize: 13 }}>
          Loading trim vendors...
        </div>
      ) : visibleVendors.length === 0 ? (
        <div style={{
          padding: '40px 20px', textAlign: 'center', color: '#666', fontSize: 13,
          background: '#F8F9FA', border: '1px dashed #D1D5DB', borderRadius: 8,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: '#0f2a3e' }}>No third-party trim vendors yet</div>
          <div>Add vendors like DFW Door, Texas Innovation, etc. to track outsourced trim install rates.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {visibleVendors.map(v => {
            const rateEntries = v.rates && typeof v.rates === 'object'
              ? Object.entries(v.rates).filter(([_, val]) => val !== null && val !== undefined)
              : []
            return (
              <div
                key={v.id}
                style={{
                  background: v.active ? 'white' : '#F8F9FA',
                  border: '1px solid #E5E7EB',
                  borderLeft: `4px solid ${v.active ? '#C6A24E' : '#999'}`,
                  borderRadius: 8,
                  padding: 16,
                  opacity: v.active ? 1 : 0.7,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#0f2a3e' }}>{v.name}</div>
                      {!v.active && (
                        <span style={{
                          fontSize: 10, padding: '2px 8px', borderRadius: 10,
                          background: '#E5E7EB', color: '#666', fontWeight: 600,
                          textTransform: 'uppercase', letterSpacing: 0.5,
                        }}>
                          Inactive
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#666', display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                      {v.contactEmail && <span>{v.contactEmail}</span>}
                      {v.contactPhone && <span>{v.contactPhone}</span>}
                      {!v.contactEmail && !v.contactPhone && <span style={{ color: '#aaa' }}>No contact info</span>}
                    </div>
                    {v.notes && (
                      <div style={{ fontSize: 12, color: '#666', marginTop: 6, fontStyle: 'italic' }}>
                        {v.notes}
                      </div>
                    )}
                    {rateEntries.length > 0 && (
                      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {rateEntries.map(([key, val]) => (
                          <span
                            key={key}
                            style={{
                              fontSize: 11, padding: '4px 10px', borderRadius: 4,
                              background: '#F0F7FF', border: '1px solid #BDD7EE', color: '#0f2a3e',
                              fontFamily: 'monospace',
                            }}
                          >
                            {key}: ${typeof val === 'number' ? val.toFixed(2) : String(val)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => openEdit(v)}
                      disabled={saving}
                      style={{
                        padding: '6px 12px', borderRadius: 4, border: '1px solid #ddd',
                        background: 'white', cursor: 'pointer', fontSize: 12, color: '#333',
                      }}
                    >
                      Edit
                    </button>
                    {v.active ? (
                      <button
                        onClick={() => handleDeactivate(v)}
                        disabled={saving}
                        style={{
                          padding: '6px 12px', borderRadius: 4, border: '1px solid #F1948A',
                          background: 'white', cursor: 'pointer', fontSize: 12, color: '#C0392B',
                        }}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        onClick={() => handleReactivate(v)}
                        disabled={saving}
                        style={{
                          padding: '6px 12px', borderRadius: 4, border: '1px solid #82E0AA',
                          background: 'white', cursor: 'pointer', fontSize: 12, color: '#1E8449',
                        }}
                      >
                        Reactivate
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 42, 62, 0.5)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            zIndex: 1000, padding: '60px 20px', overflow: 'auto',
          }}
          onClick={closeModal}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'white', borderRadius: 10, padding: 24,
              maxWidth: 720, width: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f2a3e' }}>
                {form.id ? 'Edit Trim Vendor' : 'Add Trim Vendor'}
              </h2>
              <button
                onClick={closeModal}
                style={{
                  background: 'transparent', border: 'none', fontSize: 22, color: '#888',
                  cursor: 'pointer', lineHeight: 1, padding: 0,
                }}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
              <FormField label="Vendor Name *">
                <input
                  type="text"
                  value={form.name}
                  onChange={e => updateField('name', e.target.value)}
                  placeholder="DFW Door"
                  style={inputStyle}
                />
              </FormField>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <FormField label="Contact Email">
                  <input
                    type="email"
                    value={form.contactEmail}
                    onChange={e => updateField('contactEmail', e.target.value)}
                    placeholder="ops@dfwdoor.com"
                    style={inputStyle}
                  />
                </FormField>
                <FormField label="Contact Phone">
                  <input
                    type="tel"
                    value={form.contactPhone}
                    onChange={e => updateField('contactPhone', e.target.value)}
                    placeholder="(214) 555-0100"
                    style={inputStyle}
                  />
                </FormField>
              </div>

              <FormField label="Notes">
                <textarea
                  value={form.notes}
                  onChange={e => updateField('notes', e.target.value)}
                  rows={2}
                  placeholder="Coverage area, terms, lead time, etc."
                  style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
                />
              </FormField>

              <div>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginBottom: 8,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#0f2a3e' }}>
                    Per-Category Rates
                  </div>
                  <button
                    onClick={addRateRow}
                    style={{
                      padding: '4px 10px', borderRadius: 4, border: '1px solid #ddd',
                      background: 'white', cursor: 'pointer', fontSize: 11, color: '#666',
                    }}
                  >
                    + Add Rate
                  </button>
                </div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                  e.g. <code>interior_prehung</code> → $45.00. Empty rows are dropped on save.
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {form.rateRows.map((row, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="text"
                        value={row.key}
                        onChange={e => updateRateRow(idx, 'key', e.target.value)}
                        placeholder="category_key"
                        style={{ ...inputStyle, flex: 1 }}
                      />
                      <span style={{ color: '#888' }}>$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.value}
                        onChange={e => updateRateRow(idx, 'value', e.target.value)}
                        placeholder="0.00"
                        style={{ ...inputStyle, width: 100, textAlign: 'right', fontFamily: 'monospace' }}
                      />
                      <button
                        onClick={() => removeRateRow(idx)}
                        style={{
                          padding: '6px 10px', borderRadius: 4, border: '1px solid #F1948A',
                          background: 'white', cursor: 'pointer', fontSize: 11, color: '#C0392B',
                        }}
                        aria-label="Remove rate"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button
                onClick={closeModal}
                disabled={saving}
                style={{
                  padding: '8px 16px', borderRadius: 6, border: '1px solid #ddd',
                  background: 'white', cursor: 'pointer', fontSize: 13, color: '#666',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving || !form.name.trim()}
                style={{
                  padding: '8px 20px', borderRadius: 6, border: 'none',
                  background: form.name.trim() ? '#C6A24E' : '#ccc',
                  color: 'white', fontWeight: 600,
                  cursor: form.name.trim() && !saving ? 'pointer' : 'default',
                  fontSize: 13, opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? 'Saving...' : form.id ? 'Save Changes' : 'Create Vendor'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #ddd',
  borderRadius: 4,
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#0f2a3e', marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  )
}
