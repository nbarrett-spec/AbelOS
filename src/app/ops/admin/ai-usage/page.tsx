'use client'

import { useEffect, useState } from 'react'
import {
  PageHeader,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  KPICard,
  Badge,
  Table,
  TableHead,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  TableEmpty,
  Skeleton,
} from '@/components/ui'

interface Row {
  id: string
  endpoint: string
  model: string | null
  promptTokens: number
  completionTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costEstimate: number
  durationMs: number
  staffId: string | null
  staffName: string | null
  createdAt: string
}

interface UsageData {
  ok: boolean
  totals: { calls: number; totalCost: number; todayCalls: number; todayCost: number }
  byEndpoint: Array<{
    endpoint: string
    calls: number
    totalCost: number
    promptTokens: number
    completionTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    avgMs: number
  }>
  byDay: Array<{ day: string; calls: number; totalCost: number }>
  recent: Row[]
}

function fmtMoney(n: number): string {
  return `$${(n || 0).toFixed(4)}`
}
function fmtMoneyShort(n: number): string {
  return `$${(n || 0).toFixed(2)}`
}
function fmtInt(n: number): string {
  return (n || 0).toLocaleString()
}

export default function AIUsagePage() {
  const [data, setData] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/ops/admin/ai-usage', { credentials: 'include' })
        const json = await res.json()
        if (!cancelled) setData(json)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI Usage"
        description="Anthropic API spend, endpoint breakdown, and recent invocations."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Admin', href: '/ops/admin' },
          { label: 'AI Usage' },
        ]}
      />

      {loading && (
        <div className="grid grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}

      {!loading && data?.ok && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard title="Calls · Today" value={fmtInt(data.totals.todayCalls)} />
            <KPICard
              title="Spend · Today"
              value={fmtMoneyShort(data.totals.todayCost)}
              accent={data.totals.todayCost > 5 ? 'danger' : 'slate'}
            />
            <KPICard title="Calls · 30d" value={fmtInt(data.totals.calls)} />
            <KPICard
              title="Spend · 30d"
              value={fmtMoneyShort(data.totals.totalCost)}
              accent={data.totals.totalCost > 100 ? 'danger' : 'slate'}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>By endpoint (30 days)</CardTitle>
            </CardHeader>
            <CardBody>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeader>Endpoint</TableHeader>
                    <TableHeader>Calls</TableHeader>
                    <TableHeader>Total cost</TableHeader>
                    <TableHeader>In tokens</TableHeader>
                    <TableHeader>Out tokens</TableHeader>
                    <TableHeader>Cached</TableHeader>
                    <TableHeader>Avg ms</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.byEndpoint.length === 0 && (
                    <TableEmpty colSpan={7} title="No AI activity in the last 30 days." />
                  )}
                  {data.byEndpoint.map((row) => (
                    <TableRow key={row.endpoint}>
                      <TableCell className="font-mono">{row.endpoint}</TableCell>
                      <TableCell>{fmtInt(row.calls)}</TableCell>
                      <TableCell className="font-semibold">{fmtMoneyShort(row.totalCost)}</TableCell>
                      <TableCell>{fmtInt(row.promptTokens)}</TableCell>
                      <TableCell>{fmtInt(row.completionTokens)}</TableCell>
                      <TableCell>{fmtInt(row.cacheReadTokens)}</TableCell>
                      <TableCell>{fmtInt(row.avgMs)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Daily spend (14 days)</CardTitle>
            </CardHeader>
            <CardBody>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeader>Day</TableHeader>
                    <TableHeader>Calls</TableHeader>
                    <TableHeader>Spend</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.byDay.length === 0 && <TableEmpty colSpan={3} title="No activity." />}
                  {data.byDay.map((row) => (
                    <TableRow key={row.day}>
                      <TableCell className="font-mono">{row.day}</TableCell>
                      <TableCell>{fmtInt(row.calls)}</TableCell>
                      <TableCell>{fmtMoneyShort(row.totalCost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent invocations</CardTitle>
            </CardHeader>
            <CardBody>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeader>When</TableHeader>
                    <TableHeader>Endpoint</TableHeader>
                    <TableHeader>Model</TableHeader>
                    <TableHeader>Staff</TableHeader>
                    <TableHeader>In / Out</TableHeader>
                    <TableHeader>Cache r/w</TableHeader>
                    <TableHeader>Cost</TableHeader>
                    <TableHeader>ms</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.recent.length === 0 && <TableEmpty colSpan={8} title="No invocations yet." />}
                  {data.recent.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="tabular-nums text-xs text-fg-muted">
                        {new Date(r.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="neutral" size="xs">{r.endpoint}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.model || '—'}</TableCell>
                      <TableCell>{r.staffName || r.staffId || '—'}</TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {fmtInt(r.promptTokens)} / {fmtInt(r.completionTokens)}
                      </TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {fmtInt(r.cacheReadTokens)} / {fmtInt(r.cacheWriteTokens)}
                      </TableCell>
                      <TableCell className="tabular-nums">{fmtMoney(r.costEstimate)}</TableCell>
                      <TableCell className="tabular-nums text-xs">{r.durationMs}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
