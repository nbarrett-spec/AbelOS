'use client'

import Link from 'next/link'
import { Sparkles, AlertCircle, TrendingUp } from 'lucide-react'

interface ContextStripProps {
  greeting: string
  currentDate: string
  kpis: Array<{
    label: string
    value: string | number
    change?: number
    changeLabel?: string
    severity?: 'neutral' | 'positive' | 'warning' | 'danger'
  }>
}

export function ContextStrip({ greeting, currentDate, kpis }: ContextStripProps) {
  const severityColors = {
    neutral: 'text-gray-600 bg-gray-50',
    positive: 'text-success-700 bg-success-50',
    warning: 'text-warning-700 bg-warning-50',
    danger: 'text-danger-700 bg-danger-50',
  }

  return (
    <div className="space-y-3 mb-6">
      {/* Greeting + Date */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{greeting}</h1>
          <p className="text-sm text-gray-500 mt-1">{currentDate}</p>
        </div>
      </div>

      {/* Live KPI badges */}
      <div className="flex flex-wrap gap-2">
        {kpis.map((kpi, i) => (
          <div
            key={i}
            className={`px-3 py-2 rounded-lg text-sm font-medium ${
              severityColors[kpi.severity || 'neutral']
            } flex items-center gap-2 border`}
            style={{
              borderColor: kpi.severity === 'danger' ? '#fca5a5' : kpi.severity === 'warning' ? '#fed7aa' : kpi.severity === 'positive' ? '#86efac' : '#e5e7eb',
            }}
          >
            <span>{kpi.label}:</span>
            <span className="font-bold">{kpi.value}</span>
            {kpi.change !== undefined && (
              <span className={`text-xs ${kpi.change >= 0 ? 'text-success-600' : 'text-danger-600'}`}>
                {kpi.change > 0 ? '↑' : '↓'} {Math.abs(kpi.change)}%
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
