'use client';

import { useState, useEffect } from 'react';

const TABS = [
  { id: 'dashboard', label: 'Overview', icon: '📊' },
  { id: 'performance', label: 'Performance', icon: '📈' },
  { id: 'crew-utilization', label: 'Crew Utilization', icon: '👷' },
  { id: 'route-analysis', label: 'Route Analysis', icon: '🗺️' },
  { id: 'cost-attribution', label: 'Cost Attribution', icon: '💰' },
];

function fmtN(v: any): string { const n = Number(v); return isNaN(n) ? '0' : n.toLocaleString(); }

export default function DeliveryOptimizePage() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  useEffect(() => { loadTab(activeTab); }, [activeTab]);
  const loadTab = async (tab: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ops/delivery/optimize?report=${tab}`);
      if (res.ok) setData(await res.json());
    } catch (e) { console.error('Load error:', e); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#1e3a5f] text-white px-8 py-8">
        <h1 className="text-3xl font-bold">Delivery & Route Optimization</h1>
        <p className="text-blue-100 mt-2">Fleet performance, route efficiency, and delivery cost analysis</p>
      </div>
      <div className="bg-white border-b border-gray-200 px-8">
        <div className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id ? 'border-[#C6A24E] text-[#C6A24E]' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              <span className="mr-1">{tab.icon}</span> {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-500">Analyzing delivery data...</div>
        ) : data ? (
          <>
            {activeTab === 'dashboard' && <DashTab data={data} />}
            {activeTab === 'performance' && <PerfTab data={data} />}
            {activeTab === 'crew-utilization' && <CrewTab data={data} />}
            {activeTab === 'route-analysis' && <RouteTab data={data} />}
            {activeTab === 'cost-attribution' && <CostTab data={data} />}
          </>
        ) : null}
      </div>
    </div>
  );
}

function DashTab({ data }: { data: any }) {
  const d = data.deliveries || {};
  const c = data.crews || {};
  const s = data.schedule || {};
  const ot = data.onTimeRate || {};

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPI label="On-Time Rate (90d)" value={`${ot.onTimePct || 0}%`} sub={`${fmtN(ot.onTime)} of ${fmtN(ot.total)} deliveries`} color={Number(ot.onTimePct) >= 90 ? 'green' : Number(ot.onTimePct) >= 75 ? 'yellow' : 'red'} />
        <KPI label="Today's Schedule" value={fmtN(s.today)} sub={`${fmtN(s.thisWeek)} this week`} color="blue" />
        <KPI label="Active Crews" value={fmtN(c.activeCrews)} sub={`${c.deliveryCrews} delivery, ${c.installCrews} install`} color="blue" />
        <KPI label="Completed (30d)" value={fmtN(d.completedThisMonth)} sub={`${fmtN(d.completedThisWeek)} this week`} color="green" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Delivery Status</h2>
          <div className="space-y-3">
            <StatBar label="Scheduled" value={Number(d.scheduled)} max={Number(d.totalDeliveries)} color="#3498db" />
            <StatBar label="In Transit" value={Number(d.inTransit)} max={Number(d.totalDeliveries)} color="#D4B96A" />
            <StatBar label="Completed" value={Number(d.completed)} max={Number(d.totalDeliveries)} color="#27ae60" />
            <StatBar label="Cancelled" value={Number(d.cancelled)} max={Number(d.totalDeliveries)} color="#e74c3c" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Schedule Pipeline</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <p className="text-3xl font-bold text-blue-600">{fmtN(s.confirmed)}</p>
              <p className="text-sm text-gray-600">Confirmed</p>
            </div>
            <div className="text-center p-4 bg-yellow-50 rounded-lg">
              <p className="text-3xl font-bold text-yellow-600">{fmtN(s.tentative)}</p>
              <p className="text-sm text-gray-600">Tentative</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PerfTab({ data }: { data: any }) {
  const crews = data.crewPerformance || [];
  const weekly = data.weeklyVolume || [];

  return (
    <div className="space-y-6">
      {weekly.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Weekly Delivery Volume</h2>
          <div className="space-y-2">
            {weekly.map((w: any, i: number) => {
              const max = Math.max(...weekly.map((wk: any) => Number(wk.deliveries)));
              return (
                <div key={i} className="flex items-center gap-4">
                  <div className="w-28 text-sm text-gray-600 shrink-0">{new Date(w.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                  <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                    <div className="h-full bg-[#1e3a5f] rounded-full" style={{ width: `${(Number(w.deliveries) / max) * 100}%` }} />
                  </div>
                  <div className="w-16 text-right text-sm font-medium">{w.deliveries}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Crew Performance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Crew', 'Type', 'Vehicle', 'Total Deliveries', 'Completed', 'Pending', 'Avg Hours', 'Last Delivery'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {crews.map((c: any, i: number) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm font-medium">{c.name}</td>
                  <td className="px-4 py-2 text-sm">{c.crewType}</td>
                  <td className="px-4 py-2 text-sm">{c.vehiclePlate || '—'}</td>
                  <td className="px-4 py-2 text-sm font-semibold">{c.totalDeliveries}</td>
                  <td className="px-4 py-2 text-sm text-green-600">{c.completed}</td>
                  <td className="px-4 py-2 text-sm">{c.pending}</td>
                  <td className="px-4 py-2 text-sm">{c.avgHoursPerDelivery ? `${c.avgHoursPerDelivery}h` : '—'}</td>
                  <td className="px-4 py-2 text-sm text-gray-500">{c.lastDeliveryDate ? new Date(c.lastDeliveryDate).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CrewTab({ data }: { data: any }) {
  const crews = data.crews || [];
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Crew Utilization</h2>
        <p className="text-sm text-gray-500 mt-1">Schedule density and workload balance</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Crew', 'Type', 'Vehicle', 'This Week', 'This Month', 'Completed (30d)', 'Pending'].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {crews.map((c: any, i: number) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-sm font-medium">{c.name}</td>
                <td className="px-4 py-2 text-sm">{c.crewType}</td>
                <td className="px-4 py-2 text-sm">{c.vehiclePlate || '—'}</td>
                <td className="px-4 py-2 text-sm font-semibold">{c.scheduledThisWeek}</td>
                <td className="px-4 py-2 text-sm">{c.scheduledThisMonth}</td>
                <td className="px-4 py-2 text-sm text-green-600">{c.completedThisMonth}</td>
                <td className="px-4 py-2 text-sm">{c.pendingDeliveries}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RouteTab({ data }: { data: any }) {
  const m = data.metrics || {};
  const deliveries = data.deliveries || [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPI label="Avg Transit Time" value={`${m.avgTransitMin || '—'} min`} sub="Warehouse to site" color="blue" />
        <KPI label="Avg On-Site Time" value={`${m.avgOnSiteMin || '—'} min`} sub="Arrival to completion" color="yellow" />
        <KPI label="Avg Total Time" value={`${m.avgTotalMin || '—'} min`} sub="Departure to completion" color="green" />
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Recent Delivery Routes (Last 90 Days)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Address', 'Crew', 'Route #', 'Transit (min)', 'On-Site (min)', 'Status'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {deliveries.slice(0, 50).map((d: any, i: number) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm">{d.address}</td>
                  <td className="px-4 py-2 text-sm">{d.crewName || '—'}</td>
                  <td className="px-4 py-2 text-sm">{d.routeOrder}</td>
                  <td className="px-4 py-2 text-sm">{d.transitMinutes ? `${d.transitMinutes}m` : '—'}</td>
                  <td className="px-4 py-2 text-sm">{d.onSiteMinutes ? `${d.onSiteMinutes}m` : '—'}</td>
                  <td className="px-4 py-2 text-sm">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      d.status === 'COMPLETED' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                    }`}>{d.status}</span>
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

function CostTab({ data }: { data: any }) {
  const builders = data.byBuilder || [];
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Delivery Cost Attribution by Builder</h2>
        <p className="text-sm text-gray-500 mt-1">Delivery effort per builder account</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Builder', 'Deliveries', 'Jobs', 'Avg Hours/Delivery'].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {builders.map((b: any, i: number) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-sm font-medium">{b.companyName}</td>
                <td className="px-4 py-2 text-sm font-semibold">{b.deliveryCount}</td>
                <td className="px-4 py-2 text-sm">{b.jobCount}</td>
                <td className="px-4 py-2 text-sm">{b.avgHoursPerDelivery ? `${b.avgHoursPerDelivery}h` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

function StatBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-4">
      <div className="w-24 text-sm text-gray-700 shrink-0">{label}</div>
      <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }} />
      </div>
      <div className="w-12 text-right text-sm font-medium">{value}</div>
    </div>
  );
}
