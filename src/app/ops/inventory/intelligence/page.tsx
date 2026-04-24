'use client';

import { useState, useEffect } from 'react';
import { Package } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';

const TABS = [
  { id: 'dashboard', label: 'Overview', icon: '📊' },
  { id: 'reorder-alerts', label: 'Reorder Alerts', icon: '🚨' },
  { id: 'slow-movers', label: 'Slow Movers', icon: '🐢' },
  { id: 'demand-forecast', label: 'Demand Forecast', icon: '📈' },
  { id: 'turnover', label: 'Turnover Analysis', icon: '🔄' },
  { id: 'stockout-risk', label: 'Stockout Risk', icon: '⚠️' },
];

function fmt$(v: any): string { const n = Number(v); return isNaN(n) ? '$0' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n); }
function fmtN(v: any): string { const n = Number(v); return isNaN(n) ? '0' : n.toLocaleString(); }

const ALERT_COLORS: Record<string, string> = {
  OUT_OF_STOCK: 'bg-red-600 text-white',
  CRITICAL: 'bg-red-100 text-red-800',
  REORDER: 'bg-orange-100 text-orange-800',
  LOW: 'bg-yellow-100 text-yellow-800',
  OK: 'bg-green-100 text-green-800',
};

const VELOCITY_COLORS: Record<string, string> = {
  DEAD_STOCK: 'bg-red-100 text-red-800',
  VERY_SLOW: 'bg-orange-100 text-orange-800',
  SLOW: 'bg-yellow-100 text-yellow-800',
  MODERATE: 'bg-blue-100 text-blue-800',
};

export default function InventoryIntelligencePage() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  useEffect(() => { loadTab(activeTab); }, [activeTab]);

  const loadTab = async (tab: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ops/inventory/intelligence?report=${tab}`);
      if (res.ok) setData(await res.json());
    } catch (e) { console.error('Load error:', e); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#1e3a5f] text-white px-8 py-8">
        <h1 className="text-3xl font-bold">Inventory Intelligence</h1>
        <p className="text-blue-100 mt-2">AI-powered demand forecasting, reorder optimization, and waste elimination</p>
      </div>

      <div className="bg-white border-b border-gray-200 px-8">
        <div className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id ? 'border-signal text-signal' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              <span className="mr-1">{tab.icon}</span> {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-500">Analyzing inventory data...</div>
        ) : data ? (
          <>
            {activeTab === 'dashboard' && <DashboardTab data={data} />}
            {activeTab === 'reorder-alerts' && <ReorderTab data={data} />}
            {activeTab === 'slow-movers' && <SlowMoversTab data={data} />}
            {activeTab === 'demand-forecast' && <DemandTab data={data} />}
            {activeTab === 'turnover' && <TurnoverTab data={data} />}
            {activeTab === 'stockout-risk' && <StockoutTab data={data} />}
          </>
        ) : null}
      </div>
    </div>
  );
}

function DashboardTab({ data }: { data: any }) {
  const o = data.overview || {};
  const v = data.value || {};
  const po = data.pendingPOs || {};
  const a = data.activity || {};

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPI label="Inventory Value (Cost)" value={fmt$(v.totalCostValue)} sub={`${fmtN(o.totalUnitsOnHand)} units on hand`} color="blue" />
        <KPI label="Retail Value" value={fmt$(v.totalRetailValue)} sub={`${fmt$(v.totalMarginValue)} margin potential`} color="green" />
        <KPI label="Reorder Alerts" value={fmtN(o.belowReorderPoint)} sub={`${fmtN(o.outOfStock)} out of stock`} color={Number(o.belowReorderPoint) > 0 ? 'red' : 'green'} />
        <KPI label="Open POs" value={fmtN(po.openPOs)} sub={`${fmt$(po.totalPOValue)} on order`} color="yellow" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Stock Health</h2>
          <div className="space-y-4">
            <StatRow label="Total SKUs Tracked" value={fmtN(o.totalSKUs)} />
            <StatRow label="Units On Hand" value={fmtN(o.totalUnitsOnHand)} />
            <StatRow label="Units Committed" value={fmtN(o.totalCommitted)} />
            <StatRow label="Units On Order" value={fmtN(o.totalOnOrder)} />
            <StatRow label="Available" value={fmtN(o.totalAvailable)} />
            <StatRow label="Out of Stock" value={fmtN(o.outOfStock)} alert={Number(o.outOfStock) > 0} />
            <StatRow label="Negative Available" value={fmtN(o.negativeAvailable)} alert={Number(o.negativeAvailable) > 0} />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Warehouse Activity</h2>
          <div className="space-y-4">
            <StatRow label="Received This Week" value={fmtN(a.receivedThisWeek)} />
            <StatRow label="Counted This Month" value={fmtN(a.countedThisMonth)} />
            <StatRow label="Needs Cycle Count (90d+)" value={fmtN(a.needsCycleCount)} alert={Number(a.needsCycleCount) > 10} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ReorderTab({ data }: { data: any }) {
  const alerts = data.alerts || [];
  const s = data.summary || {};

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPI label="Out of Stock" value={fmtN(s.outOfStock)} sub="Zero inventory" color="red" />
        <KPI label="Critical" value={fmtN(s.critical)} sub="Available <= 0" color="red" />
        <KPI label="Reorder Now" value={fmtN(s.reorder)} sub="Below reorder point" color="orange" />
        <KPI label="Getting Low" value={fmtN(s.low)} sub="Approaching reorder" color="yellow" />
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        {alerts.length === 0 ? (
          <EmptyState
            icon={<Package className="w-8 h-8 text-fg-subtle" />}
            title="No items match your filters"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Alert', 'SKU', 'Product', 'Category', 'On Hand', 'Committed', 'Available', 'Reorder Pt', 'Reorder Qty', 'Vendor', 'Lead Time'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {alerts.map((a: any, i: number) => (
                  <tr key={i} className="hover:bg-row-hover">
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ALERT_COLORS[a.alertLevel] || ''}`}>
                        {a.alertLevel}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-sm font-mono">{a.sku}</td>
                    <td className="px-3 py-2 text-sm">{a.name}</td>
                    <td className="px-3 py-2 text-sm">{a.category}</td>
                    <td className="px-3 py-2 text-sm font-semibold">{a.onHand}</td>
                    <td className="px-3 py-2 text-sm">{a.committed}</td>
                    <td className="px-3 py-2 text-sm">{a.available}</td>
                    <td className="px-3 py-2 text-sm">{a.reorderPoint}</td>
                    <td className="px-3 py-2 text-sm">{a.reorderQty}</td>
                    <td className="px-3 py-2 text-sm">{a.vendorName || '—'}</td>
                    <td className="px-3 py-2 text-sm">{a.leadTimeDays ? `${a.leadTimeDays}d` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SlowMoversTab({ data }: { data: any }) {
  const items = data.items || [];
  const s = data.summary || {};

  return (
    <div className="space-y-4">
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="font-semibold text-red-800">
          {fmt$(s.totalCarryingCost)} tied up in slow-moving and dead stock
        </p>
        <p className="text-red-600 text-sm mt-1">
          {s.deadStock} dead stock items ({fmt$(s.deadStockValue)}) | {s.verySlow} very slow | {s.slow} slow
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Velocity', 'SKU', 'Product', 'Category', 'On Hand', 'Carrying Cost', 'Sold (90d)', 'Sold (180d)', 'Months Supply', 'Zone'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.filter((it: any) => it.velocityClass !== 'MODERATE').slice(0, 50).map((it: any, i: number) => (
                <tr key={i} className="hover:bg-row-hover">
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${VELOCITY_COLORS[it.velocityClass] || ''}`}>
                      {it.velocityClass}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm font-mono">{it.sku}</td>
                  <td className="px-3 py-2 text-sm">{it.name}</td>
                  <td className="px-3 py-2 text-sm">{it.category}</td>
                  <td className="px-3 py-2 text-sm">{it.onHand}</td>
                  <td className="px-3 py-2 text-sm text-red-600 font-semibold">{fmt$(it.carryingCost)}</td>
                  <td className="px-3 py-2 text-sm">{it.qtySold90d}</td>
                  <td className="px-3 py-2 text-sm">{it.qtySold180d}</td>
                  <td className="px-3 py-2 text-sm">{it.monthsOfSupply >= 999 ? '∞' : `${it.monthsOfSupply}mo`}</td>
                  <td className="px-3 py-2 text-sm text-gray-500">{it.warehouseZone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DemandTab({ data }: { data: any }) {
  const topProducts = data.topProducts || [];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Top Products by Demand Velocity</h2>
          <p className="text-sm text-gray-500 mt-1">Average monthly units sold and current stock coverage</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['SKU', 'Product', 'Category', 'Avg Monthly', '30d Sales', '90d Sales', 'Current Stock', 'Months Coverage'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {topProducts.map((p: any, i: number) => (
                <tr key={i} className="hover:bg-row-hover">
                  <td className="px-3 py-2 text-sm font-mono">{p.sku}</td>
                  <td className="px-3 py-2 text-sm">{p.name}</td>
                  <td className="px-3 py-2 text-sm">{p.category}</td>
                  <td className="px-3 py-2 text-sm font-semibold">{p.avgMonthly}</td>
                  <td className="px-3 py-2 text-sm">{fmtN(p.qty30d)}</td>
                  <td className="px-3 py-2 text-sm">{fmtN(p.qty90d)}</td>
                  <td className="px-3 py-2 text-sm">{fmtN(p.currentStock)}</td>
                  <td className="px-3 py-2 text-sm">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      Number(p.monthsOfStock) <= 1 ? 'bg-red-100 text-red-800' :
                      Number(p.monthsOfStock) <= 3 ? 'bg-yellow-100 text-yellow-800' :
                      'bg-green-100 text-green-800'
                    }`}>
                      {Number(p.monthsOfStock) >= 999 ? 'N/A' : `${p.monthsOfStock}mo`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TurnoverTab({ data }: { data: any }) {
  const cats = data.categories || [];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Inventory Turnover by Category</h2>
        <p className="text-sm text-gray-500 mt-1">Higher turnover = more efficient use of capital</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Category', 'SKUs', 'On Hand', 'Inventory Value', 'Annual Revenue', 'Turnover Rate', 'Days of Inventory'].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {cats.map((c: any, i: number) => (
              <tr key={i} className="hover:bg-row-hover">
                <td className="px-4 py-2 text-sm font-medium">{c.category}</td>
                <td className="px-4 py-2 text-sm">{fmtN(c.skuCount)}</td>
                <td className="px-4 py-2 text-sm">{fmtN(c.totalOnHand)}</td>
                <td className="px-4 py-2 text-sm">{fmt$(c.inventoryValue)}</td>
                <td className="px-4 py-2 text-sm">{fmt$(c.annualRevenue)}</td>
                <td className="px-4 py-2 text-sm">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    Number(c.turnoverRate) >= 6 ? 'bg-green-100 text-green-800' :
                    Number(c.turnoverRate) >= 3 ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {c.turnoverRate}x
                  </span>
                </td>
                <td className="px-4 py-2 text-sm">{Number(c.daysOfInventory) >= 999 ? '∞' : `${c.daysOfInventory}d`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StockoutTab({ data }: { data: any }) {
  const items = data.items || [];

  return (
    <div className="space-y-4">
      {data.criticalCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="font-semibold text-red-800">{data.criticalCount} products will stock out before reorder arrives</p>
          <p className="text-red-600 text-sm mt-1">These items need emergency purchasing action</p>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Stockout Risk Analysis</h2>
          <p className="text-sm text-gray-500 mt-1">Projected days until stockout based on 90-day demand velocity</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['SKU', 'Product', 'On Hand', 'Available', 'Daily Demand', 'Days to Stockout', 'Lead Time', 'Risk'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((it: any, i: number) => (
                <tr key={i} className={`hover:bg-row-hover ${it.willStockOutBeforeReorder ? 'bg-red-50' : ''}`}>
                  <td className="px-4 py-2 text-sm font-mono">{it.sku}</td>
                  <td className="px-4 py-2 text-sm">{it.name}</td>
                  <td className="px-4 py-2 text-sm">{it.onHand}</td>
                  <td className="px-4 py-2 text-sm">{it.available}</td>
                  <td className="px-4 py-2 text-sm">{Number(it.avgDailyDemand).toFixed(1)}</td>
                  <td className="px-4 py-2 text-sm font-semibold">{it.daysUntilStockout}d</td>
                  <td className="px-4 py-2 text-sm">{it.leadTimeDays}d</td>
                  <td className="px-4 py-2 text-sm">
                    {it.willStockOutBeforeReorder ? (
                      <span className="bg-red-600 text-white px-2 py-0.5 rounded text-xs font-semibold">WILL STOCK OUT</span>
                    ) : (
                      <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded text-xs font-medium">OK</span>
                    )}
                  </td>
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
  const bg: Record<string, string> = { green: 'bg-green-50 border-green-200', red: 'bg-red-50 border-red-200', yellow: 'bg-yellow-50 border-yellow-200', blue: 'bg-blue-50 border-blue-200', orange: 'bg-orange-50 border-orange-200' };
  const tc: Record<string, string> = { green: 'text-green-700', red: 'text-red-700', yellow: 'text-yellow-700', blue: 'text-blue-700', orange: 'text-orange-700' };
  return (
    <div className={`rounded-lg shadow-sm border p-6 ${bg[color] || bg.blue}`}>
      <p className="text-gray-600 text-sm font-medium mb-2">{label}</p>
      <p className={`text-3xl font-semibold ${tc[color] || tc.blue}`}>{value}</p>
      <p className="text-gray-500 text-xs mt-2">{sub}</p>
    </div>
  );
}

function StatRow({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-gray-600">{label}</span>
      <span className={`text-sm font-semibold ${alert ? 'text-red-600' : 'text-gray-900'}`}>{value}</span>
    </div>
  );
}
