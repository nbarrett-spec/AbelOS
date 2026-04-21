'use client';

import { useState, useEffect } from 'react';

const TABS = [
  { id: 'funnel', label: 'Conversion Funnel', icon: '📊' },
  { id: 'by-builder', label: 'By Builder', icon: '🏗️' },
  { id: 'by-category', label: 'By Category', icon: '📦' },
  { id: 'recovery', label: 'Recovery', icon: '🔄' },
  { id: 'trends', label: 'Trends', icon: '📈' },
];

function fmt$(v: any): string { const n = Number(v); return isNaN(n) ? '$0' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n); }
function fmtN(v: any): string { const n = Number(v); return isNaN(n) ? '0' : n.toLocaleString(); }
function fmtPct(v: any): string { const n = Number(v); return isNaN(n) ? '0%' : `${n.toFixed(1)}%`; }

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-200',
  SENT: 'bg-blue-400',
  VIEWED: 'bg-indigo-400',
  ACCEPTED: 'bg-green-400',
  ORDERED: 'bg-green-600',
  EXPIRED: 'bg-red-400',
  REJECTED: 'bg-red-600',
};

export default function QuoteConversionPage() {
  const [activeTab, setActiveTab] = useState('funnel');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  useEffect(() => { loadTab(activeTab); }, [activeTab]);

  const loadTab = async (tab: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ops/quotes/conversion?report=${tab}`);
      if (res.ok) setData(await res.json());
    } catch (e) { console.error('Load error:', e); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#1e3a5f] text-white px-8 py-8">
        <h1 className="text-3xl font-bold">Quote Conversion Tracking</h1>
        <p className="text-blue-100 mt-2">Find where quotes die and recover lost revenue</p>
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
          <div className="flex items-center justify-center py-20 text-gray-500">Analyzing quote data...</div>
        ) : data ? (
          <>
            {activeTab === 'funnel' && <FunnelTab data={data} />}
            {activeTab === 'by-builder' && <BuilderTab data={data} />}
            {activeTab === 'by-category' && <CategoryTab data={data} />}
            {activeTab === 'recovery' && <RecoveryTab data={data} />}
            {activeTab === 'trends' && <TrendsTab data={data} />}
          </>
        ) : null}
      </div>
    </div>
  );
}

function FunnelTab({ data }: { data: any }) {
  const funnel = data.funnel || [];
  const s = data.summary || {};
  const ttc = data.timeToConvert || {};
  const maxCount = Math.max(...funnel.map((f: any) => Number(f.count)));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPI label="Overall Conversion" value={fmtPct(s.overallConversionPct)} sub={`${fmtN(s.totalQuotes)} total quotes`} color="blue" />
        <KPI label="Sent-to-Order Rate" value={fmtPct(s.sentToOrderPct)} sub="Quotes sent that became orders" color={Number(s.sentToOrderPct) >= 40 ? 'green' : 'yellow'} />
        <KPI label="Expiration Rate" value={fmtPct(s.expirationRate)} sub={`${fmt$(s.totalRevenueLost)} expired value`} color={Number(s.expirationRate) > 20 ? 'red' : 'yellow'} />
        <KPI label="Avg Time to Convert" value={`${ttc.avgDays || '—'} days`} sub={`Min: ${ttc.minDays || '—'}d / Max: ${ttc.maxDays || '—'}d`} color="green" />
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">Quote Status Funnel</h2>
        <div className="space-y-4">
          {funnel.map((f: any, i: number) => {
            const pct = maxCount > 0 ? (Number(f.count) / maxCount) * 100 : 0;
            return (
              <div key={i} className="flex items-center gap-4">
                <div className="w-24 text-sm font-medium text-gray-700 shrink-0">{f.status}</div>
                <div className="flex-1 bg-gray-100 rounded-full h-10 overflow-hidden relative">
                  <div
                    className={`h-full rounded-full ${STATUS_COLORS[f.status] || 'bg-gray-300'}`}
                    style={{ width: `${Math.max(pct, 3)}%` }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-gray-800">
                    {f.count} quotes ({fmt$(f.totalValue)})
                  </span>
                </div>
                <div className="w-24 text-right text-sm text-gray-500">~{f.avgAge}d avg</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BuilderTab({ data }: { data: any }) {
  const builders = data.builders || [];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Conversion by Builder</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Builder', 'Total Quotes', 'Converted', 'Expired', 'Pending', 'Rate', 'Quoted Value', 'Converted Value', 'Lost Value'].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {builders.map((b: any, i: number) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-sm font-medium">{b.companyName}</td>
                <td className="px-4 py-2 text-sm">{fmtN(b.totalQuotes)}</td>
                <td className="px-4 py-2 text-sm text-green-600 font-medium">{fmtN(b.converted)}</td>
                <td className="px-4 py-2 text-sm text-red-600">{fmtN(b.expired)}</td>
                <td className="px-4 py-2 text-sm">{fmtN(b.pending)}</td>
                <td className="px-4 py-2 text-sm">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    Number(b.conversionPct) >= 50 ? 'bg-green-100 text-green-800' :
                    Number(b.conversionPct) >= 25 ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {fmtPct(b.conversionPct)}
                  </span>
                </td>
                <td className="px-4 py-2 text-sm">{fmt$(b.totalQuotedValue)}</td>
                <td className="px-4 py-2 text-sm text-green-600">{fmt$(b.convertedValue)}</td>
                <td className="px-4 py-2 text-sm text-red-600">{fmt$(b.expiredValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CategoryTab({ data }: { data: any }) {
  const cats = data.categories || [];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Conversion by Product Category</h2>
        <p className="text-sm text-gray-500 mt-1">Which product categories convert best from quotes to orders</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Category', 'Quotes Containing', 'Ordered', 'Rate', 'Total Quoted', 'Converted Value', 'Avg Unit Price'].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {cats.map((c: any, i: number) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-sm font-medium">{c.category}</td>
                <td className="px-4 py-2 text-sm">{fmtN(c.quotesContaining)}</td>
                <td className="px-4 py-2 text-sm text-green-600">{fmtN(c.orderedQuotes)}</td>
                <td className="px-4 py-2 text-sm">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    Number(c.conversionPct) >= 50 ? 'bg-green-100 text-green-800' :
                    Number(c.conversionPct) >= 25 ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {fmtPct(c.conversionPct)}
                  </span>
                </td>
                <td className="px-4 py-2 text-sm">{fmt$(c.totalQuotedValue)}</td>
                <td className="px-4 py-2 text-sm text-green-600">{fmt$(c.convertedValue)}</td>
                <td className="px-4 py-2 text-sm">{fmt$(c.avgUnitPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecoveryTab({ data }: { data: any }) {
  const recoverable = data.recoverable || [];
  const neverOrdered = data.neverOrdered || [];

  return (
    <div className="space-y-6">
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <p className="font-semibold text-green-800">Recovery Potential: {fmt$(data.totalRecoverableValue)}</p>
        <p className="text-green-600 text-sm mt-1">{recoverable.length} recently expired/stale quotes that could be revived with outreach</p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Recoverable Quotes</h2>
          <p className="text-sm text-gray-500 mt-1">Expired or stale quotes from the last 60 days worth $500+</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Builder', 'Project', 'Amount', 'Status', 'Days Old', 'Recent Orders', 'Email', 'Phone'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recoverable.map((r: any, i: number) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm font-medium">{r.companyName}</td>
                  <td className="px-4 py-2 text-sm">{r.projectName || '—'}</td>
                  <td className="px-4 py-2 text-sm font-semibold">{fmt$(r.totalAmount)}</td>
                  <td className="px-4 py-2 text-sm">{r.status}</td>
                  <td className="px-4 py-2 text-sm">{r.daysSinceCreated}d</td>
                  <td className="px-4 py-2 text-sm">{r.recentOrders > 0 ?
                    <span className="text-green-600">{r.recentOrders} (active)</span> :
                    <span className="text-gray-400">None</span>}
                  </td>
                  <td className="px-4 py-2 text-sm text-blue-600">{r.contactEmail || '—'}</td>
                  <td className="px-4 py-2 text-sm">{r.contactPhone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {neverOrdered.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-orange-200 overflow-hidden">
          <div className="bg-orange-500 text-white px-6 py-3 font-semibold">
            {neverOrdered.length} Builders Quoted But Never Ordered
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-orange-50 border-b border-orange-200">
                <tr>
                  {['Builder', 'Quotes Sent', 'Total Quoted', 'Last Quote', 'Email'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-orange-100">
                {neverOrdered.map((n: any, i: number) => (
                  <tr key={i} className="hover:bg-orange-50">
                    <td className="px-4 py-2 text-sm font-medium">{n.companyName}</td>
                    <td className="px-4 py-2 text-sm">{n.quoteCount}</td>
                    <td className="px-4 py-2 text-sm font-semibold">{fmt$(n.totalQuoted)}</td>
                    <td className="px-4 py-2 text-sm">{n.lastQuoteDate ? new Date(n.lastQuoteDate).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-2 text-sm text-blue-600">{n.contactEmail || '—'}</td>
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

function TrendsTab({ data }: { data: any }) {
  const monthly = data.monthly || [];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Monthly Conversion Trends</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Month', 'Total Quotes', 'Converted', 'Expired', 'Rate', 'Total Value', 'Converted Value'].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {monthly.map((m: any, i: number) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-sm font-medium">
                  {new Date(m.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </td>
                <td className="px-4 py-2 text-sm">{fmtN(m.totalQuotes)}</td>
                <td className="px-4 py-2 text-sm text-green-600 font-medium">{fmtN(m.converted)}</td>
                <td className="px-4 py-2 text-sm text-red-600">{fmtN(m.expired)}</td>
                <td className="px-4 py-2 text-sm">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    Number(m.conversionPct) >= 50 ? 'bg-green-100 text-green-800' :
                    Number(m.conversionPct) >= 25 ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {fmtPct(m.conversionPct)}
                  </span>
                </td>
                <td className="px-4 py-2 text-sm">{fmt$(m.totalValue)}</td>
                <td className="px-4 py-2 text-sm text-green-600">{fmt$(m.convertedValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
      <p className={`text-3xl font-bold ${tc[color] || tc.blue}`}>{value}</p>
      <p className="text-gray-500 text-xs mt-2">{sub}</p>
    </div>
  );
}
