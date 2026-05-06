'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';

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
  const router = useRouter();
  const searchParams = useSearchParams();

  // A-UX-13: filters hydrate from URL on mount so deep-links and reloads preserve state.
  const [activeTab, setActiveTab] = useState('funnel');
  const [categoryFilter, setCategoryFilter] = useState(() => searchParams.get('category') || '');
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [monthFilter, setMonthFilter] = useState(() => searchParams.get('month') || '');
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

  // A-UX-13: sync filter state → URL so reload + Back/Forward + sharing all preserve filters.
  // router.replace with scroll:false avoids scroll-jumping on each keystroke.
  useEffect(() => {
    const params = new URLSearchParams();
    if (categoryFilter) params.set('category', categoryFilter);
    if (search) params.set('search', search);
    if (monthFilter) params.set('month', monthFilter);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }, [categoryFilter, search, monthFilter, router]);

  const clearFilters = useCallback(() => {
    setCategoryFilter('');
    setSearch('');
    setMonthFilter('');
  }, []);
  const hasActiveFilters = Boolean(categoryFilter || search || monthFilter);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="bg-surface-elevated text-white px-8 py-8">
        <h1 className="text-3xl font-semibold">Quote Conversion Tracking</h1>
        <p className="text-blue-100 mt-2">Find where quotes die and recover lost revenue</p>
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

      <div className="bg-surface-muted border-b border-border px-8 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap gap-3 items-center">
          <input
            type="text"
            placeholder="Search builder, project, quote #..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg text-sm w-64 focus:outline-none focus:border-signal bg-surface"
          />
          <input
            type="text"
            placeholder="Category (e.g. Doors)"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg text-sm w-48 focus:outline-none focus:border-signal bg-surface"
          />
          <input
            type="month"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:border-signal bg-surface"
          />
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-red-500 hover:text-red-700 font-medium"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-fg-muted">Analyzing quote data...</div>
        ) : data ? (
          <>
            {activeTab === 'funnel' && <FunnelTab data={data} />}
            {activeTab === 'by-builder' && <BuilderTab data={data} search={search} />}
            {activeTab === 'by-category' && <CategoryTab data={data} categoryFilter={categoryFilter} />}
            {activeTab === 'recovery' && <RecoveryTab data={data} search={search} monthFilter={monthFilter} />}
            {activeTab === 'trends' && <TrendsTab data={data} monthFilter={monthFilter} />}
          </>
        ) : (
          <EmptyState
            icon={<FileText className="w-8 h-8 text-fg-subtle" />}
            title="No conversion data"
            description="Conversion analytics will appear once quotes are created"
            size="full"
          />
        )}
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

      <div className="bg-surface rounded-lg shadow-sm border border-border p-6">
        <h2 className="text-lg font-semibold text-fg mb-6">Quote Status Funnel</h2>
        <div className="space-y-4">
          {funnel.map((f: any, i: number) => {
            const pct = maxCount > 0 ? (Number(f.count) / maxCount) * 100 : 0;
            return (
              <div key={i} className="flex items-center gap-4">
                <div className="w-24 text-sm font-medium text-fg shrink-0">{f.status}</div>
                <div className="flex-1 bg-surface-muted rounded-full h-10 overflow-hidden relative">
                  <div
                    className={`h-full rounded-full ${STATUS_COLORS[f.status] || 'bg-gray-300'}`}
                    style={{ width: `${Math.max(pct, 3)}%` }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-fg">
                    {f.count} quotes ({fmt$(f.totalValue)})
                  </span>
                </div>
                <div className="w-24 text-right text-sm text-fg-muted">~{f.avgAge}d avg</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BuilderTab({ data, search }: { data: any; search: string }) {
  const allBuilders = data.builders || [];
  const builders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allBuilders;
    return allBuilders.filter((b: any) =>
      String(b.companyName || '').toLowerCase().includes(q)
    );
  }, [allBuilders, search]);

  return (
    <div className="bg-surface rounded-lg shadow-sm border border-border overflow-hidden">
      <div className="px-6 py-4 border-b border-border">
        <h2 className="text-lg font-semibold text-fg">Conversion by Builder</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-surface-muted border-b border-border">
            <tr>
              {['Builder', 'Total Quotes', 'Converted', 'Expired', 'Pending', 'Rate', 'Quoted Value', 'Converted Value', 'Lost Value'].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-fg">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {builders.map((b: any, i: number) => (
              <tr key={i} className="hover:bg-row-hover">
                <td className="px-4 py-2 text-sm font-medium">
                  {b.builderId ? (
                    <Link href={`/ops/accounts/${b.builderId}`} className="text-signal hover:underline cursor-pointer">
                      {b.companyName}
                    </Link>
                  ) : (
                    b.companyName
                  )}
                </td>
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

function CategoryTab({ data, categoryFilter }: { data: any; categoryFilter: string }) {
  const allCats = data.categories || [];
  const cats = useMemo(() => {
    const q = categoryFilter.trim().toLowerCase();
    if (!q) return allCats;
    return allCats.filter((c: any) =>
      String(c.category || '').toLowerCase().includes(q)
    );
  }, [allCats, categoryFilter]);

  return (
    <div className="bg-surface rounded-lg shadow-sm border border-border overflow-hidden">
      <div className="px-6 py-4 border-b border-border">
        <h2 className="text-lg font-semibold text-fg">Conversion by Product Category</h2>
        <p className="text-sm text-fg-muted mt-1">Which product categories convert best from quotes to orders</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-surface-muted border-b border-border">
            <tr>
              {['Category', 'Quotes Containing', 'Ordered', 'Rate', 'Total Quoted', 'Converted Value', 'Avg Unit Price'].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-fg">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {cats.map((c: any, i: number) => (
              <tr key={i} className="hover:bg-row-hover">
                <td className="px-4 py-2 text-sm font-medium">
                  {c.category && c.category !== 'Unknown' ? (
                    // A-UX-13: this page now hydrates ?category= on mount (see top of component).
                    // /ops/products still doesn't read ?category= on mount — that drilldown is tracked separately.
                    <Link
                      href={`/ops/products?category=${encodeURIComponent(c.category)}`}
                      className="text-signal hover:underline cursor-pointer"
                    >
                      {c.category}
                    </Link>
                  ) : (
                    c.category
                  )}
                </td>
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

function RecoveryTab({ data, search, monthFilter }: { data: any; search: string; monthFilter: string }) {
  const allRecoverable = data.recoverable || [];
  const allNeverOrdered = data.neverOrdered || [];
  const recoverable = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRecoverable.filter((r: any) => {
      if (q) {
        const hay = `${r.quoteNumber || ''} ${r.companyName || ''} ${r.projectName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (monthFilter && r.createdAt) {
        const d = new Date(r.createdAt);
        if (!isNaN(d.getTime())) {
          const m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
          if (m !== monthFilter) return false;
        }
      }
      return true;
    });
  }, [allRecoverable, search, monthFilter]);
  const neverOrdered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allNeverOrdered;
    return allNeverOrdered.filter((n: any) =>
      String(n.companyName || '').toLowerCase().includes(q)
    );
  }, [allNeverOrdered, search]);

  return (
    <div className="space-y-6">
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <p className="font-semibold text-green-800">Recovery Potential: {fmt$(data.totalRecoverableValue)}</p>
        <p className="text-green-600 text-sm mt-1">{recoverable.length} recently expired/stale quotes that could be revived with outreach</p>
      </div>

      <div className="bg-surface rounded-lg shadow-sm border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-fg">Recoverable Quotes</h2>
          <p className="text-sm text-fg-muted mt-1">Expired or stale quotes from the last 60 days worth $500+</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-muted border-b border-border">
              <tr>
                {['Quote #', 'Builder', 'Project', 'Amount', 'Status', 'Days Old', 'Recent Orders', 'Email', 'Phone'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-fg">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recoverable.map((r: any, i: number) => (
                <tr key={i} className="hover:bg-row-hover">
                  <td className="px-4 py-2 text-sm font-mono">
                    {r.quoteNumber ? (
                      // A-UX-13: this page now hydrates ?search= on mount (see top of component).
                      // /ops/quotes still doesn't read ?search= on mount — that drilldown is tracked separately.
                      <Link href={`/ops/quotes?search=${encodeURIComponent(r.quoteNumber)}`} className="text-signal hover:underline cursor-pointer">
                        {r.quoteNumber}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm font-medium">
                    {r.builderId ? (
                      <Link href={`/ops/accounts/${r.builderId}`} className="text-signal hover:underline cursor-pointer">
                        {r.companyName}
                      </Link>
                    ) : (
                      r.companyName
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm">{r.projectName || '—'}</td>
                  <td className="px-4 py-2 text-sm font-semibold">{fmt$(r.total)}</td>
                  <td className="px-4 py-2 text-sm">{r.status}</td>
                  <td className="px-4 py-2 text-sm">{r.daysSinceCreated}d</td>
                  <td className="px-4 py-2 text-sm">{r.recentOrders > 0 ?
                    <span className="text-green-600">{r.recentOrders} (active)</span> :
                    <span className="text-fg-subtle">None</span>}
                  </td>
                  <td className="px-4 py-2 text-sm text-blue-600">{r.email || '—'}</td>
                  <td className="px-4 py-2 text-sm">{r.phone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {neverOrdered.length > 0 && (
        <div className="bg-surface rounded-lg shadow-sm border border-orange-200 overflow-hidden">
          <div className="bg-orange-500 text-white px-6 py-3 font-semibold">
            {neverOrdered.length} Builders Quoted But Never Ordered
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-orange-50 border-b border-orange-200">
                <tr>
                  {['Builder', 'Quotes Sent', 'Total Quoted', 'Last Quote', 'Email'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-fg">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-orange-100">
                {neverOrdered.map((n: any, i: number) => (
                  <tr key={i} className="hover:bg-orange-50">
                    <td className="px-4 py-2 text-sm font-medium">
                      {n.builderId ? (
                        <Link href={`/ops/accounts/${n.builderId}`} className="text-signal hover:underline cursor-pointer">
                          {n.companyName}
                        </Link>
                      ) : (
                        n.companyName
                      )}
                    </td>
                    <td className="px-4 py-2 text-sm">{n.quoteCount}</td>
                    <td className="px-4 py-2 text-sm font-semibold">{fmt$(n.totalQuoted)}</td>
                    <td className="px-4 py-2 text-sm">{n.lastQuoteDate ? new Date(n.lastQuoteDate).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-2 text-sm text-blue-600">{n.email || '—'}</td>
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

function TrendsTab({ data, monthFilter }: { data: any; monthFilter: string }) {
  const allMonthly = data.monthly || [];
  const monthly = useMemo(() => {
    if (!monthFilter) return allMonthly;
    return allMonthly.filter((m: any) => {
      if (!m.month) return false;
      const d = new Date(m.month);
      if (isNaN(d.getTime())) return false;
      const monthStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      return monthStr === monthFilter;
    });
  }, [allMonthly, monthFilter]);

  return (
    <div className="bg-surface rounded-lg shadow-sm border border-border overflow-hidden">
      <div className="px-6 py-4 border-b border-border">
        <h2 className="text-lg font-semibold text-fg">Monthly Conversion Trends</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-surface-muted border-b border-border">
            <tr>
              {['Month', 'Total Quotes', 'Converted', 'Expired', 'Rate', 'Total Value', 'Converted Value'].map((h) => (
                <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-fg">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {monthly.map((m: any, i: number) => {
              const d = m.month ? new Date(m.month) : null;
              const monthStr = d && !isNaN(d.getTime())
                ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
                : '';
              const monthLabel = d && !isNaN(d.getTime())
                ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
                : '—';
              return (
              <tr key={i} className="hover:bg-row-hover">
                <td className="px-4 py-2 text-sm font-medium">
                  {monthStr ? (
                    // A-UX-13: this page now hydrates ?month= on mount (see top of component).
                    // /ops/quotes still doesn't read ?month= on mount — that drilldown is tracked separately.
                    <Link href={`/ops/quotes?month=${monthStr}`} className="text-signal hover:underline cursor-pointer">
                      {monthLabel}
                    </Link>
                  ) : (
                    monthLabel
                  )}
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
              );
            })}
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
      <p className="text-fg-muted text-sm font-medium mb-2">{label}</p>
      <p className={`text-3xl font-semibold ${tc[color] || tc.blue}`}>{value}</p>
      <p className="text-fg-muted text-xs mt-2">{sub}</p>
    </div>
  );
}
