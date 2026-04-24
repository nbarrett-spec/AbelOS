// If Thomas transitions to new builders, update the builder-name filter list below.
//
// Bookmark-friendly shortcut for Thomas Robinson (PM) showing his active
// job book scoped to Hayhurst, Haven Home, TriStar, and Bailey Brothers —
// per Nate's 4/24 corrections. Filtering on builderName keeps his view
// honest and excludes pollution from other builders that may have
// historical jobs still pointing at his assignedPMId.
//
// Pattern mirrors src/app/brittney/page.tsx — see that file for the
// canonical commentary on the server-component + raw-SQL + KPI layout.

import Link from 'next/link'
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
// Thomas's active builders per Nate's 4/24 corrections. If he transitions,
// update this list. The SQL filter uses ILIKE with %-wildcards so naming
// variants match (e.g. "Hayhurst Homes", "Haven Home Builders",
// "TriStar Construction", "Bailey Brothers Homes").
// Next.js 14 app-router page files only permit specific exports (default
// component + dynamic/revalidate/runtime/generateMetadata/metadata/etc).
// Arbitrary `export const` fails the build with "X is not a valid Page
// export field". Kept module-private here; if this ever needs to be
// imported elsewhere, move to src/lib/pm-filters.ts first.
const THOMAS_BUILDER_PATTERNS = [
  '%Hayhurst%',
  '%Haven Home%',
  '%TriStar%',
  '%Bailey Brothers%',
]

// Display-friendly label for the filter list (shown in the header).
const THOMAS_BUILDER_LABEL =
  'Hayhurst + Haven Home + TriStar + Bailey Brothers'

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
export default async function ThomasPage(): Promise<JSX.Element> {
  // Feature flag — default ON. Only hides when explicitly disabled.
  if (process.env.NEXT_PUBLIC_FEATURE_THOMAS_PAGE === 'off') {
    return (
      <div className="max-w-3xl mx-auto p-8">
        <EmptyState
          title="This page is disabled"
          description="The /thomas shortcut is turned off via feature flag."
        />
      </div>
    )
  }

  // ── Step 1: Look up Thomas's Staff row ───────────────────────────────
  const staffRows = await prisma.$queryRawUnsafe<StaffRow[]>(
    `SELECT id, "firstName", "lastName"
       FROM "Staff"
      WHERE "firstName" ILIKE $1
        AND "lastName"  ILIKE $2
      LIMIT 1`,
    'Thomas',
    'Robinson'
  )

  const staff = staffRows[0]

  if (!staff) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <PageHeader
          eyebrow="PM Book"
          title="Thomas's Book"
          description="Could not find Thomas Robinson in the Staff directory."
        />
        <Card>
          <CardBody>
            <EmptyState
              icon="users"
              title="Staff record not found"
              description="No active staff row matches 'Thomas Robinson'. He may not be set up yet, or his name is spelled differently in Staff."
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

  // ── Step 2: Query his jobs filtered to the 4 builder patterns ────────
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
    THOMAS_BUILDER_PATTERNS
  )

  // ── Step 3: KPIs ─────────────────────────────────────────────────────
  const totalJobs = jobs.length

  const materialsReady = jobs.filter(
    (j) => j.readinessCheck && j.materialsLocked
  ).length
  const materialsReadyPct =
    totalJobs > 0 ? Math.round((materialsReady / totalJobs) * 100) : 0

  const now = new Date()
  const weekAhead = new Date(now)
  weekAhead.setDate(weekAhead.getDate() + 7)
  const todayStart = startOfDay(now)

  const closingThisWeek = jobs.filter((j) => {
    if (!j.scheduledDate) return false
    const d = new Date(j.scheduledDate)
    return d >= todayStart && d <= weekAhead && j.status !== 'COMPLETE'
  }).length

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
        title={`Thomas's Book — ${THOMAS_BUILDER_LABEL}`}
        description={`Active jobs assigned to ${staff.firstName}, filtered to ${THOMAS_BUILDER_LABEL}. Excludes CLOSED and CANCELLED.`}
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
          subtitle={`Scoped to ${THOMAS_BUILDER_LABEL}`}
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
              description={`Thomas has no open ${THOMAS_BUILDER_LABEL} jobs right now. If this looks wrong, verify builder names in InFlow match the filter patterns: ${THOMAS_BUILDER_PATTERNS.join(', ')}.`}
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
                  const communityCell = (j.community || '—') + lotBit
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
          {THOMAS_BUILDER_PATTERNS.join('  ·  ')}
        </code>
      </div>
    </div>
  )
}
