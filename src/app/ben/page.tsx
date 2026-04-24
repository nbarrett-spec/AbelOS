// Bookmark-friendly shortcut for Ben Wilson (PM) showing his assigned job
// book. Per Nate's 4/24 notes, Ben's primary builder historically has been
// Brookson, which currently has no recent activity — so this page is
// expected to often be empty. If the job list is empty we surface a small
// advisory banner calling that out so the page doesn't look broken.
//
// We intentionally do NOT filter by builderName here. If Ben picks up
// another builder, his jobs show up automatically; add a
// BEN_BUILDER_PATTERNS list + ILIKE ANY clause if a scope ever needs to
// be enforced.
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
export default async function BenPage(): Promise<JSX.Element> {
  // Feature flag — default ON. Only hides when explicitly disabled.
  if (process.env.NEXT_PUBLIC_FEATURE_BEN_PAGE === 'off') {
    return (
      <div className="max-w-3xl mx-auto p-8">
        <EmptyState
          title="This page is disabled"
          description="The /ben shortcut is turned off via feature flag."
        />
      </div>
    )
  }

  // ── Step 1: Look up Ben's Staff row ──────────────────────────────────
  const staffRows = await prisma.$queryRawUnsafe<StaffRow[]>(
    `SELECT id, "firstName", "lastName"
       FROM "Staff"
      WHERE "firstName" ILIKE $1
        AND "lastName"  ILIKE $2
      LIMIT 1`,
    'Ben',
    'Wilson'
  )

  const staff = staffRows[0]

  if (!staff) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <PageHeader
          eyebrow="PM Book"
          title="Ben's Book"
          description="Could not find Ben Wilson in the Staff directory."
        />
        <Card>
          <CardBody>
            <EmptyState
              icon="users"
              title="Staff record not found"
              description="No active staff row matches 'Ben Wilson'. He may not be set up yet, or his name is spelled differently in Staff."
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

  // ── Step 2: Query his jobs — no builder filter ───────────────────────
  // Historically Brookson was Ben's primary builder; Brookson is currently
  // inactive. We pull every non-CLOSED / non-CANCELLED job assigned to him
  // so anything new shows up automatically. If empty, we render an
  // advisory banner below.
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
        AND j.status::text NOT IN ('CLOSED','CANCELLED')
      ORDER BY j."scheduledDate" ASC NULLS LAST,
               j."jobNumber"     ASC`,
    staff.id
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
        title="Ben's Book"
        description={`Active jobs assigned to ${staff.firstName}. Excludes CLOSED and CANCELLED.`}
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'PM Books', href: '/ops/staff' },
          { label: staff.firstName },
        ]}
      />

      {totalJobs === 0 && (
        <div
          className="rounded-md border px-4 py-3 text-sm"
          style={{
            background: 'var(--surface-2)',
            borderColor: 'var(--border)',
            color: 'var(--fg)',
          }}
          role="status"
        >
          <strong>Heads up:</strong> No active jobs assigned — per Nate&apos;s
          4/24 notes, Ben&apos;s primary builder (Brookson) has no recent
          activity.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Active jobs"
          value={totalJobs}
          accent="brand"
          subtitle="All builders"
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
              description="Ben has no open jobs right now. His primary builder (Brookson) has no recent activity. If a new assignment is expected, verify the PM assignment in InFlow / Bolt."
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
        Scope: all builders · active statuses only (excludes CLOSED, CANCELLED)
      </div>
    </div>
  )
}
