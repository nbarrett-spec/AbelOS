'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import {
  Download,
  Copy,
  Check,
  Calendar as CalendarIcon,
  Mail,
  Clock,
  Play,
  FileText,
  Truck,
  Users,
  Package,
  DollarSign,
  X,
} from 'lucide-react'
import { PageHeader, Button } from '@/components/ui'

interface ReportData {
  period: number
  revenue: { orderCount: number; totalRevenue: number; avgOrderValue: number; completedOrders: number }
  monthlyRevenue: { month: string; monthLabel: string; orders: number; revenue: number }[]
  topBuilders: { companyName: string; orderCount: number; totalRevenue: number; avgOrder: number }[]
  categoryMix: { category: string; itemCount: number; revenue: number }[]
  quoteMetrics: { totalQuotes: number; approved: number; rejected: number; pending: number; totalQuoteValue: number; approvedValue: number }
  pipeline: { status: string; count: number; value: number }[]
  lowStock: { sku: string; name: string; category: string; onHand: number; committed: number; available: number }[]
}

const fmt = (n: number) => (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const fmtCurrency = (n: number) => '$' + (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const STATUS_LABELS: Record<string, string> = {
  RECEIVED: 'Received', CONFIRMED: 'Confirmed', IN_PRODUCTION: 'In Production',
  READY_TO_SHIP: 'Ready to Ship', SHIPPED: 'Shipped', DELIVERED: 'Delivered', COMPLETE: 'Complete',
}

type TemplateId = 'ar-aging' | 'revenue-by-builder' | 'po-by-vendor' | 'deliveries-by-driver' | 'profit-by-family'
type Cadence = 'daily' | 'weekly' | 'monthly'

interface TemplateDef {
  id: TemplateId
  title: string
  blurb: string
  Icon: typeof FileText
}

const TEMPLATES: TemplateDef[] = [
  { id: 'ar-aging', title: 'AR Aging', blurb: 'Current, 1–30, 31–60, 60+ day buckets with invoice count and balance.', Icon: DollarSign },
  { id: 'revenue-by-builder', title: 'Revenue by Builder', blurb: 'Orders, revenue, and avg order for each builder over a date window.', Icon: Users },
  { id: 'po-by-vendor', title: 'PO by Vendor', blurb: 'Open and total POs, value, and count grouped by vendor.', Icon: Package },
  { id: 'deliveries-by-driver', title: 'Deliveries by Driver', blurb: 'Deliveries, completions, in-flight, and on-time count per crew.', Icon: Truck },
  { id: 'profit-by-family', title: 'Profitability', blurb: 'Revenue, est. cost, est. margin, and margin % by product family.', Icon: FileText },
]

export default function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('30')

  // Template panel state
  const [activeTemplate, setActiveTemplate] = useState<TemplateId | null>(null)
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const thirtyAgo = useMemo(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), [])
  const [from, setFrom] = useState(thirtyAgo)
  const [to, setTo] = useState(today)
  const [generating, setGenerating] = useState(false)
  const [copiedTemplateId, setCopiedTemplateId] = useState<TemplateId | null>(null)
  const [cadence, setCadence] = useState<Cadence>('weekly')
  const [recipientInput, setRecipientInput] = useState('')
  const [recipients, setRecipients] = useState<string[]>([])
  const [scheduling, setScheduling] = useState(false)
  const [scheduleMsg, setScheduleMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/ops/reports?period=${period}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false))
  }, [period])

  // ── Template actions ───────────────────────────────────────────────────
  const runTemplate = async (templateId: TemplateId, opts: { mode: 'download' | 'copy' }) => {
    setGenerating(true)
    try {
      const res = await fetch('/api/ops/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId,
          params: { from, to, format: opts.mode === 'copy' ? 'csv' : 'csv' },
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const text = await res.text()
      if (opts.mode === 'copy') {
        await navigator.clipboard.writeText(text)
        setCopiedTemplateId(templateId)
        setTimeout(() => setCopiedTemplateId(null), 1800)
      } else {
        const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `abel-report_${templateId}_${today}.csv`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      }
    } catch (err: any) {
      alert(`Failed to generate report: ${err.message}`)
    } finally {
      setGenerating(false)
    }
  }

  const emailTemplate = (templateId: TemplateId) => {
    const t = TEMPLATES.find((x) => x.id === templateId)!
    const subject = `Abel Report — ${t.title} — ${today}`
    const body = [
      `Report: ${t.title}`,
      `Window: ${from} to ${to}`,
      ``,
      `Generated from Abel OS. To pull the CSV, visit:`,
      `${window.location.origin}/ops/reports`,
      ``,
      `Click "Generate" on the ${t.title} tile to download the latest.`,
    ].join('\n')
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  const addRecipient = () => {
    const v = recipientInput.trim()
    if (!v) return
    const parts = v.split(/[\s,;]+/).filter(Boolean)
    const seen = new Set(recipients)
    const next = [...recipients]
    for (const p of parts) if (!seen.has(p)) { next.push(p); seen.add(p) }
    setRecipients(next)
    setRecipientInput('')
  }

  const removeRecipient = (email: string) => {
    setRecipients(recipients.filter((r) => r !== email))
  }

  const scheduleTemplate = async () => {
    if (!activeTemplate) return
    if (recipients.length === 0) {
      setScheduleMsg({ ok: false, text: 'Add at least one recipient.' })
      return
    }
    setScheduling(true)
    setScheduleMsg(null)
    try {
      const res = await fetch('/api/ops/reports/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: activeTemplate,
          cadence,
          recipients,
          params: { from, to },
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      setScheduleMsg({ ok: true, text: `Scheduled ${cadence} delivery to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}.` })
      setRecipients([])
    } catch (err: any) {
      setScheduleMsg({ ok: false, text: `Schedule failed: ${err.message}` })
    } finally {
      setScheduling(false)
    }
  }

  const activeTemplateDef = activeTemplate ? TEMPLATES.find((t) => t.id === activeTemplate) : null

  // ── Loading / empty states ─────────────────────────────────────────────
  if (loading || !data) {
    return (
      <div>
        <PageHeader title="Reports & Analytics" description="Revenue, builder performance, and operational metrics" />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-[#0f2a3e] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  const qm = data.quoteMetrics || { totalQuotes: 0, approved: 0, rejected: 0, pending: 0, totalQuoteValue: 0, approvedValue: 0 }
  const rev = data.revenue || { orderCount: 0, totalRevenue: 0, avgOrderValue: 0, completedOrders: 0 }
  const conversionRate = (qm.totalQuotes || 0) > 0 ? (((qm.approved || 0) / qm.totalQuotes) * 100).toFixed(1) : '0'
  const maxMonthlyRevenue = Math.max(...(data.monthlyRevenue || []).map((m) => m.revenue), 1)

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports & Analytics"
        description="Revenue, builder performance, and operational metrics"
        actions={
          <div className="flex gap-1 sm:gap-2 bg-gray-100 rounded-lg p-1">
            {[
              { label: '7d', value: '7' },
              { label: '30d', value: '30' },
              { label: '90d', value: '90' },
              { label: 'Year', value: '365' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                  period === opt.value ? 'bg-white shadow text-[#0f2a3e]' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        }
      />

      {/* ── Report Templates ─────────────────────────────────────────────── */}
      <section className="rounded-xl border bg-white p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-gray-900">Report Templates</h2>
            <p className="text-xs text-gray-500 mt-0.5">Generate on demand, copy to clipboard, or schedule recurring email delivery.</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <CalendarIcon className="w-4 h-4 text-gray-400" />
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="border rounded-md px-2 py-1 text-xs"
              aria-label="Window from"
            />
            <span className="text-gray-400 text-xs">to</span>
            <input
              type="date"
              value={to}
              max={today}
              onChange={(e) => setTo(e.target.value)}
              className="border rounded-md px-2 py-1 text-xs"
              aria-label="Window to"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {TEMPLATES.map((t) => {
            const Icon = t.Icon
            const isActive = activeTemplate === t.id
            return (
              <div
                key={t.id}
                className={`rounded-lg border p-4 transition ${
                  isActive ? 'border-[#0f2a3e] ring-1 ring-[#0f2a3e]/20 bg-[#0f2a3e]/[0.02]' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="rounded-md bg-[#0f2a3e]/5 p-2 text-[#0f2a3e] shrink-0">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-gray-900 truncate">{t.title}</p>
                    <p className="text-xs text-gray-500 mt-1 leading-snug">{t.blurb}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => runTemplate(t.id, { mode: 'download' })}
                    disabled={generating}
                  >
                    <Play className="w-3.5 h-3.5 mr-1" /> Generate
                  </Button>
                  <button
                    type="button"
                    onClick={() => runTemplate(t.id, { mode: 'copy' })}
                    disabled={generating}
                    className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 px-2 py-1 rounded border border-gray-200 hover:border-gray-300 disabled:opacity-50"
                    title="Copy CSV to clipboard"
                  >
                    {copiedTemplateId === t.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedTemplateId === t.id ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={() => emailTemplate(t.id)}
                    className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 px-2 py-1 rounded border border-gray-200 hover:border-gray-300"
                    title="Email this report"
                  >
                    <Mail className="w-3.5 h-3.5" /> Email
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTemplate(isActive ? null : t.id)
                      setScheduleMsg(null)
                    }}
                    className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border transition ${
                      isActive
                        ? 'text-[#0f2a3e] border-[#0f2a3e]/40 bg-[#0f2a3e]/5'
                        : 'text-gray-600 border-gray-200 hover:border-gray-300 hover:text-gray-900'
                    }`}
                    title="Schedule recurring delivery"
                  >
                    <Clock className="w-3.5 h-3.5" /> Schedule
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Schedule panel */}
        {activeTemplateDef && (
          <div className="mt-4 rounded-lg border border-[#0f2a3e]/30 bg-[#0f2a3e]/[0.02] p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">Schedule: {activeTemplateDef.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Window {from} to {to}. Delivery starts on the next tick of the selected cadence.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setActiveTemplate(null); setScheduleMsg(null) }}
                className="text-gray-400 hover:text-gray-700"
                aria-label="Close schedule panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Cadence</label>
                <select
                  value={cadence}
                  onChange={(e) => setCadence(e.target.value as Cadence)}
                  className="border rounded-md px-2 py-1.5 text-sm"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>

              <div className="flex-1 min-w-[240px]">
                <label className="block text-xs text-gray-500 mb-1">Email recipients</label>
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    value={recipientInput}
                    onChange={(e) => setRecipientInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
                        e.preventDefault()
                        addRecipient()
                      }
                    }}
                    placeholder="name@abellumber.com"
                    className="flex-1 border rounded-md px-2 py-1.5 text-sm"
                  />
                  <Button size="sm" variant="ghost" onClick={addRecipient}>Add</Button>
                </div>
                {recipients.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {recipients.map((r) => (
                      <span key={r} className="inline-flex items-center gap-1 text-xs bg-white border border-gray-200 rounded px-2 py-0.5">
                        {r}
                        <button
                          type="button"
                          onClick={() => removeRecipient(r)}
                          className="text-gray-400 hover:text-red-600"
                          aria-label={`Remove ${r}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <Button variant="primary" size="sm" onClick={scheduleTemplate} disabled={scheduling}>
                {scheduling ? 'Scheduling...' : 'Save schedule'}
              </Button>
            </div>

            {scheduleMsg && (
              <p className={`text-xs mt-3 ${scheduleMsg.ok ? 'text-green-700' : 'text-red-600'}`}>
                {scheduleMsg.text}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Quick Actions */}
      <div>
        <Link
          href="/ops/reports/shipping-forecast"
          className="inline-flex items-center gap-3 bg-white border rounded-xl px-5 py-4 hover:border-[#0f2a3e] hover:shadow-md transition group"
        >
          <span className="text-2xl" aria-hidden>
            <Truck className="w-6 h-6 text-[#0f2a3e]" />
          </span>
          <div>
            <p className="font-semibold text-gray-900 group-hover:text-[#0f2a3e] transition">Shipping Forecast Report</p>
            <p className="text-xs text-gray-400">
              Orders shipping soon with BOM totals, assembled doors &amp; downloadable XLSX
            </p>
          </div>
          <span className="text-gray-300 group-hover:text-[#0f2a3e] ml-4 transition">&rarr;</span>
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-xl border p-5">
          <p className="text-sm text-gray-500">Total Revenue</p>
          <p className="text-3xl font-bold text-[#0f2a3e] mt-1">{fmtCurrency(rev.totalRevenue)}</p>
          <p className="text-xs text-gray-400 mt-1">{fmt(rev.orderCount)} orders</p>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <p className="text-sm text-gray-500">Avg Order Value</p>
          <p className="text-3xl font-bold text-[#C6A24E] mt-1">{fmtCurrency(rev.avgOrderValue)}</p>
          <p className="text-xs text-gray-400 mt-1">{fmt(rev.completedOrders)} completed</p>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <p className="text-sm text-gray-500">Quote Conversion</p>
          <p className="text-3xl font-bold text-green-600 mt-1">{conversionRate}%</p>
          <p className="text-xs text-gray-400 mt-1">{qm.approved || 0} of {qm.totalQuotes || 0} quotes</p>
        </div>
        <div className="bg-white rounded-xl border p-5">
          <p className="text-sm text-gray-500">Pipeline Value</p>
          <p className="text-3xl font-bold text-purple-600 mt-1">{fmtCurrency((qm.totalQuoteValue || 0) - (qm.approvedValue || 0))}</p>
          <p className="text-xs text-gray-400 mt-1">{qm.pending || 0} quotes pending</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Monthly Revenue Chart */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Monthly Revenue</h3>
            <button
              type="button"
              onClick={() => runTemplate('revenue-by-builder', { mode: 'download' })}
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 px-2 py-1 rounded border border-transparent hover:border-gray-200"
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
          </div>
          {data.monthlyRevenue.length === 0 ? (
            <p className="text-gray-400 text-sm">No revenue data for this period</p>
          ) : (
            <div className="space-y-3">
              {data.monthlyRevenue.map((m) => (
                <div key={m.month} className="flex items-center gap-3">
                  <span className="text-sm text-gray-500 w-10">{m.monthLabel}</span>
                  <div className="flex-1 h-8 bg-gray-50 rounded-lg overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#0f2a3e] to-[#2980B9] rounded-lg flex items-center px-3"
                      style={{ width: `${Math.max(5, (m.revenue / maxMonthlyRevenue) * 100)}%` }}
                    >
                      <span className="text-xs text-white font-medium whitespace-nowrap">{fmtCurrency(m.revenue)}</span>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 w-16 text-right">{m.orders} orders</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Order Pipeline */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Order Pipeline</h3>
          {data.pipeline.length === 0 ? (
            <p className="text-gray-400 text-sm">No orders for this period</p>
          ) : (
            <div className="space-y-3">
              {data.pipeline.map((p) => (
                <div key={p.status} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#0f2a3e]" />
                    <span className="text-sm font-medium text-gray-700">{STATUS_LABELS[p.status] || p.status}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-500">{p.count} orders</span>
                    <span className="text-sm font-semibold text-[#0f2a3e]">{fmtCurrency(p.value)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {/* Top Builders */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Top Builders by Revenue</h3>
            <button
              type="button"
              onClick={() => runTemplate('revenue-by-builder', { mode: 'copy' })}
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 px-2 py-1 rounded border border-transparent hover:border-gray-200"
            >
              {copiedTemplateId === 'revenue-by-builder' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedTemplateId === 'revenue-by-builder' ? 'Copied' : 'Copy CSV'}
            </button>
          </div>
          {data.topBuilders.length === 0 ? (
            <p className="text-gray-400 text-sm">No builder data for this period</p>
          ) : (
            <div className="divide-y">
              {data.topBuilders.map((b, i) => (
                <div key={b.companyName} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                      i === 0 ? 'bg-[#C6A24E]' : i === 1 ? 'bg-[#0f2a3e]' : 'bg-gray-400'
                    }`}>{i + 1}</span>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{b.companyName}</p>
                      <p className="text-xs text-gray-400">{b.orderCount} orders &middot; avg {fmtCurrency(b.avgOrder)}</p>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-[#0f2a3e]">{fmtCurrency(b.totalRevenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Product Category Mix */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Product Category Mix</h3>
            <button
              type="button"
              onClick={() => runTemplate('profit-by-family', { mode: 'copy' })}
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 px-2 py-1 rounded border border-transparent hover:border-gray-200"
            >
              {copiedTemplateId === 'profit-by-family' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedTemplateId === 'profit-by-family' ? 'Copied' : 'Copy CSV'}
            </button>
          </div>
          {data.categoryMix.length === 0 ? (
            <p className="text-gray-400 text-sm">No product data for this period</p>
          ) : (
            <div className="space-y-3">
              {data.categoryMix.map((c) => {
                const totalCategoryRevenue = data.categoryMix.reduce((s, x) => s + x.revenue, 0)
                const pct = totalCategoryRevenue > 0 ? ((c.revenue / totalCategoryRevenue) * 100).toFixed(0) : '0'
                return (
                  <div key={c.category} className="flex items-center gap-3">
                    <span className="text-sm text-gray-600 w-32 truncate">{c.category}</span>
                    <div className="flex-1 h-5 bg-gray-50 rounded overflow-hidden">
                      <div className="h-full bg-[#0f2a3e]/20 rounded" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-10 text-right">{pct}%</span>
                    <span className="text-sm font-medium text-gray-900 w-20 text-right">{fmtCurrency(c.revenue)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Low Stock Alerts */}
      {data.lowStock.length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-900 mb-4">
            <span className="text-signal mr-2">!</span>
            Low Stock Alerts ({data.lowStock.length} items)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.lowStock.map((item) => (
              <div key={item.sku} className={`p-3 rounded-lg border ${item.available <= 0 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                <p className="text-xs text-gray-500">{item.sku} &middot; {item.category}</p>
                <div className="flex gap-3 mt-2">
                  <span className="text-xs">On Hand: <strong>{item.onHand}</strong></span>
                  <span className="text-xs">Available: <strong className={item.available <= 0 ? 'text-red-600' : 'text-signal'}>{item.available}</strong></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
