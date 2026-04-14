'use client'

import { TrendingUp, TrendingDown } from 'lucide-react'

interface KPIData {
  label: string
  value: string | number
  delta?: number
  icon: React.ReactNode
  color: 'blue' | 'emerald' | 'amber' | 'violet'
  trend?: 'up' | 'down' | 'neutral'
}

const colorClasses = {
  blue: 'bg-blue-50/50 dark:bg-blue-950/20 border-blue-200/50 dark:border-blue-800/30 text-blue-700 dark:text-blue-300',
  emerald:
    'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/50 dark:border-emerald-800/30 text-emerald-700 dark:text-emerald-300',
  amber:
    'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/30 text-amber-700 dark:text-amber-300',
  violet:
    'bg-violet-50/50 dark:bg-violet-950/20 border-violet-200/50 dark:border-violet-800/30 text-violet-700 dark:text-violet-300',
}

const accentColor = {
  blue: 'text-blue-600 dark:text-blue-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  violet: 'text-violet-600 dark:text-violet-400',
}

interface KPIGridProps {
  kpis: KPIData[]
}

export default function KPIGrid({ kpis }: KPIGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map((kpi, idx) => (
        <div
          key={idx}
          className={`kpi-card ${colorClasses[kpi.color]} rounded-2xl border p-6 transition-all duration-300 hover:shadow-md hover:border-opacity-100`}
        >
          {/* Icon + Label Row */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-3xl">{kpi.icon}</span>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{kpi.label}</span>
          </div>

          {/* Value */}
          <div className="mb-4">
            <p className={`text-3xl font-bold ${accentColor[kpi.color]} truncate`}>{kpi.value}</p>
          </div>

          {/* Delta */}
          {kpi.delta !== undefined && (
            <div className="flex items-center gap-1.5">
              {kpi.trend === 'up' && (
                <>
                  <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                    +{Math.abs(kpi.delta)}%
                  </span>
                </>
              )}
              {kpi.trend === 'down' && (
                <>
                  <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />
                  <span className="text-sm font-semibold text-red-600 dark:text-red-400">{kpi.delta}%</span>
                </>
              )}
              {kpi.trend === 'neutral' && (
                <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">—</span>
              )}
              <span className="text-xs text-gray-500 dark:text-gray-400">vs last month</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
