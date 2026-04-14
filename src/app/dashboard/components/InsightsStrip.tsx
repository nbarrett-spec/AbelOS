'use client'

import Link from 'next/link'
import { Zap, TrendingUp, AlertCircle } from 'lucide-react'

interface Insight {
  id: string
  icon: 'zap' | 'trending' | 'alert'
  title: string
  description: string
}

interface InsightsStripProps {
  insights: Insight[]
  ytdSavings: number
  reorderCount: number
}

const iconMap = {
  zap: <Zap className="w-5 h-5" />,
  trending: <TrendingUp className="w-5 h-5" />,
  alert: <AlertCircle className="w-5 h-5" />,
}

export default function InsightsStrip({
  insights,
  ytdSavings,
  reorderCount,
}: InsightsStripProps) {
  if (insights.length === 0 && ytdSavings === 0) return null

  return (
    <div className="rounded-2xl bg-gradient-to-r from-slate-50 to-blue-50 dark:from-slate-900/50 dark:to-blue-950/30 border border-slate-200/50 dark:border-slate-800/50 p-6 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <span className="text-2xl">✨</span>
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Smart Insights</h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">AI-powered recommendations for your business</p>
          </div>
        </div>
        <Link
          href="/dashboard/intelligence"
          className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors whitespace-nowrap"
        >
          View All →
        </Link>
      </div>

      {/* Insights Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Reorder Alerts */}
        <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200/50 dark:border-slate-700/50 p-4 transition-all hover:border-blue-200 dark:hover:border-blue-800/50 hover:shadow-sm">
          <div className="flex items-start justify-between mb-3">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-red-100 dark:bg-red-950/30 text-red-600 dark:text-red-400">
              {iconMap.alert}
            </span>
            {reorderCount > 0 && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400">
                {reorderCount}
              </span>
            )}
          </div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Reorder Alerts</h4>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            {reorderCount > 0
              ? `You have ${reorderCount} item${reorderCount !== 1 ? 's' : ''} due for reorder based on your patterns`
              : 'All your stock levels are looking good'}
          </p>
        </div>

        {/* Savings */}
        {ytdSavings > 0 && (
          <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200/50 dark:border-slate-700/50 p-4 transition-all hover:border-emerald-200 dark:hover:border-emerald-800/50 hover:shadow-sm">
            <div className="flex items-start justify-between mb-3">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400">
                {iconMap.trending}
              </span>
            </div>
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">YTD Savings</h4>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mb-1">
              ${(ytdSavings / 1000).toFixed(1)}k
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400">through tiered pricing</p>
          </div>
        )}

        {/* Price Updates */}
        <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200/50 dark:border-slate-700/50 p-4 transition-all hover:border-amber-200 dark:hover:border-amber-800/50 hover:shadow-sm">
          <div className="flex items-start justify-between mb-3">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400">
              {iconMap.zap}
            </span>
          </div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Price Intelligence</h4>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Monitor lumber prices in real-time and get alerts on favorable moves
          </p>
        </div>
      </div>
    </div>
  )
}
