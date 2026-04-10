'use client'

import { useEffect, useState } from 'react'

const NAVY = '#1B4F72'
const ORANGE = '#E67E22'

interface ForecastProduct {
  productId: string
  name: string
  sku: string
  category: string
  stockQuantity: number
  reorderPoint: number
  predictedDemand: number
  pipelineDemand: number
  totalExpectedDemand: number
  daysOfStock: number
  willStockOut: boolean
  needsReorder: boolean
  cost: number
  basePrice: number
  reorderValue: number
  signal: string
  demand90Days: number
}

interface AutoPO {
  id: string
  vendorName: string
  status: string
  estimatedTotal: number
  itemCount: number
  reason: string
  createdAt: string
}

export default function InventoryForecastPage() {
  const [forecasts, setForecasts] = useState<ForecastProduct[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [pos, setPos] = useState<AutoPO[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState(30)
  const [filter, setFilter] = useState<string>('all') // all, critical, warning, healthy
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    loadData()
  }, [period])

  const loadData = async () => {
    setLoading(true)
    try {
      const [forecastRes, poRes] = await Promise.all([
        fetch(`/api/agent-hub/inventory/forecast?period=${period}`),
        fetch('/api/agent-hub/inventory/auto-po'),
      ])

      if (forecastRes.ok) {
        const data = await forecastRes.json()
        setForecasts(data.forecasts || [])
        setSummary(data.summary || null)
      }
      if (poRes.ok) {
        const poData = await poRes.json()
        setPos(poData.data || [])
      }
    } catch (err) {
      console.error('Failed to load forecast data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleGeneratePOs = async () => {
    setGenerating(true)
    setMessage('')
    try {
      const res = await fetch('/api/agent-hub/inventory/auto-po', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      setMessage(`Generated ${data.posGenerated} PO recommendations ($${data.totalValue?.toFixed(2) || '0'} total)`)
      loadData()
    } catch (err) {
      setMessage('Failed to generate POs')
    } finally {
      setGenerating(false)
    }
  }

  const filtered = filter === 'all' ? forecasts : forecasts.filter(f => f.signal === filter.toUpperCase())

  const signalColor = (signal: string) => {
    switch (signal) {
      case 'CRITICAL': return '#c0392b'
      case 'WARNING': return ORANGE
      case 'WATCH': return '#f39c12'
      default: return '#27ae60'
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '18px', color: '#666' }}>Loading inventory forecast...</div>
      </div>
    )
  }

  return (
    <div style={{ padding: '0', minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <div style={{ backgroundColor: NAVY, color: 'white', padding: '30px 40px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '28px', fontWeight: 'bold', margin: '0 0 8px 0' }}>
              Predictive Inventory
            </h1>
            <p style={{ fontSize: '14px', color: '#ccc', margin: '0' }}>
              Demand forecasting, stock-out predictions, and automated purchase order recommendations
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <select
              value={period}
              onChange={(e) => setPeriod(Number(e.target.value))}
              style={{ padding: '8px 12px', borderRadius: '4px', border: 'none', fontSize: '14px' }}
            >
              <option value={30}>30-Day Forecast</option>
              <option value={60}>60-Day Forecast</option>
              <option value={90}>90-Day Forecast</option>
            </select>
            <button
              onClick={handleGeneratePOs}
              disabled={generating}
              style={{
                backgroundColor: ORANGE,
                color: 'white',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '4px',
                cursor: generating ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: 'bold',
                opacity: generating ? 0.6 : 1,
              }}
            >
              {generating ? 'Generating...' : 'Generate PO Recommendations'}
            </button>
          </div>
        </div>
      </div>

      {message && (
        <div style={{
          backgroundColor: '#d4edda', color: '#155724', padding: '12px 40px',
          marginBottom: '20px', borderLeft: '4px solid #28a745',
        }}>
          {message}
        </div>
      )}

      {/* Summary Cards */}
      <div style={{ padding: '0 40px 20px', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '15px' }}>
        {[
          { label: 'Total Products', value: summary?.totalProducts || 0, color: NAVY },
          { label: 'Critical (Stock Out)', value: summary?.critical || 0, color: '#c0392b' },
          { label: 'Warning (Low Stock)', value: summary?.warning || 0, color: ORANGE },
          { label: 'Healthy', value: summary?.healthy || 0, color: '#27ae60' },
          { label: 'Reorder Value', value: `$${(summary?.totalReorderValue || 0).toLocaleString()}`, color: NAVY },
        ].map((card, i) => (
          <div key={i} style={{
            backgroundColor: 'white', border: '1px solid #ddd', borderRadius: '4px', padding: '20px',
          }}>
            <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', marginBottom: '8px' }}>
              {card.label}
            </div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: card.color }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div style={{ padding: '0 40px 15px', display: 'flex', gap: '8px' }}>
        {['all', 'critical', 'warning', 'watch', 'healthy'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '8px 16px', borderRadius: '4px', border: '1px solid #ddd',
              backgroundColor: filter === f ? NAVY : 'white',
              color: filter === f ? 'white' : '#333',
              cursor: 'pointer', fontSize: '13px', fontWeight: '500',
              textTransform: 'capitalize',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Forecast Table */}
      <div style={{ padding: '0 40px 20px' }}>
        <div style={{ backgroundColor: 'white', border: '1px solid #ddd', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f9f9f9', borderBottom: '2px solid #ddd' }}>
                  {['Signal', 'SKU', 'Product', 'Category', 'Stock', 'Reorder Pt', `${period}d Demand`, 'Pipeline', 'Days Left', 'Reorder $'].map(h => (
                    <th key={h} style={{ padding: '12px 10px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#666' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map(f => (
                  <tr key={f.productId} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '10px' }}>
                      <span style={{
                        display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%',
                        backgroundColor: signalColor(f.signal),
                      }} />
                      <span style={{ marginLeft: '6px', fontSize: '11px', color: signalColor(f.signal), fontWeight: '600' }}>
                        {f.signal}
                      </span>
                    </td>
                    <td style={{ padding: '10px', fontSize: '12px', fontFamily: 'monospace', color: '#666' }}>{f.sku}</td>
                    <td style={{ padding: '10px', fontSize: '13px', fontWeight: '500', maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.name}
                    </td>
                    <td style={{ padding: '10px', fontSize: '12px' }}>{f.category}</td>
                    <td style={{ padding: '10px', fontSize: '13px', fontWeight: '600', color: f.stockQuantity <= f.reorderPoint ? '#c0392b' : NAVY }}>
                      {f.stockQuantity}
                    </td>
                    <td style={{ padding: '10px', fontSize: '13px', color: '#666' }}>{f.reorderPoint}</td>
                    <td style={{ padding: '10px', fontSize: '13px', fontWeight: '500' }}>{f.predictedDemand}</td>
                    <td style={{ padding: '10px', fontSize: '13px', color: ORANGE }}>{f.pipelineDemand}</td>
                    <td style={{
                      padding: '10px', fontSize: '13px', fontWeight: '600',
                      color: f.daysOfStock < 30 ? '#c0392b' : f.daysOfStock < 60 ? ORANGE : '#27ae60',
                    }}>
                      {f.daysOfStock >= 999 ? '∞' : f.daysOfStock}
                    </td>
                    <td style={{ padding: '10px', fontSize: '13px', color: NAVY }}>
                      {f.reorderValue > 0 ? `$${f.reorderValue.toFixed(0)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>
              No products match the current filter
            </div>
          )}
        </div>
      </div>

      {/* Auto PO Recommendations */}
      <div style={{ padding: '0 40px 40px' }}>
        <div style={{ backgroundColor: 'white', border: '1px solid #ddd', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{ padding: '20px', borderBottom: '1px solid #eee' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0, color: NAVY }}>
              Purchase Order Recommendations
            </h2>
          </div>
          {pos.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>
              No PO recommendations yet. Click "Generate PO Recommendations" above.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9f9f9', borderBottom: '2px solid #ddd' }}>
                    {['Vendor', 'Items', 'Est. Total', 'Status', 'Created', 'Reason'].map(h => (
                      <th key={h} style={{ padding: '12px 15px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#666' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pos.map(po => (
                    <tr key={po.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '12px 15px', fontSize: '13px', fontWeight: '500', color: NAVY }}>{po.vendorName}</td>
                      <td style={{ padding: '12px 15px', fontSize: '13px' }}>{po.itemCount}</td>
                      <td style={{ padding: '12px 15px', fontSize: '13px', fontWeight: '600' }}>${po.estimatedTotal.toFixed(2)}</td>
                      <td style={{ padding: '12px 15px' }}>
                        <span style={{
                          padding: '3px 8px', borderRadius: '3px', fontSize: '11px', fontWeight: '600',
                          backgroundColor: po.status === 'RECOMMENDED' ? '#fff3cd' : po.status === 'APPROVED' ? '#d4edda' : '#cce5ff',
                          color: po.status === 'RECOMMENDED' ? '#856404' : po.status === 'APPROVED' ? '#155724' : '#004085',
                        }}>
                          {po.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px 15px', fontSize: '12px', color: '#666' }}>
                        {new Date(po.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '12px 15px', fontSize: '12px', color: '#666', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {po.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
