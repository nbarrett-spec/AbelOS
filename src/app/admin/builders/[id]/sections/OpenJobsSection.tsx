// Open Jobs table — server-rendered list of active jobs for the builder.
//
// "Open" = Job.status NOT IN ('CLOSED'). Note that "CLOSED" here is the Job
// terminal state (see JobStatus enum in schema.prisma). We intentionally
// keep "COMPLETE", "INVOICED", etc. visible because PMs still care about
// those until payment clears and the row flips to CLOSED.
//
// Materials-ready heuristic matches /brittney/page.tsx: readinessCheck +
// materialsLocked both true = ready. A checkmark glyph is shown in that
// column; otherwise "—".
//
// Job has no direct Builder FK — the link is Job.builderName (denormalized).
// page.tsx passes in the pre-filtered rows to keep this component simple.

import Link from 'next/link'
import { Card, CardBody, Badge, EmptyState } from '@/components/ui'
import { formatDate } from '@/lib/utils'

export interface OpenJobRow {
  id: string
  jobNumber: string
  community: string | null
  lotBlock: string | null
  status: string
  scheduledDate: Date | null
  readinessCheck: boolean
  materialsLocked: boolean
  loadConfirmed: boolean
  assignedPMName: string | null
}

export interface OpenJobsSectionProps {
  jobs: OpenJobRow[]
  /** When set, shows a "View all jobs" link in the header that filters the
   *  /ops/jobs list by this builder (BUG-14). */
  viewAllHref?: string
}

function statusVariant(
  status: string
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand' {
  switch (status) {
    case 'COMPLETE':
    case 'INVOICED':
    case 'DELIVERED':
      return 'success'
    case 'PUNCH_LIST':
    case 'READINESS_CHECK':
      return 'warning'
    case 'IN_TRANSIT':
    case 'INSTALLING':
    case 'IN_PRODUCTION':
    case 'MATERIALS_LOCKED':
    case 'LOADED':
    case 'STAGED':
      return 'info'
    case 'CREATED':
      return 'neutral'
    default:
      return 'neutral'
  }
}

export default function OpenJobsSection({
  jobs,
  viewAllHref,
}: OpenJobsSectionProps) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-fg-muted">
              Open jobs
            </div>
            <div className="text-lg font-semibold text-fg">
              {jobs.length} active
            </div>
          </div>
          {viewAllHref && (
            <Link
              href={viewAllHref}
              className="text-xs text-brand hover:underline"
            >
              View all jobs →
            </Link>
          )}
        </div>

        {jobs.length === 0 ? (
          <EmptyState
            title="No open jobs"
            description="All jobs for this builder are closed. New jobs will appear here automatically."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-fg-muted">
                  <th className="py-2 pr-3">Job #</th>
                  <th className="py-2 pr-3">Community</th>
                  <th className="py-2 pr-3">Lot</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Materials</th>
                  <th className="py-2 pr-3">Closing</th>
                  <th className="py-2 pr-3">PM</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const materialsReady = j.readinessCheck && j.materialsLocked
                  return (
                    <tr key={j.id} className="border-t border-border">
                      <td className="py-2 pr-3 font-mono text-xs">
                        <Link
                          href={`/ops/jobs/${j.id}`}
                          className="text-brand hover:underline"
                        >
                          {j.jobNumber}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">{j.community || '—'}</td>
                      <td className="py-2 pr-3 text-xs text-fg-muted">
                        {j.lotBlock || '—'}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant={statusVariant(j.status)} size="sm">
                          {j.status.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3">
                        {materialsReady ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs font-medium"
                            style={{ color: 'var(--data-positive)' }}
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 12 12"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d="M2.5 6.5L5 9L9.5 3"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                            Ready
                          </span>
                        ) : (
                          <span className="text-xs text-fg-muted">
                            {j.readinessCheck ? 'R' : '·'}
                            {' / '}
                            {j.materialsLocked ? 'M' : '·'}
                            {' / '}
                            {j.loadConfirmed ? 'L' : '·'}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {formatDate(j.scheduledDate)}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {j.assignedPMName || (
                          <span className="text-fg-muted">Unassigned</span>
                        )}
                      </td>
                      <td className="py-2">
                        <Link
                          href={`/ops/jobs/${j.id}`}
                          className="text-xs text-brand hover:underline"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
