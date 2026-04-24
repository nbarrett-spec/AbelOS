'use client'

import Link from 'next/link'
import { Sparkline } from '@/components/ui'

export interface HistoryBatch {
  id: string
  weekStart: string
  status: string
  totalSkus: number
  completedSkus: number
  discrepanciesFound: number
  completionRate: number
  varianceDollars: number
  assignedToName: string | null
  createdAt: string
  closedAt: string | null
}

interface HistoryPanelProps {
  batches: HistoryBatch[]
  loading?: boolean
}

// Blueprint palette (matches existing page usage)
const PALETTE = {
  green: '#27AE60',
  greenDark: '#229954',
  gold: '#C6A24E',
  red: '#DC2626',
}

const fmtUsd = (n: number) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })

const fmtWeek = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })

/** Consecutive weeks (from the most recent CLOSED batch back) with zero discrepancies. */
function computeGreenStreak(rows: HistoryBatch[]): number {
  let streak = 0
  for (const r of rows) {
    if (r.status !== 'CLOSED') continue
    if (r.discrepanciesFound === 0) streak += 1
    else break
  }
  return streak
}

export default function HistoryPanel({ batches, loading }: HistoryPanelProps) {
  // Skeleton
  if (loading) {
    return (
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-4 border-b">
          <div className="h-5 w-64 bg-gray-200 rounded animate-pulse" />
          <div className="h-3 w-80 bg-gray-100 rounded animate-pulse mt-2" />
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 bg-gray-100 rounded-lg animate-pulse"
            />
          ))}
        </div>
        <div className="p-4 border-t">
          <div className="h-24 bg-gray-100 rounded animate-pulse" />
        </div>
      </div>
    )
  }

  // Empty state
  if (!batches || batches.length === 0) {
    return (
      <div className="bg-white rounded-xl border p-8 text-center text-gray-500">
        <p className="text-xs uppercase tracking-wider text-gray-400 mb-2">
          Discrepancy Trend &mdash; Last 12 Weeks
        </p>
        <p className="text-sm font-medium">No history yet</p>
        <p className="text-xs mt-1">
          Trend will appear once the first weekly batch closes.
        </p>
      </div>
    )
  }

  // API returns DESC (most recent first). For the sparkline we want chronological.
  const chrono = [...batches].slice().reverse()
  const variancePoints = chrono.map((b) => b.varianceDollars)

  // Stats
  const totalSkusAudited = batches.reduce(
    (a, b) => a + (b.completedSkus || 0),
    0
  )
  const avgVariance =
    batches.length > 0
      ? batches.reduce((a, b) => a + (b.varianceDollars || 0), 0) / batches.length
      : 0

  // Biggest variance week
  let biggestIdx = 0
  for (let i = 1; i < batches.length; i++) {
    if ((batches[i]?.varianceDollars ?? 0) > (batches[biggestIdx]?.varianceDollars ?? 0)) {
      biggestIdx = i
    }
  }
  // batches[] is DESC, so biggestIdx is "weeks ago" (0 = this week)
  const weeksSinceBiggest = biggestIdx
  const biggestAmount = batches[biggestIdx]?.varianceDollars ?? 0

  const greenStreak = computeGreenStreak(batches)

  // Latest vs average delta
  const latest = batches[0]?.varianceDollars ?? 0
  const varianceDelta = latest - avgVariance

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">
            Discrepancy Trend &mdash; Last 12 Weeks
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Variance $ rollup per batch. Watch for weeks that spike above average.
          </p>
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-b">
        <div className="p-4 border-r border-b md:border-b-0 border-gray-100">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Green Streak
          </p>
          <p
            className="text-2xl font-bold mt-1"
            style={{
              color: greenStreak > 0 ? PALETTE.green : '#6B7280',
            }}
          >
            {greenStreak}
            <span className="text-sm font-medium text-gray-400 ml-1">
              wk{greenStreak === 1 ? '' : 's'}
            </span>
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {greenStreak > 0
              ? 'Consecutive zero-discrepancy weeks'
              : 'Last closed batch had discrepancies'}
          </p>
        </div>
        <div className="p-4 border-r border-b md:border-b-0 border-gray-100">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Avg Weekly Variance
          </p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {fmtUsd(avgVariance)}
          </p>
          <p className="text-xs mt-1">
            <span
              className={
                varianceDelta > 0
                  ? 'text-red-600'
                  : varianceDelta < 0
                    ? 'text-green-600'
                    : 'text-gray-400'
              }
            >
              {varianceDelta > 0 ? '+' : ''}
              {fmtUsd(varianceDelta)}
            </span>
            <span className="text-gray-400"> this week vs avg</span>
          </p>
        </div>
        <div className="p-4 border-r border-gray-100">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Weeks Since Biggest
          </p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {weeksSinceBiggest}
            <span className="text-sm font-medium text-gray-400 ml-1">
              wk{weeksSinceBiggest === 1 ? '' : 's'}
            </span>
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {biggestAmount > 0
              ? `Peak ${fmtUsd(biggestAmount)}`
              : 'No variance recorded'}
          </p>
        </div>
        <div className="p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            SKUs Audited
          </p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {totalSkusAudited.toLocaleString()}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Across {batches.length} batch{batches.length === 1 ? '' : 'es'}
          </p>
        </div>
      </div>

      {/* Sparkline */}
      <div className="p-4 border-b bg-gray-50/50">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-xs font-medium text-gray-700">Variance $ per week</p>
            <p className="text-[11px] text-gray-400">
              Oldest &rarr; Newest ({chrono.length} points)
            </p>
          </div>
          <div className="flex gap-4 text-xs text-gray-500">
            <span>
              Peak{' '}
              <span className="font-semibold text-gray-900">
                {fmtUsd(Math.max(...variancePoints, 0))}
              </span>
            </span>
            <span>
              Low{' '}
              <span className="font-semibold text-gray-900">
                {fmtUsd(Math.min(...variancePoints, 0))}
              </span>
            </span>
          </div>
        </div>
        {variancePoints.length >= 2 ? (
          <Sparkline
            data={variancePoints}
            color={PALETTE.gold}
            width={800}
            height={80}
            showArea
            showDot
            showTooltip
            formatValue={(v) => fmtUsd(v)}
            label="Variance dollars per week"
            className="w-full max-w-full"
          />
        ) : (
          <div className="h-20 flex items-center justify-center text-xs text-gray-400">
            Need at least 2 closed batches for a trend line
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-600 uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Week</th>
              <th className="px-4 py-3 text-left">Assigned</th>
              <th className="px-4 py-3 text-right">Completion</th>
              <th className="px-4 py-3 text-right">Discrepancies</th>
              <th className="px-4 py-3 text-right">Variance $</th>
              <th className="px-4 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {batches.map((h) => {
              const pct = Math.round((h.completionRate || 0) * 100)
              const href = `/ops/portal/warehouse/cycle-count?batchId=${encodeURIComponent(h.id)}`
              return (
                <tr
                  key={h.id}
                  className="border-b hover:bg-gray-50/60 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">
                      {fmtWeek(h.weekStart)}
                    </div>
                    <div className="text-[11px] text-gray-400">
                      {h.status === 'OPEN' ? (
                        <span className="text-yellow-700">Open</span>
                      ) : h.closedAt ? (
                        `Closed ${new Date(h.closedAt).toLocaleDateString()}`
                      ) : (
                        h.status
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {h.assignedToName || (
                      <span className="text-gray-300">&mdash;</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <span className="font-medium text-gray-900">{pct}%</span>
                      <span className="text-[11px] text-gray-400">
                        ({h.completedSkus}/{h.totalSkus})
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`font-medium ${
                        h.discrepanciesFound > 0
                          ? 'text-red-600'
                          : 'text-gray-400'
                      }`}
                    >
                      {h.discrepanciesFound}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    <span
                      className={
                        h.varianceDollars > 0 ? 'text-red-600' : 'text-gray-400'
                      }
                    >
                      {fmtUsd(h.varianceDollars)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={href}
                      className="text-xs font-medium text-[#27AE60] hover:text-[#229954] hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
