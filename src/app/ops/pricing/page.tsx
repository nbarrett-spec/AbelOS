'use client';

import { useState, useEffect } from 'react';
import { DollarSign } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';

interface OverviewData {
  productHealth: {
    totalProducts: number;
    activeProducts: number;
    avgMarginPct: number;
    minMarginPct: number;
    maxMarginPct: number;
    belowMinMargin: number;
    missingCost: number;
    missingPrice: number;
    totalMarginDollars: number;
  };
  customPricing: {
    totalCustomPrices: number;
    buildersWithCustomPricing: number;
    avgCustomMarginPct: number;
    customBelowMinMargin: number;
  };
  recentPerformance: {
    recentOrders: number;
    recentRevenue: number;
    recentGrossProfit: number;
    recentMarginPct: number;
  };
}

interface AlertData {
  totalAlerts: number;
  belowMinMargin: { count: number; items: any[] };
  belowCost: { count: number; items: any[] };
  missingCost: { count: number; items: any[] };
  stalePricing: { count: number; items: any[] };
}

interface BuilderMarginData {
  builders: any[];
  discountAnalysis: any[];
}

interface CategoryMarginData {
  catalogMargins: any[];
  soldMargins: any[];
}

interface OpportunityData {
  priceIncreaseTargets: { count: number; items: any[] };
  overDiscounted: { count: number; items: any[] };
  crossSellGaps: { count: number; items: any[] };
}

interface RevenueLeakData {
  expiredQuotes: { expiredCount: number; lostRevenue: number };
  conversionRate: {
    totalQuotes: number;
    convertedToOrder: number;
    expired: number;
    stillDraft: number;
    conversionPct: number;
  };
  paymentIssues: {
    overdue30: number;
    overdue60: number;
    overdue90: number;
    overdueAmount: number;
  };
}

const TABS = [
  { id: 'overview', label: 'Margin Overview', icon: '📊' },
  { id: 'alerts', label: 'Alerts', icon: '🚨' },
  { id: 'builders', label: 'Builder Margins', icon: '🏗️' },
  { id: 'categories', label: 'Category Analysis', icon: '📦' },
  { id: 'opportunities', label: 'Opportunities', icon: '💡' },
  { id: 'leaks', label: 'Revenue Leaks', icon: '💧' },
];

function formatCurrency(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(val));
}

function formatPct(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return '0%';
  return `${Number(val).toFixed(1)}%`;
}

function formatNum(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return '0';
  return Number(val).toLocaleString();
}

export default function PricingEnginePage() {
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [alerts, setAlerts] = useState<AlertData | null>(null);
  const [builderMargins, setBuilderMargins] = useState<BuilderMarginData | null>(null);
  const [categoryMargins, setCategoryMargins] = useState<CategoryMarginData | null>(null);
  const [opportunities, setOpportunities] = useState<OpportunityData | null>(null);
  const [leaks, setLeaks] = useState<RevenueLeakData | null>(null);

  useEffect(() => {
    loadTab(activeTab);
  }, [activeTab]);

  const loadTab = async (tab: string) => {
    setLoading(true);
    try {
      const reportMap: Record<string, string> = {
        overview: 'overview',
        alerts: 'alerts',
        builders: 'builder-margins',
        categories: 'category-margins',
        opportunities: 'opportunities',
        leaks: 'revenue-leaks',
      };
      const res = await fetch(`/api/ops/pricing/engine?report=${reportMap[tab]}`);
      if (res.ok) {
        const data = await res.json();
        switch (tab) {
          case 'overview': setOverview(data); break;
          case 'alerts': setAlerts(data); break;
          case 'builders': setBuilderMargins(data); break;
          case 'categories': setCategoryMargins(data); break;
          case 'opportunities': setOpportunities(data); break;
          case 'leaks': setLeaks(data); break;
        }
      }
    } catch (e) {
      console.error('Failed to load pricing data:', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-surface text-fg px-8 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Smart Pricing Engine</h1>
            <p className="text-fg-muted mt-2">AI-powered margin analysis and optimization</p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => loadTab(activeTab)}
              className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm transition-colors"
            >
              Refresh Data
            </button>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white border-b border-gray-200 px-8">
        <div className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-signal text-signal'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <span className="mr-1">{tab.icon}</span> {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-gray-500">Analyzing pricing data...</div>
          </div>
        ) : (
          <>
            {activeTab === 'overview' && overview && <OverviewTab data={overview} />}
            {activeTab === 'alerts' && alerts && <AlertsTab data={alerts} />}
            {activeTab === 'builders' && builderMargins && <BuilderMarginsTab data={builderMargins} />}
            {activeTab === 'categories' && categoryMargins && <CategoryMarginsTab data={categoryMargins} />}
            {activeTab === 'opportunities' && opportunities && <OpportunitiesTab data={opportunities} />}
            {activeTab === 'leaks' && leaks && <RevenueLeaksTab data={leaks} />}
          </>
        )}
      </div>
    </div>
  );
}

// ==================== OVERVIEW TAB ====================
function OverviewTab({ data }: { data: OverviewData }) {
  const ph = data.productHealth;
  const cp = data.customPricing;
  const rp = data.recentPerformance;

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPICard
          label="Average Margin"
          value={formatPct(ph.avgMarginPct)}
          sub={`Range: ${formatPct(ph.minMarginPct)} - ${formatPct(ph.maxMarginPct)}`}
          color={Number(ph.avgMarginPct) >= 25 ? 'green' : Number(ph.avgMarginPct) >= 15 ? 'yellow' : 'red'}
        />
        <KPICard
          label="90-Day Revenue"
          value={formatCurrency(rp.recentRevenue)}
          sub={`${formatNum(rp.recentOrders)} orders`}
          color="blue"
        />
        <KPICard
          label="90-Day Gross Profit"
          value={formatCurrency(rp.recentGrossProfit)}
          sub={`${formatPct(rp.recentMarginPct)} realized margin`}
          color="green"
        />
        <KPICard
          label="Pricing Alerts"
          value={String(Number(ph.belowMinMargin) + Number(ph.missingCost))}
          sub={`${ph.belowMinMargin} below target, ${ph.missingCost} missing cost`}
          color={Number(ph.belowMinMargin) > 0 ? 'red' : 'green'}
        />
      </div>

      {/* Product Health */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Product Catalog Health</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <Stat label="Active Products" value={formatNum(ph.activeProducts)} />
          <Stat label="Below Min Margin" value={formatNum(ph.belowMinMargin)} alert={Number(ph.belowMinMargin) > 0} />
          <Stat label="Missing Cost Data" value={formatNum(ph.missingCost)} alert={Number(ph.missingCost) > 0} />
          <Stat label="Missing Price" value={formatNum(ph.missingPrice)} alert={Number(ph.missingPrice) > 0} />
        </div>
      </div>

      {/* Custom Pricing Health */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Custom Builder Pricing</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <Stat label="Total Custom Prices" value={formatNum(cp.totalCustomPrices)} />
          <Stat label="Builders w/ Custom Pricing" value={formatNum(cp.buildersWithCustomPricing)} />
          <Stat label="Avg Custom Margin" value={formatPct(cp.avgCustomMarginPct)} />
          <Stat label="Below Min Margin" value={formatNum(cp.customBelowMinMargin)} alert={Number(cp.customBelowMinMargin) > 0} />
        </div>
      </div>
    </div>
  );
}

// ==================== ALERTS TAB ====================
function AlertsTab({ data }: { data: AlertData }) {
  return (
    <div className="space-y-6">
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
        <span className="text-2xl">🚨</span>
        <div>
          <p className="font-semibold text-red-800">{data.totalAlerts} pricing alerts require attention</p>
          <p className="text-red-600 text-sm">
            {data.belowCost.count} selling below cost | {data.belowMinMargin.count} below min margin | {data.missingCost.count} missing cost
          </p>
        </div>
      </div>

      {/* Below Cost - CRITICAL */}
      {data.belowCost.count > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-red-300 overflow-hidden">
          <div className="bg-red-600 text-white px-6 py-3 font-semibold">
            CRITICAL: {data.belowCost.count} Custom Prices Below Cost (Losing Money)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-red-50 border-b border-red-200">
                <tr>
                  {['SKU', 'Product', 'Builder', 'Cost', 'Custom Price', 'Loss/Unit'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-red-900">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-red-100">
                {data.belowCost.items.map((item, i) => (
                  <tr key={i} className="hover:bg-red-50">
                    <td className="px-4 py-2 text-sm font-mono">{item.sku}</td>
                    <td className="px-4 py-2 text-sm">{item.name}</td>
                    <td className="px-4 py-2 text-sm">{item.companyName}</td>
                    <td className="px-4 py-2 text-sm">{formatCurrency(item.cost)}</td>
                    <td className="px-4 py-2 text-sm text-red-600 font-semibold">{formatCurrency(item.customPrice)}</td>
                    <td className="px-4 py-2 text-sm text-red-600 font-bold">{formatCurrency(item.lossPerUnit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Below Min Margin */}
      {data.belowMinMargin.count > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-yellow-300 overflow-hidden">
          <div className="bg-yellow-500 text-white px-6 py-3 font-semibold">
            {data.belowMinMargin.count} Products Below Minimum Margin Target
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-yellow-50 border-b border-yellow-200">
                <tr>
                  {['SKU', 'Product', 'Category', 'Cost', 'Price', 'Current Margin', 'Target'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-yellow-900">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-yellow-100">
                {data.belowMinMargin.items.slice(0, 20).map((item, i) => (
                  <tr key={i} className="hover:bg-yellow-50">
                    <td className="px-4 py-2 text-sm font-mono">{item.sku}</td>
                    <td className="px-4 py-2 text-sm">{item.name}</td>
                    <td className="px-4 py-2 text-sm">{item.category}</td>
                    <td className="px-4 py-2 text-sm">{formatCurrency(item.cost)}</td>
                    <td className="px-4 py-2 text-sm">{formatCurrency(item.basePrice)}</td>
                    <td className="px-4 py-2 text-sm text-yellow-700 font-semibold">{formatPct(item.currentMarginPct)}</td>
                    <td className="px-4 py-2 text-sm">{formatPct(item.targetMarginPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Missing Cost */}
      {data.missingCost.count > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-300 overflow-hidden">
          <div className="bg-gray-600 text-white px-6 py-3 font-semibold">
            {data.missingCost.count} Active Products Missing Cost Data
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['SKU', 'Product', 'Category', 'Base Price', 'Issue'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.missingCost.items.slice(0, 20).map((item, i) => (
                  <tr key={i} className="hover:bg-row-hover">
                    <td className="px-4 py-2 text-sm font-mono">{item.sku}</td>
                    <td className="px-4 py-2 text-sm">{item.name}</td>
                    <td className="px-4 py-2 text-sm">{item.category}</td>
                    <td className="px-4 py-2 text-sm">{formatCurrency(item.basePrice)}</td>
                    <td className="px-4 py-2 text-sm text-gray-500">No cost = can't calculate margin</td>
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

// ==================== BUILDER MARGINS TAB ====================
function BuilderMarginsTab({ data }: { data: BuilderMarginData }) {
  return (
    <div className="space-y-6">
      {/* Builder Profitability */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Builder Profitability (from Orders)</h2>
          <p className="text-sm text-gray-500 mt-1">Margin analysis based on actual order history</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Builder', 'Orders', 'Revenue', 'Gross Profit', 'Margin %', 'Products', 'Last Order'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.builders.map((b, i) => (
                <tr key={i} className="hover:bg-row-hover">
                  <td className="px-4 py-2 text-sm font-medium">{b.companyName}</td>
                  <td className="px-4 py-2 text-sm">{formatNum(b.orderCount)}</td>
                  <td className="px-4 py-2 text-sm">{formatCurrency(b.totalRevenue)}</td>
                  <td className="px-4 py-2 text-sm">{formatCurrency(b.totalGrossProfit)}</td>
                  <td className="px-4 py-2 text-sm">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      Number(b.avgMarginPct) >= 25 ? 'bg-green-100 text-green-800' :
                      Number(b.avgMarginPct) >= 15 ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {formatPct(b.avgMarginPct)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sm">{formatNum(b.uniqueProducts)}</td>
                  <td className="px-4 py-2 text-sm text-gray-500">
                    {b.lastOrderDate ? new Date(b.lastOrderDate).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Discount Analysis */}
      {data.discountAnalysis.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Custom Pricing Discount Analysis</h2>
            <p className="text-sm text-gray-500 mt-1">How much below base price each builder is getting</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Builder', 'Custom Prices', 'Avg Discount', 'Total Discount $', 'Custom Margin %'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.discountAnalysis.map((d, i) => (
                  <tr key={i} className="hover:bg-row-hover">
                    <td className="px-4 py-2 text-sm font-medium">{d.companyName}</td>
                    <td className="px-4 py-2 text-sm">{formatNum(d.customPriceCount)}</td>
                    <td className="px-4 py-2 text-sm">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        Number(d.avgDiscountPct) > 20 ? 'bg-red-100 text-red-800' :
                        Number(d.avgDiscountPct) > 10 ? 'bg-yellow-100 text-yellow-800' :
                        'bg-green-100 text-green-800'
                      }`}>
                        {formatPct(d.avgDiscountPct)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-sm">{formatCurrency(d.totalDiscountDollars)}</td>
                    <td className="px-4 py-2 text-sm">{formatPct(d.avgCustomMarginPct)}</td>
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

// ==================== CATEGORY MARGINS TAB ====================
function CategoryMarginsTab({ data }: { data: CategoryMarginData }) {
  return (
    <div className="space-y-6">
      {/* Catalog Margins */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Catalog Margins by Category</h2>
          <p className="text-sm text-gray-500 mt-1">Based on base price vs cost for all active products</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Category', 'Products', 'Avg Cost', 'Avg Price', 'Avg Margin', 'Min Margin', 'Max Margin', 'Below Target'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.catalogMargins.map((c, i) => (
                <tr key={i} className="hover:bg-row-hover">
                  <td className="px-4 py-2 text-sm font-medium">{c.category}</td>
                  <td className="px-4 py-2 text-sm">{formatNum(c.productCount)}</td>
                  <td className="px-4 py-2 text-sm">{formatCurrency(c.avgCost)}</td>
                  <td className="px-4 py-2 text-sm">{formatCurrency(c.avgPrice)}</td>
                  <td className="px-4 py-2 text-sm">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      Number(c.avgMarginPct) >= 25 ? 'bg-green-100 text-green-800' :
                      Number(c.avgMarginPct) >= 15 ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {formatPct(c.avgMarginPct)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sm">{formatPct(c.minMarginPct)}</td>
                  <td className="px-4 py-2 text-sm">{formatPct(c.maxMarginPct)}</td>
                  <td className="px-4 py-2 text-sm">
                    {Number(c.belowTarget) > 0 && (
                      <span className="bg-red-100 text-red-800 px-2 py-0.5 rounded text-xs font-medium">
                        {c.belowTarget}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Realized Margins from Sales */}
      {data.soldMargins.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Realized Margins (from Actual Sales)</h2>
            <p className="text-sm text-gray-500 mt-1">What Abel actually earned on orders placed</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Category', 'Line Items', 'Revenue', 'Gross Profit', 'Realized Margin'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.soldMargins.map((s, i) => (
                  <tr key={i} className="hover:bg-row-hover">
                    <td className="px-4 py-2 text-sm font-medium">{s.category}</td>
                    <td className="px-4 py-2 text-sm">{formatNum(s.lineItems)}</td>
                    <td className="px-4 py-2 text-sm">{formatCurrency(s.revenue)}</td>
                    <td className="px-4 py-2 text-sm">{formatCurrency(s.grossProfit)}</td>
                    <td className="px-4 py-2 text-sm">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        Number(s.realizedMarginPct) >= 25 ? 'bg-green-100 text-green-800' :
                        Number(s.realizedMarginPct) >= 15 ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {formatPct(s.realizedMarginPct)}
                      </span>
                    </td>
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

// ==================== OPPORTUNITIES TAB ====================
function OpportunitiesTab({ data }: { data: OpportunityData }) {
  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
        <span className="text-2xl">💡</span>
        <div>
          <p className="font-semibold text-green-800">
            {data.priceIncreaseTargets.count + data.overDiscounted.count + data.crossSellGaps.count} optimization opportunities identified
          </p>
          <p className="text-green-600 text-sm">
            {data.priceIncreaseTargets.count} price increase targets | {data.overDiscounted.count} over-discounted accounts | {data.crossSellGaps.count} cross-sell gaps
          </p>
        </div>
      </div>

      {/* Price Increase Targets */}
      {data.priceIncreaseTargets.count > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Price Increase Targets</h2>
            <p className="text-sm text-gray-500 mt-1">High-volume products with below-average margins for their category</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['SKU', 'Product', 'Category', 'Current Margin', 'Category Avg', 'Gap', 'Revenue'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.priceIncreaseTargets.items.map((item, i) => (
                  <tr key={i} className="hover:bg-row-hover">
                    <td className="px-4 py-2 text-sm font-mono">{item.sku}</td>
                    <td className="px-4 py-2 text-sm">{item.name}</td>
                    <td className="px-4 py-2 text-sm">{item.category}</td>
                    <td className="px-4 py-2 text-sm text-yellow-700 font-medium">{formatPct(item.marginPct)}</td>
                    <td className="px-4 py-2 text-sm">{formatPct(item.categoryAvgMargin)}</td>
                    <td className="px-4 py-2 text-sm text-red-600 font-medium">-{formatPct(item.marginGapVsCategory)}</td>
                    <td className="px-4 py-2 text-sm">{formatCurrency(item.totalRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Over-Discounted Builders */}
      {data.overDiscounted.count > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Over-Discounted Accounts</h2>
            <p className="text-sm text-gray-500 mt-1">Builders getting 15%+ discounts — review if justified by volume</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Builder', 'Custom Prices', 'Avg Discount', 'Orders', 'Total Spend'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.overDiscounted.items.map((d, i) => (
                  <tr key={i} className="hover:bg-row-hover">
                    <td className="px-4 py-2 text-sm font-medium">{d.companyName}</td>
                    <td className="px-4 py-2 text-sm">{d.customPriceCount}</td>
                    <td className="px-4 py-2 text-sm text-red-600 font-medium">{formatPct(d.avgDiscountPct)}</td>
                    <td className="px-4 py-2 text-sm">{formatNum(d.orderCount)}</td>
                    <td className="px-4 py-2 text-sm">{formatCurrency(d.totalSpend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cross-Sell Gaps */}
      {data.crossSellGaps.count > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Cross-Sell Opportunities</h2>
            <p className="text-sm text-gray-500 mt-1">Builders buying some categories but not others</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Builder', 'Categories Purchased', 'Missing Categories'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.crossSellGaps.items.map((g, i) => (
                  <tr key={i} className="hover:bg-row-hover">
                    <td className="px-4 py-2 text-sm font-medium">{g.companyName}</td>
                    <td className="px-4 py-2 text-sm">
                      {(g.purchasedCategories || []).map((c: string) => (
                        <span key={c} className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded mr-1 mb-1">{c}</span>
                      ))}
                    </td>
                    <td className="px-4 py-2 text-sm">
                      <span className="text-orange-600 font-medium">{g.missingCategoryCount} categories</span>
                    </td>
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

// ==================== REVENUE LEAKS TAB ====================
function RevenueLeaksTab({ data }: { data: RevenueLeakData }) {
  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPICard
          label="Expired Quotes (6mo)"
          value={formatNum(data.expiredQuotes.expiredCount)}
          sub={`${formatCurrency(data.expiredQuotes.lostRevenue)} lost revenue`}
          color="red"
        />
        <KPICard
          label="Quote Conversion Rate"
          value={formatPct(data.conversionRate.conversionPct)}
          sub={`${data.conversionRate.convertedToOrder} of ${data.conversionRate.totalQuotes} quotes`}
          color={Number(data.conversionRate.conversionPct) >= 50 ? 'green' : 'yellow'}
        />
        <KPICard
          label="Overdue Payments (30d+)"
          value={formatNum(data.paymentIssues.overdue30)}
          sub={formatCurrency(data.paymentIssues.overdueAmount)}
          color={Number(data.paymentIssues.overdue30) > 0 ? 'red' : 'green'}
        />
        <KPICard
          label="Severely Overdue (90d+)"
          value={formatNum(data.paymentIssues.overdue90)}
          sub="Needs immediate action"
          color={Number(data.paymentIssues.overdue90) > 0 ? 'red' : 'green'}
        />
      </div>

      {/* Quote Funnel */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quote Conversion Funnel (Last 6 Months)</h2>
        <div className="space-y-3">
          <FunnelBar label="Total Quotes" value={data.conversionRate.totalQuotes} max={data.conversionRate.totalQuotes} color="#1e3a5f" />
          <FunnelBar label="Converted to Order" value={data.conversionRate.convertedToOrder} max={data.conversionRate.totalQuotes} color="#27ae60" />
          <FunnelBar label="Still in Draft" value={data.conversionRate.stillDraft} max={data.conversionRate.totalQuotes} color="#D4B96A" />
          <FunnelBar label="Expired" value={data.conversionRate.expired} max={data.conversionRate.totalQuotes} color="#e74c3c" />
        </div>
      </div>

      {/* AR Aging */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Accounts Receivable Aging</h2>
        <div className="grid grid-cols-3 gap-6">
          <div className="text-center p-4 bg-yellow-50 rounded-lg">
            <p className="text-3xl font-bold text-yellow-600">{formatNum(data.paymentIssues.overdue30)}</p>
            <p className="text-sm text-gray-600 mt-1">30+ Days Overdue</p>
          </div>
          <div className="text-center p-4 bg-orange-50 rounded-lg">
            <p className="text-3xl font-bold text-orange-600">{formatNum(data.paymentIssues.overdue60)}</p>
            <p className="text-sm text-gray-600 mt-1">60+ Days Overdue</p>
          </div>
          <div className="text-center p-4 bg-red-50 rounded-lg">
            <p className="text-3xl font-bold text-red-600">{formatNum(data.paymentIssues.overdue90)}</p>
            <p className="text-sm text-gray-600 mt-1">90+ Days Overdue</p>
          </div>
        </div>
        <p className="text-center mt-4 text-gray-500 text-sm">
          Total overdue amount: <span className="font-semibold text-red-600">{formatCurrency(data.paymentIssues.overdueAmount)}</span>
        </p>
      </div>
    </div>
  );
}

// ==================== SHARED COMPONENTS ====================
function KPICard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  const colors: Record<string, string> = {
    green: 'bg-green-50 border-green-200',
    red: 'bg-red-50 border-red-200',
    yellow: 'bg-yellow-50 border-yellow-200',
    blue: 'bg-blue-50 border-blue-200',
  };
  const textColors: Record<string, string> = {
    green: 'text-green-700',
    red: 'text-red-700',
    yellow: 'text-yellow-700',
    blue: 'text-blue-700',
  };
  return (
    <div className={`rounded-lg shadow-sm border p-6 ${colors[color] || colors.blue}`}>
      <p className="text-gray-600 text-sm font-medium mb-2">{label}</p>
      <p className={`text-3xl font-bold ${textColors[color] || textColors.blue}`}>{value}</p>
      <p className="text-gray-500 text-xs mt-2">{sub}</p>
    </div>
  );
}

function Stat({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div>
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${alert ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-4">
      <div className="w-44 text-sm text-gray-700 shrink-0">{label}</div>
      <div className="flex-1 bg-gray-100 rounded-full h-8 relative overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }}
        />
      </div>
      <div className="w-20 text-right text-sm font-medium text-gray-900">{formatNum(value)}</div>
    </div>
  );
}
