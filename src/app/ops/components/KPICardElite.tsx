'use client'

import Link from 'next/link'
import { TrendingUp, TrendingDown } from 'lucide-react'

interface KPICardEliteProps {
  label: string
  value: string | number
  delta?: number
  sparkline?: number[]
  context?: string
  href?: string
  color?: 'walnut' | 'amber' | 'green' | 'charcoal' | 'info' | 'warning' | 'danger' | 'navy' | 'orange' | 'slate'
  isLoading?: boolean
}

const colorMap: Record<string, { border: string; bg: string }> = {
  walnut: { border: 'border-l-brand', bg: 'hover:bg-brand/5' },
  amber: { border: 'border-l-signal', bg: 'hover:bg-signal/5' },
  green: { border: 'border-l-abel-green', bg: 'hover:bg-abel-green/5' },
  charcoal: { border: 'border-l-navy', bg: 'hover:bg-navy/5' },
  info: { border: 'border-l-info-500', bg: 'hover:bg-info-50' },
  warning: { border: 'border-l-warning-500', bg: 'hover:bg-warning-50' },
  danger: { border: 'border-l-danger-500', bg: 'hover:bg-danger-50' },
  // Legacy aliases
  navy: { border: 'border-l-brand', bg: 'hover:bg-brand/5' },
  orange: { border: 'border-l-signal', bg: 'hover:bg-signal/5' },
  slate: { border: 'border-l-navy', bg: 'hover:bg-navy/5' },
}

export function KPICardElite({
  label,
  value,
  delta,
  sparkline,
  context,
  href,
  color = 'navy',
  isLoading = false,
}: KPICardEliteProps) {
  const config = colorMap[color]
  const content = (
    <div
      className={`
        bg-white border border-gray-200 rounded-xl p-4
        transition-all duration-200 ease-out
        ${config.bg} ${href ? 'cursor-pointer' : ''}
        ${isLoading ? 'animate-pulse' : ''}
      `}
      style={{
        borderLeftWidth: '4px',
      }}
    >
      <div className={`border-l-4 ${config.border} pl-4 -ml-4`}>
        <p className="text-xs text-gray-600 uppercase tracking-widest font-semibold">{label}</p>
        <div className="flex items-baseline gap-3 mt-2">
          <p className="text-3xl font-bold text-gray-900">
            {isLoading ? '—' : value}
          </p>
          {delta !== undefined && !isLoading && (
            <div className={`flex items-center gap-1 text-sm font-semibold ${delta >= 0 ? 'text-success-600' : 'text-danger-600'}`}>
              {delta > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              <span>{Math.abs(delta)}%</span>
            </div>
          )}
        </div>
        {context && <p className="text-xs text-gray-500 mt-2">{context}</p>}

        {sparkline && sparkline.length > 1 && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <SparklineEmbedded data={sparkline} color={color} />
          </div>
        )}
      </div>
    </div>
  )

  return href ? <Link href={href}>{content}</Link> : content
}

function SparklineEmbedded({ data, color }: { data: number[]; color: string }) {
  const colorVal: Record<string, string> = {
    walnut: '#0f2a3e',
    amber: '#C6A24E',
    green: '#27AE60',
    charcoal: '#2C2C2C',
    info: '#0ea5e9',
    warning: '#f59e0b',
    danger: '#ef4444',
    navy: '#0f2a3e',
    orange: '#C6A24E',
    slate: '#2C2C2C',
  }
  const strokeColor = colorVal[color] || '#0f2a3e'

  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const width = 100
  const height = 30
  const padding = 2

  const points = data.map((val, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2)
    const y = padding + (1 - (val - min) / range) * (height - padding * 2)
    return { x, y }
  })

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  return (
    <svg width={width} height={height} style={{ display: 'block', width: '100%' }}>
      <path d={pathD} fill="none" stroke={strokeColor} strokeWidth={1.5} strokeLinecap="round" />
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={1.5} fill={strokeColor} />
    </svg>
  )
}
