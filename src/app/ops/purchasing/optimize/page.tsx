'use client';

import { useState, useEffect } from 'react';
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardBody,
  KPICard,
  Badge,
  StatusBadge,
  EmptyState,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import {
  BarChart3,
  Scale,
  ClipboardList,
  Package,
  DollarSign,
  Receipt,
  AlertTriangle,
} from 'lucide-react';

const TABS: Array<{ id: string; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'dashboard',         label: 'Overview',          icon: BarChart3 },
  { id: 'vendor-comparison', label: 'Vendor Comparison', icon: Scale },
  { id: 'vendor-scorecard',  label: 'Vendor Scorecard',  icon: ClipboardList },
  { id: 'consolidation',     label: 'PO Consolidation',  icon: Package },
  { id: 'spend-analysis',    label: 'Spend Analysis',    icon: DollarSign },
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
    <div className="space-y-5 animate-enter">
      <PageHeader
        eyebrow="Procurement"
        title="Purchasing Optimization"
        description="Vendor intelligence, cost reduction, and procurement efficiency."
      />

      <div className="border-b border-border">
        <div className="flex gap-1 -mb-px overflow-x-auto scrollbar-thin">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  isActive
                    ? 'border-signal text-signal'
                    : 'border-transparent text-fg-muted hover:text-fg'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-fg-muted">
          Analyzing purchasing data...
        </div>
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
  );
}

function DashTab({ data }: { data: any }) {
  const po = data.poSummary || {};
  const vs = data.vendorSummary || {};
  const recent = data.recentPOs || [];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <KPICard
          title="Total PO Spend"
          accent="brand"
          value={fmt$(po.totalSpend)}
          subtitle={`${fmtN(po.totalPOs)} purchase orders`}
        />
        <KPICard
          title="Open POs"
          accent="accent"
          value={fmtN(po.openPOs)}
          subtitle={`${fmt$(po.openValue)} pending`}
        />
        <KPICard
          title="Active Vendors"
          accent="positive"
          value={fmtN(vs.activeVendors)}
          subtitle={`${Math.round((vs.avgOnTimeRate || 0) * 100)}% avg on-time`}
        />
        <KPICard
          title="Avg Lead Time"
          accent="neutral"
          value={`${po.avgLeadDays || '—'} days`}
          subtitle="Order to receipt"
        />
      </div>

      <Card variant="default" padding="none">
        <CardHeader>
          <div>
            <CardTitle>Recent Purchase Orders</CardTitle>
            <CardDescription>Most recent activity across all vendors.</CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          {recent.length === 0 ? (
            <EmptyState
              icon={<Receipt className="w-8 h-8 text-fg-subtle" />}
              title="No POs to display"
              description="Recent purchase orders will appear here once activity exists."
              size="default"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border">
                  <tr>
                    {['PO #', 'Vendor', 'Total', 'Status', 'Ordered', 'Expected'].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-[11px] uppercase tracking-wide font-semibold text-fg-subtle">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recent.map((p: any, i: number) => (
                    <tr key={i} className="hover:bg-row-hover">
                      <td className="px-4 py-2 text-sm font-mono text-fg">{p.poNumber}</td>
                      <td className="px-4 py-2 text-sm text-fg">{p.vendorName}</td>
                      <td className="px-4 py-2 text-sm font-semibold tabular-nums text-fg">{fmt$2(p.total)}</td>
                      <td className="px-4 py-2 text-sm">
                        <StatusBadge status={p.status} size="xs" />
                      </td>
                      <td className="px-4 py-2 text-sm tabular-nums text-fg-muted">{p.orderedAt ? new Date(p.orderedAt).toLocaleDateString() : '—'}</td>
                      <td className="px-4 py-2 text-sm tabular-nums text-fg-muted">{p.expectedDate ? new Date(p.expectedDate).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function ComparisonTab({ data }: { data: any }) {
  const multi = data.multiVendor || [];
  const single = data.singleSource || [];

  return (
    <div className="space-y-5">
      <Card variant="default" padding="none">
        <CardHeader>
          <div>
            <CardTitle>Multi-Vendor Price Comparison</CardTitle>
            <CardDescription>Products available from multiple vendors — sorted by price spread.</CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          {multi.length === 0 ? (
            <EmptyState
              icon={<Scale className="w-8 h-8 text-fg-subtle" />}
              title="No multi-vendor products"
              description="No products are sourced from multiple vendors yet."
              size="default"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border">
                  <tr>
                    {['SKU', 'Product', 'Category', 'Current Cost', 'Best Price', 'Worst Price', 'Spread', 'Vendors'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[11px] uppercase tracking-wide font-semibold text-fg-subtle">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {multi.map((m: any, i: number) => (
                    <tr key={i} className="hover:bg-row-hover">
                      <td className="px-3 py-2 text-sm font-mono text-fg-muted">{m.sku}</td>
                      <td className="px-3 py-2 text-sm text-fg">{m.name}</td>
                      <td className="px-3 py-2 text-sm text-fg-muted">{m.category}</td>
                      <td className="px-3 py-2 text-sm tabular-nums text-fg">{fmt$2(m.currentCost)}</td>
                      <td className="px-3 py-2 text-sm font-semibold tabular-nums text-data-positive">{fmt$2(m.bestCost)}</td>
                      <td className="px-3 py-2 text-sm tabular-nums text-data-negative">{fmt$2(m.worstCost)}</td>
                      <td className="px-3 py-2 text-sm font-semibold tabular-nums text-fg">{fmt$2(m.priceSpread)}</td>
                      <td className="px-3 py-2 text-sm tabular-nums text-fg-muted">{m.vendorCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {single.length > 0 && (
        <Card variant="default" padding="none">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-data-warning" />
              <div>
                <CardTitle>Single-Source Risk</CardTitle>
                <CardDescription>{single.length} products available from only one vendor.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border">
                  <tr>
                    {['SKU', 'Product', 'Category', 'Cost', 'Vendor', 'Lead Time'].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-[11px] uppercase tracking-wide font-semibold text-fg-subtle">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {single.map((s: any, i: number) => (
                    <tr key={i} className="hover:bg-row-hover">
                      <td className="px-4 py-2 text-sm font-mono text-fg-muted">{s.sku}</td>
                      <td className="px-4 py-2 text-sm text-fg">{s.name}</td>
                      <td className="px-4 py-2 text-sm text-fg-muted">{s.category}</td>
                      <td className="px-4 py-2 text-sm tabular-nums text-fg">{fmt$2(s.cost)}</td>
                      <td className="px-4 py-2 text-sm text-fg">{s.vendorName} <span className="text-fg-subtle font-mono text-xs">({s.vendorCode})</span></td>
                      <td className="px-4 py-2 text-sm tabular-nums text-fg-muted">{s.leadTimeDays ? `${s.leadTimeDays}d` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function ScorecardTab({ data }: { data: any }) {
  const vendors = data.vendors || [];
  return (
    <Card variant="default" padding="none">
      <CardHeader>
        <div>
          <CardTitle>Vendor Performance Scorecards</CardTitle>
          <CardDescription>Spend, on-time rate, and lead-time metrics by vendor.</CardDescription>
        </div>
      </CardHeader>
      <CardBody>
        {vendors.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="w-8 h-8 text-fg-subtle" />}
            title="No vendor scorecards"
            description="Scorecards will populate once PO history exists."
            size="default"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border">
                <tr>
                  {['Vendor', 'Code', 'Total POs', 'Total Spend', 'Products', 'On-Time Rate', 'Avg Lead Days', 'Contact'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-[11px] uppercase tracking-wide font-semibold text-fg-subtle">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {vendors.map((v: any, i: number) => {
                  const otr = Number(v.onTimeRate);
                  const variant: 'success' | 'warning' | 'danger' =
                    otr >= 0.9 ? 'success' : otr >= 0.75 ? 'warning' : 'danger';
                  return (
                    <tr key={i} className="hover:bg-row-hover">
                      <td className="px-3 py-2 text-sm font-medium text-fg">{v.name}</td>
                      <td className="px-3 py-2 text-sm font-mono text-fg-muted">{v.code}</td>
                      <td className="px-3 py-2 text-sm tabular-nums text-fg">{v.totalPOs}</td>
                      <td className="px-3 py-2 text-sm font-semibold tabular-nums text-fg">{fmt$(v.totalSpend)}</td>
                      <td className="px-3 py-2 text-sm tabular-nums text-fg">{v.productsSupplied}</td>
                      <td className="px-3 py-2 text-sm">
                        <Badge variant={variant} size="xs">{Math.round((v.onTimeRate || 0) * 100)}%</Badge>
                      </td>
                      <td className="px-3 py-2 text-sm tabular-nums text-fg-muted">{v.actualAvgLeadDays || v.avgLeadDays || '—'}d</td>
                      <td className="px-3 py-2 text-sm text-signal">{v.email || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ConsolidationTab({ data }: { data: any }) {
  const opps = data.opportunities || [];
  return (
    <div className="space-y-4">
      {opps.length === 0 ? (
        <Card variant="default" padding="md">
          <EmptyState
            icon={<Package className="w-8 h-8 text-fg-subtle" />}
            title="No consolidation opportunities"
            description="When multiple reorders can be combined for the same vendor, they'll appear here."
            size="default"
          />
        </Card>
      ) : (
        <>
          <div className="panel border-l-2 border-l-data-positive p-4">
            <div className="font-semibold text-fg">{opps.length} PO consolidation opportunities found</div>
            <div className="text-sm text-fg-muted mt-1">
              Combine multiple reorders into single POs to save on shipping and admin time.
            </div>
          </div>

          {opps.map((o: any, i: number) => (
            <Card key={i} variant="default" padding="md">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="font-semibold text-fg truncate">
                    {o.vendorName} <span className="text-fg-subtle font-mono text-xs">({o.vendorCode})</span>
                  </div>
                  <div className="text-sm text-fg-muted mt-0.5">{o.productsNeedingReorder} products need reorder</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="metric metric-md tabular-nums text-data-positive">{fmt$(o.estimatedPOValue)}</div>
                  <div className="text-[11px] text-fg-subtle">Estimated PO value</div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-border">
                    <tr>
                      {['SKU', 'Product', 'On Hand', 'Reorder Pt', 'Order Qty', 'Unit Cost'].map((h) => (
                        <th key={h} className="px-3 py-1.5 text-left text-[11px] uppercase tracking-wide font-semibold text-fg-subtle">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(o.products || []).map((p: any, j: number) => (
                      <tr key={j} className="hover:bg-row-hover">
                        <td className="px-3 py-1.5 text-sm font-mono text-fg-muted">{p.sku}</td>
                        <td className="px-3 py-1.5 text-sm text-fg">{p.name}</td>
                        <td className="px-3 py-1.5 text-sm tabular-nums text-fg">{p.onHand}</td>
                        <td className="px-3 py-1.5 text-sm tabular-nums text-fg-muted">{p.reorderPoint}</td>
                        <td className="px-3 py-1.5 text-sm font-semibold tabular-nums text-fg">{p.reorderQty}</td>
                        <td className="px-3 py-1.5 text-sm tabular-nums text-fg-muted">{fmt$2(p.vendorCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

function SpendTab({ data }: { data: any }) {
  const vendor = data.vendorSpend || [];
  const category = data.categorySpend || [];

  return (
    <div className="space-y-5">
      <Card variant="default" padding="none">
        <CardHeader>
          <div>
            <CardTitle>Spend by Vendor</CardTitle>
            <CardDescription>Rolling spend across 30, 90, and 365 days.</CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          {vendor.length === 0 ? (
            <EmptyState
              icon={<DollarSign className="w-8 h-8 text-fg-subtle" />}
              title="No vendor spend data"
              description="Vendor spend will appear once POs have been issued."
              size="default"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border">
                  <tr>
                    {['Vendor', 'Last 30d', 'Last 90d', 'Last 12mo', 'POs'].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-[11px] uppercase tracking-wide font-semibold text-fg-subtle">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {vendor.map((v: any, i: number) => (
                    <tr key={i} className="hover:bg-row-hover">
                      <td className="px-4 py-2 text-sm font-medium text-fg">{v.vendorName}</td>
                      <td className="px-4 py-2 text-sm tabular-nums text-fg">{fmt$(v.spend30d)}</td>
                      <td className="px-4 py-2 text-sm tabular-nums text-fg">{fmt$(v.spend90d)}</td>
                      <td className="px-4 py-2 text-sm font-semibold tabular-nums text-fg">{fmt$(v.spend365d)}</td>
                      <td className="px-4 py-2 text-sm tabular-nums text-fg-muted">{v.poCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card variant="default" padding="none">
        <CardHeader>
          <div>
            <CardTitle>Spend by Product Category</CardTitle>
            <CardDescription>Total spend, quantity, and average cost grouped by category.</CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          {category.length === 0 ? (
            <EmptyState
              icon={<Package className="w-8 h-8 text-fg-subtle" />}
              title="No category spend data"
              description="Category spend will populate once line items are recorded."
              size="default"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border">
                  <tr>
                    {['Category', 'Total Spend', 'Total Qty', 'POs', 'Avg Unit Cost'].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-[11px] uppercase tracking-wide font-semibold text-fg-subtle">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {category.map((c: any, i: number) => (
                    <tr key={i} className="hover:bg-row-hover">
                      <td className="px-4 py-2 text-sm font-medium text-fg">{c.category}</td>
                      <td className="px-4 py-2 text-sm font-semibold tabular-nums text-fg">{fmt$(c.totalSpend)}</td>
                      <td className="px-4 py-2 text-sm tabular-nums text-fg">{fmtN(c.totalQty)}</td>
                      <td className="px-4 py-2 text-sm tabular-nums text-fg-muted">{c.poCount}</td>
                      <td className="px-4 py-2 text-sm tabular-nums text-fg-muted">{fmt$2(c.avgUnitCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
