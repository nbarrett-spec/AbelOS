'use client'

import { useState } from 'react'

// ──────────────────────────────────────────────────────────────────────────
// CSS-based Chart Components for Abel Operations Dashboard
// No external dependencies — pure CSS + React
// ──────────────────────────────────────────────────────────────────────────

// ─── Bar Chart ───────────────────────────────────────────────────────────

interface BarChartProps {
  data: { label: string; value: number; color?: string }[]
  height?: number
  showValues?: boolean
  maxValue?: number
  formatValue?: (v: number) => string
}

export function BarChart({
  data,
  height = 200,
  showValues = true,
  maxValue,
  formatValue = (v) => v.toLocaleString(),
}: BarChartProps) {
  const max = maxValue || Math.max(...data.map((d) => d.value), 1)
  const defaultColors = ['#3E2A1E', '#C9822B', '#27AE60', '#8CA8B8', '#B8876B', '#8B6F47', '#6E2A24', '#8B6F2A', '#2C2C2C']

  return (
    <div style={{ height, display: 'flex', alignItems: 'flex-end', gap: 4, paddingBottom: 28, position: 'relative' }}>
      {data.map((item, i) => {
        const barHeight = max > 0 ? (item.value / max) * (height - 40) : 0
        const color = item.color || defaultColors[i % defaultColors.length]
        return (
          <div
            key={item.label}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
          >
            {showValues && (
              <span style={{ fontSize: 10, fontWeight: 600, color: '#6b7280' }}>
                {formatValue(item.value)}
              </span>
            )}
            <div
              style={{
                width: '100%',
                maxWidth: 48,
                height: Math.max(barHeight, 2),
                backgroundColor: color,
                borderRadius: '4px 4px 0 0',
                transition: 'height 0.5s ease',
                minHeight: 2,
              }}
              title={`${item.label}: ${formatValue(item.value)}`}
            />
            <span
              style={{
                fontSize: 9,
                color: '#9ca3af',
                textAlign: 'center',
                lineHeight: '1.1',
                maxWidth: 60,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                position: 'absolute',
                bottom: 0,
              }}
            >
              {item.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Donut Chart ─────────────────────────────────────────────────────────

interface DonutChartProps {
  data: { label: string; value: number; color: string }[]
  size?: number
  thickness?: number
  centerLabel?: string
  centerValue?: string
}

export function DonutChart({
  data,
  size = 160,
  thickness = 24,
  centerLabel,
  centerValue,
}: DonutChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const [hovered, setHovered] = useState<number | null>(null)

  // Build conic gradient
  let gradientParts: string[] = []
  let cumulative = 0
  for (const item of data) {
    const startPct = (cumulative / total) * 100
    cumulative += item.value
    const endPct = (cumulative / total) * 100
    gradientParts.push(`${item.color} ${startPct}% ${endPct}%`)
  }

  const radius = size / 2
  const innerRadius = radius - thickness

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      {/* Donut */}
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <div
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            background: total > 0 ? `conic-gradient(${gradientParts.join(', ')})` : '#e5e7eb',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: thickness,
            left: thickness,
            width: size - thickness * 2,
            height: size - thickness * 2,
            borderRadius: '50%',
            backgroundColor: 'white',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {centerValue && (
            <span style={{ fontSize: 20, fontWeight: 700, color: '#1f2937' }}>{centerValue}</span>
          )}
          {centerLabel && (
            <span style={{ fontSize: 10, color: '#9ca3af' }}>{centerLabel}</span>
          )}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {data.map((item, i) => (
          <div
            key={item.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'default',
              opacity: hovered !== null && hovered !== i ? 0.4 : 1,
              transition: 'opacity 0.2s',
            }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: item.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {item.label}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginLeft: 'auto' }}>
              {item.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Sparkline ───────────────────────────────────────────────────────────

interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  color?: string
  fillColor?: string
  showDots?: boolean
}

export function Sparkline({
  data,
  width = 200,
  height = 50,
  color = '#3E2A1E',
  fillColor,
  showDots = false,
}: SparklineProps) {
  if (data.length < 2) return null

  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const padding = 4

  const points = data.map((val, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2)
    const y = padding + (1 - (val - min) / range) * (height - padding * 2)
    return { x, y }
  })

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  // Fill area
  const fillD = fillColor
    ? `${pathD} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`
    : ''

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {fillColor && <path d={fillD} fill={fillColor} opacity={0.2} />}
      <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {showDots &&
        points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={color} />
        ))}
      {/* End dot */}
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={3} fill={color} />
    </svg>
  )
}

// ─── Horizontal Bar Chart ────────────────────────────────────────────────

interface HBarChartProps {
  data: { label: string; value: number; color?: string }[]
  maxValue?: number
  formatValue?: (v: number) => string
}

export function HBarChart({
  data,
  maxValue,
  formatValue = (v) => v.toLocaleString(),
}: HBarChartProps) {
  const max = maxValue || Math.max(...data.map((d) => d.value), 1)
  const defaultColors = ['#3E2A1E', '#C9822B', '#27AE60', '#8E44AD', '#E74C3C', '#3498DB', '#1ABC9C', '#D9993F']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.map((item, i) => {
        const pct = max > 0 ? (item.value / max) * 100 : 0
        const color = item.color || defaultColors[i % defaultColors.length]
        return (
          <div key={item.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ fontSize: 12, color: '#374151' }}>{item.label}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{formatValue(item.value)}</span>
            </div>
            <div style={{ height: 8, backgroundColor: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  backgroundColor: color,
                  borderRadius: 4,
                  transition: 'width 0.5s ease',
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Mini Stat Card ──────────────────────────────────────────────────────

interface MiniStatProps {
  label: string
  value: string | number
  trend?: number // percentage change
  trendLabel?: string
  sparkData?: number[]
  color?: string
}

export function MiniStat({ label, value, trend, trendLabel, sparkData, color = '#3E2A1E' }: MiniStatProps) {
  const isPositive = (trend || 0) >= 0

  return (
    <div style={{
      padding: '16px 20px',
      backgroundColor: 'white',
      borderRadius: 12,
      border: '1px solid #e5e7eb',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>{label}</p>
          <p style={{ fontSize: 24, fontWeight: 700, color: '#1f2937' }}>
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
          {trend !== undefined && (
            <p style={{ fontSize: 11, color: isPositive ? '#10b981' : '#ef4444', marginTop: 4, display: 'flex', alignItems: 'center', gap: 2 }}>
              <span>{isPositive ? '▲' : '▼'}</span>
              <span>{Math.abs(trend).toFixed(1)}%</span>
              {trendLabel && <span style={{ color: '#9ca3af', marginLeft: 2 }}>{trendLabel}</span>}
            </p>
          )}
        </div>
        {sparkData && (
          <Sparkline data={sparkData} width={80} height={36} color={color} fillColor={color} />
        )}
      </div>
    </div>
  )
}

// ─── Progress Ring ───────────────────────────────────────────────────────

interface ProgressRingProps {
  value: number // 0-100
  size?: number
  strokeWidth?: number
  color?: string
  label?: string
}

export function ProgressRing({ value, size = 60, strokeWidth = 6, color = '#3E2A1E', label }: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(value, 100) / 100) * circumference

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f3f4f6" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>{Math.round(value)}%</span>
      {label && <span style={{ fontSize: 10, color: '#9ca3af' }}>{label}</span>}
    </div>
  )
}
