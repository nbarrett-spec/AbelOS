/**
 * Visual timeline for an order's lifecycle.
 *
 * §4.2.1 Order Detail. Renders 5 fixed steps (Confirmed → Production →
 * Shipped → Out for Delivery → Delivered) with a colored bar connecting
 * each. The current step uses the amber gradient; completed steps use
 * walnut; upcoming steps are muted.
 *
 * Cancelled / On-Hold orders short-circuit and render a single banner
 * instead of the timeline (cleaner than half-walking the steps).
 */

import { Check } from 'lucide-react'
import type { PortalOrderStatus } from '@/types/portal'

interface PortalOrderTimelineProps {
  status: string
  /** ISO timestamps keyed by step name. Optional — used as captions when present. */
  dates?: Partial<Record<TimelineStepKey, string>>
  className?: string
}

type TimelineStepKey =
  | 'confirmed'
  | 'production'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'

const STEPS: { key: TimelineStepKey; label: string }[] = [
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'production', label: 'In Production' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'out_for_delivery', label: 'Out for Delivery' },
  { key: 'delivered', label: 'Delivered' },
]

/** Map an order status to the index of the step it represents (0-4). */
function indexForStatus(s: string): number {
  const u = s.toUpperCase()
  if (u === 'DRAFT' || u === 'CONFIRMED' || u === 'RECEIVED') return 0
  if (u === 'IN_PRODUCTION') return 1
  if (u === 'SHIPPED' || u === 'PARTIAL_SHIPPED') return 2
  if (u === 'OUT_FOR_DELIVERY') return 3
  if (u === 'DELIVERED') return 4
  return 0
}

function fmtDate(iso?: string): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return ''
  }
}

export function PortalOrderTimeline({
  status,
  dates,
  className,
}: PortalOrderTimelineProps) {
  const upper = status.toUpperCase()

  if (upper === 'CANCELLED') {
    return (
      <div
        className={`px-4 py-3 rounded-md text-sm flex items-center gap-3 ${
          className ?? ''
        }`}
        style={{
          background: 'rgba(110,42,36,0.08)',
          border: '1px solid rgba(110,42,36,0.2)',
          color: '#7E2417',
        }}
      >
        <strong>Order cancelled.</strong>
        <span style={{ color: 'var(--portal-text-muted, #6B6056)' }}>
          This order is no longer active.
        </span>
      </div>
    )
  }

  if (upper === 'ON_HOLD') {
    return (
      <div
        className={`px-4 py-3 rounded-md text-sm flex items-center gap-3 ${
          className ?? ''
        }`}
        style={{
          background: 'rgba(212,165,74,0.14)',
          border: '1px solid rgba(212,165,74,0.3)',
          color: '#7A5413',
        }}
      >
        <strong>Order on hold.</strong>
        <span style={{ color: 'var(--portal-text-muted, #6B6056)' }}>
          Your PM will reach out shortly.
        </span>
      </div>
    )
  }

  const current = indexForStatus(status)

  return (
    <div className={className}>
      <ol
        className="flex items-center gap-1 md:gap-2"
        aria-label="Order progress"
      >
        {STEPS.map((step, i) => {
          const state: 'complete' | 'current' | 'upcoming' =
            i < current ? 'complete' : i === current ? 'current' : 'upcoming'
          return (
            <li
              key={step.key}
              className="flex-1 min-w-0"
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <div className="flex items-center gap-1 md:gap-2">
                <div
                  className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold transition-colors"
                  style={
                    state === 'complete'
                      ? {
                          background: 'var(--c1)',
                          color: 'white',
                        }
                      : state === 'current'
                        ? {
                            background:
                              'var(--grad)',
                            color: 'white',
                            boxShadow: '0 0 0 4px rgba(201,130,43,0.18)',
                          }
                        : {
                            background:
                              'var(--portal-bg-elevated, #FAF5E8)',
                            color: 'var(--portal-text-muted, #6B6056)',
                            border:
                              '1px solid var(--portal-border, #E8DFD0)',
                          }
                  }
                >
                  {state === 'complete' ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    i + 1
                  )}
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className="hidden sm:block flex-1 h-[2px] rounded-full"
                    style={{
                      background:
                        state === 'complete'
                          ? 'var(--c1)'
                          : 'var(--portal-border, #E8DFD0)',
                    }}
                  />
                )}
              </div>
              <div className="mt-1.5">
                <div
                  className="text-[11px] font-medium leading-tight truncate"
                  style={{
                    color:
                      state === 'upcoming'
                        ? 'var(--portal-text-muted, #6B6056)'
                        : 'var(--portal-text-strong, #3E2A1E)',
                  }}
                >
                  {step.label}
                </div>
                {dates?.[step.key] && (
                  <div
                    className="text-[10px] font-mono"
                    style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                  >
                    {fmtDate(dates[step.key])}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export type { TimelineStepKey }
export { indexForStatus as portalTimelineIndexForStatus }
