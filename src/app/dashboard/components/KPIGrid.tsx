'use client'

import { type ReactNode } from 'react'
import KPICard from '@/components/ui/KPICard'

interface KPIData {
  label: string
  value: string | number
  delta?: string
  deltaDirection?: 'up' | 'down' | 'flat'
  icon: ReactNode
  accent: 'navy' | 'orange' | 'green' | 'info' | 'danger' | 'slate'
  sparkline?: number[]
  subtitle?: string
}

interface KPIGridProps {
  kpis: KPIData[]
  loading?: boolean
}

export default function KPIGrid({ kpis, loading }: KPIGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map((kpi, idx) => (
        <div
          key={idx}
          className="animate-enter"
          style={{ animationDelay: `${(idx + 1) * 50}ms` }}
        >
          <KPICard
            title={kpi.label}
            value={kpi.value}
            delta={kpi.delta}
            deltaDirection={kpi.deltaDirection}
            accent={kpi.accent}
            icon={kpi.icon}
            sparkline={kpi.sparkline}
            subtitle={kpi.subtitle}
            loading={loading}
          />
        </div>
      ))}
    </div>
  )
}
