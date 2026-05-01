/**
 * Builder Portal — tiny SVG sparkline.
 *
 * Server-renderable (no client hooks). Used inside KPI cards at 12% opacity.
 */

interface PortalSparklineProps {
  data: number[]
  width?: number
  height?: number
  color?: string
  /** Strokeable opacity 0-1; default 0.6 (the card itself nests this with --opacity 0.12). */
  opacity?: number
  className?: string
}

export function PortalSparkline({
  data,
  width = 100,
  height = 36,
  color = 'var(--c1)',
  opacity = 0.6,
  className,
}: PortalSparklineProps) {
  if (!data || data.length < 2) {
    return (
      <svg width={width} height={height} className={className} aria-hidden="true">
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={color}
          strokeWidth={1.5}
          opacity={opacity * 0.4}
        />
      </svg>
    )
  }

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const stepX = data.length > 1 ? width / (data.length - 1) : width
  const padY = 3

  const pts = data.map((v, i) => {
    const x = i * stepX
    const y = height - padY - ((v - min) / range) * (height - padY * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  const path = `M ${pts.join(' L ')}`
  const lastX = (data.length - 1) * stepX
  const lastY = height - padY - ((data[data.length - 1] - min) / range) * (height - padY * 2)

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={opacity}
      />
      <circle cx={lastX} cy={lastY} r={2.25} fill={color} opacity={opacity * 1.4} />
    </svg>
  )
}
