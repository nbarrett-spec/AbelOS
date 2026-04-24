'use client';

import { useState, useEffect } from 'react';

const TABS = [
  { id: 'dashboard', label: 'Overview', icon: '🎯' },
  { id: 'stale-deals', label: 'Stale Deals', icon: '⏰' },
  { id: 'stale-quotes', label: 'Stale Quotes', icon: '📋' },
  { id: 'rep-activity', label: 'Rep Performance', icon: '👤' },
  { id: 'pipeline-velocity', label: 'Velocity', icon: '🚀' },
];

function fmt$(v: any): string { const n = Number(v); return isNaN(n) ? '$0' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n); }
function fmtN(v: any): string { const n = Number(v); return isNaN(n) ? '0' : n.toLocaleString(); }
function fmtPct(v: any): string { const n = Number(v); return isNaN(n) ? '0%' : `${n.toFixed(1)}%`; }

const STAGE_COLORS: Record<string, string> = {
  PROSPECT: 'bg-gray-100 text-gray-700',
  QUALIFIED: 'bg-blue-100 text-blue-700',
  PROPOSAL: 'bg-indigo-100 text-indigo-700',
  NEGOTIATION: 'bg-purple-100 text-purple-700',
  CONTRACT: 'bg-orange-100 text-orange-700',
  CLOSING: 'bg-yellow-100 text-yellow-700',
  WON: 'bg-green-100 text-green-700',
  LOST: 'bg-red-100 text-red-700',
};

const STALENESS_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-800',
  WARNING: 'bg-orange-100 text-orange-800',
  ATTENTION: 'bg-yellow-100 text-yellow-800',
  OK: 'bg-green-100 text-green-800',
};

export default function SalesIntelligencePage() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  useEffect(() => { loadTab(activeTab); }, [activeTab]);

  const loadTab = async (tab: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ops/sales/follow-ups?report=${tab}`);
      if (res.ok) setData(await res.json());
    } catch (e) { console.error('Load error:', e); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#1e3a5f] text-white px-8 py-8">
        <h1 className="text-3xl font-bold">Sales Intelligence</h1>
        <p className="text-blue-100 mt-2">AI-powered pipeline management and follow-up automation</p>
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
          <div className="flex items-center justify-center py-20 text-gray-500">Analyzing sales data...</div>
        ) : data ? (
          <>
            {activeTab === 'dashboard' && <DashboardTab data={data} />}
            {activeTab === 'stale-deals' && <StaleDealsTab data={data} />}
            {activeTab === 'stale-quotes' && <StaleQuotesTab data={data} />}
            {activeTab === 'rep-activity' && <RepActivityTab data={data} />}
            {activeTab === 'pipeline-velocity' && <VelocityTab data={data} />}
          </>
        ) : null}
      </div>
    </div>
  );
}

function DashboardTab({ data }: { data: any }) {
  const wr = data.winRate || {};
  const pq = data.pendingQuotes || {};

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPI label="Active Pipeline" value={fmt$(data.totalPipelineValue)} sub={`${fmtN(data.totalActiveDeals)} deals`} color="blue" />
        <KPI label="Win Rate (6mo)" value={fmtPct(wr.winRatePct)} sub={`${fmtN(wr.won)} won / ${fmtN(wr.lost)} lost`} color={Number(wr.winRatePct) >= 40 ? 'green' : 'yellow'} />
        <KPI label="Needs Follow-Up" value={fmtN(data.needsFollowUp?.count)} sub="7+ days no activity" color={Number(data.needsFollowUp?.count) > 5 ? 'red' : 'yellow'} />
        <KPI label="Stale Quotes" value={fmtN(pq.staleCount)} sub={`${fmt$(pq.staleValue)} at risk`} color={Number(pq.staleCount) > 0 ? 'orange' : 'green'} />
      </div>

      {/* Pipeline Funnel */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Pipeline Stages</h2>
        <div className="space-y-3">
          {(data.pipeline || []).map((s: any, i: number) => {
            const maxVal = Math.max(...(data.pipeline || []).map((p: any) => Number(p.totalValue)));
            const pct = maxVal > 0 ? (Number(s.totalValue) / maxVal) * 100 : 0;
            return (
              <div key={i} className="flex items-center gap-4">
                <div className="w-28 shrink-0">
                  <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${STAGE_COLORS[s.stage] || 'bg-gray-100'}`}>
                    {s.stage}
                  </span>
                </div>
                <div className="flex-1 bg-gray-100 rounded-full h-8 overflow-hidden">
                  <div className="h-full bg-[#1e3a5f] rounded-full" style={{ width: `${Math.max(pct, 2)}%` }} />
                </div>
                <div className="w-40 text-right text-sm">
                  <span className="font-semibold">{fmt$(s.totalValue)}</span>
                  <span className="text-gray-500 ml-2">({s.dealCount} deals, ~{s.avgDaysInPipeline}d avg)</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Needs Follow-Up */}
      {data.needsFollowUp?.count > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-orange-200 overflow-hidden">
          <div className="bg-orange-500 text-white px-6 py-3 font-semibold">
            {data.needsFollowUp.count} Deals Need Follow-Up (7+ days no activity)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-orange-50 border-b border-orange-200">
                <tr>
                  {['Deal', 'Company', 'Stage', 'Value', 'Days Since Activity', 'Assigned To'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-orange-100">
                {data.needsFollowUp.deals.map((d: any, i: number) => (
                  <tr key={i} className="hover:bg-orange-50">
                    <td className="px-4 py-2 text-sm font-medium">{d.title}</td>
                    <td className="px-4 py-2 text-sm">{d.companyName}</td>
                    <td className="px-4 py-2 text-sm">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STAGE_COLORS[d.stage] || ''}`}>{d.stage}</span>
                    </td>
                    <td className="px-4 py-2 text-sm font-semibold">{fmt$(d.value)}</td>
                    <td className="px-4 py-2 text-sm text-red-600 font-semibold">{d.daysSinceActivity}d</td>
                    <td className="px-4 py-2 text-sm">{d.assignedTo || '—'}</td>
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

function StaleDealsTab({ data }: { data: any }) {
  const deals = data.deals || [];
  const s = data.summary || {};

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPI label="Critical (30d+)" value={fmtN(s.critical)} sub="Likely lost without action" color="red" />
        <KPI label="Warning (14d+)" value={fmtN(s.warning)} sub="Losing momentum" color="orange" />
        <KPI label="Attention (7d+)" value={fmtN(s.attention)} sub="Needs a touch" color="yellow" />
        <KPI label="Total at Risk" value={fmt$(s.totalValue)} sub={`${deals.length} deals`} color="blue" />
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Status', 'Deal', 'Company', 'Stage', 'Value', 'Days Idle', 'Activities', 'Rep'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {deals.map((d: any, i: number) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STALENESS_COLORS[d.staleness] || ''}`}>
                      {d.staleness}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sm font-medium">{d.title}</td>
                  <td className="px-4 py-2 text-sm">{d.companyName}</td>
                  <td className="px-4 py-2 text-sm">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STAGE_COLORS[d.stage] || ''}`}>{d.stage}</span>
                  </td>
                  <td className="px-4 py-2 text-sm font-semibold">{fmt$(d.value)}</td>
                  <td className="px-4 py-2 text-sm text-red-600 font-medium">{d.daysSinceUpdate}d</td>
                  <td className="px-4 py-2 text-sm">{d.activityCount}</td>
                  <td className="px-4 py-2 text-sm">{d.assignedTo || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StaleQuotesTab({ data }: { data: any }) {
  const quotes = data.quotes || [];
  const s = data.summary || {};
  const healthColors: Record<string, string> = {
    VERY_STALE: 'bg-red-100 text-red-800',
    STALE: 'bg-orange-100 text-orange-800',
    DRAFT_STALE: 'bg-yellow-100 text-yellow-800',
    ACTIVE: 'bg-green-100 text-green-800',
    EXPIRED: 'bg-gray-100 text-gray-800',
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPI label="Very Stale (14d+)" value={fmtN(s.veryStale)} sub="High loss risk" color="red" />
        <KPI label="Stale (7d+)" value={fmtN(s.stale)} sub="Needs follow-up" color="orange" />
        <KPI label="Draft Stale (3d+)" value={fmtN(s.draftStale)} sub="Never sent" color="yellow" />
        <KPI label="Revenue at Risk" value={fmt$(s.totalAtRisk)} sub="Stale + very stale" color="blue" />
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Health', 'Builder', 'Project', 'Amount', 'Status', 'Days Old', 'Valid Until'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {quotes.map((q: any, i: number) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${healthColors[q.quoteHealth] || ''}`}>
                      {q.quoteHealth}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sm font-medium">{q.companyName}</td>
                  <td className="px-4 py-2 text-sm">{q.projectName || '—'}</td>
                  <td className="px-4 py-2 text-sm font-semibold">{fmt$(q.totalAmount)}</td>
                  <td className="px-4 py-2 text-sm">{q.status}</td>
                  <td className="px-4 py-2 text-sm">{q.daysOld}d</td>
                  <td className="px-4 py-2 text-sm text-gray-500">
                    {q.validUntil ? new Date(q.validUntil).toLocaleDateString() : '—'}
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

function RepActivityTab({ data }: { data: any }) {
  const reps = data.reps || [];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Sales Rep Scorecard</h2>
        <p className="text-sm text-gray-500 mt-1">Performance metrics per rep</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Rep', 'Active Deals', 'Pipeline Value', 'Recent Wins (90d)', 'Won Value', 'Stale Deals', 'Weekly Activities'].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {reps.map((r: any, i: number) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-sm font-medium">{r.repName || 'Unassigned'}</td>
                <td className="px-4 py-2 text-sm">{fmtN(r.activeDeals)}</td>
                <td className="px-4 py-2 text-sm font-semibold">{fmt$(r.pipelineValue)}</td>
                <td className="px-4 py-2 text-sm text-green-600 font-medium">{fmtN(r.recentWins)}</td>
                <td className="px-4 py-2 text-sm">{fmt$(r.recentWonValue)}</td>
                <td className="px-4 py-2 text-sm">
                  {Number(r.staleDeals) > 0 && (
                    <span className="bg-red-100 text-red-800 px-2 py-0.5 rounded text-xs font-medium">{r.staleDeals}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-sm">{fmtN(r.weeklyActivities)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VelocityTab({ data }: { data: any }) {
  const flow = data.monthlyFlow || [];
  const velocity = data.stageVelocity || [];

  return (
    <div className="space-y-6">
      {velocity.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Average Days to Reach Each Stage</h2>
          <div className="space-y-3">
            {velocity.map((v: any, i: number) => (
              <div key={i} className="flex items-center gap-4">
                <div className="w-36 text-sm text-gray-700 shrink-0">{v.toStage}</div>
                <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                  <div className="h-full bg-signal rounded-full" style={{ width: `${Math.min(Number(v.avgDaysToReach) * 2, 100)}%` }} />
                </div>
                <div className="w-32 text-right text-sm font-medium">{v.avgDaysToReach} days ({v.transitions} transitions)</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {flow.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Monthly Deal Flow</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Month', 'New Deals', 'New Value', 'Won Deals', 'Won Value'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {flow.map((f: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm font-medium">
                      {new Date(f.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-2 text-sm">{fmtN(f.newDeals)}</td>
                    <td className="px-4 py-2 text-sm">{fmt$(f.newValue)}</td>
                    <td className="px-4 py-2 text-sm text-green-600 font-medium">{fmtN(f.wonDeals)}</td>
                    <td className="px-4 py-2 text-sm font-semibold">{fmt$(f.wonValue)}</td>
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

function KPI({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  const bg: Record<string, string> = { green: 'bg-green-50 border-green-200', red: 'bg-red-50 border-red-200', yellow: 'bg-yellow-50 border-yellow-200', blue: 'bg-blue-50 border-blue-200', orange: 'bg-orange-50 border-orange-200' };
  const tc: Record<string, string> = { green: 'text-green-700', red: 'text-red-700', yellow: 'text-yellow-700', blue: 'text-blue-700', orange: 'text-orange-700' };
  return (
    <div className={`rounded-lg shadow-sm border p-6 ${bg[color] || bg.blue}`}>
      <p className="text-gray-600 text-sm font-medium mb-2">{label}</p>
      <p className={`text-3xl font-bold ${tc[color] || tc.blue}`}>{value}</p>
      <p className="text-gray-500 text-xs mt-2">{sub}</p>
    </div>
  );
}
