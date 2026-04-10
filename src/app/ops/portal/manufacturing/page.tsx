'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface KPIData {
  jobsInProduction: number;
  jobsStaged: number;
  picksPending: number;
  shortsAlerts: number;
  qcPassRate: number;
  unitsThisWeek: number;
  onTimeRate: number;
  avgCycleDays: number;
}

interface Job {
  id: string;
  jobNumber: string;
  builder: string;
  community: string;
  scheduledDate: string;
  pickProgress: number;
  status: string;
}

interface ShortItem {
  sku: string;
  description: string;
  totalShort: number;
  affectedJobs: number;
}

interface QCFailedCheck {
  jobId: string;
  defectCodes: string[];
  date: string;
}

interface WeeklyThroughput {
  week: string;
  count: number;
}

interface EfficiencyMetrics {
  avgDaysCreatedToStaged: number;
  avgDaysInProduction: number;
  avgPicksPerJob: number;
  monthThroughput: number;
  lastMonthThroughput: number;
}

interface OverviewData {
  kpi: KPIData;
  productionQueue: Job[];
  shortages: ShortItem[];
  qcSummary: {
    passRate: number;
    failCount: number;
    conditionalCount: number;
    failedChecks: QCFailedCheck[];
  };
  weeklyThroughput: WeeklyThroughput[];
}

interface EfficiencyData {
  metrics: EfficiencyMetrics;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export default function ManufacturingCommandCenter() {
  const [overviewData, setOverviewData] = useState<OverviewData | null>(null);
  const [efficiencyData, setEfficiencyData] = useState<EfficiencyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [overviewRes, efficiencyRes] = await Promise.all([
          fetch('/api/ops/manufacturing-command?section=overview'),
          fetch('/api/ops/manufacturing-command?section=efficiency'),
        ]);

        if (overviewRes.ok) {
          const overview = await overviewRes.json();
          setOverviewData(overview);
        }

        if (efficiencyRes.ok) {
          const efficiency = await efficiencyRes.json();
          setEfficiencyData(efficiency);
        }
      } catch (error) {
        console.error('Failed to fetch manufacturing data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const getKPIColor = (
    value: number,
    type: 'passRate' | 'onTime' | 'other'
  ): string => {
    if (type === 'passRate') {
      if (value > 95) return 'text-emerald-400';
      if (value > 85) return 'text-amber-400';
      return 'text-red-400';
    }
    if (type === 'onTime') {
      if (value > 90) return 'text-emerald-400';
      if (value > 75) return 'text-amber-400';
      return 'text-red-400';
    }
    return 'text-gray-400';
  };

  const getKPIBgColor = (
    value: number,
    type: 'passRate' | 'onTime' | 'other'
  ): string => {
    if (type === 'passRate') {
      if (value > 95) return 'bg-emerald-400/10 border-emerald-400/30';
      if (value > 85) return 'bg-amber-400/10 border-amber-400/30';
      return 'bg-red-400/10 border-red-400/30';
    }
    if (type === 'onTime') {
      if (value > 90) return 'bg-emerald-400/10 border-emerald-400/30';
      if (value > 75) return 'bg-amber-400/10 border-amber-400/30';
      return 'bg-red-400/10 border-red-400/30';
    }
    return 'bg-gray-800/50 border-gray-700';
  };

  const handleSendMessage = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: chatInput,
      timestamp: new Date(),
    };

    setChatMessages((prev: ChatMessage[]) => [...prev, userMessage]);
    setChatInput('');
    setChatLoading(true);

    try {
      const response = await fetch('/api/ops/manufacturing-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: chatInput }),
      });

      if (response.ok) {
        const data = await response.json();
        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.response,
          timestamp: new Date(),
        };
        setChatMessages((prev: ChatMessage[]) => [...prev, assistantMessage]);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setChatLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-950 min-h-screen text-white p-8">
        <div className="max-w-7xl mx-auto">
          <div className="h-12 bg-gray-800 rounded mb-8 animate-pulse" />
          <div className="grid grid-cols-8 gap-4 mb-8">
            {Array.from({ length: 8 }).map((_: any, i: number) => (
              <div key={i} className="h-32 bg-gray-800 rounded animate-pulse" />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2 space-y-6">
              {Array.from({ length: 3 }).map((_: any, i: number) => (
                <div
                  key={i}
                  className="h-64 bg-gray-800 rounded animate-pulse"
                />
              ))}
            </div>
            <div className="h-96 bg-gray-800 rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-950 min-h-screen text-white">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-8 py-4">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-3xl font-bold">Manufacturing Command Center</h1>
            <button
              onClick={() => setShowAIPanel(!showAIPanel)}
              className="px-4 py-2 bg-blue-400/20 border border-blue-400/50 rounded text-blue-400 hover:bg-blue-400/30 transition"
            >
              {showAIPanel ? 'Hide' : 'Show'} AI Assistant
            </button>
          </div>

          <nav className="flex gap-6 flex-wrap text-sm">
            <Link
              href="/ops/manufacturing"
              className="text-gray-400 hover:text-blue-400 transition"
            >
              Production Floor
            </Link>
            <Link
              href="/ops/portal/manufacturing/rework"
              className="text-gray-400 hover:text-blue-400 transition"
            >
              Rework & Defects
            </Link>
            <Link
              href="/ops/portal/manufacturing/receiving"
              className="text-gray-400 hover:text-blue-400 transition"
            >
              Receiving
            </Link>
            <Link
              href="/ops/portal/manufacturing/schedule"
              className="text-gray-400 hover:text-blue-400 transition"
            >
              Schedule
            </Link>
            <Link
              href="/ops/manufacturing/qc"
              className="text-gray-400 hover:text-blue-400 transition"
            >
              Quality Control
            </Link>
            <Link
              href="/ops/manufacturing/picks"
              className="text-gray-400 hover:text-blue-400 transition"
            >
              Pick Lists
            </Link>
            <Link
              href="/ops/manufacturing/staging"
              className="text-gray-400 hover:text-blue-400 transition"
            >
              Staging
            </Link>
          </nav>
        </div>
      </header>

      {/* KPI Strip */}
      {overviewData && (
        <div className="bg-gray-900 border-b border-gray-800 px-8 py-6">
          <div className="max-w-7xl mx-auto grid grid-cols-8 gap-4">
            <div className="bg-gray-800 border border-gray-700 rounded p-4">
              <div className="text-gray-400 text-xs font-semibold uppercase">
                Jobs In Production
              </div>
              <div className="text-2xl font-bold text-blue-400 mt-2">
                {overviewData.kpi.jobsInProduction.toLocaleString()}
              </div>
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded p-4">
              <div className="text-gray-400 text-xs font-semibold uppercase">
                Jobs Staged
              </div>
              <div className="text-2xl font-bold text-amber-400 mt-2">
                {overviewData.kpi.jobsStaged.toLocaleString()}
              </div>
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded p-4">
              <div className="text-gray-400 text-xs font-semibold uppercase">
                Picks Pending
              </div>
              <div className="text-2xl font-bold text-orange-400 mt-2">
                {overviewData.kpi.picksPending.toLocaleString()}
              </div>
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded p-4">
              <div className="text-gray-400 text-xs font-semibold uppercase">
                Shorts/Alerts
              </div>
              <div className="text-2xl font-bold text-red-400 mt-2">
                {overviewData.kpi.shortsAlerts.toLocaleString()}
              </div>
            </div>

            <div
              className={`border rounded p-4 ${getKPIBgColor(overviewData.kpi.qcPassRate, 'passRate')}`}
            >
              <div className="text-gray-400 text-xs font-semibold uppercase">
                QC Pass Rate
              </div>
              <div
                className={`text-2xl font-bold mt-2 ${getKPIColor(overviewData.kpi.qcPassRate, 'passRate')}`}
              >
                {overviewData.kpi.qcPassRate.toFixed(1)}%
              </div>
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded p-4">
              <div className="text-gray-400 text-xs font-semibold uppercase">
                Units This Week
              </div>
              <div className="text-2xl font-bold text-emerald-400 mt-2">
                {overviewData.kpi.unitsThisWeek.toLocaleString()}
              </div>
            </div>

            <div
              className={`border rounded p-4 ${getKPIBgColor(overviewData.kpi.onTimeRate, 'onTime')}`}
            >
              <div className="text-gray-400 text-xs font-semibold uppercase">
                On-Time Rate
              </div>
              <div
                className={`text-2xl font-bold mt-2 ${getKPIColor(overviewData.kpi.onTimeRate, 'onTime')}`}
              >
                {overviewData.kpi.onTimeRate.toFixed(1)}%
              </div>
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded p-4">
              <div className="text-gray-400 text-xs font-semibold uppercase">
                Avg Cycle Days
              </div>
              <div className="text-2xl font-bold text-white mt-2">
                {overviewData.kpi.avgCycleDays.toFixed(1)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="max-w-7xl mx-auto px-8 py-8">
        <div className="grid grid-cols-3 gap-6">
          {/* Left Column (2/3) */}
          <div className="col-span-2 space-y-6">
            {/* Production Queue */}
            {overviewData && (
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                <h2 className="text-xl font-bold mb-4">Production Queue</h2>
                <div className="space-y-3">
                  {overviewData.productionQueue
                    .slice(0, 5)
                    .map((job: Job) => (
                      <Link
                        key={job.id}
                        href={`/ops/manufacturing/build-sheet?jobId=${job.id}`}
                        className="block bg-gray-800 border border-gray-700 rounded p-4 hover:border-blue-400/50 transition group"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <div className="font-semibold text-blue-400 group-hover:text-blue-300">
                              Job #{job.jobNumber}
                            </div>
                            <div className="text-sm text-gray-400">
                              {job.builder} • {job.community}
                            </div>
                          </div>
                          <span className="px-2 py-1 bg-blue-400/20 border border-blue-400/50 rounded text-xs text-blue-400">
                            {job.status}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 mb-2">
                          Scheduled: {job.scheduledDate}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-700 rounded overflow-hidden">
                            <div
                              className="h-full bg-blue-400 transition-all"
                              style={{ width: `${job.pickProgress}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-400 w-10">
                            {job.pickProgress}%
                          </span>
                        </div>
                      </Link>
                    ))}
                </div>
              </div>
            )}

            {/* Material Shortage Alerts */}
            {overviewData && (
              <div
                className={`border rounded-lg p-6 ${
                  overviewData.shortages.length > 0
                    ? 'bg-red-400/5 border-red-400/30'
                    : 'bg-emerald-400/5 border-emerald-400/30'
                }`}
              >
                <h2 className="text-xl font-bold mb-4">Material Shortage Alerts</h2>
                {overviewData.shortages.length > 0 ? (
                  <div className="space-y-3">
                    {overviewData.shortages.map((short: ShortItem, i: number) => (
                      <div
                        key={i}
                        className="bg-gray-800/50 border border-red-400/30 rounded p-3"
                      >
                        <div className="flex justify-between items-start mb-1">
                          <div>
                            <div className="font-semibold text-red-400">
                              {short.sku}
                            </div>
                            <div className="text-sm text-gray-400">
                              {short.description}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-red-400">
                              {short.totalShort.toLocaleString()} short
                            </div>
                            <div className="text-xs text-gray-500">
                              {short.affectedJobs} jobs affected
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-emerald-400 font-semibold">
                    ✓ No Active Shortages
                  </div>
                )}
              </div>
            )}

            {/* QC Summary */}
            {overviewData && (
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                <h2 className="text-xl font-bold mb-4">Quality Control Summary</h2>
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div className="bg-gray-800 border border-gray-700 rounded p-4 text-center">
                    <div className="text-gray-400 text-xs uppercase mb-2">
                      Pass Rate
                    </div>
                    <div className="text-3xl font-bold text-emerald-400">
                      {overviewData.qcSummary.passRate.toFixed(1)}%
                    </div>
                  </div>
                  <div className="bg-gray-800 border border-gray-700 rounded p-4 text-center">
                    <div className="text-gray-400 text-xs uppercase mb-2">
                      Failed Checks
                    </div>
                    <div className="text-3xl font-bold text-red-400">
                      {overviewData.qcSummary.failCount}
                    </div>
                  </div>
                  <div className="bg-gray-800 border border-gray-700 rounded p-4 text-center">
                    <div className="text-gray-400 text-xs uppercase mb-2">
                      Conditional
                    </div>
                    <div className="text-3xl font-bold text-amber-400">
                      {overviewData.qcSummary.conditionalCount}
                    </div>
                  </div>
                </div>

                {overviewData.qcSummary.failedChecks.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-400 mb-3">
                      Last 5 Failed Checks
                    </h3>
                    <div className="space-y-2">
                      {overviewData.qcSummary.failedChecks
                        .slice(0, 5)
                        .map((check: QCFailedCheck, i: number) => (
                          <div
                            key={i}
                            className="bg-gray-800 border border-gray-700 rounded p-3"
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <div className="font-semibold text-red-400">
                                  Job #{check.jobId}
                                </div>
                                <div className="text-xs text-gray-400">
                                  {check.defectCodes.join(', ')}
                                </div>
                              </div>
                              <div className="text-xs text-gray-500">
                                {check.date}
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Weekly Throughput */}
            {overviewData && (
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                <h2 className="text-xl font-bold mb-4">Weekly Throughput</h2>
                <div className="space-y-2">
                  {overviewData.weeklyThroughput.map((week: WeeklyThroughput) => (
                    <div key={week.week} className="flex items-center gap-4">
                      <div className="w-16 text-sm text-gray-400">
                        {week.week}
                      </div>
                      <div className="flex-1 h-6 bg-gray-800 rounded flex items-center px-2">
                        <div
                          className="h-full bg-emerald-400 rounded transition-all flex items-center justify-center"
                          style={{
                            width: `${Math.min((week.count / 50) * 100, 100)}%`,
                          }}
                        >
                          {week.count > 5 && (
                            <span className="text-xs font-semibold text-gray-950">
                              {week.count}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="w-8 text-right text-sm font-semibold text-emerald-400">
                        {week.count}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column (1/3) */}
          <div className="space-y-6">
            {/* AI Manufacturing Assistant */}
            {showAIPanel && (
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 flex flex-col h-96">
                <h2 className="text-lg font-bold mb-4">AI Manufacturing Assistant</h2>

                <div className="flex-1 overflow-y-auto mb-4 space-y-3 bg-gray-800/30 rounded p-3 border border-gray-800">
                  {chatMessages.length === 0 ? (
                    <div className="text-gray-500 text-sm text-center py-8">
                      Ask about production status, shortages, schedules...
                    </div>
                  ) : (
                    chatMessages.map((msg: ChatMessage) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-xs rounded p-2 text-sm ${
                            msg.role === 'user'
                              ? 'bg-blue-400/20 border border-blue-400/50 text-blue-100'
                              : 'bg-emerald-400/10 border border-emerald-400/30 text-emerald-100'
                          }`}
                        >
                          {msg.content}
                        </div>
                      </div>
                    ))
                  )}
                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-gray-700 rounded p-2 text-sm text-gray-400">
                        Thinking...
                      </div>
                    </div>
                  )}
                </div>

                <form onSubmit={handleSendMessage} className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setChatInput(e.target.value)
                    }
                    placeholder="Ask a question..."
                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-400"
                    disabled={chatLoading}
                  />
                  <button
                    type="submit"
                    disabled={chatLoading || !chatInput.trim()}
                    className="px-4 py-2 bg-blue-400/20 border border-blue-400/50 rounded text-blue-400 hover:bg-blue-400/30 disabled:opacity-50 text-sm font-semibold transition"
                  >
                    Send
                  </button>
                </form>
              </div>
            )}

            {/* Quick Actions */}
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
              <h2 className="text-lg font-bold mb-4">Quick Actions</h2>
              <div className="grid grid-cols-2 gap-2">
                <Link
                  href="/ops/manufacturing/build-sheet"
                  className="bg-gray-800 border border-gray-700 rounded p-3 text-center text-sm font-semibold hover:border-blue-400 hover:bg-blue-400/10 transition"
                >
                  Build Sheet
                </Link>
                <Link
                  href="/ops/manufacturing/picks"
                  className="bg-gray-800 border border-gray-700 rounded p-3 text-center text-sm font-semibold hover:border-amber-400 hover:bg-amber-400/10 transition"
                >
                  Generate Picks
                </Link>
                <Link
                  href="/ops/manufacturing/qc"
                  className="bg-gray-800 border border-gray-700 rounded p-3 text-center text-sm font-semibold hover:border-emerald-400 hover:bg-emerald-400/10 transition"
                >
                  Run QC Check
                </Link>
                <Link
                  href="/ops/manufacturing/staging"
                  className="bg-gray-800 border border-gray-700 rounded p-3 text-center text-sm font-semibold hover:border-emerald-400 hover:bg-emerald-400/10 transition"
                >
                  View Staging
                </Link>
                <Link
                  href="/ops/inventory"
                  className="bg-gray-800 border border-gray-700 rounded p-3 text-center text-sm font-semibold hover:border-orange-400 hover:bg-orange-400/10 transition"
                >
                  Inventory
                </Link>
                <Link
                  href="/ops/manufacturing/bom"
                  className="bg-gray-800 border border-gray-700 rounded p-3 text-center text-sm font-semibold hover:border-purple-400 hover:bg-purple-400/10 transition"
                >
                  BOMs
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Row - Efficiency Metrics */}
        {efficiencyData && (
          <div className="grid grid-cols-4 gap-6 mt-8">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
              <div className="text-gray-400 text-sm uppercase font-semibold mb-2">
                Avg Days Created→Staged
              </div>
              <div className="text-3xl font-bold text-blue-400">
                {efficiencyData.metrics.avgDaysCreatedToStaged.toFixed(1)}
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
              <div className="text-gray-400 text-sm uppercase font-semibold mb-2">
                Avg Days In Production
              </div>
              <div className="text-3xl font-bold text-amber-400">
                {efficiencyData.metrics.avgDaysInProduction.toFixed(1)}
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
              <div className="text-gray-400 text-sm uppercase font-semibold mb-2">
                Avg Picks/Job
              </div>
              <div className="text-3xl font-bold text-orange-400">
                {efficiencyData.metrics.avgPicksPerJob.toFixed(2)}
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
              <div className="text-gray-400 text-sm uppercase font-semibold mb-2">
                Month vs Last Month
              </div>
              <div className="flex items-baseline gap-2">
                <div className="text-3xl font-bold text-emerald-400">
                  {efficiencyData.metrics.monthThroughput.toLocaleString()}
                </div>
                <div className="text-sm text-gray-500">
                  vs{' '}
                  <span className="text-white">
                    {efficiencyData.metrics.lastMonthThroughput.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
