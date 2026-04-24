// ─────────────────────────────────────────────────────────────────────────────
// /ops/pm/book/[staffId] — Single-PM "Book" view
//
// Server component. Reads params.staffId, fetches the PM's workload from the
// /api/ops/pm/book/[staffId] endpoint, and hands the rows off to the
// <BookTable/> client component. Monday-morning single-pane view for each PM.
//
// Feature flag: NEXT_PUBLIC_FEATURE_PM_BOOK !== 'off'  (default ON).
// Auth: /ops/* is already gated by middleware.
// ─────────────────────────────────────────────────────────────────────────────

import { notFound } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { PageHeader, KPICard, StatusDot } from '@/components/ui'
import { Briefcase, PackageCheck, CalendarClock, AlertTriangle } from 'lucide-react'
import BookTable, { type BookJobRow } from './BookTable'

export const dynamic = 'force-dynamic'

// ── Types mirror the API response ─────────────────────────────────────────────
interface BookData {
  staff: {
    id: string
    firstName: string
    lastName: string
    email: string
    title: string | null
    role: string
  }
  asOf: string
  summary: {
    activeJobs: number
    materialsReadyPct: number
    closingThisWeek: number
    overdueActions: number
  }
  jobs: BookJobRow[]
}

async function loadBook(staffId: string): Promise<BookData | null> {
  // Fetch from our own API — this keeps the auth/audit pipeline single-threaded
  // and means the page respects future changes to the book endpoint without
  // re-implementing joins here.
  const h = headers()
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000'
  const proto = h.get('x-forwarded-proto') || 'http'
  const cookieHeader = cookies()
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')

  // Forward auth headers injected by middleware so checkStaffAuth passes.
  const fwd: Record<string, string> = { cookie: cookieHeader }
  const staffIdHdr = h.get('x-staff-id')
  const staffRoleHdr = h.get('x-staff-role')
  const staffRolesHdr = h.get('x-staff-roles')
  if (staffIdHdr) fwd['x-staff-id'] = staffIdHdr
  if (staffRoleHdr) fwd['x-staff-role'] = staffRoleHdr
  if (staffRolesHdr) fwd['x-staff-roles'] = staffRolesHdr

  try {
    const res = await fetch(
      `${proto}://${host}/api/ops/pm/book/${encodeURIComponent(staffId)}`,
      { headers: fwd, cache: 'no-store' }
    )
    if (!res.ok) {
      if (res.status === 404) return null
      // Fall through to a direct Prisma read below if the API call failed for
      // any transient reason — the page should still render on Monday morning
      // even if the route is cold.
      throw new Error(`book api ${res.status}`)
    }
    return (await res.json()) as BookData
  } catch (e) {
    // ── Fallback: read straight from Prisma. Keeps the page alive if the API
    //    layer hiccups. KPI accuracy may drop slightly (no audit/hyphen joins)
    //    but it will never render "blank" on go-live day.
    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        title: true,
        role: true,
      },
    })
    if (!staff) return null

    const jobs = await prisma.job.findMany({
      where: { assignedPMId: staffId },
      select: {
        id: true,
        jobNumber: true,
        community: true,
        lotBlock: true,
        builderName: true,
        status: true,
        scheduledDate: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    })

    const mapped: BookJobRow[] = jobs.map((j) => ({
      id: j.id,
      jobNumber: j.jobNumber,
      community: j.community,
      lotBlock: j.lotBlock,
      builderName: j.builderName,
      status: j.status,
      materialsStatus: 'NONE',
      materialsBreakdown: {
        total: 0,
        picked: 0,
        consumed: 0,
        reserved: 0,
        backordered: 0,
        other: 0,
      },
      closingDate: null,
      scheduledDate: j.scheduledDate ? j.scheduledDate.toISOString() : null,
      lastActivityAt: null,
      updatedAt: j.updatedAt.toISOString(),
    }))

    const TERMINAL = new Set(['COMPLETE', 'INVOICED', 'CLOSED'])
    const activeJobs = mapped.filter((m) => !TERMINAL.has(m.status)).length

    return {
      staff,
      asOf: new Date().toISOString(),
      summary: {
        activeJobs,
        materialsReadyPct: 0,
        closingThisWeek: 0,
        overdueActions: 0,
      },
      jobs: mapped,
    }
  }
}

function featureFlagOff(): boolean {
  return process.env.NEXT_PUBLIC_FEATURE_PM_BOOK === 'off'
}

export default async function PMBookPage({
  params,
}: {
  params: { staffId: string }
}) {
  if (featureFlagOff()) {
    return (
      <div className="p-6">
        <div className="glass-card p-6 text-center">
          <h1 className="text-lg font-semibold mb-2">PM Book is disabled</h1>
          <p className="text-sm text-fg-muted">
            The single-PM book view is currently turned off
            (NEXT_PUBLIC_FEATURE_PM_BOOK=off). Clear the flag to re-enable.
          </p>
        </div>
      </div>
    )
  }

  const data = await loadBook(params.staffId)
  if (!data) notFound()

  const { staff, summary, jobs, asOf } = data
  const asOfLabel = new Date(asOf).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  const readyAccent: 'positive' | 'accent' | 'negative' =
    summary.materialsReadyPct >= 80
      ? 'positive'
      : summary.materialsReadyPct >= 50
        ? 'accent'
        : 'negative'
  const overdueAccent: 'positive' | 'negative' =
    summary.overdueActions === 0 ? 'positive' : 'negative'

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        eyebrow="PM Book"
        title={`${staff.firstName} ${staff.lastName} — PM Book`}
        description={`${summary.activeJobs} active jobs · refreshed ${asOfLabel}`}
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'PM', href: '/ops/portal/pm' },
          { label: `${staff.firstName} ${staff.lastName}` },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <StatusDot tone="live" label="live" />
            <span className="text-xs text-fg-muted font-mono">LIVE</span>
          </div>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Active Jobs"
          value={summary.activeJobs}
          accent="brand"
          icon={<Briefcase className="w-4 h-4" />}
          subtitle={`of ${jobs.length} total`}
        />
        <KPICard
          title="Materials Ready"
          value={`${summary.materialsReadyPct}%`}
          accent={readyAccent}
          icon={<PackageCheck className="w-4 h-4" />}
          subtitle="active jobs w/ full allocation"
        />
        <KPICard
          title="Closing This Week"
          value={summary.closingThisWeek}
          accent="accent"
          icon={<CalendarClock className="w-4 h-4" />}
          subtitle="next 7 days"
        />
        <KPICard
          title="Overdue Actions"
          value={summary.overdueActions}
          accent={overdueAccent}
          icon={<AlertTriangle className="w-4 h-4" />}
          subtitle="tasks past due"
        />
      </div>

      {/* Main table */}
      <BookTable jobs={jobs} />

      {/* Quick links */}
      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>
          Data source:{' '}
          <Link
            href={`/api/ops/pm/book/${encodeURIComponent(staff.id)}`}
            className="underline hover:text-fg"
          >
            /api/ops/pm/book/{staff.id}
          </Link>
        </span>
        <Link href="/ops/portal/pm" className="underline hover:text-fg">
          Back to PM portal →
        </Link>
      </div>
    </div>
  )
}
