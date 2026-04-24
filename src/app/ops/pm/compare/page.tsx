// ─────────────────────────────────────────────────────────────────────────────
// /ops/pm/compare — Multi-PM Comparison page
//
// Server component. Fetches /api/ops/pm/compare, hands the PM array off to
// <ComparisonTable/>. Exec-level single-pane view answering "who's overloaded
// / who needs help / whose book is in the best/worst shape."
//
// Complements /ops/pm (card-based roster, D1) — the card view is great for
// browsing; this view is for side-by-side comparison and CSV export.
//
// Feature flag: NEXT_PUBLIC_FEATURE_PM_COMPARE !== 'off'  (default ON).
// Auth: /ops/* is already gated by middleware.
//
// Fallback: if the API fails or is cold on first paint, we fall back to a
// direct Prisma read of active PMs with zeroed metrics so the page still
// renders.
// ─────────────────────────────────────────────────────────────────────────────

import { cookies, headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { PageHeader, StatusDot } from '@/components/ui'
import ComparisonTable, { type ComparePM } from './ComparisonTable'

export const dynamic = 'force-dynamic'

interface CompareResponse {
  asOf: string
  monthKey: string
  pms: ComparePM[]
  fallbackUsed: boolean
}

async function loadCompare(): Promise<CompareResponse> {
  const h = headers()
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000'
  const proto = h.get('x-forwarded-proto') || 'http'
  const cookieHeader = cookies()
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')

  const fwd: Record<string, string> = { cookie: cookieHeader }
  const staffIdHdr = h.get('x-staff-id')
  const staffRoleHdr = h.get('x-staff-role')
  const staffRolesHdr = h.get('x-staff-roles')
  if (staffIdHdr) fwd['x-staff-id'] = staffIdHdr
  if (staffRoleHdr) fwd['x-staff-role'] = staffRoleHdr
  if (staffRolesHdr) fwd['x-staff-roles'] = staffRolesHdr

  try {
    const res = await fetch(`${proto}://${host}/api/ops/pm/compare`, {
      headers: fwd,
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`compare api ${res.status}`)
    return (await res.json()) as CompareResponse
  } catch (e) {
    // ── Fallback: direct Prisma read with zeroed metrics. Keeps the page
    //    alive if the API hiccups on cold start.
    try {
      const staff = await prisma.staff.findMany({
        where: {
          active: true,
          OR: [
            { role: 'PROJECT_MANAGER' },
            { department: 'PROJECT_MANAGEMENT' },
            { title: { contains: 'Project Manager', mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          title: true,
          role: true,
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      })
      const now = new Date()
      const y = now.getUTCFullYear()
      const m = String(now.getUTCMonth() + 1).padStart(2, '0')
      return {
        asOf: now.toISOString(),
        monthKey: `${y}-${m}`,
        pms: staff.map((s) => ({
          staffId: s.id,
          firstName: s.firstName,
          lastName: s.lastName,
          email: s.email,
          title: s.title,
          role: s.role,
          activeJobs: 0,
          totalJobDollars: 0,
          materialsReadyPct: 0,
          redJobs: 0,
          overdueTasks: 0,
          closingsThisWeek: 0,
          avgDaysToClose: null,
          ytdCompleted: 0,
        })),
        fallbackUsed: true,
      }
    } catch {
      const now = new Date()
      const y = now.getUTCFullYear()
      const m = String(now.getUTCMonth() + 1).padStart(2, '0')
      return {
        asOf: now.toISOString(),
        monthKey: `${y}-${m}`,
        pms: [],
        fallbackUsed: true,
      }
    }
  }
}

function featureFlagOff(): boolean {
  return process.env.NEXT_PUBLIC_FEATURE_PM_COMPARE === 'off'
}

export default async function PMComparePage() {
  if (featureFlagOff()) {
    return (
      <div className="p-6">
        <div className="glass-card p-6 text-center">
          <h1 className="text-lg font-semibold mb-2">PM Comparison is disabled</h1>
          <p className="text-sm text-fg-muted">
            The PM comparison view is currently turned off
            (NEXT_PUBLIC_FEATURE_PM_COMPARE=off). Clear the flag to re-enable.
          </p>
        </div>
      </div>
    )
  }

  const data = await loadCompare()
  const h = headers()
  const viewerStaffId = h.get('x-staff-id') || null

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        eyebrow="Ops"
        title={`PM Comparison — ${data.monthKey}`}
        description="Side-by-side metrics — click any row to open that PM's book"
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Project Managers', href: '/ops/pm' },
          { label: 'Comparison' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <StatusDot tone="live" label="live" />
            <span className="text-xs text-fg-muted font-mono">LIVE</span>
          </div>
        }
      />

      <ComparisonTable
        pms={data.pms}
        asOf={data.asOf}
        monthKey={data.monthKey}
        fallbackUsed={data.fallbackUsed}
        viewerStaffId={viewerStaffId}
      />
    </div>
  )
}
