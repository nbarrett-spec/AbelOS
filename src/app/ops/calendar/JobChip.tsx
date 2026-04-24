'use client'

// ──────────────────────────────────────────────────────────────────────────
// JobChip — a compact pill representing one calendar event (start or close).
// Used inside day cells on /ops/calendar and inside the day-expansion panel.
//
// Visual spec:
//   - Colored left rail by status group (indigo / gray / cyan / slate)
//   - Materials-ready dot on the right (green / amber / red / unknown)
//   - "CLOSE" badge if this event is a closing date, otherwise the start
//     date is implied by the cell.
// ──────────────────────────────────────────────────────────────────────────

export type CalendarEventStatus = string // raw JobStatus enum value
export type MaterialsStatus = 'green' | 'amber' | 'red' | 'unknown'
export type DateKind = 'start' | 'close'

export interface JobChipEvent {
  jobId: string
  jobNumber: string
  community: string | null
  builderName: string
  status: CalendarEventStatus
  dateKind: DateKind
  date: string
  materialsStatus: MaterialsStatus
}

// Map the 13 JobStatus enum values into the 4 buckets the UX spec calls out.
// IN_PROGRESS = indigo (c1), PENDING = gray, READY_TO_CLOSE = cyan (c4), CLOSED = slate.
type StatusBucket = 'IN_PROGRESS' | 'PENDING' | 'READY_TO_CLOSE' | 'CLOSED'

export function bucketStatus(raw: string): StatusBucket {
  switch (raw) {
    // Active work
    case 'IN_PRODUCTION':
    case 'STAGED':
    case 'LOADED':
    case 'IN_TRANSIT':
    case 'INSTALLING':
      return 'IN_PROGRESS'
    // Early / not-yet-working
    case 'CREATED':
    case 'READINESS_CHECK':
    case 'MATERIALS_LOCKED':
      return 'PENDING'
    // Done-but-open
    case 'DELIVERED':
    case 'PUNCH_LIST':
    case 'COMPLETE':
      return 'READY_TO_CLOSE'
    // Wrapped
    case 'INVOICED':
    case 'CLOSED':
      return 'CLOSED'
    default:
      return 'PENDING'
  }
}

const RAIL_COLORS: Record<StatusBucket, string> = {
  IN_PROGRESS: 'var(--c1)',   // indigo
  PENDING: 'var(--fg-subtle, #6b7280)',
  READY_TO_CLOSE: 'var(--c4)', // teal/cyan
  CLOSED: 'var(--fg-muted, #94a3b8)',
}

const BUCKET_LABEL: Record<StatusBucket, string> = {
  IN_PROGRESS: 'In Progress',
  PENDING: 'Pending',
  READY_TO_CLOSE: 'Ready to Close',
  CLOSED: 'Closed',
}

const MATERIALS_COLOR: Record<MaterialsStatus, string> = {
  green: '#10b981',
  amber: '#F59E0B',
  red: '#EF4444',
  unknown: '#9CA3AF',
}

const MATERIALS_LABEL: Record<MaterialsStatus, string> = {
  green: 'Materials picked',
  amber: 'Reserved — stock on hand',
  red: 'Backordered or short',
  unknown: 'No allocations yet',
}

export default function JobChip({
  event,
  compact = true,
  onClick,
}: {
  event: JobChipEvent
  compact?: boolean
  onClick?: () => void
}) {
  const bucket = bucketStatus(event.status)
  const rail = RAIL_COLORS[bucket]
  const matColor = MATERIALS_COLOR[event.materialsStatus]
  const matLabel = MATERIALS_LABEL[event.materialsStatus]
  const bucketLabel = BUCKET_LABEL[bucket]

  const title = `${event.jobNumber} · ${event.builderName}${event.community ? ' · ' + event.community : ''}\n${bucketLabel} · ${matLabel}${event.dateKind === 'close' ? '\nClosing date' : ''}`

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="w-full text-left rounded-[4px] border border-border bg-surface-elevated hover:border-border-strong hover:shadow-sm transition-all overflow-hidden flex items-stretch group"
      style={{ borderLeft: `3px solid ${rail}` }}
    >
      <div className={compact ? 'flex-1 min-w-0 px-1.5 py-1' : 'flex-1 min-w-0 px-2 py-1.5'}>
        <div className="flex items-center gap-1 min-w-0">
          <span
            className={`font-mono tabular-nums text-fg truncate ${compact ? 'text-[10px]' : 'text-[11px]'}`}
          >
            {event.jobNumber}
          </span>
          {event.dateKind === 'close' && (
            <span
              className="shrink-0 font-mono tracking-wide uppercase px-1 rounded text-[8px]"
              style={{
                color: 'var(--c4)',
                background: 'color-mix(in srgb, var(--c4) 14%, transparent)',
              }}
            >
              CLOSE
            </span>
          )}
          <span
            className="ml-auto shrink-0 w-1.5 h-1.5 rounded-full"
            style={{ background: matColor }}
            aria-label={matLabel}
          />
        </div>
        {!compact ? (
          <div className="text-[10.5px] text-fg-muted truncate mt-0.5">
            {event.community || '—'} <span className="text-fg-subtle">·</span>{' '}
            <span className="text-fg-muted">{event.builderName}</span>
          </div>
        ) : (
          <div className="text-[9.5px] text-fg-muted truncate">
            {event.community ? `${event.community} · ` : ''}
            {event.builderName}
          </div>
        )}
      </div>
    </button>
  )
}

// Named exports for legend etc.
export { RAIL_COLORS, BUCKET_LABEL, MATERIALS_COLOR, MATERIALS_LABEL }
