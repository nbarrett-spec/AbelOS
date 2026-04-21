'use client'

import { useState, useEffect } from 'react'
import { useToast } from '@/contexts/ToastContext'

interface ShipDateGroup {
  shipDate: string
  orderNumber: string
  customer: string
  total: number
  productCount: number
}

interface OrderRow {
  orderNumber: string
  customer: string
  shipDate: string
  subtotal: number
  tax: number
  total: number
  status: string
  productCount: number
}

interface BomTotal {
  component: string
  totalNeeded: number
}

interface AdtDoor {
  orderNumber: string
  customer: string
  shipDate: string
  sku: string
  adtProductName: string
  qty: number
  unitPrice: number
  lineTotal: number
  bomNote: string | null
}

interface ForecastMeta {
  days: number
  orderCount: number
  totalAssembledDoors: number
  generatedAt: string
}

interface ForecastData {
  meta: ForecastMeta
  orders: OrderRow[]
  bomTotals: BomTotal[]
  adtDoors: AdtDoor[]
  byShipDate: ShipDateGroup[]
}

const fmt = (n: number) => (n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
const fmtCurrency = (n: number) => '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d: string) => {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

const STATUS_COLORS: Record<string, string> = {
  RECEIVED: 'bg-blue-100 text-blue-700',
  CONFIRMED: 'bg-indigo-100 text-indigo-700',
  IN_PRODUCTION: 'bg-yellow-100 text-yellow-800',
  READY_TO_SHIP: 'bg-green-100 text-green-700',
  SHIPPED: 'bg-emerald-100 text-emerald-700',
  DELIVERED: 'bg-teal-100 text-teal-700',
  COMPLETE: 'bg-gray-100 text-gray-600',
}

export default function ShippingForecastPage() {
  const { addToast } = useToast()
  const [data, setData] = useState<ForecastData | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState('14')
  const [downloading, setDownloading] = useState(false)
  const [tab, setTab] = useState<'overview' | 'orders' | 'bom' | 'doors'>('overview')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/ops/reports/shipping-forecast?format=json&days=${days}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [days])

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const res = await fetch(`/api/ops/reports/shipping-forecast/generate-xlsx?days=${days}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Shipping_Forecast_${days}d_${new Date().toISOString().split('T')[0]}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      addToast({ type: 'error', title: 'Download Failed', message: 'Failed to download report. Please try again.' })
    }
    setDownloading(false)
  }

  // Group byShipDate data
  const dateGroups: Record<string, ShipDateGroup[]> = {}
  if (data?.byShipDate) {
    data.byShipDate.forEach(row => {
      const key = row.shipDate?.split('T')[0] || 'Unknown'
      if (!dateGroups[key]) dateGroups[key] = []
      dateGroups[key].push(row)
    })
  }

  const totalRevenue = data?.orders?.reduce((s, o) => s + (o.total || 0), 0) || 0

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <a href="/ops/reports" className="text-sm text-gray-400 hover:text-[#0f2a3e] transition">&larr; Reports</a>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Shipping Forecast</h1>
          <p className="text-sm text-gray-500 mt-1">
            Orders shipping in the next {days} days with BOM requirements and assembled door counts
          </p>
        </div>
        <div className="flex items-center gap-3 self-start sm:self-auto">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {[
              { label: '7 Days', value: '7' },
              { label: '14 Days', value: '14' },
              { label: '21 Days', value: '21' },
              { label: '30 Days', value: '30' },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setDays(opt.value)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                  days === opt.value ? 'bg-white shadow text-[#0f2a3e]' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleDownload}
            disabled={downloading || loading || !data?.orders?.length}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition disabled:opacity-50"
            style={{ backgroundColor: '#0f2a3e' }}
          >
            {downloading ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <span>📥</span>
                Download XLSX
              </>
            )}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-[#0f2a3e] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !data || !data.orders?.length ? (
        <div className="bg-white rounded-xl border p-12 text-center">
          <span className="text-4xl mb-3 block">📦</span>
          <p className="text-gray-500 font-medium">No orders shipping in the next {days} days</p>
          <p className="text-gray-400 text-sm mt-1">Try expanding the date range</p>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
            <div className="bg-white rounded-xl border p-5">
              <p className="text-sm text-gray-500">Orders Shipping</p>
              <p className="text-3xl font-bold text-[#0f2a3e] mt-1">{fmt(data.meta.orderCount)}</p>
              <p className="text-xs text-gray-400 mt-1">Next {days} days</p>
            </div>
            <div className="bg-white rounded-xl border p-5">
              <p className="text-sm text-gray-500">Total Revenue</p>
              <p className="text-3xl font-bold text-[#C6A24E] mt-1">{fmtCurrency(totalRevenue)}</p>
              <p className="text-xs text-gray-400 mt-1">Across all orders</p>
            </div>
            <div className="bg-white rounded-xl border p-5">
              <p className="text-sm text-gray-500">Assembled Doors</p>
              <p className="text-3xl font-bold text-green-600 mt-1">{fmt(data.meta.totalAssembledDoors)}</p>
              <p className="text-xs text-gray-400 mt-1">ADT units to build</p>
            </div>
            <div className="bg-white rounded-xl border p-5">
              <p className="text-sm text-gray-500">BOM Components</p>
              <p className="text-3xl font-bold text-purple-600 mt-1">{fmt(data.bomTotals?.length || 0)}</p>
              <p className="text-xs text-gray-400 mt-1">Unique parts needed</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-6 w-fit">
            {[
              { key: 'overview' as const, label: 'By Ship Date' },
              { key: 'orders' as const, label: 'Orders' },
              { key: 'bom' as const, label: 'BOM Totals' },
              { key: 'doors' as const, label: 'ADT Doors' },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
                  tab === t.key ? 'bg-white shadow text-[#0f2a3e]' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {tab === 'overview' && (
            <div className="space-y-4">
              {Object.entries(dateGroups).map(([date, rows]) => {
                const dayTotal = rows.reduce((s, r) => s + (r.total || 0), 0)
                return (
                  <div key={date} className="bg-white rounded-xl border overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-[#0f2a3e] to-[#2980B9]">
                      <div className="flex items-center gap-3">
                        <span className="text-white text-lg">📅</span>
                        <span className="text-white font-semibold">{fmtDate(date)}</span>
                        <span className="bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">{rows.length} orders</span>
                      </div>
                      <span className="text-white font-bold">{fmtCurrency(dayTotal)}</span>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-left">
                          <th className="px-5 py-2 font-medium text-gray-600">Order #</th>
                          <th className="px-5 py-2 font-medium text-gray-600">Customer</th>
                          <th className="px-5 py-2 font-medium text-gray-600 text-right">Items</th>
                          <th className="px-5 py-2 font-medium text-gray-600 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={r.orderNumber} className={i % 2 ? 'bg-gray-50/50' : ''}>
                            <td className="px-5 py-2.5 font-medium text-[#0f2a3e]">{r.orderNumber}</td>
                            <td className="px-5 py-2.5 text-gray-700">{r.customer}</td>
                            <td className="px-5 py-2.5 text-gray-500 text-right">{r.productCount}</td>
                            <td className="px-5 py-2.5 font-semibold text-gray-900 text-right">{fmtCurrency(r.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              })}
            </div>
          )}

          {tab === 'orders' && (
            <div className="bg-white rounded-xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-5 py-3 font-medium text-gray-600">Order #</th>
                    <th className="px-5 py-3 font-medium text-gray-600">Customer</th>
                    <th className="px-5 py-3 font-medium text-gray-600">Ship Date</th>
                    <th className="px-5 py-3 font-medium text-gray-600">Status</th>
                    <th className="px-5 py-3 font-medium text-gray-600 text-right">Items</th>
                    <th className="px-5 py-3 font-medium text-gray-600 text-right">Subtotal</th>
                    <th className="px-5 py-3 font-medium text-gray-600 text-right">Tax</th>
                    <th className="px-5 py-3 font-medium text-gray-600 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((o, i) => (
                    <tr key={o.orderNumber} className={`${i % 2 ? 'bg-gray-50/50' : ''} hover:bg-blue-50/30 transition`}>
                      <td className="px-5 py-2.5">
                        <a href={`/ops/orders/${o.orderNumber}`} className="font-medium text-[#0f2a3e] hover:underline">
                          {o.orderNumber}
                        </a>
                      </td>
                      <td className="px-5 py-2.5 text-gray-700">{o.customer}</td>
                      <td className="px-5 py-2.5 text-gray-600">{fmtDate(o.shipDate)}</td>
                      <td className="px-5 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[o.status] || 'bg-gray-100 text-gray-600'}`}>
                          {o.status?.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-gray-500 text-right">{o.productCount}</td>
                      <td className="px-5 py-2.5 text-gray-600 text-right">{fmtCurrency(o.subtotal)}</td>
                      <td className="px-5 py-2.5 text-gray-600 text-right">{fmtCurrency(o.tax)}</td>
                      <td className="px-5 py-2.5 font-semibold text-gray-900 text-right">{fmtCurrency(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-[#0f2a3e]/5 font-bold">
                    <td className="px-5 py-3 text-[#0f2a3e]" colSpan={5}>Grand Total</td>
                    <td className="px-5 py-3 text-right">{fmtCurrency(data.orders.reduce((s, o) => s + (o.subtotal || 0), 0))}</td>
                    <td className="px-5 py-3 text-right">{fmtCurrency(data.orders.reduce((s, o) => s + (o.tax || 0), 0))}</td>
                    <td className="px-5 py-3 text-right text-[#0f2a3e]">{fmtCurrency(totalRevenue)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {tab === 'bom' && (
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b">
                <p className="text-sm text-gray-600">
                  Total components needed across all {data.meta.totalAssembledDoors} assembled doors
                </p>
              </div>
              {data.bomTotals?.length === 0 ? (
                <div className="p-8 text-center text-gray-400">No BOM components for this forecast window</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="px-5 py-3 font-medium text-gray-600">#</th>
                      <th className="px-5 py-3 font-medium text-gray-600">Component</th>
                      <th className="px-5 py-3 font-medium text-gray-600 text-right">Total Needed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.bomTotals.map((b, i) => (
                      <tr key={b.component} className={i % 2 ? 'bg-gray-50/50' : ''}>
                        <td className="px-5 py-2.5 text-gray-400">{i + 1}</td>
                        <td className="px-5 py-2.5 font-medium text-gray-800">{b.component}</td>
                        <td className="px-5 py-2.5 text-right font-semibold text-[#0f2a3e]">{fmt(b.totalNeeded)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'doors' && (
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="px-5 py-3 bg-amber-50 border-b">
                <p className="text-sm text-amber-700 font-medium">
                  {data.meta.totalAssembledDoors} assembled door units across {data.adtDoors?.length || 0} line items
                </p>
              </div>
              {!data.adtDoors?.length ? (
                <div className="p-8 text-center text-gray-400">No assembled doors in this forecast window</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="px-5 py-3 font-medium text-gray-600">Order #</th>
                      <th className="px-5 py-3 font-medium text-gray-600">Customer</th>
                      <th className="px-5 py-3 font-medium text-gray-600">Ship Date</th>
                      <th className="px-5 py-3 font-medium text-gray-600">SKU</th>
                      <th className="px-5 py-3 font-medium text-gray-600">Product</th>
                      <th className="px-5 py-3 font-medium text-gray-600 text-right">Qty</th>
                      <th className="px-5 py-3 font-medium text-gray-600 text-right">Unit Price</th>
                      <th className="px-5 py-3 font-medium text-gray-600 text-right">Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.adtDoors.map((d, i) => (
                      <tr key={`${d.orderNumber}-${d.sku}-${i}`} className={i % 2 ? 'bg-gray-50/50' : ''}>
                        <td className="px-5 py-2.5 font-medium text-[#0f2a3e]">{d.orderNumber}</td>
                        <td className="px-5 py-2.5 text-gray-700">{d.customer}</td>
                        <td className="px-5 py-2.5 text-gray-600">{fmtDate(d.shipDate)}</td>
                        <td className="px-5 py-2.5 font-mono text-xs text-gray-500">{d.sku}</td>
                        <td className="px-5 py-2.5 text-gray-800">{d.adtProductName}</td>
                        <td className="px-5 py-2.5 text-right font-semibold">{d.qty}</td>
                        <td className="px-5 py-2.5 text-right text-gray-600">{fmtCurrency(d.unitPrice)}</td>
                        <td className="px-5 py-2.5 text-right font-semibold text-gray-900">{fmtCurrency(d.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-amber-50 font-bold">
                      <td className="px-5 py-3 text-amber-800" colSpan={5}>Total</td>
                      <td className="px-5 py-3 text-right">{fmt(data.adtDoors.reduce((s, d) => s + (d.qty || 0), 0))}</td>
                      <td className="px-5 py-3" />
                      <td className="px-5 py-3 text-right text-amber-800">
                        {fmtCurrency(data.adtDoors.reduce((s, d) => s + (d.lineTotal || 0), 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
