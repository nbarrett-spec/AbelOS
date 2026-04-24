// ─────────────────────────────────────────────────────────────────────────────
// /ops/today — PM "what's happening today + tomorrow" dashboard
//
// Server component. Auto-scopes to the logged-in staff member (reads x-staff-id
// from middleware-injected headers). Renders the shell + KPI row on the server
// so the page appears instantly, and hands the interactive sections off to
// <TodayDashboard/> which handles the client-side refresh + Mark-Done buttons.
//
// Feature flag: NEXT_PUBLIC_FEATURE_PM_TODAY  — unset = on, "off" = disable.
// Auth: /ops/* is already gated by middleware.
// ─────────────────────────────────────────────────────────────────────────────

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { PageHeader, StatusDot } from '@/components/ui'
import TodayDashboard, { type TodayData } from './TodayDashboard'

export const dynamic = 'force-dynamic'

function featureFlagOff(): boolean {
  return process.env.NEXT_PUBLIC_FEATURE_PM_TODAY === 'off'
}

async function loadToday(): Promise<TodayData | null> {
  const h = headers()
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000'
  const proto = h.get('x-forwarded-proto') || 'http'

  const cookieHeader = cookies()
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')

  // Forward the auth headers so the API's checkStaffAuth gate passes.
  const fwd: Record<string, string> = { cookie: cookieHeader }
  const staffIdHdr = h.get('x-staff-id')
  const staffRoleHdr = h.get('x-staff-role')
  const staffRolesHdr = h.get('x-staff-roles')
  const staffEmailHdr = h.get('x-staff-email')
  const staffDeptHdr = h.get('x-staff-department')
  if (staffIdHdr) fwd['x-staff-id'] = staffIdHdr
  if (staffRoleHdr) fwd['x-staff-role'] = staffRoleHdr
  if (staffRolesHdr) fwd['x-staff-roles'] = staffRolesHdr
  if (staffEmailHdr) fwd['x-staff-email'] = staffEmailHdr
  if (staffDeptHdr) fwd['x-staff-department'] = staffDeptHdr

  try {
    const res = await fetch(`${proto}://${host}/api/ops/pm/today`, {
      headers: fwd,
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as TodayData
  } catch (e) {
    console.warn('[PM Today] initial load failed, falling through to client fetch:', e)
    return null
  }
}

function formatHeaderDate(iso?: string) {
  const d = iso ? new Date(iso) : new Date()
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Chicago',
  })
}

export default async function PMTodayPage() {
  if (featureFlagOff()) {
    return (
      <div className="p-6">
        <div className="glass-card p-6 text-center">
          <h1 className="text-lg font-semibold mb-2">PM Today is disabled</h1>
          <p className="text-sm text-fg-muted">
            The PM Today dashboard is currently turned off
            (NEXT_PUBLIC_FEATURE_PM_TODAY=off). Clear the flag to re-enable.
          </p>
        </div>
      </div>
    )
  }

  // If the auth header hasn't propagated (edge case: direct navigation before
  // middleware has run), bounce to login. Normal case: middleware ensures we
  // always have x-staff-id.
  const h = headers()
  if (!h.get('x-staff-id')) {
    redirect('/login?next=/ops/today')
  }

  const initial = await loadToday()

  const firstName = initial?.staff?.firstName ?? 'PM'
  const dateLabel = formatHeaderDate(initial?.asOf)

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        eyebrow="PM Today"
        title={`Today — ${dateLabel} — ${firstName}'s Plan`}
        description="What's happening today and tomorrow — auto-scoped to you."
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Today' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <StatusDot tone="live" label="live" />
            <span className="text-xs text-fg-muted font-mono">LIVE</span>
          </div>
        }
      />

      <TodayDashboard initial={initial} />
    </div>
  )
}
