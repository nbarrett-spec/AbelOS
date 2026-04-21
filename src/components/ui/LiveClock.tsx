'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface LiveClockProps {
  /** IANA timezone, default America/Chicago. */
  timeZone?: string
  /** Whether to show seconds. Default true. */
  showSeconds?: boolean
  className?: string
}

/**
 * LiveClock — ticks every second, `America/Chicago` by default. `tabular-nums`
 * so the display doesn't jitter. Intended for the top nav / StatusBar.
 */
export default function LiveClock({
  timeZone = 'America/Chicago',
  showSeconds = true,
  className,
}: LiveClockProps) {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  if (!now) {
    return (
      <span className={cn('tabular-nums text-[11px] text-fg-subtle font-mono', className)}>
        --:--:--
      </span>
    )
  }

  const time = now.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: showSeconds ? '2-digit' : undefined,
    timeZone,
  })

  return (
    <span
      className={cn('tabular-nums text-[11px] text-fg-muted font-mono', className)}
      title={`${timeZone}`}
    >
      {time} <span className="text-fg-subtle">CT</span>
    </span>
  )
}
