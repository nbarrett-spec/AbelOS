'use client'

import { useEffect, useState } from 'react'
import { LineChart } from 'lucide-react'
import { PageHeader, EmptyState } from '@/components/ui'

interface HealthData {
  keyMetrics: {
    grossMarginPercent: number
    revenuePerJob: number
    arCollectionRate: number
    dso: number
    vendorPaymentTimeliness: number
  }
  cashFlowProjection: {
    next30Days: {
      expectedInflows: number
      expectedOutflows: number
      netProjection: number
    }
    next60Days: {
      expectedInflows: number
      expectedOutflows: number
      netProjection: number
    }
    next90Days: {
      expectedInflows: number
      expectedOutflows: number
      netProjection: number
    }
  }
  builderHealth: Array<{
    builderId: string
    builderName: string
    creditLimit: number
    currentBalance: number
    utilizationPercent: number
    paymentHistoryScore: number
    riskFlag: string | null
  }>
  revenueByScope: Array<{
    scopeType: string
    amount: number
    percent: number
    jobCount: number
  }>
}

export default function CompanyHealthPage() {
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const response = await fetch('/api/ops/finance/health')
      if (!response.ok) throw new Error('Failed to fetch health data')
      const result = await response.json()
      setData(result)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value)
  }

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-fg-muted">Loading health metrics...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        eyebrow="Finance"
        title="Company Financial Health"
        description="Key metrics, cash flow projections, and builder account health."
      />

      {/* Key Financial Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-surface rounded-lg shadow p-6 border-l-4 border-data-positive">
          <div className="text-fg-muted text-sm font-medium">Gross Margin %</div>
          <div className="text-3xl font-semibold text-data-positive mt-2">
            {Math.round(data.keyMetrics.grossMarginPercent * 100)}%
          </div>
          <p className="text-xs text-fg-subtle mt-2">Product margin</p>
        </div>

        <div className="bg-surface rounded-lg shadow p-6 border-l-4 border-[#0f2a3e]">
          <div className="text-fg-muted text-sm font-medium">Revenue per Job</div>
          <div className="text-2xl font-semibold text-fg mt-2">
            {formatCurrency(data.keyMetrics.revenuePerJob)}
          </div>
          <p className="text-xs text-fg-subtle mt-2">Average job value</p>
        </div>

        <div className="bg-surface rounded-lg shadow p-6 border-l-4 border-signal">
          <div className="text-fg-muted text-sm font-medium">AR Collection Rate</div>
          <div className="text-3xl font-semibold text-signal mt-2">
            {Math.round(data.keyMetrics.arCollectionRate * 100)}%
          </div>
          <p className="text-xs text-fg-subtle mt-2">Paid / Total Billed</p>
        </div>

        <div className="bg-surface rounded-lg shadow p-6 border-l-4 border-orange-500">
          <div className="text-fg-muted text-sm font-medium">DSO</div>
          <div className="text-3xl font-semibold text-orange-600 mt-2">
            {Math.round(data.keyMetrics.dso)}
          </div>
          <p className="text-xs text-fg-subtle mt-2">Days to collect</p>
        </div>

        <div className="bg-surface rounded-lg shadow p-6 border-l-4 border-green-500">
          <div className="text-fg-muted text-sm font-medium">Vendor Timeliness</div>
          <div className="text-3xl font-semibold text-green-600 mt-2">
            {Math.round(data.keyMetrics.vendorPaymentTimeliness * 100)}%
          </div>
          <p className="text-xs text-fg-subtle mt-2">On-time payments</p>
        </div>
      </div>

      {/* Cash Flow Projection */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          {
            label: 'Next 30 Days',
            inflows: data.cashFlowProjection.next30Days.expectedInflows,
            outflows: data.cashFlowProjection.next30Days.expectedOutflows,
            net: data.cashFlowProjection.next30Days.netProjection,
          },
          {
            label: 'Next 60 Days',
            inflows: data.cashFlowProjection.next60Days.expectedInflows,
            outflows: data.cashFlowProjection.next60Days.expectedOutflows,
            net: data.cashFlowProjection.next60Days.netProjection,
          },
          {
            label: 'Next 90 Days',
            inflows: data.cashFlowProjection.next90Days.expectedInflows,
            outflows: data.cashFlowProjection.next90Days.expectedOutflows,
            net: data.cashFlowProjection.next90Days.netProjection,
          },
        ].map((period) => (
          <div key={period.label} className="bg-surface rounded-lg shadow p-6">
            <h4 className="font-semibold text-fg mb-4">{period.label}</h4>
            <div className="space-y-3">
              <div>
                <div className="text-sm text-fg-muted">Expected Inflows</div>
                <div className="text-xl font-semibold text-data-positive mt-1">{formatCurrency(period.inflows)}</div>
              </div>
              <div>
                <div className="text-sm text-fg-muted">Expected Outflows</div>
                <div className="text-xl font-semibold text-data-negative mt-1">{formatCurrency(period.outflows)}</div>
              </div>
              <div className="pt-3 border-t border-border">
                <div className="text-sm text-fg-muted">Net Projection</div>
                <div className={`text-2xl font-semibold mt-1 ${period.net >= 0 ? 'text-data-positive' : 'text-data-negative'}`}>
                  {formatCurrency(period.net)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Revenue by Scope Type */}
      <div className="bg-surface rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-fg mb-4">Revenue by Scope Type</h3>
        {data.revenueByScope.length === 0 ? (
          <EmptyState
            icon={<LineChart className="w-8 h-8 text-fg-subtle" />}
            title="No financial data yet"
            description="Revenue breakdown will appear as jobs close."
            size="compact"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Bar chart */}
            <div className="space-y-4">
              {data.revenueByScope.map((scope) => (
                <div key={scope.scopeType}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-sm font-medium text-fg">{scope.scopeType}</div>
                      <div className="text-xs text-fg-muted">{scope.jobCount} jobs</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-fg">{formatCurrency(scope.amount)}</div>
                      <div className="text-xs text-fg-muted">{scope.percent.toFixed(1)}%</div>
                    </div>
                  </div>
                  <div className="w-full bg-surface-muted rounded-full h-3">
                    <div
                      className="h-3 rounded-full bg-gradient-to-r from-[#0f2a3e] to-signal"
                      style={{ width: `${scope.percent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Summary stats */}
            <div className="bg-surface-muted rounded-lg p-4">
              <h4 className="font-semibold text-fg mb-4">Mix Summary</h4>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-fg-muted">Total Revenue (All Scopes)</span>
                  <span className="font-semibold text-fg">
                    {formatCurrency(data.revenueByScope.reduce((sum, s) => sum + s.amount, 0))}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-fg-muted">Total Jobs</span>
                  <span className="font-semibold text-fg">
                    {data.revenueByScope.reduce((sum, s) => sum + s.jobCount, 0)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-fg-muted">Average per Job</span>
                  <span className="font-semibold text-fg">
                    {formatCurrency(
                      data.revenueByScope.reduce((sum, s) => sum + s.amount, 0) /
                        Math.max(data.revenueByScope.reduce((sum, s) => sum + s.jobCount, 0), 1)
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Builder Account Health */}
      <div className="bg-surface rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-fg mb-4">Builder Account Health</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b-2 border-border-strong">
              <tr>
                <th className="text-left py-3 px-4 font-semibold text-fg-muted">Builder</th>
                <th className="text-right py-3 px-4 font-semibold text-fg-muted">Credit Limit</th>
                <th className="text-right py-3 px-4 font-semibold text-fg-muted">Current Balance</th>
                <th className="text-right py-3 px-4 font-semibold text-fg-muted">Utilization %</th>
                <th className="text-right py-3 px-4 font-semibold text-fg-muted">Payment Score</th>
                <th className="text-left py-3 px-4 font-semibold text-fg-muted">Risk</th>
              </tr>
            </thead>
            <tbody>
              {data.builderHealth.map((builder, idx) => (
                <tr key={builder.builderId} className={idx % 2 === 0 ? 'bg-surface' : 'bg-surface-muted'}>
                  <td className="py-3 px-4 text-fg font-medium">{builder.builderName}</td>
                  <td className="text-right py-3 px-4 text-fg-muted">{formatCurrency(builder.creditLimit)}</td>
                  <td className="text-right py-3 px-4 font-semibold text-fg">{formatCurrency(builder.currentBalance)}</td>
                  <td className="text-right py-3 px-4">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-20 h-2 bg-surface-muted rounded-full">
                        <div
                          className={`h-2 rounded-full ${
                            builder.utilizationPercent > 80 ? 'bg-red-500' :
                            builder.utilizationPercent > 60 ? 'bg-orange-500' :
                            'bg-green-500'
                          }`}
                          style={{ width: `${Math.min(builder.utilizationPercent, 100)}%` }}
                        />
                      </div>
                      <span className="font-semibold text-fg w-12">{builder.utilizationPercent.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="text-right py-3 px-4">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-2 bg-surface-muted rounded-full">
                        <div
                          className={`h-2 rounded-full ${builder.paymentHistoryScore > 80 ? 'bg-green-500' : builder.paymentHistoryScore > 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                          style={{ width: `${builder.paymentHistoryScore}%` }}
                        />
                      </div>
                      <span className="font-semibold text-fg w-10">{Math.round(builder.paymentHistoryScore)}%</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {builder.riskFlag ? (
                      <span className="inline-block px-2 py-1 rounded text-xs font-semibold bg-red-100 text-red-800">
                        {builder.riskFlag}
                      </span>
                    ) : (
                      <span className="text-fg-subtle text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
