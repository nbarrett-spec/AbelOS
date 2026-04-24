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
import { getStaffSession } from '@/lib/staff-auth'
import { parseRoles } from '@/lib/permissions'
import PmRosterCards, { type RosterPM } from './PmRosterCards'

export const dynamic = 'force-dynamic'

interface RosterResponse {
  asOf: string
  pms: RosterPM[]
  fallbackUsed: boolean
}

interface PmArResponse {
  asOf: string
  pmId: string
  outstanding: number
  overdueCount: number
  aging: {
    '0-30': number
    '31-60': number
    '61-90': number
    '90+': number
  }
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

// ── Per-PM AR snapshot ────────────────────────────────────────────────────
// Loads /api/ops/pm/ar for the *current* viewer (so PMs see only their own
// invoices). Returns null when the viewer isn't a PM or the call fails — the
// section then hides itself rather than blocking the page.
async function loadMyAr(): Promise<PmArResponse | null> {
  const session = await getStaffSession()
  if (!session) return null

  const allRoles = parseRoles(session.roles || session.role)
  const eligible = allRoles.some((r) =>
    ['ADMIN', 'MANAGER', 'PROJECT_MANAGER'].includes(r)
  )
  if (!eligible) return null

  // Build the same forwarded-headers envelope as loadRoster() so the
  // server-side fetch hits middleware with a valid identity.
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
    const res = await fetch(`${proto}://${host}/api/ops/pm/ar`, {
      headers: fwd,
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as PmArResponse
  } catch {
    return null
  }
}

function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
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

  const [data, ar] = await Promise.all([loadRoster(), loadMyAr()])

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

      {ar && <MyArPanel ar={ar} />}

      <PmRosterCards
        pms={data.pms}
        asOf={data.asOf}
        fallbackUsed={data.fallbackUsed}
      />
    </div>
  )
}

// ── My AR — read-only snapshot of the current PM's open invoices ──────────
function MyArPanel({ ar }: { ar: PmArResponse }) {
  const buckets: Array<{ label: string; key: keyof PmArResponse['aging'] }> = [
    { label: '0-30 d', key: '0-30' },
    { label: '31-60 d', key: '31-60' },
    { label: '61-90 d', key: '61-90' },
    { label: '90+ d', key: '90+' },
  ]

  const hasAny = ar.outstanding > 0 || ar.overdueCount > 0

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-base font-semibold">My AR</h2>
          <p className="text-xs text-fg-muted">
            Open invoices on jobs you own — read-only snapshot
          </p>
        </div>
        <span className="text-xs text-fg-subtle font-mono">
          {new Date(ar.asOf).toLocaleString()}
        </span>
      </div>

      {!hasAny ? (
        <p className="text-sm text-fg-muted">
          No open invoices on jobs assigned to you.
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="text-xs text-fg-muted">Outstanding</div>
            <div className="text-lg font-semibold tabular-nums">
              {fmtMoney(ar.outstanding)}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="text-xs text-fg-muted">Overdue</div>
            <div className="text-lg font-semibold tabular-nums">
              {ar.overdueCount}
            </div>
          </div>
          {buckets.map((b) => (
            <div
              key={b.key}
              className="rounded-lg border border-border bg-surface p-3"
            >
              <div className="text-xs text-fg-muted">{b.label}</div>
              <div className="text-lg font-semibold tabular-nums">
                {ar.aging[b.key]}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
