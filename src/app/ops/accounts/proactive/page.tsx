'use client'

import { useState, useEffect } from 'react'
import { useToast } from '@/contexts/ToastContext'

// ─── Types ──────────────────────────────────────────────────────────
interface DashboardData {
  healthDistribution: any
  pendingTriggers: any
  touchpointActivity: any
  needsAttention: any[]
}

// ─── Helpers ────────────────────────────────────────────────────────
function KPICard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color || 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function Badge({ label, color }: { label: string; color: string }) {
  const colors: Record<string, string> = {
    green: 'bg-green-100 text-green-700',
    blue: 'bg-blue-100 text-blue-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    red: 'bg-red-100 text-red-700',
    orange: 'bg-orange-100 text-orange-700',
    purple: 'bg-purple-100 text-purple-700',
    gray: 'bg-gray-100 text-gray-600',
  }
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[color] || colors.gray}`}>{label}</span>
}

function HealthBar({ score }: { score: number }) {
  const color = score >= 75 ? '#22c55e' : score >= 50 ? '#eab308' : score >= 25 ? '#f97316' : '#ef4444'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-medium w-8 text-right">{score}</span>
    </div>
  )
}

const STATUS_COLORS: Record<string, string> = {
  THRIVING: 'green', HEALTHY: 'blue', AT_RISK: 'orange', DORMANT: 'red', NEW: 'purple',
}
const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: 'red', HIGH: 'orange', MEDIUM: 'yellow', LOW: 'blue',
}
const TIER_COLORS: Record<string, string> = {
  ENTERPRISE: 'purple', STRATEGIC: 'blue', GROWTH: 'green', DEVELOPING: 'yellow', EMERGING: 'gray',
  PLATINUM: 'purple', GOLD: 'yellow', SILVER: 'gray', BRONZE: 'orange',
}
const DIFFICULTY_COLORS: Record<string, string> = {
  WINNABLE: 'green', CHALLENGING: 'yellow', LONG_SHOT: 'red',
}

const fmt = (n: any) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const fmtD = (n: any) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString() : '—'

// ─── Tab Views ──────────────────────────────────────────────────────

function DashboardView({ data }: { data: DashboardData }) {
  const h = data.healthDistribution
  const t = data.pendingTriggers
  const tp = data.touchpointActivity
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="Total Active Accounts" value={fmt(h.totalAccounts)} />
        <KPICard label="Portfolio Value" value={`$${fmt(h.totalPortfolioValue)}`} color="text-green-600" />
        <KPICard label="Avg Revenue/Account" value={`$${fmtD(h.avgRevenue)}`} />
        <KPICard label="Pending Triggers" value={fmt(t.totalPending)} color={Number(t.critical) > 0 ? 'text-red-600' : 'text-gray-900'} sub={Number(t.critical) > 0 ? `${t.critical} critical` : undefined} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-green-700">{fmt(h.thriving)}</p>
          <p className="text-xs text-green-600">Thriving</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-blue-700">{fmt(h.healthy)}</p>
          <p className="text-xs text-blue-600">Healthy</p>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-orange-700">{fmt(h.atRisk)}</p>
          <p className="text-xs text-orange-600">At Risk</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-red-700">{fmt(h.dormant)}</p>
          <p className="text-xs text-red-600">Dormant</p>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-purple-700">{fmt(h.neverOrdered)}</p>
          <p className="text-xs text-purple-600">Never Ordered</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Touchpoint Activity (30 Days)</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-500">Phone:</span> <strong>{fmt(tp.phoneCalls)}</strong></div>
            <div><span className="text-gray-500">Email:</span> <strong>{fmt(tp.emails)}</strong></div>
            <div><span className="text-gray-500">In Person:</span> <strong>{fmt(tp.inPerson)}</strong></div>
            <div><span className="text-gray-500">Text:</span> <strong>{fmt(tp.texts)}</strong></div>
          </div>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Review Triggers</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-red-500">Critical:</span> <strong>{fmt(t.critical)}</strong></div>
            <div><span className="text-orange-500">High:</span> <strong>{fmt(t.high)}</strong></div>
            <div><span className="text-yellow-500">Medium:</span> <strong>{fmt(t.medium)}</strong></div>
            <div><span className="text-blue-500">Low:</span> <strong>{fmt(t.low)}</strong></div>
          </div>
        </div>
      </div>

      {data.needsAttention.length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Accounts Needing Attention</h3>
          <p className="text-xs text-gray-500 mb-3">High-value accounts ($10K+) with no contact in 60+ days</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-gray-500">
                <th className="pb-2">Company</th><th className="pb-2">Contact</th><th className="pb-2 text-right">Revenue</th>
                <th className="pb-2 text-right">Days Since Contact</th><th className="pb-2">Last Order</th>
              </tr></thead>
              <tbody>
                {data.needsAttention.map((a: any, i: number) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 font-medium">{a.companyName}</td>
                    <td className="py-2 text-gray-600">{a.contactName}</td>
                    <td className="py-2 text-right font-medium text-green-600">${fmt(a.totalRevenue)}</td>
                    <td className="py-2 text-right"><Badge label={`${a.daysSinceContact}d`} color="red" /></td>
                    <td className="py-2 text-gray-500">{fmtDate(a.lastOrder)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function HealthView({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Object.entries(data.summary || {}).map(([key, val]: [string, any]) => (
          <div key={key} className="bg-white rounded-lg border p-3 text-center">
            <p className="text-xl font-bold">{val}</p>
            <p className="text-xs text-gray-500 capitalize">{key.replace(/([A-Z])/g, ' $1')}</p>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Account Health Scores</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-gray-500">
              <th className="pb-2">Company</th><th className="pb-2">Status</th><th className="pb-2 w-40">Health Score</th>
              <th className="pb-2 text-right">Revenue</th><th className="pb-2 text-right">Orders</th>
              <th className="pb-2 text-right">Recent (90d)</th><th className="pb-2">Last Order</th>
            </tr></thead>
            <tbody>
              {(data.accounts || []).slice(0, 50).map((a: any, i: number) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2">
                    <p className="font-medium">{a.companyName}</p>
                    <p className="text-xs text-gray-400">{a.contactName}</p>
                  </td>
                  <td className="py-2"><Badge label={a.healthStatus} color={STATUS_COLORS[a.healthStatus] || 'gray'} /></td>
                  <td className="py-2"><HealthBar score={Number(a.healthScore)} /></td>
                  <td className="py-2 text-right font-medium">${fmt(a.totalRevenue)}</td>
                  <td className="py-2 text-right">{fmt(a.orderCount)}</td>
                  <td className="py-2 text-right">{fmt(a.recentOrders)}</td>
                  <td className="py-2 text-gray-500 text-xs">{fmtDate(a.lastOrderDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function ReviewQueueView({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPICard label="Total Pending" value={data.stats?.total || 0} />
        <KPICard label="Critical" value={data.stats?.critical || 0} color="text-red-600" />
        <KPICard label="High" value={data.stats?.high || 0} color="text-orange-600" />
        <KPICard label="Medium" value={data.stats?.medium || 0} color="text-yellow-600" />
        <KPICard label="Low" value={data.stats?.low || 0} color="text-blue-600" />
      </div>

      <div className="bg-white rounded-xl border p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Active Review Triggers</h3>
        {(data.triggers || []).length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No pending triggers. Run &quot;Generate Triggers&quot; to scan for issues.</p>
        ) : (
          <div className="space-y-3">
            {(data.triggers || []).map((t: any) => (
              <div key={t.id} className={`border rounded-lg p-4 ${t.severity === 'CRITICAL' ? 'border-red-300 bg-red-50' : t.severity === 'HIGH' ? 'border-orange-300 bg-orange-50' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge label={t.severity} color={SEVERITY_COLORS[t.severity] || 'gray'} />
                      <Badge label={t.triggerType.replace(/_/g, ' ')} color="blue" />
                    </div>
                    <p className="font-medium text-sm">{t.companyName}</p>
                    <p className="text-xs text-gray-600">{t.contactName} &middot; {t.email}</p>
                    <p className="text-sm text-gray-700 mt-1">{t.description}</p>
                    <p className="text-xs text-gray-400 mt-1">Triggered: {fmtDate(t.createdAt)}</p>
                  </div>
                  <button className="text-xs px-3 py-1 bg-white border rounded hover:bg-gray-50 whitespace-nowrap">
                    Resolve
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {(data.recentlyResolved || []).length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Recently Resolved</h3>
          <div className="space-y-2">
            {data.recentlyResolved.map((r: any) => (
              <div key={r.id} className="flex items-center gap-3 text-sm py-2 border-b last:border-0">
                <span className="text-green-500">✓</span>
                <Badge label={r.severity} color="gray" />
                <span className="font-medium">{r.companyName}</span>
                <span className="text-gray-500">{r.triggerType.replace(/_/g, ' ')}</span>
                <span className="text-xs text-gray-400 ml-auto">{fmtDate(r.resolvedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RetentionView({ data }: { data: any }) {
  const rr = data.revenueRetention || {}
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="Prior Period Builders" value={fmt(rr.priorBuilders)} />
        <KPICard label="Retained Builders" value={fmt(rr.retainedBuilders)} color="text-green-600" />
        <KPICard label="Revenue Retention" value={`${rr.revenueRetentionPct || 0}%`} color={Number(rr.revenueRetentionPct) >= 80 ? 'text-green-600' : 'text-orange-600'} />
        <KPICard label="Retained Revenue" value={`$${fmt(rr.retainedRevenue)}`} />
      </div>

      <div className="bg-white rounded-xl border p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Cohort Retention</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-gray-500">
              <th className="pb-2">Cohort</th><th className="pb-2 text-right">Size</th>
              <th className="pb-2 text-right">3-Month</th><th className="pb-2 text-right">6-Month</th><th className="pb-2 text-right">12-Month</th>
            </tr></thead>
            <tbody>
              {(data.cohorts || []).map((c: any, i: number) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2 font-medium">{new Date(c.cohortMonth).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
                  <td className="py-2 text-right">{c.cohortSize}</td>
                  <td className="py-2 text-right">
                    <span className={Number(c.retention3m) >= 50 ? 'text-green-600' : 'text-orange-600'}>{c.retention3m}%</span>
                    <span className="text-xs text-gray-400 ml-1">({c.retained3m})</span>
                  </td>
                  <td className="py-2 text-right">
                    <span className={Number(c.retention6m) >= 40 ? 'text-green-600' : 'text-orange-600'}>{c.retention6m}%</span>
                    <span className="text-xs text-gray-400 ml-1">({c.retained6m})</span>
                  </td>
                  <td className="py-2 text-right">
                    <span className={Number(c.retention12m) >= 30 ? 'text-green-600' : 'text-orange-600'}>{c.retention12m}%</span>
                    <span className="text-xs text-gray-400 ml-1">({c.retained12m})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(data.churnInsights || []).length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Churned High-Value Accounts</h3>
          <p className="text-xs text-gray-500 mb-3">Accounts with 2+ orders that went dormant (90+ days)</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-gray-500">
                <th className="pb-2">Company</th><th className="pb-2 text-right">Lifetime Revenue</th>
                <th className="pb-2 text-right">Orders</th><th className="pb-2 text-right">Days Dormant</th><th className="pb-2">Last Order</th>
              </tr></thead>
              <tbody>
                {data.churnInsights.map((c: any, i: number) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 font-medium">{c.companyName}</td>
                    <td className="py-2 text-right text-green-600 font-medium">${fmt(c.lifetimeRevenue)}</td>
                    <td className="py-2 text-right">{c.orderCount}</td>
                    <td className="py-2 text-right"><Badge label={`${c.daysDormant}d`} color="red" /></td>
                    <td className="py-2 text-gray-500">{fmtDate(c.lastOrder)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function GrowthPlansView({ data }: { data: any }) {
  const ts = data.tierSummary || {}
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Object.entries(ts).map(([key, val]: [string, any]) => (
          <div key={key} className="bg-white rounded-lg border p-3 text-center">
            <p className="text-xl font-bold">{val}</p>
            <p className="text-xs text-gray-500 capitalize">{key}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Account Growth Opportunities</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-gray-500">
              <th className="pb-2">Company</th><th className="pb-2">Tier</th><th className="pb-2 text-right">Revenue</th>
              <th className="pb-2 text-right">Avg Order</th><th className="pb-2 text-right">Categories</th><th className="pb-2">Opportunities</th>
            </tr></thead>
            <tbody>
              {(data.accounts || []).slice(0, 40).map((a: any, i: number) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2">
                    <p className="font-medium">{a.companyName}</p>
                    <p className="text-xs text-gray-400">{a.contactName}</p>
                  </td>
                  <td className="py-2"><Badge label={a.accountTier} color={TIER_COLORS[a.accountTier] || 'gray'} /></td>
                  <td className="py-2 text-right font-medium">${fmt(a.totalRevenue)}</td>
                  <td className="py-2 text-right">${fmtD(a.avgOrderValueRounded)}</td>
                  <td className="py-2 text-right">{a.categoryCount}</td>
                  <td className="py-2">
                    <div className="flex gap-1 flex-wrap">
                      {a.crossSellOpportunity && <Badge label="Cross-sell" color="green" />}
                      {a.upsellOpportunity && <Badge label="Upsell" color="blue" />}
                      {a.underutilizedCredit && <Badge label="Credit Headroom" color="purple" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(data.categoryPenetration || []).length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Category Penetration</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-gray-500">
                <th className="pb-2">Category</th><th className="pb-2 text-right">Builders</th>
                <th className="pb-2 text-right">Orders</th><th className="pb-2 text-right">Revenue</th>
              </tr></thead>
              <tbody>
                {data.categoryPenetration.map((c: any, i: number) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 font-medium">{c.category}</td>
                    <td className="py-2 text-right">{c.builderCount}</td>
                    <td className="py-2 text-right">{c.orderCount}</td>
                    <td className="py-2 text-right font-medium text-green-600">${fmt(c.totalRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function WinBackView({ data }: { data: any }) {
  const s = data.summary || {}
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="Win-Back Candidates" value={s.totalCandidates || 0} />
        <KPICard label="At-Risk Revenue" value={`$${fmt(s.totalAtRiskRevenue)}`} color="text-red-600" />
        <KPICard label="Winnable" value={s.winnable || 0} color="text-green-600" sub="90-180 days dormant" />
        <KPICard label="Platinum/Gold" value={(s.platinum || 0) + (s.gold || 0)} color="text-purple-600" />
      </div>

      <div className="bg-white rounded-xl border p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Win-Back Candidates</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-gray-500">
              <th className="pb-2">Company</th><th className="pb-2">Value Tier</th><th className="pb-2">Difficulty</th>
              <th className="pb-2 text-right">Lifetime Revenue</th><th className="pb-2 text-right">Avg Order</th>
              <th className="pb-2 text-right">Days Dormant</th><th className="pb-2">Last Order</th>
            </tr></thead>
            <tbody>
              {(data.candidates || []).map((c: any, i: number) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2">
                    <p className="font-medium">{c.companyName}</p>
                    <p className="text-xs text-gray-400">{c.contactName} &middot; {c.email}</p>
                  </td>
                  <td className="py-2"><Badge label={c.valueTier} color={TIER_COLORS[c.valueTier] || 'gray'} /></td>
                  <td className="py-2"><Badge label={c.winBackDifficulty?.replace(/_/g, ' ')} color={DIFFICULTY_COLORS[c.winBackDifficulty] || 'gray'} /></td>
                  <td className="py-2 text-right font-medium text-green-600">${fmt(c.lifetimeRevenue)}</td>
                  <td className="py-2 text-right">${fmtD(c.avgOrderValue)}</td>
                  <td className="py-2 text-right"><Badge label={`${c.daysDormant}d`} color={Number(c.daysDormant) > 180 ? 'red' : 'orange'} /></td>
                  <td className="py-2 text-gray-500">{fmtDate(c.lastOrderDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function TouchpointsView({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Recent Touchpoints</h3>
        {(data.touchpoints || []).length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">No touchpoints logged yet.</p>
        ) : (
          <div className="space-y-3">
            {(data.touchpoints || []).map((tp: any) => (
              <div key={tp.id} className="border rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Badge label={tp.touchType} color="blue" />
                  <Badge label={tp.channel} color="gray" />
                  <span className="text-xs text-gray-400 ml-auto">{fmtDate(tp.createdAt)}</span>
                </div>
                <p className="font-medium text-sm">{tp.companyName || 'Unknown'}</p>
                {tp.subject && <p className="text-sm text-gray-700">{tp.subject}</p>}
                {tp.notes && <p className="text-xs text-gray-500 mt-1">{tp.notes}</p>}
                {tp.outcome && <p className="text-xs mt-1"><strong>Outcome:</strong> {tp.outcome}</p>}
                {tp.followUpDate && <p className="text-xs text-orange-600 mt-1">Follow-up: {fmtDate(tp.followUpDate)}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────
const TABS = [
  { id: 'dashboard', label: 'Overview', report: 'dashboard' },
  { id: 'health', label: 'Account Health', report: 'account-health' },
  { id: 'queue', label: 'Review Queue', report: 'review-queue' },
  { id: 'retention', label: 'Retention', report: 'retention' },
  { id: 'growth', label: 'Growth Plans', report: 'growth-plans' },
  { id: 'winback', label: 'Win-Back', report: 'win-back' },
  { id: 'touchpoints', label: 'Touchpoints', report: 'touchpoints' },
]

export default function ProactiveAccountManagementPage() {
  const { addToast } = useToast()
  const [activeTab, setActiveTab] = useState('dashboard')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    const tab = TABS.find(t => t.id === activeTab)
    if (!tab) return
    setLoading(true)
    fetch(`/api/ops/accounts/proactive?report=${tab.report}`)
      .then(r => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [activeTab])

  async function handleGenerateTriggers() {
    setGenerating(true)
    try {
      const res = await fetch('/api/ops/accounts/proactive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate-triggers' }),
      })
      const result = await res.json()
      addToast({ type: 'success', title: 'Success', message: `Generated ${result.triggersCreated} review triggers` })
      if (activeTab === 'queue' || activeTab === 'dashboard') {
        const tab = TABS.find(t => t.id === activeTab)
        fetch(`/api/ops/accounts/proactive?report=${tab?.report}`)
          .then(r => r.json())
          .then(setData)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Proactive Account Management</h1>
          <p className="text-sm text-gray-500 mt-1">Monitor account health, retention, growth opportunities &amp; win-back candidates</p>
        </div>
        <button
          onClick={handleGenerateTriggers}
          disabled={generating}
          className="px-4 py-2 bg-[#0f2a3e] text-white text-sm rounded-lg hover:bg-[#0f2a3e]/90 disabled:opacity-50"
        >
          {generating ? 'Scanning...' : '🔍 Generate Triggers'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-[#C6A24E] text-[#C6A24E]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-[#C6A24E] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-500">Loading data...</p>
          </div>
        </div>
      ) : data ? (
        <>
          {activeTab === 'dashboard' && <DashboardView data={data} />}
          {activeTab === 'health' && <HealthView data={data} />}
          {activeTab === 'queue' && <ReviewQueueView data={data} />}
          {activeTab === 'retention' && <RetentionView data={data} />}
          {activeTab === 'growth' && <GrowthPlansView data={data} />}
          {activeTab === 'winback' && <WinBackView data={data} />}
          {activeTab === 'touchpoints' && <TouchpointsView data={data} />}
        </>
      ) : (
        <p className="text-sm text-gray-500 text-center py-10">No data available.</p>
      )}
    </div>
  )
}
