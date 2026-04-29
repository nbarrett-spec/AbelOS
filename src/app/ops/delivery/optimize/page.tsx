'use client';

import { useState, useEffect } from 'react';
import { Truck } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';

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
  const [kpiDays, setKpiDays] = useState(30);
  const [kpiData, setKpiData] = useState<any>(null);
  const [kpiLoading, setKpiLoading] = useState(false);

  useEffect(() => { loadTab(activeTab); }, [activeTab]);
  const loadTab = async (tab: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ops/delivery/optimize?report=${tab}`);
      if (res.ok) setData(await res.json());
    } catch (e) { console.error('Load error:', e); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (activeTab !== 'route-analysis') return;
    let cancelled = false;
    const loadKpis = async () => {
      setKpiLoading(true);
      try {
        const res = await fetch(`/api/ops/delivery/kpis?days=${kpiDays}`);
        if (res.ok && !cancelled) setKpiData(await res.json());
      } catch (e) { console.error('KPI load error:', e); }
      finally { if (!cancelled) setKpiLoading(false); }
    };
    loadKpis();
    return () => { cancelled = true; };
  }, [activeTab, kpiDays]);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="bg-[#1e3a5f] text-white px-8 py-8">
        <h1 className="text-3xl font-bold">Delivery & Route Optimization</h1>
        <p className="text-blue-100 mt-2">Fleet performance, route efficiency, and delivery cost analysis</p>
      </div>
      <div className="bg-surface border-b border-border px-8">
        <div className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id ? 'border-signal text-signal' : 'border-transparent text-fg-muted hover:text-fg'
              }`}>
              <span className="mr-1">{tab.icon}</span> {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-fg-muted">Analyzing delivery data...</div>
        ) : data ? (
          <>
            {activeTab === 'dashboard' && <DashTab data={data} />}
            {activeTab === 'performance' && <PerfTab data={data} />}
            {activeTab === 'crew-utilization' && <CrewTab data={data} />}
            {activeTab === 'route-analysis' && (
              <>
                <RouteTab data={data} />
                <div className="mt-6">
                  <CrewKPILeaderboard
                    kpiData={kpiData}
                    loading={kpiLoading}
                    days={kpiDays}
                    onDaysChange={setKpiDays}
                  />
                </div>
              </>
            )}
            {activeTab === 'cost-attribution' && <CostTab data={data} />}
          </>
        ) : null}
      </div>
    </div>
  );
}

function CrewKPILeaderboard({
  kpiData,
  loading,
  days,
  onDaysChange,
}: {
  kpiData: any;
  loading: boolean;
  days: number;
  onDaysChange: (d: number) => void;
}) {
  const crews: any[] = kpiData?.crews || [];

  // Compute relative tiers per metric for color coding (top/middle/bottom thirds).
  // Higher is better for onTimePct + completedCount; lower is better for damagePct.
  const tier = (values: number[], v: number, lowerIsBetter = false): 'good' | 'mid' | 'bad' => {
    const valid = values.filter((x) => x !== null && !isNaN(x));
    if (valid.length < 2) return 'mid';
    const sorted = [...valid].sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length / 3)];
    const hi = sorted[Math.ceil((sorted.length * 2) / 3) - 1];
    if (lowerIsBetter) {
      if (v <= lo) return 'good';
      if (v >= hi) return 'bad';
      return 'mid';
    }
    if (v >= hi) return 'good';
    if (v <= lo) return 'bad';
    return 'mid';
  };

  const tierClass: Record<string, string> = {
    good: 'text-green-700 font-semibold',
    mid: 'text-yellow-700',
    bad: 'text-red-700',
  };

  const onTimeVals = crews.map((c) => Number(c.onTimePct)).filter((v) => !isNaN(v));
  const completedVals = crews.map((c) => Number(c.completedCount));
  const damageVals = crews.map((c) => Number(c.damagePct));

  return (
    <div className="bg-surface rounded-lg shadow-sm border border-border overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-fg">Crew Performance Leaderboard</h2>
          <p className="text-sm text-fg-muted mt-1">On-time %, avg stops, damage rate, completed deliveries</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-fg-muted">Range:</label>
          <select
            value={days}
            onChange={(e) => onDaysChange(parseInt(e.target.value, 10))}
            className="px-3 py-1.5 text-sm border border-border rounded-md bg-surface"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-fg-muted">Loading KPIs...</div>
        ) : crews.length === 0 ? (
          <EmptyState
            icon={<Truck className="w-8 h-8 text-fg-subtle" />}
            title="No crew activity"
            description={`No completed deliveries in the last ${days} days.`}
          />
        ) : (
          <table className="w-full">
            <thead className="bg-surface-muted border-b border-border">
              <tr>
                {['Rank', 'Crew', 'On-Time %', 'Avg Stops', 'Damage %', 'Completed'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-fg">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {crews.map((c: any, i: number) => {
                const onTime = c.onTimePct === null ? null : Number(c.onTimePct);
                const completed = Number(c.completedCount);
                const damage = Number(c.damagePct);
                return (
                  <tr key={c.crewId || i} className="hover:bg-row-hover">
                    <td className="px-4 py-2 text-sm font-semibold text-fg-muted">#{i + 1}</td>
                    <td className="px-4 py-2 text-sm font-medium">{c.name}</td>
                    <td className={`px-4 py-2 text-sm ${onTime === null ? 'text-fg-muted' : tierClass[tier(onTimeVals, onTime)]}`}>
                      {onTime === null ? '—' : `${onTime}%`}
                    </td>
                    <td className="px-4 py-2 text-sm">
                      {c.avgStops === null ? '—' : c.avgStops}
                    </td>
                    <td className={`px-4 py-2 text-sm ${tierClass[tier(damageVals, damage, true)]}`}>
                      {damage}%
                    </td>
                    <td className={`px-4 py-2 text-sm ${tierClass[tier(completedVals, completed)]}`}>
                      {completed}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
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
        <div className="bg-surface rounded-lg shadow-sm border border-border p-6">
          <h2 className="text-lg font-semibold text-fg mb-4">Delivery Status</h2>
          <div className="space-y-3">
            <StatBar label="Scheduled" value={Number(d.scheduled)} max={Number(d.totalDeliveries)} color="#3498db" />
            <StatBar label="In Transit" value={Number(d.inTransit)} max={Number(d.totalDeliveries)} color="#D4B96A" />
            <StatBar label="Completed" value={Number(d.completed)} max={Number(d.totalDeliveries)} color="#27ae60" />
            <StatBar label="Cancelled" value={Number(d.cancelled)} max={Number(d.totalDeliveries)} color="#e74c3c" />
          </div>
        </div>

        <div className="bg-surface rounded-lg shadow-sm border border-border p-6">
          <h2 className="text-lg font-semibold text-fg mb-4">Schedule Pipeline</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <p className="text-3xl font-bold text-blue-600">{fmtN(s.confirmed)}</p>
              <p className="text-sm text-fg-muted">Confirmed</p>
            </div>
            <div className="text-center p-4 bg-yellow-50 rounded-lg">
              <p className="text-3xl font-bold text-yellow-600">{fmtN(s.tentative)}</p>
              <p className="text-sm text-fg-muted">Tentative</p>
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
        <div className="bg-surface rounded-lg shadow-sm border border-border p-6">
          <h2 className="text-lg font-semibold text-fg mb-4">Weekly Delivery Volume</h2>
          <div className="space-y-2">
            {weekly.map((w: any, i: number) => {
              const max = Math.max(...weekly.map((wk: any) => Number(wk.deliveries)));
              return (
                <div key={i} className="flex items-center gap-4">
                  <div className="w-28 text-sm text-fg-muted shrink-0">{new Date(w.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                  <div className="flex-1 bg-surface-muted rounded-full h-6 overflow-hidden">
                    <div className="h-full bg-[#1e3a5f] rounded-full" style={{ width: `${(Number(w.deliveries) / max) * 100}%` }} />
                  </div>
                  <div className="w-16 text-right text-sm font-medium">{w.deliveries}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-surface rounded-lg shadow-sm border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-fg">Crew Performance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-muted border-b border-border">
              <tr>
                {['Crew', 'Type', 'Vehicle', 'Total Deliveries', 'Completed', 'Pending', 'Avg Hours', 'Last Delivery'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-fg">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {crews.map((c: any, i: number) => (
                <tr key={i} className="hover:bg-row-hover">
                  <td className="px-4 py-2 text-sm font-medium">{c.name}</td>
                  <td className="px-4 py-2 text-sm">{c.crewType}</td>
                  <td className="px-4 py-2 text-sm">{c.vehiclePlate || '—'}</td>
                  <td className="px-4 py-2 text-sm font-semibold">{c.totalDeliveries}</td>
                  <td className="px-4 py-2 text-sm text-green-600">{c.completed}</td>
                  <td className="px-4 py-2 text-sm">{c.pending}</td>
                  <td className="px-4 py-2 text-sm">{c.avgHoursPerDelivery ? `${c.avgHoursPerDelivery}h` : '—'}</td>
                  <td className="px-4 py-2 text-sm text-fg-muted">{c.lastDeliveryDate ? new Date(c.lastDeliveryDate).toLocaleDateString() : '—'}</td>
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
    <div className="bg-surface rounded-lg shadow-sm border border-border overflow-hidden">
      <div className="px-6 py-4 border-b border-border">
        <h2 className="text-lg font-semibold text-fg">Crew Utilization</h2>
        <p className="text-sm text-fg-muted mt-1">Schedule density and workload balance</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-surface-muted border-b border-border">
            <tr>
              {['Crew', 'Type', 'Vehicle', 'This Week', 'This Month', 'Completed (30d)', 'Pending'].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-fg">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {crews.map((c: any, i: number) => (
              <tr key={i} className="hover:bg-row-hover">
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

      <div className="bg-surface rounded-lg shadow-sm border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-fg">Recent Delivery Routes (Last 90 Days)</h2>
        </div>
        <div className="overflow-x-auto">
          {deliveries.length === 0 ? (
            <EmptyState
              icon={<Truck className="w-8 h-8 text-fg-subtle" />}
              title="No deliveries scheduled"
              description="No completed delivery routes in the last 90 days."
            />
          ) : (
            <table className="w-full">
              <thead className="bg-surface-muted border-b border-border">
                <tr>
                  {['Address', 'Crew', 'Route #', 'Transit (min)', 'On-Site (min)', 'Status'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-fg">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {deliveries.slice(0, 50).map((d: any, i: number) => (
                  <tr key={i} className="hover:bg-row-hover">
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
          )}
        </div>
      </div>
    </div>
  );
}

function CostTab({ data }: { data: any }) {
  const builders = data.byBuilder || [];
  return (
    <div className="bg-surface rounded-lg shadow-sm border border-border overflow-hidden">
      <div className="px-6 py-4 border-b border-border">
        <h2 className="text-lg font-semibold text-fg">Delivery Cost Attribution by Builder</h2>
        <p className="text-sm text-fg-muted mt-1">Delivery effort per builder account</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-surface-muted border-b border-border">
            <tr>
              {['Builder', 'Deliveries', 'Jobs', 'Avg Hours/Delivery'].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-fg">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {builders.map((b: any, i: number) => (
              <tr key={i} className="hover:bg-row-hover">
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
      <p className="text-fg-muted text-sm font-medium mb-2">{label}</p>
      <p className={`text-3xl font-semibold ${tc[color] || tc.blue}`}>{value}</p>
      <p className="text-fg-subtle text-xs mt-2">{sub}</p>
    </div>
  );
}

function StatBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-4">
      <div className="w-24 text-sm text-fg shrink-0">{label}</div>
      <div className="flex-1 bg-surface-muted rounded-full h-6 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }} />
      </div>
      <div className="w-12 text-right text-sm font-medium">{value}</div>
    </div>
  );
}
