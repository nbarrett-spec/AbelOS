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

export default function LaborCostsPage() {
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

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: '#666' }}>
        Loading labor cost data...
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1B4F72', margin: 0 }}>
            Labor &amp; Overhead Costs
          </h1>
          <p style={{ color: '#666', margin: '6px 0 0', fontSize: 14 }}>
            Set labor and overhead costs per category. These flow into BOM cost calculations, pricing engine, and all margin reports.
          </p>
        </div>
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
              background: anyChanges ? '#E67E22' : '#ccc',
              color: 'white', fontWeight: 600, cursor: anyChanges ? 'pointer' : 'default',
              fontSize: 14, opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving...' : 'Save All Changes'}
          </button>
        </div>
      </div>

      {/* Help Panel */}
      {showHelp && (
        <div style={{
          background: '#F0F7FF', border: '1px solid #BDD7EE', borderRadius: 8,
          padding: 20, marginBottom: 20, fontSize: 13, lineHeight: 1.7, color: '#333',
        }}>
          <strong style={{ color: '#1B4F72' }}>How labor costs flow through the system:</strong>
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
            <tr style={{ background: '#1B4F72' }}>
              {['Category', 'Products', 'Has BOM', 'Avg Component Cost', 'Labor Cost', 'Overhead Cost',
                'Total Labor+OH', 'Avg Base Price', 'Margin w/o Labor', 'Margin w/ Labor', ''].map((h, i) => (
                <th key={i} style={{
                  padding: '10px 12px', color: 'white', fontWeight: 600,
                  textAlign: i >= 2 ? 'right' : 'left', fontSize: 12,
                  borderBottom: '2px solid #154360', whiteSpace: 'nowrap',
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
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: '#1B4F72' }}>
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
                    fontWeight: 600, color: totalLabor > 0 ? '#1B4F72' : '#ccc',
                  }}>
                    ${totalLabor.toFixed(2)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', color: '#333' }}>
                    {rate.avgBasePrice > 0 ? `$${rate.avgBasePrice.toFixed(2)}` : '—'}
                  </td>
                  <td style={{
                    padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace',
                    color: marginWithout === null ? '#ccc' : marginWithout < 20 ? '#C0392B' : marginWithout < 30 ? '#E67E22' : '#27AE60',
                  }}>
                    {marginWithout !== null ? `${marginWithout.toFixed(1)}%` : '—'}
                  </td>
                  <td style={{
                    padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600,
                    color: marginWith === null ? '#ccc' : marginWith < 20 ? '#C0392B' : marginWith < 30 ? '#E67E22' : '#1E8449',
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
          color="#1B4F72"
        />
        <SummaryCard
          label="Avg Labor + Overhead / Door"
          value={`$${(rates.reduce((s, r) => s + (r.avgLaborCost || 0) + (r.avgOverheadCost || 0), 0) / Math.max(rates.filter(r => (r.avgLaborCost || 0) > 0).length, 1)).toFixed(2)}`}
          color="#E67E22"
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
    </div>
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
