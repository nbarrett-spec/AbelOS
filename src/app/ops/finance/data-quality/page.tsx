'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader, Card, Button } from '@/components/ui'

interface Finding {
  id: string
  title: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  count: number
  sampleIds: string[]
  description: string
  action: string
}

interface Summary {
  totalFindings: number
  critical: number
  high: number
  medium: number
  lastChecked: string
}

const SEVERITY_COLORS: Record<Finding['severity'], string> = {
  CRITICAL: 'bg-red-50 border-red-500 text-red-800',
  HIGH: 'bg-orange-50 border-orange-500 text-orange-800',
  MEDIUM: 'bg-yellow-50 border-yellow-500 text-yellow-800',
  LOW: 'bg-blue-50 border-blue-300 text-blue-800',
}

export default function FinanceDataQualityPage() {
  const [findings, setFindings] = useState<Finding[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/ops/finance/data-quality')
      if (res.ok) {
        const data = await res.json()
        setFindings(data.findings || [])
        setSummary(data.summary || null)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-[1400px] mx-auto p-6 space-y-5">
        <PageHeader
          eyebrow="Finance"
          title="Data Quality"
          description="Read-only diagnostics. Surface invoices and orders that don't match expected patterns. Click sample IDs to investigate; this page does not mutate data."
          crumbs={[{ label: 'Ops', href: '/ops' }, { label: 'Finance', href: '/ops/finance' }, { label: 'Data Quality' }]}
          actions={<Button variant="ghost" size="sm" loading={loading} onClick={load}>Refresh</Button>}
        />

        {summary && (
          <Card padding="md">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><span className="text-fg-muted">Findings:</span> <strong>{summary.totalFindings}</strong></div>
              <div><span className="text-fg-muted">Critical:</span> <strong className="text-red-600">{summary.critical}</strong></div>
              <div><span className="text-fg-muted">High:</span> <strong className="text-orange-600">{summary.high}</strong></div>
              <div><span className="text-fg-muted">Last checked:</span> <span className="text-xs">{new Date(summary.lastChecked).toLocaleString()}</span></div>
            </div>
          </Card>
        )}

        <div className="space-y-3">
          {findings.map((f) => (
            <Card key={f.id} padding="md" className={`border-l-4 ${SEVERITY_COLORS[f.severity]}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="text-xs uppercase font-bold tracking-wider opacity-70">{f.severity}</div>
                  <div className="text-base font-semibold mt-1">{f.title}</div>
                  <div className="text-sm mt-2 text-fg-muted">{f.description}</div>
                  <div className="text-xs mt-2 italic text-fg-subtle">{f.action}</div>
                </div>
                <div className="ml-6 text-right">
                  <div className="text-3xl font-bold tabular-nums">{f.count.toLocaleString()}</div>
                  <div className="text-xs text-fg-muted">rows</div>
                </div>
              </div>
              {f.sampleIds.length > 0 && (
                <div className="mt-3">
                  <div className="text-[11px] uppercase font-semibold opacity-70 mb-1">
                    Samples ({f.sampleIds.length} of {f.count})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {f.sampleIds.slice(0, 20).map((id) => {
                      const isOrder = f.id === 'delivered-no-invoice'
                      const href = isOrder ? `/ops/orders/${id}` : `/ops/invoices/${id}`
                      return (
                        <Link
                          key={id}
                          href={href}
                          className="text-[11px] font-mono bg-white/40 hover:bg-white px-2 py-0.5 rounded border"
                        >
                          {id.slice(0, 12)}…
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )}
            </Card>
          ))}
          {findings.length === 0 && !loading && (
            <Card padding="md">
              <div className="text-sm text-fg-muted text-center">✓ No data quality issues detected.</div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
