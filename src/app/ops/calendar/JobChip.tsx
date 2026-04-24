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
  jobType: string | null
  dateKind: DateKind
  date: string
  materialsStatus: MaterialsStatus
}

// ── Job Type color coding ─────────────────────────────────────────────────
// Each job type gets a distinct color for calendar visual differentiation.
export const JOB_TYPE_COLORS: Record<string, string> = {
  TRIM_1:          '#3B82F6', // blue
  TRIM_1_INSTALL:  '#2563EB', // darker blue
  TRIM_2:          '#8B5CF6', // purple
  TRIM_2_INSTALL:  '#7C3AED', // darker purple
  DOORS:           '#F59E0B', // amber
  DOOR_INSTALL:    '#D97706', // darker amber
  HARDWARE:        '#10B981', // emerald
  HARDWARE_INSTALL:'#059669', // darker emerald
  FINAL_FRONT:     '#EF4444', // red
  FINAL_FRONT_INSTALL: '#DC2626', // darker red
  QC_WALK:         '#06B6D4', // cyan
  PUNCH:           '#F97316', // orange
  WARRANTY:        '#EC4899', // pink
  CUSTOM:          '#6B7280', // gray
}

export const JOB_TYPE_LABELS: Record<string, string> = {
  TRIM_1: 'Trim 1',
  TRIM_1_INSTALL: 'Trim 1 Install',
  TRIM_2: 'Trim 2',
  TRIM_2_INSTALL: 'Trim 2 Install',
  DOORS: 'Doors',
  DOOR_INSTALL: 'Door Install',
  HARDWARE: 'Hardware',
  HARDWARE_INSTALL: 'Hardware Install',
  FINAL_FRONT: 'Final Front',
  FINAL_FRONT_INSTALL: 'Final Front Install',
  QC_WALK: 'QC Walk',
  PUNCH: 'Punch List',
  WARRANTY: 'Warranty',
  CUSTOM: 'Custom',
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
  // Use job type color for the rail when available; fall back to status bucket color
  const rail = event.jobType && JOB_TYPE_COLORS[event.jobType]
    ? JOB_TYPE_COLORS[event.jobType]
    : RAIL_COLORS[bucket]
  const matColor = MATERIALS_COLOR[event.materialsStatus]
  const matLabel = MATERIALS_LABEL[event.materialsStatus]
  const bucketLabel = BUCKET_LABEL[bucket]
  const typeLabel = event.jobType ? JOB_TYPE_LABELS[event.jobType] || event.jobType : null

  const title = `${event.jobNumber}${typeLabel ? ' (' + typeLabel + ')' : ''} · ${event.builderName}${event.community ? ' · ' + event.community : ''}\n${bucketLabel} · ${matLabel}${event.dateKind === 'close' ? '\nClosing date' : ''}`

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
          {typeLabel && (
            <span
              className="shrink-0 font-mono tracking-wide uppercase px-1 rounded text-[8px]"
              style={{
                color: rail,
                background: `${rail}22`,
              }}
            >
              {JOB_TYPE_LABELS[event.jobType!]?.replace(/\s+/g, '').slice(0, 3).toUpperCase() || event.jobType}
            </span>
          )}
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
// JOB_TYPE_COLORS and JOB_TYPE_LABELS are already `export const` at declaration
// sites (lines 32, 49) — adding them to this re-export list is a duplicate
// and fails Next.js build with TS2484/TS2323. Keep the list to the four
// symbols that don't have inline exports.
export { RAIL_COLORS, BUCKET_LABEL, MATERIALS_COLOR, MATERIALS_LABEL }
