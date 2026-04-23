'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import KPICard from '@/components/ui/KPICard'
import Sparkline from '@/components/ui/Sparkline'

interface EarningsData {
  ok: true
  staffId: string
  ytdRevenue: number
  ytdOrders: number
  priorYtdRevenue: number
  yoyDeltaPct: number | null
  sparkline: number[]
  teamAvg: number
  teamMax: number
  repCount: number
  commission: null | { earned: number; pending: number; paid: number }
}

const fmtMoney = (n: number) => '$' + Math.round(n || 0).toLocaleString('en-US')

export default function SalesEarningsPage() {
  const [data, setData] = useState<EarningsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/ops/portal/sales/earnings')
        if (!res.ok) throw new Error((await res.json()).error || 'Failed to load')
        const j = await res.json()
        setData(j)
      } catch (err: any) {
        setError(err?.message || 'Failed to load')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-[#0f2a3e] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="max-w-2xl mx-auto rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {error || 'No earnings data'}
      </div>
    )
  }

  const vsTeamPct = data.teamAvg > 0 ? ((data.ytdRevenue - data.teamAvg) / data.teamAvg) * 100 : null
  const yoy = data.yoyDeltaPct

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Earnings</h1>
          <p className="text-sm text-gray-500">Revenue originated — YTD {new Date().getFullYear()}</p>
        </div>
        <Link href="/ops/portal/sales" className="text-sm text-[#0f2a3e] hover:underline">← Portal</Link>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KPICard
          title="YTD revenue"
          value={fmtMoney(data.ytdRevenue)}
          delta={yoy == null ? undefined : `${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}%`}
          deltaDirection={yoy == null ? 'flat' : yoy > 0 ? 'up' : yoy < 0 ? 'down' : 'flat'}
          subtitle={yoy == null ? 'no prior-year baseline' : 'vs prior YTD'}
          sparkline={data.sparkline.length > 1 ? data.sparkline : undefined}
          accent="brand"
        />
        <KPICard
          title="Orders YTD"
          value={data.ytdOrders}
          subtitle={`across accounts you own`}
          accent="neutral"
        />
        <KPICard
          title="Vs team avg"
          value={vsTeamPct == null ? '—' : `${vsTeamPct >= 0 ? '+' : ''}${vsTeamPct.toFixed(0)}%`}
          deltaDirection={vsTeamPct == null ? 'flat' : vsTeamPct > 0 ? 'up' : 'down'}
          subtitle={`team avg ${fmtMoney(data.teamAvg)} · ${data.repCount} reps`}
          accent={vsTeamPct != null && vsTeamPct >= 0 ? 'positive' : 'negative'}
        />
      </div>

      {/* Sparkline detail */}
      {data.sparkline.length > 1 && (
        <div className="rounded-2xl border bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Last 12 months</p>
              <p className="text-lg font-bold text-gray-900">{fmtMoney(data.sparkline.reduce((a, b) => a + b, 0))}</p>
            </div>
          </div>
          <Sparkline data={data.sparkline} width={600} height={80} />
        </div>
      )}

      {/* Commission block */}
      <div className="rounded-2xl border bg-white p-5">
        <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Commission</p>
        {data.commission ? (
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-500">Earned</p>
              <p className="text-lg font-bold text-gray-900">{fmtMoney(data.commission.earned)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Pending</p>
              <p className="text-lg font-bold text-amber-700">{fmtMoney(data.commission.pending)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Paid</p>
              <p className="text-lg font-bold text-green-700">{fmtMoney(data.commission.paid)}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            No commission schedule configured. Showing revenue originated as the source-of-truth KPI.
          </p>
        )}
      </div>
    </div>
  )
}
