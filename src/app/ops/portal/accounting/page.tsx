'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface KPIData {
  totalAR: number
  totalAP: number
  cashPosition: number
  revenueMTD: number
  netIncomeMTD: number
  dso: number
  collectionRate: number
  currentRatio: number
  arTrend: number
  apTrend: number
}

interface OverviewData {
  invoiceStatusCounts: Record<string, number>
  topBuilders: Array<{ name: string; balance: number; id: string }>
  recentPayments: Array<{ id: string; invoiceNumber: string; builder: string; amount: number; date: string; method: string }>
  revenueMTD: number
  revenueLastMonth: number
  expensesMTD: number
  expensesLastMonth: number
  poStatusCounts: Record<string, number>
  upcomingAP: Array<{ id: string; poNumber: string; vendor: string; amount: number; dueDate: string }>
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(value)
}

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const TrendArrow = ({ value }: { value: number }) => {
  const isPositive = value >= 0
  return (
    <span className={`ml-1 ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
      {isPositive ? '↑' : '↓'} {Math.abs(value).toFixed(1)}%
    </span>
  )
}

export default function AccountingCommandCenter() {
  const [kpis, setKpis] = useState<KPIData | null>(null)
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [chatMessages, setChatMessages] = useState<Message[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [aiPanelOpen, setAiPanelOpen] = useState(true)

  useEffect(() => {
    async function loadData() {
      try {
        const [kpiRes, overviewRes] = await Promise.all([
          fetch('/api/ops/accounting-command?section=kpis'),
          fetch('/api/ops/accounting-command?section=overview'),
        ])

        const kpiData = kpiRes.ok ? await kpiRes.json() : getDefaultKPIs()
        const overviewData = overviewRes.ok ? await overviewRes.json() : getDefaultOverview()

        setKpis(kpiData)
        setOverview(overviewData)
      } catch (error) {
        console.error('Failed to load accounting data:', error)
        setError('Failed to load data. Please try again.')
        setKpis(getDefaultKPIs())
        setOverview(getDefaultOverview())
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  const getDefaultKPIs = (): KPIData => ({
    totalAR: 487250,
    totalAP: 156890,
    cashPosition: 234567,
    revenueMTD: 542100,
    netIncomeMTD: 89450,
    dso: 28,
    collectionRate: 94.2,
    currentRatio: 3.1,
    arTrend: 2.3,
    apTrend: -1.8,
  })

  const getDefaultOverview = (): OverviewData => ({
    invoiceStatusCounts: { DRAFT: 2, ISSUED: 5, SENT: 12, OVERDUE: 3, PAID: 47 },
    topBuilders: [
      { name: 'Miller Construction', balance: 45230, id: '1' },
      { name: 'Davidson Builders', balance: 38900, id: '2' },
      { name: 'Turner & Sons', balance: 32100, id: '3' },
      { name: 'Phoenix Homes', balance: 28450, id: '4' },
      { name: 'Coastal Properties', balance: 24180, id: '5' },
    ],
    recentPayments: [
      { id: '1', invoiceNumber: 'INV-2024-089', builder: 'Miller Construction', amount: 15000, date: '2026-03-28', method: 'ACH' },
      { id: '2', invoiceNumber: 'INV-2024-087', builder: 'Davidson Builders', amount: 8500, date: '2026-03-25', method: 'Check' },
      { id: '3', invoiceNumber: 'INV-2024-085', builder: 'Turner & Sons', amount: 12300, date: '2026-03-22', method: 'ACH' },
      { id: '4', invoiceNumber: 'INV-2024-083', builder: 'Phoenix Homes', amount: 9100, date: '2026-03-20', method: 'Wire' },
      { id: '5', invoiceNumber: 'INV-2024-081', builder: 'Coastal Properties', amount: 6800, date: '2026-03-18', method: 'Check' },
    ],
    revenueMTD: 542100,
    revenueLastMonth: 498300,
    expensesMTD: 452650,
    expensesLastMonth: 441200,
    poStatusCounts: { DRAFT: 4, PENDING_APPROVAL: 8, APPROVED: 12, SENT_TO_VENDOR: 15, PARTIALLY_RECEIVED: 6, RECEIVED: 28 },
    upcomingAP: [
      { id: '1', poNumber: 'PO-2024-512', vendor: 'Lumber Wholesale Inc', amount: 18500, dueDate: '2026-04-05' },
      { id: '2', poNumber: 'PO-2024-511', vendor: 'Metal Suppliers Co', amount: 12300, dueDate: '2026-04-07' },
      { id: '3', poNumber: 'PO-2024-509', vendor: 'Hardware Direct', amount: 8900, dueDate: '2026-04-10' },
      { id: '4', poNumber: 'PO-2024-508', vendor: 'Fastener World', amount: 5600, dueDate: '2026-04-12' },
      { id: '5', poNumber: 'PO-2024-507', vendor: 'Paint & Chemicals', amount: 3400, dueDate: '2026-04-15' },
    ],
  })

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!chatInput.trim()) return

    const userMessage: Message = { role: 'user', content: chatInput }
    setChatMessages((prev) => [...prev, userMessage])
    setChatInput('')
    setChatLoading(true)

    try {
      const response = await fetch('/api/ops/accounting-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: chatInput }),
      })

      if (response.ok) {
        const data = await response.json()
        const assistantMessage: Message = { role: 'assistant', content: data.response || 'I processed your request.' }
        setChatMessages((prev) => [...prev, assistantMessage])
      }
    } catch (error) {
      console.error('Failed to send message:', error)
      const errorMessage: Message = { role: 'assistant', content: 'Sorry, I encountered an error processing your request.' }
      setChatMessages((prev) => [...prev, errorMessage])
    } finally {
      setChatLoading(false)
    }
  }

  const revenueChange = overview ? ((overview.revenueMTD - overview.revenueLastMonth) / overview.revenueLastMonth) * 100 : 0
  const totalInvoiceStatus = overview ? Object.values(overview.invoiceStatusCounts).reduce((a: number, b: number) => a + b, 0) : 1

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="animate-pulse text-signal-hover text-lg">Loading Accounting Command Center...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center py-12">
          <div className="text-4xl mb-4">⚠️</div>
          <p className="text-gray-600 font-medium">{error}</p>
          <button onClick={() => { setError(null); window.location.reload() }} className="mt-4 px-4 py-2 bg-[#0f2a3e] text-white rounded-lg hover:bg-[#0a1a28] text-sm">
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950">
      {/* HEADER BAR */}
      <div className="bg-gray-900 border-b border-gray-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-3">
              <h1 className="text-3xl font-bold text-white">Accounting Command Center</h1>
              <span className="text-signal-hover text-sm font-semibold">For: Dawn</span>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/ops/portal/accounting/ar"
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              >
                AR Management
              </Link>
              <Link
                href="/ops/portal/accounting/ap"
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              >
                AP Management
              </Link>
              <Link
                href="/ops/portal/accounting/reports"
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              >
                Financial Reports
              </Link>
              <Link
                href="/ops/invoices"
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              >
                Invoices
              </Link>
              <Link
                href="/ops/portal/accounting/close"
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              >
                Monthly Close
              </Link>
              <Link
                href="/ops/portal/accounting/integrations"
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              >
                Integrations
              </Link>
              <Link
                href="/ops/finance/patterns"
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              >
                Payment Patterns
              </Link>
              <Link
                href="/ops/finance/ap-forecast"
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              >
                AP Forecast
              </Link>
              <Link
                href="/ops/portal/accounting/briefing"
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              >
                Daily Briefing
              </Link>
              <button
                onClick={() => setAiPanelOpen(!aiPanelOpen)}
                className="px-4 py-2 text-sm font-medium text-signal-hover hover:text-amber-300 hover:bg-gray-800 rounded-lg transition-colors border border-amber-400/30"
              >
                {aiPanelOpen ? 'Hide' : 'Show'} AI Assistant
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* KPI STRIP */}
        {kpis && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-8 gap-3">
            {/* Total AR */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Total AR</p>
              <p className="text-white text-xl font-bold mt-2">{formatCurrency(kpis.totalAR)}</p>
              <p className="text-signal-hover text-xs mt-2 flex items-center">
                <TrendArrow value={kpis.arTrend} />
              </p>
            </div>

            {/* Total AP */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Total AP</p>
              <p className="text-white text-xl font-bold mt-2">{formatCurrency(kpis.totalAP)}</p>
              <p className="text-red-400 text-xs mt-2 flex items-center">
                <TrendArrow value={kpis.apTrend} />
              </p>
            </div>

            {/* Cash Position */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Cash Position</p>
              <p className={`text-xl font-bold mt-2 ${kpis.cashPosition >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatCurrency(kpis.cashPosition)}
              </p>
              <p className="text-gray-500 text-xs mt-2">Positive</p>
            </div>

            {/* Revenue MTD */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Revenue MTD</p>
              <p className="text-emerald-400 text-xl font-bold mt-2">{formatCurrency(kpis.revenueMTD)}</p>
              <p className="text-gray-500 text-xs mt-2">Month to date</p>
            </div>

            {/* Net Income MTD */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Net Income</p>
              <p className={`text-xl font-bold mt-2 ${kpis.netIncomeMTD >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatCurrency(kpis.netIncomeMTD)}
              </p>
              <p className="text-gray-500 text-xs mt-2">MTD</p>
            </div>

            {/* DSO */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">DSO</p>
              <p className="text-white text-xl font-bold mt-2">{kpis.dso}</p>
              <p className="text-emerald-400 text-xs mt-2">days</p>
            </div>

            {/* Collection Rate */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Collection Rate</p>
              <p className="text-emerald-400 text-xl font-bold mt-2">{kpis.collectionRate}%</p>
              <p className="text-gray-500 text-xs mt-2">Excellent</p>
            </div>

            {/* Current Ratio */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Current Ratio</p>
              <p className="text-emerald-400 text-xl font-bold mt-2">{kpis.currentRatio}</p>
              <p className="text-gray-500 text-xs mt-2">AR/AP</p>
            </div>
          </div>
        )}

        {/* MAIN GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* LEFT COLUMN */}
          <div className="lg:col-span-2 space-y-8">
            {/* Revenue vs Expenses */}
            {overview && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h2 className="text-white text-lg font-bold mb-6">Revenue vs Expenses</h2>
                <div className="space-y-6">
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-gray-400 text-sm">This Month</span>
                      <span className="text-emerald-400 font-semibold">{formatCurrency(overview.revenueMTD - overview.expensesMTD)}</span>
                    </div>
                    <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-400" style={{ width: '65%' }} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                      <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">Revenue</p>
                      <p className="text-white text-xl font-bold">{formatCurrency(overview.revenueMTD)}</p>
                      <p className="text-emerald-400 text-xs mt-2">vs {formatCurrency(overview.revenueLastMonth)} last month</p>
                    </div>
                    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                      <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">Expenses</p>
                      <p className="text-white text-xl font-bold">{formatCurrency(overview.expensesMTD)}</p>
                      <p className="text-gray-500 text-xs mt-2">vs {formatCurrency(overview.expensesLastMonth)} last month</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Invoice Status Breakdown */}
            {overview && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h2 className="text-white text-lg font-bold mb-6">Invoice Status Breakdown</h2>
                <div className="space-y-4">
                  <div className="h-8 bg-gray-800 rounded-full overflow-hidden flex">
                    {Object.entries(overview.invoiceStatusCounts).map(([status, count]: [string, number]) => {
                      const percentage = (count / totalInvoiceStatus) * 100
                      let bgColor = 'bg-gray-600'
                      if (status === 'DRAFT') bgColor = 'bg-gray-600'
                      if (status === 'ISSUED') bgColor = 'bg-blue-600'
                      if (status === 'SENT') bgColor = 'bg-signal'
                      if (status === 'OVERDUE') bgColor = 'bg-red-600'
                      if (status === 'PAID') bgColor = 'bg-emerald-600'
                      return (
                        <div key={status} className={`${bgColor} transition-all hover:opacity-80`} style={{ width: `${percentage}%` }} />
                      )
                    })}
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {Object.entries(overview.invoiceStatusCounts).map(([status, count]: [string, number]) => (
                      <div key={status} className="text-center">
                        <p className="text-gray-400 text-xs mb-1">{status}</p>
                        <p className="text-white font-bold text-lg">{count}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Top Outstanding Builders */}
            {overview && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h2 className="text-white text-lg font-bold mb-6">Top Outstanding Builders</h2>
                <div className="space-y-3">
                  {overview.topBuilders.map((builder: { name: string; balance: number; id: string }) => (
                    <div key={builder.id} className="flex items-center justify-between bg-gray-800/30 border border-gray-700 rounded-lg p-4 hover:bg-gray-800/50 transition-colors">
                      <div>
                        <p className="text-white font-medium">{builder.name}</p>
                        <p className="text-gray-400 text-sm mt-1">Balance due</p>
                      </div>
                      <div className="text-right">
                        <p className="text-signal-hover font-bold text-lg">{formatCurrency(builder.balance)}</p>
                        <button className="text-xs text-gray-400 hover:text-gray-300 mt-1 underline">Send Reminder</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Payments */}
            {overview && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                <h2 className="text-white text-lg font-bold mb-6">Recent Payments</h2>
                <div className="space-y-3">
                  {overview.recentPayments.map((payment: { id: string; invoiceNumber: string; builder: string; amount: number; date: string; method: string }) => (
                    <div key={payment.id} className="flex items-center justify-between bg-gray-800/30 border border-gray-700 rounded-lg p-4">
                      <div className="flex-1">
                        <div className="flex items-baseline gap-2">
                          <p className="text-white font-medium">{payment.invoiceNumber}</p>
                          <span className="text-emerald-400 text-xs bg-emerald-400/10 px-2 py-1 rounded">{payment.method}</span>
                        </div>
                        <p className="text-gray-400 text-sm mt-1">{payment.builder}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-emerald-400 font-bold">{formatCurrency(payment.amount)}</p>
                        <p className="text-gray-500 text-xs mt-1">{formatDate(payment.date)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN */}
          <div className="space-y-8">
            {/* AI Financial Assistant */}
            {aiPanelOpen && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 flex flex-col h-96">
                <h2 className="text-white text-lg font-bold mb-4">AI Financial Assistant</h2>
                <div className="flex-1 overflow-y-auto mb-4 space-y-3 bg-gray-950/50 rounded-lg p-3">
                  {chatMessages.length === 0 && (
                    <div className="flex items-center justify-center h-full text-gray-500 text-sm text-center">
                      <p>Ask me anything about your accounting metrics, invoices, or cash flow</p>
                    </div>
                  )}
                  {chatMessages.map((msg: Message, idx: number) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-xs rounded-lg px-4 py-2 text-sm ${
                          msg.role === 'user'
                            ? 'bg-signal-hover/20 text-amber-200 border border-amber-400/30'
                            : 'bg-emerald-400/10 text-emerald-200 border border-emerald-400/20'
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-emerald-400/10 text-emerald-200 rounded-lg px-4 py-2 text-sm">
                        <span className="inline-flex gap-1">
                          <span className="animate-pulse">•</span>
                          <span className="animate-pulse animation-delay-100">•</span>
                          <span className="animate-pulse animation-delay-200">•</span>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                <form onSubmit={handleSendMessage} className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask about AR, AP, cash flow..."
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-amber-400"
                    disabled={chatLoading}
                  />
                  <button
                    type="submit"
                    disabled={chatLoading}
                    className="px-4 py-2 bg-signal-hover text-gray-950 font-medium rounded-lg hover:bg-amber-300 disabled:bg-gray-700 disabled:text-gray-500 transition-colors text-sm"
                  >
                    Send
                  </button>
                </form>
              </div>
            )}

            {/* Quick Actions */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h2 className="text-white text-lg font-bold mb-4">Quick Actions</h2>
              <div className="grid grid-cols-1 gap-3">
                <Link
                  href="/ops/invoices?action=create"
                  className="block bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-4 py-3 text-center text-white font-medium transition-colors text-sm"
                >
                  Create Invoice
                </Link>
                <Link
                  href="/ops/invoices"
                  className="block bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-4 py-3 text-center text-white font-medium transition-colors text-sm"
                >
                  Record Payment
                </Link>
                <Link
                  href="/ops/portal/accounting/briefing"
                  className="block bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-4 py-3 text-center text-white font-medium transition-colors text-sm"
                >
                  Run Collections
                </Link>
                <Link
                  href="/ops/portal/accounting/ar"
                  className="block bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-4 py-3 text-center text-white font-medium transition-colors text-sm"
                >
                  View Aging Report
                </Link>
                <Link
                  href="/ops/portal/accounting/reports"
                  className="block bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-4 py-3 text-center text-white font-medium transition-colors text-sm"
                >
                  Cash Flow Forecast
                </Link>
                <Link
                  href="/ops/portal/accounting/reports?tab=jobs"
                  className="block bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-4 py-3 text-center text-white font-medium transition-colors text-sm"
                >
                  Job Profitability
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* BOTTOM ROW */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* PO Status Summary */}
          {overview && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h2 className="text-white text-lg font-bold mb-6">PO Status Summary</h2>
              <div className="flex flex-wrap gap-3">
                {Object.entries(overview.poStatusCounts).map(([status, count]: [string, number]) => {
                  let colorClass = 'bg-gray-700 text-gray-200'
                  if (status === 'DRAFT') colorClass = 'bg-gray-700 text-gray-200'
                  if (status === 'PENDING_APPROVAL') colorClass = 'bg-signal/20 text-amber-300'
                  if (status === 'APPROVED') colorClass = 'bg-blue-600/20 text-blue-300'
                  if (status === 'SENT_TO_VENDOR') colorClass = 'bg-cyan-600/20 text-cyan-300'
                  if (status === 'PARTIALLY_RECEIVED') colorClass = 'bg-orange-600/20 text-orange-300'
                  if (status === 'RECEIVED') colorClass = 'bg-emerald-600/20 text-emerald-300'

                  return (
                    <div key={status} className={`${colorClass} px-4 py-2 rounded-lg font-medium text-sm`}>
                      {status.replace(/_/g, ' ')} ({count})
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Upcoming AP */}
          {overview && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h2 className="text-white text-lg font-bold mb-6">Upcoming AP</h2>
              <div className="space-y-3">
                {overview.upcomingAP.map((item: { id: string; poNumber: string; vendor: string; amount: number; dueDate: string }) => (
                  <div key={item.id} className="flex items-center justify-between bg-gray-800/30 border border-gray-700 rounded-lg p-4">
                    <div className="flex-1">
                      <p className="text-white font-medium">{item.poNumber}</p>
                      <p className="text-gray-400 text-sm mt-1">{item.vendor}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-white font-bold">{formatCurrency(item.amount)}</p>
                      <p className="text-gray-400 text-xs mt-1">Due {formatDate(item.dueDate)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
