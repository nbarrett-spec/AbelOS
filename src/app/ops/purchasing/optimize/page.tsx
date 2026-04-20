'use client';

import { useState, useEffect } from 'react';

const TABS = [
  { id: 'dashboard', label: 'Overview', icon: '📊' },
  { id: 'vendor-comparison', label: 'Vendor Comparison', icon: '⚖️' },
  { id: 'vendor-scorecard', label: 'Vendor Scorecard', icon: '📋' },
  { id: 'consolidation', label: 'PO Consolidation', icon: '📦' },
  { id: 'spend-analysis', label: 'Spend Analysis', icon: '💰' },
];

function fmt$(v: any): string { const n = Number(v); return isNaN(n) ? '$0' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n); }
function fmt$2(v: any): string { const n = Number(v); return isNaN(n) ? '$0.00' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n); }
function fmtN(v: any): string { const n = Number(v); return isNaN(n) ? '0' : n.toLocaleString(); }

export default function PurchasingOptimizePage() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  useEffect(() => { loadTab(activeTab); }, [activeTab]);

  const loadTab = async (tab: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ops/purchasing/optimize?report=${tab}`);
      if (res.ok) setData(await res.json());
    } catch (e) { console.error('Load error:', e); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#1e3a5f] text-white px-8 py-8">
        <h1 className="text-3xl font-bold">Purchasing Optimization</h1>
        <p className="text-blue-100 mt-2">Vendor intelligence, cost reduction, and procurement efficiency</p>
      </div>
      <div className="bg-white border-b border-gray-200 px-8">
        <div className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id ? 'border-[#C9822B] text-[#C9822B]' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              <span className="mr-1">{tab.icon}</span> {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-500">Analyzing purchasing data...</div>
        ) : data ? (
          <>
            {activeTab === 'dashboard' && <DashTab data={data} />}
            {activeTab === 'vendor-comparison' && <ComparisonTab data={data} />}
            {activeTab === 'vendor-scorecard' && <ScorecardTab data={data} />}
            {activeTab === 'consolidation' && <ConsolidationTab data={data} />}
            {activeTab === 'spend-analysis' && <SpendTab data={data} />}
          </>
        ) : null}
      </div>
    </div>
  );
}

function DashTab({ data }: { data: any }) {
  const po = data.poSummary || {};
  const vs = data.vendorSummary || {};
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPI label="Total PO Spend" value={fmt$(po.totalSpend)} sub={`${fmtN(po.totalPOs)} purchase orders`} color="blue" />
        <KPI label="Open POs" value={fmtN(po.openPOs)} sub={`${fmt$(po.openValue)} pending`} color="yellow" />
        <KPI label="Active Vendors" value={fmtN(vs.activeVendors)} sub={`${Math.round((vs.avgOnTimeRate || 0) * 100)}% avg on-time`} color="green" />
        <KPI label="Avg Lead Time" value={`${po.avgLeadDays || '—'} days`} sub="Order to receipt" color="blue" />
      </div>

      {(data.recentPOs || []).length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Recent Purchase Orders</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['PO #', 'Vendor', 'Total', 'Status', 'Ordered', 'Expected'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.recentPOs.map((po: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm font-mono">{po.poNumber}</td>
                    <td className="px-4 py-2 text-sm">{po.vendorName}</td>
                    <td className="px-4 py-2 text-sm font-semibold">{fmt$2(po.total)}</td>
                    <td className="px-4 py-2 text-sm">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        po.status === 'RECEIVED' ? 'bg-green-100 text-green-800' :
                        po.status === 'ORDERED' ? 'bg-blue-100 text-blue-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>{po.status}</span>
                    </td>
                    <td className="px-4 py-2 text-sm">{po.orderedAt ? new Date(po.orderedAt).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-2 text-sm">{po.expectedDate ? new Date(po.expectedDate).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ComparisonTab({ data }: { data: any }) {
  const multi = data.multiVendor || [];
  const single = data.singleSource || [];

  return (
    <div className="space-y-6">
      {multi.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Multi-Vendor Price Comparison</h2>
            <p className="text-sm text-gray-500 mt-1">Products available from multiple vendors — sorted by price spread</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['SKU', 'Product', 'Category', 'Current Cost', 'Best Price', 'Worst Price', 'Spread', 'Vendors'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {multi.map((m: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-sm font-mono">{m.sku}</td>
                    <td className="px-3 py-2 text-sm">{m.name}</td>
                    <td className="px-3 py-2 text-sm">{m.category}</td>
                    <td className="px-3 py-2 text-sm">{fmt$2(m.currentCost)}</td>
                    <td className="px-3 py-2 text-sm text-green-600 font-semibold">{fmt$2(m.bestCost)}</td>
                    <td className="px-3 py-2 text-sm text-red-600">{fmt$2(m.worstCost)}</td>
                    <td className="px-3 py-2 text-sm font-semibold">{fmt$2(m.priceSpread)}</td>
                    <td className="px-3 py-2 text-sm">{m.vendorCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {single.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-orange-200 overflow-hidden">
          <div className="bg-orange-500 text-white px-6 py-3 font-semibold">
            Single-Source Risk: {single.length} Products from Only One Vendor
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-orange-50 border-b border-orange-200">
                <tr>
                  {['SKU', 'Product', 'Category', 'Cost', 'Vendor', 'Lead Time'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-orange-100">
                {single.map((s: any, i: number) => (
                  <tr key={i} className="hover:bg-orange-50">
                    <td className="px-4 py-2 text-sm font-mono">{s.sku}</td>
                    <td className="px-4 py-2 text-sm">{s.name}</td>
                    <td className="px-4 py-2 text-sm">{s.category}</td>
                    <td className="px-4 py-2 text-sm">{fmt$2(s.cost)}</td>
                    <td className="px-4 py-2 text-sm">{s.vendorName} ({s.vendorCode})</td>
                    <td className="px-4 py-2 text-sm">{s.leadTimeDays ? `${s.leadTimeDays}d` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ScorecardTab({ data }: { data: any }) {
  const vendors = data.vendors || [];
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Vendor Performance Scorecards</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Vendor', 'Code', 'Total POs', 'Total Spend', 'Products', 'On-Time Rate', 'Avg Lead Days', 'Contact'].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {vendors.map((v: any, i: number) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-sm font-medium">{v.name}</td>
                <td className="px-3 py-2 text-sm font-mono">{v.code}</td>
                <td className="px-3 py-2 text-sm">{v.totalPOs}</td>
                <td className="px-3 py-2 text-sm font-semibold">{fmt$(v.totalSpend)}</td>
                <td className="px-3 py-2 text-sm">{v.productsSupplied}</td>
                <td className="px-3 py-2 text-sm">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    Number(v.onTimeRate) >= 0.9 ? 'bg-green-100 text-green-800' :
                    Number(v.onTimeRate) >= 0.75 ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {Math.round((v.onTimeRate || 0) * 100)}%
                  </span>
                </td>
                <td className="px-3 py-2 text-sm">{v.actualAvgLeadDays || v.avgLeadDays || '—'}d</td>
                <td className="px-3 py-2 text-sm text-blue-600">{v.email || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ConsolidationTab({ data }: { data: any }) {
  const opps = data.opportunities || [];
  return (
    <div className="space-y-4">
      {opps.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="font-semibold text-green-800">{opps.length} PO consolidation opportunities found</p>
          <p className="text-green-600 text-sm mt-1">Combine multiple reorders into single POs to save on shipping and admin time</p>
        </div>
      )}

      {opps.map((o: any, i: number) => (
        <div key={i} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="font-semibold text-gray-900">{o.vendorName} ({o.vendorCode})</h3>
              <p className="text-sm text-gray-500">{o.productsNeedingReorder} products need reorder</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-green-600">{fmt$(o.estimatedPOValue)}</p>
              <p className="text-xs text-gray-500">Estimated PO value</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  {['SKU', 'Product', 'On Hand', 'Reorder Pt', 'Order Qty', 'Unit Cost'].map((h) => (
                    <th key={h} className="px-3 py-1 text-left text-xs font-semibold text-gray-700">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(o.products || []).map((p: any, j: number) => (
                  <tr key={j}>
                    <td className="px-3 py-1 text-sm font-mono">{p.sku}</td>
                    <td className="px-3 py-1 text-sm">{p.name}</td>
                    <td className="px-3 py-1 text-sm">{p.onHand}</td>
                    <td className="px-3 py-1 text-sm">{p.reorderPoint}</td>
                    <td className="px-3 py-1 text-sm font-semibold">{p.reorderQty}</td>
                    <td className="px-3 py-1 text-sm">{fmt$2(p.vendorCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function SpendTab({ data }: { data: any }) {
  const vendor = data.vendorSpend || [];
  const category = data.categorySpend || [];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Spend by Vendor</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Vendor', 'Last 30d', 'Last 90d', 'Last 12mo', 'POs'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {vendor.map((v: any, i: number) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm font-medium">{v.vendorName}</td>
                  <td className="px-4 py-2 text-sm">{fmt$(v.spend30d)}</td>
                  <td className="px-4 py-2 text-sm">{fmt$(v.spend90d)}</td>
                  <td className="px-4 py-2 text-sm font-semibold">{fmt$(v.spend365d)}</td>
                  <td className="px-4 py-2 text-sm">{v.poCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Spend by Product Category</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Category', 'Total Spend', 'Total Qty', 'POs', 'Avg Unit Cost'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {category.map((c: any, i: number) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm font-medium">{c.category}</td>
                  <td className="px-4 py-2 text-sm font-semibold">{fmt$(c.totalSpend)}</td>
                  <td className="px-4 py-2 text-sm">{fmtN(c.totalQty)}</td>
                  <td className="px-4 py-2 text-sm">{c.poCount}</td>
                  <td className="px-4 py-2 text-sm">{fmt$2(c.avgUnitCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KPI({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  const bg: Record<string, string> = { green: 'bg-green-50 border-green-200', red: 'bg-red-50 border-red-200', yellow: 'bg-yellow-50 border-yellow-200', blue: 'bg-blue-50 border-blue-200' };
  const tc: Record<string, string> = { green: 'text-green-700', red: 'text-red-700', yellow: 'text-yellow-700', blue: 'text-blue-700' };
  return (
    <div className={`rounded-lg shadow-sm border p-6 ${bg[color] || bg.blue}`}>
      <p className="text-gray-600 text-sm font-medium mb-2">{label}</p>
      <p className={`text-3xl font-bold ${tc[color] || tc.blue}`}>{value}</p>
      <p className="text-gray-500 text-xs mt-2">{sub}</p>
    </div>
  );
}
