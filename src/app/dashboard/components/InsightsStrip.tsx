'use client'

import Link from 'next/link'
import { Sparkles, TrendingUp, AlertCircle, Zap, ArrowRight } from 'lucide-react'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'

interface InsightsStripProps {
  insights: Array<{ id: string; icon: string; title: string; description: string }>
  ytdSavings: number
  reorderCount: number
}

export default function InsightsStrip({ insights, ytdSavings, reorderCount }: InsightsStripProps) {
  if (insights.length === 0 && ytdSavings === 0 && reorderCount === 0) return null

  return (
    <Card variant="glass" padding="none" rounded="2xl" className="overflow-hidden animate-enter animate-enter-delay-3">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100/50 dark:border-gray-800/50 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-abel-orange/10 to-amber-100/50 dark:from-abel-orange/20 dark:to-amber-900/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-abel-orange" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Smart Insights</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">AI-powered recommendations</p>
          </div>
        </div>
        <Link
          href="/dashboard/intelligence"
          className="inline-flex items-center gap-1 text-xs font-semibold text-abel-navy dark:text-abel-navy-light hover:text-abel-navy-dark dark:hover:text-white transition-colors group"
        >
          View All
          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>

      {/* Cards */}
      <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Reorder Alerts */}
        <div className="group bg-white dark:bg-gray-900/60 rounded-xl border border-gray-200/60 dark:border-gray-800/60 p-4 transition-all hover:border-danger-200 dark:hover:border-danger-800/50 hover:shadow-sm">
          <div className="flex items-start justify-between mb-3">
            <div className="w-8 h-8 rounded-lg bg-danger-50 dark:bg-danger-900/30 flex items-center justify-center text-danger-500">
              <AlertCircle className="w-4 h-4" />
            </div>
            {reorderCount > 0 && (
              <Badge variant="danger" size="sm">{reorderCount}</Badge>
            )}
          </div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Reorder Alerts</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            {reorderCount > 0
              ? `${reorderCount} item${reorderCount !== 1 ? 's' : ''} due for reorder based on your purchasing patterns`
              : 'All your stock levels are looking good'}
          </p>
        </div>

        {/* Savings */}
        {ytdSavings > 0 && (
          <div className="group bg-white dark:bg-gray-900/60 rounded-xl border border-gray-200/60 dark:border-gray-800/60 p-4 transition-all hover:border-success-200 dark:hover:border-success-800/50 hover:shadow-sm">
            <div className="w-8 h-8 rounded-lg bg-success-50 dark:bg-success-900/30 flex items-center justify-center text-success-500 mb-3">
              <TrendingUp className="w-4 h-4" />
            </div>
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">YTD Savings</h4>
            <p className="text-2xl font-bold text-success-600 dark:text-success-400 mb-1 tracking-tight">
              ${(ytdSavings / 1000).toFixed(1)}k
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">through tiered pricing</p>
          </div>
        )}

        {/* Price Intelligence */}
        <div className="group bg-white dark:bg-gray-900/60 rounded-xl border border-gray-200/60 dark:border-gray-800/60 p-4 transition-all hover:border-warning-200 dark:hover:border-warning-800/50 hover:shadow-sm">
          <div className="w-8 h-8 rounded-lg bg-warning-50 dark:bg-warning-900/30 flex items-center justify-center text-warning-500 mb-3">
            <Zap className="w-4 h-4" />
          </div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Price Intelligence</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            Real-time lumber price monitoring with alerts on favorable market moves
          </p>
        </div>
      </div>
    </Card>
  )
}
