// If Brittney transitions to new builders, update the builder-name filter list below.
//
// Bookmark-friendly shortcut for Brittney Werner (PM) showing her active job
// book scoped to Toll Brothers + Texas R&R. After Pulte was lost 2026-04-20,
// her book moved to these two builders; filtering on builderName keeps her
// view honest and excludes dead-Pulte pollution.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import {
  PageHeader,
  KPICard,
  Card,
  CardBody,
  EmptyState,
  Badge,
  Table,
  TableHead,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ── Config ────────────────────────────────────────────────────────────────
// Brittney's active builders. If she transitions, update this list. The
// SQL filter uses ILIKE with %-wildcards so "Toll Brothers", "Toll Bros",
// "Toll Brothers Texas", "Texas R&R", "Texas RR", "Texas R & R" all match.
const BRITTNEY_BUILDER_PATTERNS = [
  '%Toll%',
  '%Texas R&R%',
  '%Texas RR%',
  '%Texas R & R%',
]

// Display-friendly label for the filter list (shown in the header).
const BRITTNEY_BUILDER_LABEL = 'Toll Brothers + Texas R&R'

// Statuses we consider "closed" — excluded from the active book.
const CLOSED_STATUSES = ['CLOSED', 'CANCELLED'] as const

// ── Types ─────────────────────────────────────────────────────────────────
interface StaffRow {
  id: string
  firstName: string
  lastName: string
}

interface JobRow {
  id: string
  jobNumber: string
  builderName: string
  community: string | null
  jobAddress: string | null
  lotBlock: string | null
  status: string
  scopeType: string
  scheduledDate: Date | null
  completedAt: Date | null
  readinessCheck: boolean
  materialsLocked: boolean
  loadConfirmed: boolean
  assignedPMId: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────
function fmtDate(d: Date | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

function statusVariant(
  status: string
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
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

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

// ── Page ──────────────────────────────────────────────────────────────────
export default async function BrittneyPage(): Promise<JSX.Element> {
  // Feature flag — default ON. Only hides when explicitly disabled.
  if (process.env.NEXT_PUBLIC_FEATURE_BRITTNEY_PAGE === 'off') {
    return (
      <div className="max-w-3xl mx-auto p-8">
        <EmptyState
          title="This page is disabled"
          description="The /brittney shortcut is turned off via feature flag."
        />
      </div>
    )
  }

  // ── Step 1: Look up Brittney's Staff row ─────────────────────────────
  const staffRows = await prisma.$queryRawUnsafe<StaffRow[]>(
    `SELECT id, "firstName", "lastName"
       FROM "Staff"
      WHERE "firstName" ILIKE $1
        AND "lastName"  ILIKE $2
      LIMIT 1`,
    'Brittney',
    'Werner'
  )

  const staff = staffRows[0]

  if (!staff) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <PageHeader
          eyebrow="PM Book"
          title="Brittney's Book"
          description="Could not find Brittney Werner in the Staff directory."
        />
        <Card>
          <CardBody>
            <EmptyState
              icon="users"
              title="Staff record not found"
              description="No active staff row matches 'Brittney Werner'. She may not be set up yet, or her name is spelled differently in Staff."
              action={{
                label: 'Go to Staff directory',
                href: '/ops/staff',
              }}
            />
          </CardBody>
        </Card>
      </div>
    )
  }

  // ── Optional delegation to C1's PM Book page ─────────────────────────
  // If /ops/pm/book/[staffId] ships and accepts ?builders=..., delegate.
  // Otherwise render inline. We guard behind an explicit env opt-in so a
  // half-shipped C1 route doesn't silently break this page.
  if (process.env.NEXT_PUBLIC_BRITTNEY_DELEGATE_TO_PM_BOOK === 'on') {
    redirect(`/ops/pm/book/${staff.id}?builders=toll,texas-rr`)
  }

  // ── Step 2: Query her jobs filtered to Toll + Texas R&R ──────────────
  // Job has no direct builderId FK; the link is the denormalized
  // Job.builderName string. We ILIKE against the pattern list and also
  // join Builder (LEFT JOIN) in case a builderId-style join becomes
  // available later — harmless no-op today.
  const jobs = await prisma.$queryRawUnsafe<JobRow[]>(
    `SELECT j.id,
            j."jobNumber",
            j."builderName",
            j.community,
            j."jobAddress",
            j."lotBlock",
            j.status::text            AS status,
            j."scopeType"::text       AS "scopeType",
            j."scheduledDate",
            j."completedAt",
            j."readinessCheck",
            j."materialsLocked",
            j."loadConfirmed",
            j."assignedPMId"
       FROM "Job" j
      WHERE j."assignedPMId" = $1
        AND j."builderName" ILIKE ANY ($2::text[])
        AND j.status::text NOT IN ('CLOSED','CANCELLED')
      ORDER BY j."scheduledDate" ASC NULLS LAST,
               j."jobNumber"     ASC`,
    staff.id,
    BRITTNEY_BUILDER_PATTERNS
  )

  // ── Step 3: KPIs ─────────────────────────────────────────────────────
  const totalJobs = jobs.length

  // "Materials ready" — readinessCheck + materialsLocked both true.
  const materialsReady = jobs.filter(
    (j) => j.readinessCheck && j.materialsLocked
  ).length
  const materialsReadyPct =
    totalJobs > 0 ? Math.round((materialsReady / totalJobs) * 100) : 0

  // Closing this week — scheduledDate in next 7 days, not yet complete.
  const now = new Date()
  const weekAhead = new Date(now)
  weekAhead.setDate(weekAhead.getDate() + 7)
  const todayStart = startOfDay(now)

  const closingThisWeek = jobs.filter((j) => {
    if (!j.scheduledDate) return false
    const d = new Date(j.scheduledDate)
    return d >= todayStart && d <= weekAhead && j.status !== 'COMPLETE'
  }).length

  // Overdue — scheduledDate is in the past and status is not terminal.
  const overdue = jobs.filter((j) => {
    if (!j.scheduledDate) return false
    const d = new Date(j.scheduledDate)
    return (
      d < todayStart &&
      j.status !== 'COMPLETE' &&
      j.status !== 'INVOICED' &&
      !CLOSED_STATUSES.includes(j.status as (typeof CLOSED_STATUSES)[number])
    )
  }).length

  // ── Step 4: Render ───────────────────────────────────────────────────
  return (
    <div className="max-w-[1400px] mx-auto p-6 space-y-6">
      <PageHeader
        eyebrow={`PM · ${staff.firstName} ${staff.lastName}`}
        title={`Brittney's Book — ${BRITTNEY_BUILDER_LABEL}`}
        description={`Active jobs assigned to ${staff.firstName}, filtered to ${BRITTNEY_BUILDER_LABEL}. Excludes CLOSED and CANCELLED.`}
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'PM Books', href: '/ops/staff' },
          { label: staff.firstName },
        ]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Active jobs"
          value={totalJobs}
          accent="brand"
          subtitle={`Scoped to ${BRITTNEY_BUILDER_LABEL}`}
        />
        <KPICard
          title="Materials ready"
          value={`${materialsReadyPct}%`}
          accent={materialsReadyPct >= 70 ? 'positive' : 'forecast'}
          subtitle={`${materialsReady} of ${totalJobs} jobs`}
        />
        <KPICard
          title="Closing this week"
          value={closingThisWeek}
          accent="accent"
          subtitle="Scheduled in next 7 days"
        />
        <KPICard
          title="Overdue"
          value={overdue}
          accent={overdue > 0 ? 'negative' : 'neutral'}
          subtitle="Past scheduled date"
        />
      </div>

      <Card>
        <CardBody>
          {jobs.length === 0 ? (
            <EmptyState
              title="No active jobs"
              description={`Brittney has no open ${BRITTNEY_BUILDER_LABEL} jobs right now. If this looks wrong, verify builder names in InFlow match the filter patterns: ${BRITTNEY_BUILDER_PATTERNS.join(', ')}.`}
            />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader>Job #</TableHeader>
                  <TableHeader>Builder</TableHeader>
                  <TableHeader>Community / Lot</TableHeader>
                  <TableHeader>Address</TableHeader>
                  <TableHeader>Scope</TableHeader>
                  <TableHeader>Status</TableHeader>
                  <TableHeader>Scheduled</TableHeader>
                  <TableHeader>Ready</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {jobs.map((j) => {
                  const lotBit = j.lotBlock ? ` · ${j.lotBlock}` : ''
                  const communityCell =
                    (j.community || '—') + lotBit
                  const readyBits = [
                    j.readinessCheck ? 'R' : '',
                    j.materialsLocked ? 'M' : '',
                    j.loadConfirmed ? 'L' : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')

                  return (
                    <TableRow key={j.id}>
                      <TableCell>
                        <Link
                          href={`/ops/jobs/${j.id}`}
                          className="font-mono text-xs hover:underline"
                          style={{ color: 'var(--c1)' }}
                        >
                          {j.jobNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{j.builderName}</TableCell>
                      <TableCell>{communityCell}</TableCell>
                      <TableCell className="text-xs text-fg-muted">
                        {j.jobAddress || '—'}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs">{j.scopeType}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(j.status)}>
                          {j.status.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {fmtDate(j.scheduledDate)}
                      </TableCell>
                      <TableCell className="text-xs text-fg-muted">
                        {readyBits || '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <div className="text-xs text-fg-muted">
        Filter patterns in use:{' '}
        <code className="font-mono">
          {BRITTNEY_BUILDER_PATTERNS.join('  ·  ')}
        </code>
      </div>
    </div>
  )
}
