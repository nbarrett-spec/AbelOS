'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { TrendingUp } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { formatCurrency, formatPercent, getTimeAgo } from '@/lib/formatting';
import { NewDealModal } from './components/NewDealModal';

interface StatsData {
  pipelineValue: number;
  activeDealsCount: number;
  winRate: number;
  closingThisMonth: number;
}

interface Deal {
  id: string;
  companyName: string;
  contactName: string;
  dealValue: number;
  stage: string;
  expectedCloseDate: string;
  owner: {
    id: string;
    name: string;
    initials: string;
  };
}

interface Activity {
  id: string;
  type: string;
  description: string;
  timestamp: string;
  icon: string;
}

interface RepSales {
  name: string;
  initials: string;
  dealCount: number;
  pipelineValue: number;
}

const STAGE_NAMES: Record<string, string> = {
  PROSPECT: 'Prospect',
  DISCOVERY: 'Discovery',
  WALKTHROUGH: 'Walkthrough',
  BID_SUBMITTED: 'Bid Submitted',
  BID_REVIEW: 'Bid Review',
  NEGOTIATION: 'Negotiation',
  WON: 'Won',
  LOST: 'Lost',
  ONBOARDED: 'Onboarded',
};

const STAGE_COLORS: Record<string, string> = {
  PROSPECT: 'bg-gray-100 border-gray-300',
  DISCOVERY: 'bg-blue-50 border-blue-300',
  WALKTHROUGH: 'bg-indigo-50 border-indigo-300',
  BID_SUBMITTED: 'bg-yellow-50 border-yellow-300',
  BID_REVIEW: 'bg-orange-50 border-orange-300',
  NEGOTIATION: 'bg-purple-50 border-purple-300',
  WON: 'bg-green-50 border-green-300',
  LOST: 'bg-red-50 border-red-300',
  ONBOARDED: 'bg-emerald-50 border-emerald-300',
};

const STAGE_HEADER_COLORS: Record<string, string> = {
  PROSPECT: 'bg-gray-200',
  DISCOVERY: 'bg-blue-200',
  WALKTHROUGH: 'bg-indigo-200',
  BID_SUBMITTED: 'bg-yellow-200',
  BID_REVIEW: 'bg-orange-200',
  NEGOTIATION: 'bg-purple-200',
  WON: 'bg-green-200',
  LOST: 'bg-red-200',
  ONBOARDED: 'bg-emerald-200',
};

const PIPELINE_STAGES = [
  'PROSPECT',
  'DISCOVERY',
  'WALKTHROUGH',
  'BID_SUBMITTED',
  'BID_REVIEW',
  'NEGOTIATION',
  'WON',
  'LOST',
];

const STAGE_DESCRIPTIONS: Record<string, string> = {
  PROSPECT: 'Initial contact made',
  DISCOVERY: 'Learning about their needs',
  WALKTHROUGH: 'Site walk-through completed',
  BID_SUBMITTED: 'Proposal sent to customer',
  BID_REVIEW: 'Customer reviewing proposal',
  NEGOTIATION: 'Negotiating terms',
  WON: 'Deal closed successfully',
  LOST: 'Deal lost or abandoned',
};

export default function SalesDashboardPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [repSales, setRepSales] = useState<RepSales[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');
  const [sortedDeals, setSortedDeals] = useState<Deal[]>([]);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        const [statsRes, dealsRes] = await Promise.all([
          fetch('/api/ops/sales/stats'),
          fetch('/api/ops/sales/deals'),
        ]);

        if (statsRes.ok) {
          const statsJson = await statsRes.json();
          const statsData = statsJson.stats || statsJson;
          setStats({
            pipelineValue: Number(statsData.pipelineValue) || 0,
            activeDealsCount: (statsData.dealsByStage || []).reduce((sum: number, s: any) => sum + (Number(s.count) || 0), 0),
            winRate: parseFloat(statsData.winRate) || 0,
            closingThisMonth: (statsData.closingThisMonth || []).length || 0,
          });
        }

        if (dealsRes.ok) {
          const dealsJson = await dealsRes.json();
          const dealsData = dealsJson.deals || dealsJson || [];
          setDeals(Array.isArray(dealsData) ? dealsData : []);

          // Process activities and rep sales from deals data
          processDealsData(Array.isArray(dealsData) ? dealsData : []);
        }
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  const processDealsData = (dealsData: Deal[]) => {
    // Sort deals by last update (most recent first)
    const sorted = [...dealsData].sort((a, b) =>
      new Date(b.expectedCloseDate).getTime() - new Date(a.expectedCloseDate).getTime()
    );
    setSortedDeals(sorted);

    // Generate recent activities from deals - top 5 most recently updated
    const generatedActivities: Activity[] = sorted
      .slice(0, 5)
      .map((deal, index) => {
        const typeMap: Record<string, string> = {
          'PROSPECT': '🎯',
          'DISCOVERY': '🔍',
          'WALKTHROUGH': '🚶',
          'BID_SUBMITTED': '📝',
          'BID_REVIEW': '👀',
          'NEGOTIATION': '💬',
          'WON': '✅',
          'LOST': '❌',
        };
        return {
          id: `activity-${index}`,
          type: 'deal_update',
          description: `${deal.companyName} - ${deal.dealValue > 0 ? formatCurrency(deal.dealValue) : 'New deal'}`,
          timestamp: deal.expectedCloseDate,
          icon: typeMap[deal.stage] || '📊',
        };
      });
    setActivities(generatedActivities);

    // Generate rep sales data
    const repMap = new Map<string, RepSales>();
    dealsData.forEach((deal) => {
      if (!repMap.has(deal.owner.id)) {
        repMap.set(deal.owner.id, {
          name: deal.owner.name,
          initials: deal.owner.initials,
          dealCount: 0,
          pipelineValue: 0,
        });
      }
      const rep = repMap.get(deal.owner.id)!;
      rep.dealCount += 1;
      rep.pipelineValue += deal.dealValue;
    });

    setRepSales(Array.from(repMap.values()).sort((a, b) => b.pipelineValue - a.pipelineValue));
  };

  const dealsByStage = PIPELINE_STAGES.reduce(
    (acc, stage) => {
      acc[stage] = deals.filter((d) => d.stage === stage);
      return acc;
    },
    {} as Record<string, Deal[]>
  );

  const getStageStats = (stage: string) => {
    const stageDealsList = dealsByStage[stage] || [];
    const count = stageDealsList.length;
    const value = stageDealsList.reduce((sum, deal) => sum + deal.dealValue, 0);
    return { count, value };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#1e3a5f] text-white px-8 py-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold">Sales Dashboard</h1>
            <p className="text-blue-100 mt-2">Track your pipeline, deals, and team performance</p>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-signal hover:bg-signal-hover text-white px-8 py-3 rounded-lg font-semibold text-base transition-colors transform hover:scale-105"
          >
            + New Deal
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8">
        {/* Summary Bar */}
        <div className="bg-gradient-to-r from-[#1e3a5f] to-[#2d5a8c] text-white rounded-lg shadow-md p-6 mb-8">
          <div className="flex items-center justify-between">
            <div className="flex gap-12">
              <div>
                <p className="text-sm font-medium text-blue-100 mb-1">Pipeline</p>
                <p className="text-2xl font-bold">{deals.length} deals</p>
                <p className="text-xs text-blue-100 mt-1">
                  {stats ? formatCurrency(stats.pipelineValue) : '$0'} total
                </p>
              </div>
              <div className="border-l border-blue-400"></div>
              <div>
                <p className="text-sm font-medium text-blue-100 mb-1">Closing This Month</p>
                <p className="text-2xl font-bold">{stats ? stats.closingThisMonth : 0} deals</p>
                <p className="text-xs text-blue-100 mt-1">Due soon</p>
              </div>
              <div className="border-l border-blue-400"></div>
              <div>
                <p className="text-sm font-medium text-blue-100 mb-1">Follow-ups</p>
                <p className="text-2xl font-bold">{sortedDeals.slice(0, 5).length}</p>
                <p className="text-xs text-blue-100 mt-1">Recent activity</p>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Cards Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div onClick={() => setViewMode('kanban')} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 cursor-pointer hover:shadow-md transition-shadow">
            <p className="text-gray-600 text-sm font-medium mb-2">Pipeline Value</p>
            <p className="text-3xl font-bold text-[#1e3a5f]">{stats ? formatCurrency(stats.pipelineValue) : '$0'}</p>
            <p className="text-gray-400 text-xs mt-2">All active deals</p>
          </div>
          <div onClick={() => setViewMode('table')} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 cursor-pointer hover:shadow-md transition-shadow">
            <p className="text-gray-600 text-sm font-medium mb-2">Active Deals</p>
            <p className="text-3xl font-bold text-[#1e3a5f]">{stats ? stats.activeDealsCount : 0}</p>
            <p className="text-gray-400 text-xs mt-2">In progress</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-gray-600 text-sm font-medium mb-2">Win Rate</p>
            <p className="text-3xl font-bold text-[#1e3a5f]">{stats ? formatPercent(stats.winRate) : '0%'}</p>
            <p className="text-gray-400 text-xs mt-2">Last 90 days</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-gray-600 text-sm font-medium mb-2">Closing This Month</p>
            <p className="text-3xl font-bold text-[#1e3a5f]">{stats ? stats.closingThisMonth : 0}</p>
            <p className="text-gray-400 text-xs mt-2">Expected close</p>
          </div>
        </div>

        {/* Bids & Quotes Tracker */}
        {(dealsByStage['BID_SUBMITTED']?.length > 0 || dealsByStage['BID_REVIEW']?.length > 0 || dealsByStage['NEGOTIATION']?.length > 0) && (
          <div className="bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200 rounded-lg p-6 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Bids & Quotes Tracker</h3>
              <div className="flex gap-3 text-sm">
                <span className="px-3 py-1 bg-yellow-200 rounded-full font-semibold text-yellow-800">
                  {(dealsByStage['BID_SUBMITTED']?.length || 0)} Submitted
                </span>
                <span className="px-3 py-1 bg-orange-200 rounded-full font-semibold text-orange-800">
                  {(dealsByStage['BID_REVIEW']?.length || 0)} Under Review
                </span>
                <span className="px-3 py-1 bg-purple-200 rounded-full font-semibold text-purple-800">
                  {(dealsByStage['NEGOTIATION']?.length || 0)} Negotiating
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[...dealsByStage['BID_SUBMITTED'] || [], ...dealsByStage['BID_REVIEW'] || [], ...dealsByStage['NEGOTIATION'] || []]
                .sort((a, b) => new Date(a.expectedCloseDate).getTime() - new Date(b.expectedCloseDate).getTime())
                .slice(0, 6)
                .map(deal => {
                  const daysUntilClose = Math.ceil((new Date(deal.expectedCloseDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                  const isUrgent = daysUntilClose <= 7
                  return (
                    <Link key={deal.id} href={`/ops/sales/deals/${deal.id}`}>
                      <div className={`bg-white rounded-lg p-4 border ${isUrgent ? 'border-red-300 ring-1 ring-red-200' : 'border-gray-200'} hover:shadow-md transition-all cursor-pointer`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            deal.stage === 'BID_SUBMITTED' ? 'bg-yellow-100 text-yellow-800' :
                            deal.stage === 'BID_REVIEW' ? 'bg-orange-100 text-orange-800' :
                            'bg-purple-100 text-purple-800'
                          }`}>{STAGE_NAMES[deal.stage]}</span>
                          {isUrgent && <span className="text-xs font-bold text-red-600">Closes in {daysUntilClose}d</span>}
                        </div>
                        <p className="font-bold text-sm text-gray-900 truncate">{deal.companyName}</p>
                        <p className="text-xs text-gray-500 mb-2">{deal.contactName}</p>
                        <div className="flex items-center justify-between">
                          <p className="text-lg font-bold text-signal">{formatCurrency(deal.dealValue)}</p>
                          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-[#1e3a5f] text-white text-xs font-semibold">
                            {deal.owner.initials}
                          </div>
                        </div>
                        {/* Progress bar showing stage */}
                        <div className="mt-3 flex gap-1">
                          {['BID_SUBMITTED', 'BID_REVIEW', 'NEGOTIATION', 'WON'].map((s, i) => (
                            <div key={s} className={`h-1.5 flex-1 rounded-full ${
                              PIPELINE_STAGES.indexOf(deal.stage) >= PIPELINE_STAGES.indexOf(s)
                                ? 'bg-signal' : 'bg-gray-200'
                            }`} />
                          ))}
                        </div>
                      </div>
                    </Link>
                  )
                })}
            </div>
          </div>
        )}

        {/* Recently Updated Deals Section */}
        {sortedDeals.slice(0, 5).length > 0 && (
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Recently Updated</h3>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {sortedDeals.slice(0, 5).map((deal) => {
                const typeMap: Record<string, string> = {
                  'PROSPECT': '🎯',
                  'DISCOVERY': '🔍',
                  'WALKTHROUGH': '🚶',
                  'BID_SUBMITTED': '📝',
                  'BID_REVIEW': '👀',
                  'NEGOTIATION': '💬',
                  'WON': '✅',
                  'LOST': '❌',
                };
                return (
                  <Link key={deal.id} href={`/ops/sales/deals/${deal.id}`}>
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow cursor-pointer h-full">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xl">{typeMap[deal.stage] || '📊'}</span>
                        <span className="text-xs font-semibold text-gray-500 uppercase">{STAGE_NAMES[deal.stage]}</span>
                      </div>
                      <p className="font-bold text-sm text-gray-900 truncate">{deal.companyName}</p>
                      <p className="text-xs text-gray-600 truncate mb-3">{deal.contactName}</p>
                      <p className="text-lg font-bold text-signal mb-2">{formatCurrency(deal.dealValue)}</p>
                      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                        <p className="text-xs text-gray-500">
                          {new Date(deal.expectedCloseDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </p>
                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-[#1e3a5f] text-white text-xs font-semibold">
                          {deal.owner.initials}
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* View Mode Toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setViewMode('kanban')}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              viewMode === 'kanban'
                ? 'bg-[#1e3a5f] text-white'
                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            Kanban View
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              viewMode === 'table'
                ? 'bg-[#1e3a5f] text-white'
                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            Table View
          </button>
        </div>

        {/* Pipeline Board - Kanban View */}
        {viewMode === 'kanban' && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Pipeline Board</h2>
            <div className="overflow-x-auto bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="flex gap-4 p-4" style={{ minWidth: 'fit-content' }}>
                {PIPELINE_STAGES.slice(0, 6).map((stage) => {
                  const stageDeals = dealsByStage[stage] || [];
                  const { count, value } = getStageStats(stage);
                  return (
                    <div
                      key={stage}
                      className="flex-shrink-0 w-[280px] flex flex-col"
                    >
                      {/* Stage Header with Tooltip */}
                      <div
                        className={`${STAGE_HEADER_COLORS[stage]} rounded-t-lg p-3 text-xs font-semibold text-gray-800 relative group`}
                        title={STAGE_DESCRIPTIONS[stage]}
                      >
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            {STAGE_NAMES[stage]}
                            <span className="text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity cursor-help">?</span>
                          </span>
                          <span className="bg-white bg-opacity-70 px-2 py-0.5 rounded text-gray-700 ml-2">
                            {count}
                          </span>
                        </div>
                        <div className="text-gray-600 mt-1">
                          {value > 0 ? formatCurrency(value) : '—'}
                        </div>
                        {/* Tooltip */}
                        <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                          {STAGE_DESCRIPTIONS[stage]}
                        </div>
                      </div>

                      {/* Stage Cards Container */}
                      <div className={`flex-1 p-3 space-y-2 rounded-b-lg ${STAGE_COLORS[stage]} border-b border-l border-r`} style={{ minHeight: '400px' }}>
                        {stageDeals.length === 0 ? (
                          <div className="text-gray-400 text-xs py-4 text-center">No deals</div>
                        ) : (
                          stageDeals.map((deal) => (
                            <Link key={deal.id} href={`/ops/sales/deals/${deal.id}`}>
                              <div className="bg-white border border-gray-200 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow">
                                <p className="font-semibold text-sm text-gray-900 truncate">
                                  {deal.companyName}
                                </p>
                                <p className="text-xs text-gray-600 truncate">
                                  {deal.contactName}
                                </p>
                                <p className="font-bold text-sm text-signal mt-2">
                                  {formatCurrency(deal.dealValue)}
                                </p>
                                <div className="flex items-center justify-between mt-3">
                                  <p className="text-xs text-gray-500">
                                    {new Date(deal.expectedCloseDate).toLocaleDateString('en-US', {
                                      month: 'short',
                                      day: 'numeric',
                                    })}
                                  </p>
                                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-[#1e3a5f] text-white text-xs font-semibold">
                                    {deal.owner.initials}
                                  </div>
                                </div>
                              </div>
                            </Link>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Pipeline Board - Table View */}
        {viewMode === 'table' && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">All Deals</h2>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              {sortedDeals.length === 0 ? (
                <EmptyState icon={<TrendingUp className="w-8 h-8 text-fg-subtle" />} title="No leads in pipeline" description="Create a deal to get started." />
              ) : (
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-700 uppercase tracking-wider">Company</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-700 uppercase tracking-wider">Contact</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-700 uppercase tracking-wider">Stage</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-gray-700 uppercase tracking-wider">Value</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-700 uppercase tracking-wider">Close Date</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-700 uppercase tracking-wider">Owner</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {sortedDeals.map((deal) => (
                    <Link key={deal.id} href={`/ops/sales/deals/${deal.id}`}>
                      <tr className="hover:bg-gray-50 cursor-pointer transition-colors">
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">{deal.companyName}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">{deal.contactName}</td>
                        <td className="px-6 py-4">
                          <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold text-gray-700 ${STAGE_COLORS[deal.stage].split(' ')[0]}`}>
                            {STAGE_NAMES[deal.stage]}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm font-bold text-signal">{formatCurrency(deal.dealValue)}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {new Date(deal.expectedCloseDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[#1e3a5f] text-white text-xs font-semibold">
                            {deal.owner.initials}
                          </div>
                        </td>
                      </tr>
                    </Link>
                  ))}
                </tbody>
              </table>
              )}
            </div>
          </div>
        )}

        {/* Bottom Section: Recent Activity and Deals by Rep */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Recent Activity */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Activity Feed</h3>
            <div className="space-y-4">
              {activities.length === 0 ? (
                <p className="text-gray-400 text-sm">No recent activity</p>
              ) : (
                activities.map((activity) => (
                  <Link key={activity.id} href={`/ops/sales/deals`}>
                    <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                      <span className="text-2xl flex-shrink-0">{activity.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {activity.description}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {getTimeAgo(new Date(activity.timestamp))}
                        </p>
                      </div>
                      <div className="text-xs text-gray-400 flex-shrink-0">→</div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* Deals by Rep */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Team Performance</h3>
            <div className="space-y-4">
              {repSales.length === 0 ? (
                <p className="text-gray-400 text-sm">No rep data</p>
              ) : (
                repSales.map((rep, index) => (
                  <div key={index} className="p-3 rounded-lg bg-gray-50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[#1e3a5f] text-white text-sm font-semibold">
                          {rep.initials}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-gray-900">{rep.name}</p>
                          <p className="text-xs text-gray-600">
                            {rep.dealCount} deal{rep.dealCount !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-signal">{formatCurrency(rep.pipelineValue)}</p>
                        <p className="text-xs text-gray-500">pipeline</p>
                      </div>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-gradient-to-r from-[#1e3a5f] to-[#C6A24E] h-2 rounded-full"
                        style={{
                          width: `${
                            stats && stats.pipelineValue > 0
                              ? (rep.pipelineValue / stats.pipelineValue) * 100
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* New Deal Modal */}
      <NewDealModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => {
          setIsModalOpen(false);
          // Refresh deals
          fetch('/api/ops/sales/deals')
            .then((res) => res.json())
            .then((json) => setDeals(json.deals || json || []));
        }}
      />
    </div>
  );
}
