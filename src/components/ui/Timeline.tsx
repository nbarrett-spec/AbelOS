'use client'

import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ── Aegis v2 "Drafting Room" Timeline ────────────────────────────────────
// Horizontal node chain (not vertical). Each node is a 12px circle + 2px line.
// States: completed (gold filled), active (gold ring pulsing),
// upcoming (navy/border), error (ember). Click node to expand detail.
// ─────────────────────────────────────────────────────────────────────────

export type TimelineNodeState = 'completed' | 'active' | 'upcoming' | 'error'

export interface TimelineNode {
  id: string
  label: string
  state: TimelineNodeState
  timestamp?: string | Date
  operator?: string
  station?: string
  durationMin?: number
  detail?: ReactNode
}

export interface TimelineProps {
  nodes: TimelineNode[]
  className?: string
  /** Initially expanded node id */
  defaultExpandedId?: string
}

function formatTs(ts: TimelineNode['timestamp']): string {
  if (!ts) return ''
  const d = typeof ts === 'string' ? new Date(ts) : ts
  if (isNaN(d.getTime())) return String(ts)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const STATE_STYLES: Record<
  TimelineNodeState,
  { fill: string; ring: string; line: string; pulse: boolean }
> = {
  completed: {
    fill: 'var(--signal, var(--gold))',
    ring: 'var(--signal, var(--gold))',
    line: 'var(--signal, var(--gold))',
    pulse: false,
  },
  active: {
    fill: 'var(--canvas)',
    ring: 'var(--signal, var(--gold))',
    line: 'var(--border-strong)',
    pulse: true,
  },
  upcoming: {
    fill: 'var(--canvas)',
    ring: 'var(--border-strong)',
    line: 'var(--border)',
    pulse: false,
  },
  error: {
    fill: 'var(--ember, #b64e3d)',
    ring: 'var(--ember, #b64e3d)',
    line: 'var(--ember, #b64e3d)',
    pulse: false,
  },
}

export function Timeline({
  nodes,
  className,
  defaultExpandedId,
}: TimelineProps) {
  const [expandedId, setExpandedId] = useState<string | null>(
    defaultExpandedId ?? null,
  )
  const toggle = (id: string) =>
    setExpandedId((cur) => (cur === id ? null : id))

  return (
    <div className={cn('w-full', className)}>
      <div className="relative">
        {/* Horizontal scrollable rail */}
        <div
          className="aegis-timeline overflow-x-auto scrollbar-thin"
          style={{
            maskImage:
              'linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent)',
            WebkitMaskImage:
              'linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent)',
          }}
        >
          <div className="flex items-start min-w-max px-4 py-3" role="list">
            {nodes.map((node, i) => {
              const style = STATE_STYLES[node.state]
              const isLast = i === nodes.length - 1
              const isExpanded = expandedId === node.id
              return (
                <div
                  key={node.id}
                  role="listitem"
                  className="flex flex-col items-center min-w-[120px]"
                >
                  <div className="flex items-center w-full">
                    <div className="flex-1 h-[2px]" />
                    <button
                      type="button"
                      onClick={() => toggle(node.id)}
                      aria-expanded={isExpanded}
                      aria-label={`${node.label} — ${node.state}`}
                      className="relative shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal)] focus-visible:ring-offset-2 rounded-full"
                      style={{ width: 12, height: 12 }}
                    >
                      <span
                        className={cn(
                          'block rounded-full absolute inset-0',
                          style.pulse && 'aegis-timeline-pulse',
                        )}
                        style={{
                          background: style.fill,
                          boxShadow: `inset 0 0 0 2px ${style.ring}`,
                        }}
                      />
                    </button>
                    {!isLast && (
                      <div
                        className="flex-1 h-[2px]"
                        style={{ background: style.line }}
                      />
                    )}
                    {isLast && <div className="flex-1 h-[2px]" />}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggle(node.id)}
                    className="mt-2 text-[11px] font-mono uppercase tracking-[0.08em] text-fg-muted hover:text-fg transition-colors text-center max-w-[110px] leading-tight"
                  >
                    {node.label}
                  </button>
                  {node.timestamp && (
                    <span className="mt-0.5 text-[10px] text-fg-subtle tabular-nums">
                      {formatTs(node.timestamp)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {expandedId && (
        <div className="panel mt-3 p-3 animate-[fadeIn_180ms_var(--ease)]">
          {(() => {
            const n = nodes.find((x) => x.id === expandedId)
            if (!n) return null
            return (
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-semibold text-fg">
                    {n.label}
                  </span>
                  {n.timestamp && (
                    <span className="text-[11px] font-mono tabular-nums text-fg-muted">
                      {formatTs(n.timestamp)}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-fg-muted">
                  {n.operator && (
                    <span>
                      <span className="text-fg-subtle mr-1">Operator:</span>
                      {n.operator}
                    </span>
                  )}
                  {n.station && (
                    <span>
                      <span className="text-fg-subtle mr-1">Station:</span>
                      {n.station}
                    </span>
                  )}
                  {typeof n.durationMin === 'number' && (
                    <span className="tabular-nums">
                      <span className="text-fg-subtle mr-1">Duration:</span>
                      {n.durationMin}m
                    </span>
                  )}
                </div>
                {n.detail && <div className="text-[12px] text-fg">{n.detail}</div>}
              </div>
            )
          })()}
        </div>
      )}

      <style jsx>{`
        @keyframes aegis-timeline-pulse {
          0%, 100% { box-shadow: inset 0 0 0 2px var(--signal), 0 0 0 0 var(--signal-glow); }
          50%      { box-shadow: inset 0 0 0 2px var(--signal), 0 0 0 6px transparent; }
        }
        .aegis-timeline-pulse {
          animation: aegis-timeline-pulse 1.6s cubic-bezier(.2,.8,.2,1) infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .aegis-timeline-pulse { animation: none !important; }
        }
      `}</style>
    </div>
  )
}

export default Timeline
