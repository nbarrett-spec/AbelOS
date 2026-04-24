// ─────────────────────────────────────────────────────────────────────────────
// /ops/pm — Project Managers landing page (roster of all active PMs)
//
// Server component. Fetches /api/ops/pm/roster, hands the PM list off to
// <PmRosterCards/>. Each card links into /ops/pm/book/[staffId].
//
// Feature flag: NEXT_PUBLIC_FEATURE_PM_ROSTER !== 'off'  (default ON).
// Auth: /ops/* is already gated by middleware.
//
// Fallback: if the API fails or is cold on first paint, we fall back to a
// direct Prisma read of active PMs with zeroed KPIs — the page still renders
// so nav stays predictable.
// ─────────────────────────────────────────────────────────────────────────────

import { cookies, headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { PageHeader, StatusDot } from '@/components/ui'
import PmRosterCards, { type RosterPM } from './PmRosterCards'

export const dynamic = 'force-dynamic'

interface RosterResponse {
  asOf: string
  pms: RosterPM[]
  fallbackUsed: boolean
}

async function loadRoster(): Promise<RosterResponse> {
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
    const res = await fetch(`${proto}://${host}/api/ops/pm/roster`, {
      headers: fwd,
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`roster api ${res.status}`)
    return (await res.json()) as RosterResponse
  } catch (e) {
    // ── Fallback: direct Prisma read (role-based only, zero KPIs). Keeps
    //    the page alive if the API hiccups on cold start.
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
      return {
        asOf: new Date().toISOString(),
        pms: staff.map((s) => ({
          id: s.id,
          firstName: s.firstName,
          lastName: s.lastName,
          email: s.email,
          title: s.title,
          role: s.role,
          activeJobs: 0,
          materialsReadyPct: 0,
          closingThisWeek: 0,
          overdueTasks: 0,
        })),
        fallbackUsed: true,
      }
    } catch {
      return { asOf: new Date().toISOString(), pms: [], fallbackUsed: true }
    }
  }
}

function featureFlagOff(): boolean {
  return process.env.NEXT_PUBLIC_FEATURE_PM_ROSTER === 'off'
}

export default async function PMRosterPage() {
  if (featureFlagOff()) {
    return (
      <div className="p-6">
        <div className="glass-card p-6 text-center">
          <h1 className="text-lg font-semibold mb-2">PM Roster is disabled</h1>
          <p className="text-sm text-fg-muted">
            The PM roster view is currently turned off
            (NEXT_PUBLIC_FEATURE_PM_ROSTER=off). Clear the flag to re-enable.
          </p>
        </div>
      </div>
    )
  }

  const data = await loadRoster()

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        eyebrow="Ops"
        title="Project Managers"
        description="Monday workload snapshot — click a PM to open their book"
        crumbs={[{ label: 'Ops', href: '/ops' }, { label: 'Project Managers' }]}
        actions={
          <div className="flex items-center gap-2">
            <StatusDot tone="live" label="live" />
            <span className="text-xs text-fg-muted font-mono">LIVE</span>
          </div>
        }
      />

      <PmRosterCards
        pms={data.pms}
        asOf={data.asOf}
        fallbackUsed={data.fallbackUsed}
      />
    </div>
  )
}
