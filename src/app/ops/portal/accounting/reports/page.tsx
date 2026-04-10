'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';

type Tab = 'pnl' | 'cash-flow' | 'job-profitability';

interface MonthlyPnL {
  month: string;
  revenue: number;
  expenses: number;
  netIncome: number;
  marginPercent: number;
}

interface BuilderRevenue {
  builderName: string;
  revenue: number;
}

interface VendorExpense {
  vendorName: string;
  expenses: number;
}

interface PnLData {
  monthlyData: MonthlyPnL[];
  topBuilders: BuilderRevenue[];
  topVendors: VendorExpense[];
  grossMarginPercent: number;
}

interface WeekCashFlow {
  week: number;
  expectedARCollections: number;
  expectedAPPayments: number;
  netFlow: number;
  runningBalance: number;
}

interface CashFlowData {
  currentCashPosition: number;
  eightWeekProjection: WeekCashFlow[];
}

interface Job {
  jobNumber: string;
  builderName: string;
  revenue: number;
  costs: number;
  grossProfit: number;
  marginPercent: number;
}

interface JobProfitabilityData {
  jobs: Job[];
  averageMargin: number;
  totalRevenue: number;
  totalCosts: number;
  totalProfit: number;
  profitableCount: number;
  unprofitableCount: number;
}

export default function FinancialReportsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('pnl');
  const [pnlData, setPnlData] = useState<PnLData | null>(null);
  const [cashFlowData, setCashFlowData] = useState<CashFlowData | null>(null);
  const [jobProfitabilityData, setJobProfitabilityData] = useState<JobProfitabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortJobsByMargin, setSortJobsByMargin] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [pnlRes, cashFlowRes, jobCostingRes] = await Promise.all([
          fetch('/api/ops/accounting-command?section=pnl'),
          fetch('/api/ops/accounting-command?section=cash-flow'),
          fetch('/api/ops/accounting-command?section=job-costing'),
        ]);

        if (!pnlRes.ok || !cashFlowRes.ok || !jobCostingRes.ok) {
          throw new Error('Failed to fetch financial data');
        }

        const pnlJson: PnLData = await pnlRes.json();
        const cashFlowJson: CashFlowData = await cashFlowRes.json();
        const jobCostingJson: JobProfitabilityData = await jobCostingRes.json();

        setPnlData(pnlJson);
        setCashFlowData(cashFlowJson);
        setJobProfitabilityData(jobCostingJson);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number): string => {
    return `${value.toFixed(1)}%`;
  };

  const getMarginColor = (margin: number): string => {
    if (margin < 15) return 'text-red-400';
    if (margin < 30) return 'text-amber-400';
    return 'text-emerald-400';
  };

  const getMarginBgColor = (margin: number): string => {
    if (margin < 15) return 'bg-red-950';
    if (margin < 30) return 'bg-amber-950';
    return 'bg-emerald-950';
  };

  const sortedJobs = jobProfitabilityData
    ? [...jobProfitabilityData.jobs].sort((a: Job, b: Job) =>
        sortJobsByMargin ? a.marginPercent - b.marginPercent : b.marginPercent - a.marginPercent
      )
    : [];

  const LoadingSkeleton = () => (
    <div className="space-y-4">
      <div className="h-10 bg-gray-800 rounded animate-pulse"></div>
      <div className="h-64 bg-gray-800 rounded animate-pulse"></div>
    </div>
  );

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 p-8">
        <div className="mb-6">
          <Link
            href="/ops/portal/accounting"
            className="inline-flex items-center gap-2 text-amber-400 hover:text-amber-300"
          >
            <ChevronLeft size={20} />
            Back to Accounting
          </Link>
        </div>
        <div className="bg-red-950 border border-red-800 rounded-lg p-6 text-red-200">
          <div className="flex items-start gap-3">
            <AlertTriangle size={24} className="flex-shrink-0 mt-1" />
            <div>
              <h2 className="text-lg font-semibold mb-1">Error Loading Financial Data</h2>
              <p>{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/ops/portal/accounting"
          className="inline-flex items-center gap-2 text-amber-400 hover:text-amber-300 mb-4"
        >
          <ChevronLeft size={20} />
          Back to Accounting
        </Link>
        <h1 className="text-4xl font-bold text-white mb-2">Financial Reports</h1>
        <p className="text-gray-400">Comprehensive financial performance dashboard</p>
      </div>

      {/* Tab Navigation */}
      <div className="mb-8 border-b border-gray-800">
        <div className="flex gap-8">
          {(['pnl', 'cash-flow', 'job-profitability'] as const).map((tab: Tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-4 font-semibold transition-colors relative ${
                activeTab === tab
                  ? 'text-white'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              {tab === 'pnl' && 'P&L'}
              {tab === 'cash-flow' && 'Cash Flow'}
              {tab === 'job-profitability' && 'Job Profitability'}
              {activeTab === tab && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-amber-400"></div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="space-y-8">
        {loading ? (
          <LoadingSkeleton />
        ) : (
          <>
            {/* P&L Tab */}
            {activeTab === 'pnl' && pnlData && (
              <div className="space-y-8">
                {/* Gross Margin Card */}
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                  <h2 className="text-sm font-semibold text-gray-400 mb-2">Overall Gross Margin</h2>
                  <div className="text-5xl font-bold text-amber-400">
                    {formatPercent(pnlData.grossMarginPercent)}
                  </div>
                </div>

                {/* Monthly Summary Table */}
                <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-800">
                    <h2 className="text-lg font-semibold text-white">Monthly Summary (Last 12 Months)</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-800">
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-400">Month</th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Revenue</th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Expenses</th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Net Income</th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Margin %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pnlData.monthlyData.map((month: MonthlyPnL, idx: number) => (
                          <tr
                            key={month.month}
                            className={idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-900'}
                          >
                            <td className="px-6 py-4 text-white font-medium">{month.month}</td>
                            <td className="px-6 py-4 text-right text-white">{formatCurrency(month.revenue)}</td>
                            <td className="px-6 py-4 text-right text-white">{formatCurrency(month.expenses)}</td>
                            <td
                              className={`px-6 py-4 text-right font-semibold ${
                                month.netIncome >= 0 ? 'text-emerald-400' : 'text-red-400'
                              }`}
                            >
                              {formatCurrency(month.netIncome)}
                            </td>
                            <td className={`px-6 py-4 text-right font-semibold ${getMarginColor(month.marginPercent)}`}>
                              {formatPercent(month.marginPercent)}
                            </td>
                          </tr>
                        ))}
                        {/* Totals Row */}
                        <tr className="bg-gray-900 border-t border-gray-800 font-bold">
                          <td className="px-6 py-4 text-white">Total</td>
                          <td className="px-6 py-4 text-right text-white">
                            {formatCurrency(pnlData.monthlyData.reduce((sum: number, m: MonthlyPnL) => sum + m.revenue, 0))}
                          </td>
                          <td className="px-6 py-4 text-right text-white">
                            {formatCurrency(pnlData.monthlyData.reduce((sum: number, m: MonthlyPnL) => sum + m.expenses, 0))}
                          </td>
                          <td className="px-6 py-4 text-right text-emerald-400">
                            {formatCurrency(pnlData.monthlyData.reduce((sum: number, m: MonthlyPnL) => sum + m.netIncome, 0))}
                          </td>
                          <td className="px-6 py-4 text-right text-amber-400">
                            {formatPercent(
                              (pnlData.monthlyData.reduce((sum: number, m: MonthlyPnL) => sum + m.netIncome, 0) /
                                pnlData.monthlyData.reduce((sum: number, m: MonthlyPnL) => sum + m.revenue, 0)) *
                              100
                            )}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Revenue by Builder */}
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                  <h2 className="text-lg font-semibold text-white mb-6">Top 10 Builders by Revenue</h2>
                  <div className="space-y-4">
                    {pnlData.topBuilders.map((builder: BuilderRevenue, idx: number) => {
                      const maxRevenue = Math.max(...pnlData.topBuilders.map((b: BuilderRevenue) => b.revenue));
                      const percentage = (builder.revenue / maxRevenue) * 100;
                      return (
                        <div key={idx} className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-white font-medium">{builder.builderName}</span>
                            <span className="text-amber-400 font-semibold">{formatCurrency(builder.revenue)}</span>
                          </div>
                          <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                            <div
                              className="bg-amber-400 h-full rounded-full"
                              style={{ width: `${percentage}%` }}
                            ></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Expenses by Vendor */}
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                  <h2 className="text-lg font-semibold text-white mb-6">Top 10 Vendors by Expenses</h2>
                  <div className="space-y-4">
                    {pnlData.topVendors.map((vendor: VendorExpense, idx: number) => {
                      const maxExpenses = Math.max(...pnlData.topVendors.map((v: VendorExpense) => v.expenses));
                      const percentage = (vendor.expenses / maxExpenses) * 100;
                      return (
                        <div key={idx} className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-white font-medium">{vendor.vendorName}</span>
                            <span className="text-red-400 font-semibold">{formatCurrency(vendor.expenses)}</span>
                          </div>
                          <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                            <div
                              className="bg-red-400 h-full rounded-full"
                              style={{ width: `${percentage}%` }}
                            ></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Cash Flow Tab */}
            {activeTab === 'cash-flow' && cashFlowData && (
              <div className="space-y-8">
                {/* Current Cash Position */}
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                  <h2 className="text-sm font-semibold text-gray-400 mb-2">Current Cash Position</h2>
                  <div className="flex items-baseline gap-2">
                    <div className="text-5xl font-bold text-emerald-400">
                      {formatCurrency(cashFlowData.currentCashPosition)}
                    </div>
                    {cashFlowData.currentCashPosition < 0 && (
                      <div className="flex items-center gap-2 text-red-400">
                        <AlertTriangle size={20} />
                        <span className="text-sm font-semibold">Negative Balance</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 8-Week Cash Flow Projection */}
                <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-800">
                    <h2 className="text-lg font-semibold text-white">8-Week Cash Flow Projection</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-800">
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-400">Week</th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Expected AR Collections</th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Expected AP Payments</th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Net Flow</th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Running Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cashFlowData.eightWeekProjection.map((week: WeekCashFlow, idx: number) => (
                          <tr
                            key={week.week}
                            className={idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-900'}
                          >
                            <td className="px-6 py-4 text-white font-medium">Week {week.week}</td>
                            <td className="px-6 py-4 text-right text-emerald-400 font-medium">
                              {formatCurrency(week.expectedARCollections)}
                            </td>
                            <td className="px-6 py-4 text-right text-red-400 font-medium">
                              {formatCurrency(week.expectedAPPayments)}
                            </td>
                            <td
                              className={`px-6 py-4 text-right font-semibold ${
                                week.netFlow >= 0 ? 'text-emerald-400' : 'text-red-400'
                              }`}
                            >
                              {week.netFlow >= 0 ? '+' : ''}
                              {formatCurrency(week.netFlow)}
                            </td>
                            <td
                              className={`px-6 py-4 text-right font-semibold ${
                                week.runningBalance < 0 ? 'text-red-400 bg-red-950' : 'text-emerald-400'
                              }`}
                            >
                              {formatCurrency(week.runningBalance)}
                              {week.runningBalance < 0 && (
                                <div className="text-xs text-red-300 mt-1">Warning: Negative</div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Cash Flow Warnings */}
                {cashFlowData.eightWeekProjection.some((w: WeekCashFlow) => w.runningBalance < 0) && (
                  <div className="bg-red-950 border border-red-800 rounded-lg p-6">
                    <div className="flex items-start gap-3">
                      <AlertTriangle size={24} className="text-red-400 flex-shrink-0 mt-1" />
                      <div>
                        <h3 className="text-lg font-semibold text-red-200 mb-2">Cash Flow Alert</h3>
                        <p className="text-red-300">
                          The 8-week projection shows periods where the cash balance may go negative. Review AR collections and AP payment schedules.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Job Profitability Tab */}
            {activeTab === 'job-profitability' && jobProfitabilityData && (
              <div className="space-y-8">
                {/* Average Margin Card */}
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                  <h2 className="text-sm font-semibold text-gray-400 mb-2">Overall Average Margin</h2>
                  <div className="text-5xl font-bold text-amber-400">
                    {formatPercent(jobProfitabilityData.averageMargin)}
                  </div>
                </div>

                {/* Summary Metrics */}
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                    <h3 className="text-sm font-semibold text-gray-400 mb-2">Total Revenue</h3>
                    <p className="text-2xl font-bold text-white">{formatCurrency(jobProfitabilityData.totalRevenue)}</p>
                  </div>
                  <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                    <h3 className="text-sm font-semibold text-gray-400 mb-2">Total Costs</h3>
                    <p className="text-2xl font-bold text-white">{formatCurrency(jobProfitabilityData.totalCosts)}</p>
                  </div>
                  <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                    <h3 className="text-sm font-semibold text-gray-400 mb-2">Total Profit</h3>
                    <p className="text-2xl font-bold text-emerald-400">{formatCurrency(jobProfitabilityData.totalProfit)}</p>
                  </div>
                  <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                    <h3 className="text-sm font-semibold text-gray-400 mb-2">Job Count</h3>
                    <div className="space-y-1">
                      <p className="text-emerald-400">
                        <span className="font-bold text-xl">{jobProfitabilityData.profitableCount}</span> Profitable
                      </p>
                      <p className="text-red-400">
                        <span className="font-bold text-xl">{jobProfitabilityData.unprofitableCount}</span> Unprofitable
                      </p>
                    </div>
                  </div>
                </div>

                {/* Job Profitability Table */}
                <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center">
                    <h2 className="text-lg font-semibold text-white">Job Profitability Details</h2>
                    <button
                      onClick={() => setSortJobsByMargin(!sortJobsByMargin)}
                      className="text-sm text-gray-400 hover:text-gray-300 transition-colors"
                    >
                      Sort: {sortJobsByMargin ? 'Margin (Low to High)' : 'Margin (High to Low)'}
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-800">
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-400">Job #</th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-400">Builder</th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Revenue</th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Costs</th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Gross Profit</th>
                          <th className="px-6 py-3 text-right text-sm font-semibold text-gray-400">Margin %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedJobs.map((job: Job, idx: number) => (
                          <tr
                            key={job.jobNumber}
                            className={idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-900'}
                          >
                            <td className="px-6 py-4 text-white font-medium">{job.jobNumber}</td>
                            <td className="px-6 py-4 text-white">{job.builderName}</td>
                            <td className="px-6 py-4 text-right text-white">{formatCurrency(job.revenue)}</td>
                            <td className="px-6 py-4 text-right text-white">{formatCurrency(job.costs)}</td>
                            <td
                              className={`px-6 py-4 text-right font-semibold ${
                                job.grossProfit >= 0 ? 'text-emerald-400' : 'text-red-400'
                              }`}
                            >
                              {formatCurrency(job.grossProfit)}
                            </td>
                            <td
                              className={`px-6 py-4 text-right font-semibold px-4 py-2 rounded ${getMarginBgColor(job.marginPercent)} ${getMarginColor(job.marginPercent)}`}
                            >
                              {formatPercent(job.marginPercent)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
