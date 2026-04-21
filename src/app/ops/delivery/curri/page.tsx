'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

// ──────────────────────────────────────────────────────────────────────────
// Curri Third-Party Delivery Integration
//
// Embeds Curri booking flow and tracks which deliveries go third-party
// vs in-house. Provides cost comparison and performance tracking.
//
// Curri (app.curri.com) is a third-party delivery service for building
// materials. Abel Lumber uses them for overflow capacity or when all
// in-house crews are deployed.
// ──────────────────────────────────────────────────────────────────────────

interface ThirdPartyDelivery {
  id: string
  deliveryNumber: string
  jobNumber: string
  builderName: string
  address: string
  provider: 'CURRI' | 'IN_HOUSE' | 'OTHER'
  curriBookingId: string | null
  status: string
  cost: number | null
  bookedAt: string | null
  deliveredAt: string | null
  trackingUrl: string | null
}

export default function CurriIntegrationPage() {
  const [activeTab, setActiveTab] = useState<'book' | 'tracking' | 'comparison'>('book')
  const [deliveries, setDeliveries] = useState<ThirdPartyDelivery[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    inHouseCount: 0,
    curriCount: 0,
    inHouseCostAvg: 0,
    curriCostAvg: 0,
    inHouseOnTime: 0,
    curriOnTime: 0,
  })

  useEffect(() => {
    loadDeliveryData()
  }, [])

  async function loadDeliveryData() {
    setLoading(true)
    try {
      const res = await fetch('/api/ops/delivery/tracking')
      if (res.ok) {
        const data = await res.json()
        const allDeliveries = data.deliveries || []
        setDeliveries(allDeliveries)

        // Calculate comparison stats
        const inHouse = allDeliveries.filter((d: any) => d.provider !== 'CURRI')
        const curri = allDeliveries.filter((d: any) => d.provider === 'CURRI')
        setStats({
          inHouseCount: inHouse.length,
          curriCount: curri.length,
          inHouseCostAvg: 0, // Would be calculated from actual cost data
          curriCostAvg: 0,
          inHouseOnTime: 0,
          curriOnTime: 0,
        })
      }
    } catch (err) {
      console.error('Failed to load deliveries:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#1e3a5f] text-white px-8 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <span>🚛</span> Curri — Third-Party Delivery
            </h1>
            <p className="text-blue-200 mt-2">
              Book overflow deliveries, track third-party shipments, compare costs
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/ops/delivery"
              className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm"
            >
              ← Delivery Center
            </Link>
            <Link
              href="/ops/fleet"
              className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm"
            >
              Fleet Hub
            </Link>
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="bg-white border-b border-gray-200 px-8">
        <div className="flex gap-1 -mb-px">
          {[
            { id: 'book' as const, label: 'Book Delivery', icon: '📦' },
            { id: 'tracking' as const, label: 'Track Shipments', icon: '📍' },
            { id: 'comparison' as const, label: 'Cost Comparison', icon: '📊' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-[#C6A24E] text-[#C6A24E]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <span className="mr-1.5">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8">
        {activeTab === 'book' && <BookingTab />}
        {activeTab === 'tracking' && (
          <TrackingTab deliveries={deliveries} loading={loading} />
        )}
        {activeTab === 'comparison' && (
          <ComparisonTab stats={stats} deliveries={deliveries} />
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Booking Tab — Embed Curri or link to their booking flow
// ──────────────────────────────────────────────────────────────────────────

function BookingTab() {
  const [showEmbed, setShowEmbed] = useState(false)

  return (
    <div className="space-y-6">
      {/* Quick Book Banner */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-700 rounded-xl p-8 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Book a Curri Delivery</h2>
            <p className="text-purple-200 mt-2 max-w-xl">
              When all in-house crews are deployed, use Curri for on-demand delivery.
              Curri specializes in building materials delivery with flatbed trucks.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <a
              href="https://app.curri.com/book"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white text-purple-700 hover:bg-purple-50 px-6 py-3 rounded-lg font-bold text-sm transition-colors text-center"
            >
              Open Curri Booking →
            </a>
            <button
              onClick={() => setShowEmbed(!showEmbed)}
              className="bg-white/20 hover:bg-white/30 text-white px-6 py-2 rounded-lg text-sm transition-colors"
            >
              {showEmbed ? 'Hide Embedded View' : 'Show Embedded View'}
            </button>
          </div>
        </div>
      </div>

      {/* Embedded Curri (iframe) */}
      {showEmbed && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Curri Booking Portal</span>
            <a
              href="https://app.curri.com/book"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#0f2a3e] hover:underline"
            >
              Open in new tab ↗
            </a>
          </div>
          <iframe
            src="https://app.curri.com/book"
            className="w-full border-0"
            style={{ height: '700px' }}
            title="Curri Delivery Booking"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      )}

      {/* Booking Checklist */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-bold text-[#1e3a5f] mb-4">Before You Book on Curri</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <CheckItem label="All in-house crews deployed for the day" />
            <CheckItem label="Delivery is time-sensitive (same/next day)" />
            <CheckItem label="Confirm pickup address (Abel warehouse)" />
            <CheckItem label="Confirm delivery address + builder contact" />
          </div>
          <div className="space-y-3">
            <CheckItem label="Specify materials and weight estimate" />
            <CheckItem label="Note any special requirements (crane, forklift)" />
            <CheckItem label="Get Curri booking ID after booking" />
            <CheckItem label="Log the booking in Aegis (Tracking tab)" />
          </div>
        </div>
      </div>

      {/* Log a Curri Booking */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-bold text-[#1e3a5f] mb-4">Log a Curri Booking in Aegis</h3>
        <p className="text-sm text-gray-600 mb-4">
          After booking on Curri, log it here so we can track third-party vs in-house delivery metrics.
        </p>
        <form
          className="grid grid-cols-2 gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            alert('Booking logged! (API endpoint coming soon)')
          }}
        >
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Job Number</label>
            <input
              type="text"
              placeholder="JOB-2026-0123"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Curri Booking ID</label>
            <input
              type="text"
              placeholder="CURRI-xxxxx"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Delivery Address</label>
            <input
              type="text"
              placeholder="123 Main St, City, TX 75001"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Estimated Cost</label>
            <input
              type="number"
              placeholder="$0.00"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              placeholder="Materials, special instructions..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              rows={2}
            />
          </div>
          <div className="col-span-2">
            <button
              type="submit"
              className="bg-[#0f2a3e] hover:bg-[#163d5c] text-white px-6 py-2 rounded-lg text-sm font-medium"
            >
              Log Curri Booking
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Tracking Tab
// ──────────────────────────────────────────────────────────────────────────

function TrackingTab({
  deliveries,
  loading,
}: {
  deliveries: ThirdPartyDelivery[]
  loading: boolean
}) {
  const [filter, setFilter] = useState<'all' | 'curri' | 'in-house'>('all')

  const filtered =
    filter === 'all'
      ? deliveries
      : filter === 'curri'
      ? deliveries.filter((d) => d.provider === 'CURRI')
      : deliveries.filter((d) => d.provider !== 'CURRI')

  return (
    <div className="space-y-6">
      {/* Filter */}
      <div className="flex items-center gap-3">
        {[
          { key: 'all' as const, label: 'All Deliveries' },
          { key: 'curri' as const, label: 'Curri (Third-Party)' },
          { key: 'in-house' as const, label: 'In-House' },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              filter === f.key
                ? 'bg-[#0f2a3e] text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-[#0f2a3e] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-4xl mb-3">📦</div>
          <h4 className="font-bold text-[#1e3a5f] mb-2">No Deliveries Found</h4>
          <p className="text-sm text-gray-500">
            {filter === 'curri'
              ? 'No Curri third-party deliveries logged yet. Book one from the Book tab.'
              : 'No deliveries found for today.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Delivery</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Job</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Provider</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Address</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{d.deliveryNumber}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {d.jobNumber} — {d.builderName}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        d.provider === 'CURRI'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {d.provider === 'CURRI' ? '🚛 Curri' : '🏠 In-House'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{d.status}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs truncate max-w-[200px]">
                    {d.address}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {d.cost ? `$${d.cost.toFixed(2)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Comparison Tab — In-House vs Third-Party
// ──────────────────────────────────────────────────────────────────────────

function ComparisonTab({
  stats,
  deliveries,
}: {
  stats: any
  deliveries: ThirdPartyDelivery[]
}) {
  return (
    <div className="space-y-6">
      <h3 className="font-bold text-[#1e3a5f]">In-House vs Third-Party Delivery Comparison</h3>

      <div className="grid grid-cols-2 gap-6">
        {/* In-House Card */}
        <div className="bg-white rounded-xl border-2 border-blue-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">🏠</span>
            <h4 className="font-bold text-[#1e3a5f] text-lg">In-House Delivery</h4>
          </div>
          <div className="space-y-3">
            <MetricRow label="Total Deliveries" value={`${stats.inHouseCount}`} />
            <MetricRow label="Avg Cost/Delivery" value={stats.inHouseCostAvg > 0 ? `$${stats.inHouseCostAvg.toFixed(2)}` : 'Tracking...'} />
            <MetricRow label="On-Time Rate" value={stats.inHouseOnTime > 0 ? `${stats.inHouseOnTime}%` : 'Tracking...'} />
            <MetricRow label="Fleet Control" value="Full" highlight />
            <MetricRow label="Photo Documentation" value="Yes" highlight />
            <MetricRow label="Real-time Tracking" value="With GPS" />
          </div>
        </div>

        {/* Curri Card */}
        <div className="bg-white rounded-xl border-2 border-purple-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">🚛</span>
            <h4 className="font-bold text-purple-800 text-lg">Curri (Third-Party)</h4>
          </div>
          <div className="space-y-3">
            <MetricRow label="Total Deliveries" value={`${stats.curriCount}`} />
            <MetricRow label="Avg Cost/Delivery" value={stats.curriCostAvg > 0 ? `$${stats.curriCostAvg.toFixed(2)}` : 'Tracking...'} />
            <MetricRow label="On-Time Rate" value={stats.curriOnTime > 0 ? `${stats.curriOnTime}%` : 'Tracking...'} />
            <MetricRow label="Fleet Control" value="Limited" />
            <MetricRow label="Photo Documentation" value="Via Curri App" />
            <MetricRow label="Real-time Tracking" value="Curri App" />
          </div>
        </div>
      </div>

      {/* When to Use Each */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h4 className="font-bold text-[#1e3a5f] mb-4">When to Use Each Option</h4>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h5 className="font-semibold text-blue-700 text-sm mb-2">Use In-House When:</h5>
            <ul className="space-y-1 text-sm text-gray-600">
              <li className="flex items-start gap-2"><span className="text-blue-500">•</span> Crew available and route makes sense</li>
              <li className="flex items-start gap-2"><span className="text-blue-500">•</span> Multiple stops in same area</li>
              <li className="flex items-start gap-2"><span className="text-blue-500">•</span> Need full photo documentation</li>
              <li className="flex items-start gap-2"><span className="text-blue-500">•</span> Builder requires Abel crew for install</li>
              <li className="flex items-start gap-2"><span className="text-blue-500">•</span> Cost per delivery is lower than Curri</li>
            </ul>
          </div>
          <div>
            <h5 className="font-semibold text-purple-700 text-sm mb-2">Use Curri When:</h5>
            <ul className="space-y-1 text-sm text-gray-600">
              <li className="flex items-start gap-2"><span className="text-purple-500">•</span> All in-house crews deployed</li>
              <li className="flex items-start gap-2"><span className="text-purple-500">•</span> Same-day / urgent delivery needed</li>
              <li className="flex items-start gap-2"><span className="text-purple-500">•</span> Remote jobsite out of normal route</li>
              <li className="flex items-start gap-2"><span className="text-purple-500">•</span> Small/single item delivery</li>
              <li className="flex items-start gap-2"><span className="text-purple-500">•</span> Weekend or after-hours delivery</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Shared Components
// ──────────────────────────────────────────────────────────────────────────

function CheckItem({ label }: { label: string }) {
  const [checked, setChecked] = useState(false)
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => setChecked(e.target.checked)}
        className="rounded border-gray-300"
      />
      <span className={`text-sm ${checked ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
        {label}
      </span>
    </label>
  )
}

function MetricRow({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="flex justify-between">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm font-medium ${highlight ? 'text-green-600' : 'text-gray-800'}`}>
        {value}
      </span>
    </div>
  )
}
