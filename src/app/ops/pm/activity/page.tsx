// ─────────────────────────────────────────────────────────────────────────────
// /ops/pm/activity — standalone "What changed since I last looked" page.
//
// Server component. Reads x-staff-id from middleware-injected headers and
// renders the <PmActivityFeed/> client component scoped to that staffId.
//
// URL params:
//   ?since=ISO   — override the 24h default window (forwarded to the feed)
//
// Feature flag: NEXT_PUBLIC_FEATURE_PM_ACTIVITY_FEED !== 'off'  (default ON).
// Auth: middleware on /ops/* handles session — if x-staff-id is missing we
// redirect to /ops/login with a ?redirect back to this page.
// ─────────────────────────────────────────────────────────────────────────────

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { PageHeader, StatusDot } from '@/components/ui'
import PmActivityFeed from '@/components/pm/PmActivityFeed'
import { prisma } from '@/lib/prisma'
import { Activity } from 'lucide-react'

export const dynamic = 'force-dynamic'

function featureFlagOff(): boolean {
  return process.env.NEXT_PUBLIC_FEATURE_PM_ACTIVITY_FEED === 'off'
}

interface PageProps {
  searchParams?: { since?: string }
}

export default async function PMActivityPage({ searchParams }: PageProps) {
  if (featureFlagOff()) {
    return (
      <div className="p-6">
        <div className="glass-card p-6 text-center">
          <h1 className="text-lg font-semibold mb-2">
            Activity feed is disabled
          </h1>
          <p className="text-sm text-fg-muted">
            The PM activity feed is currently turned off
            (NEXT_PUBLIC_FEATURE_PM_ACTIVITY_FEED=off). Clear the flag to
            re-enable.
          </p>
        </div>
      </div>
    )
  }

  const h = headers()
  const staffId = h.get('x-staff-id')

  if (!staffId) {
    // Middleware should already gate /ops/*, but keep a defensive redirect so
    // direct hits without a session land on login, not a blank page.
    redirect('/ops/login?redirect=/ops/pm/activity')
  }

  // Fetch staff name for the header — best-effort, never block rendering.
  let displayName = ''
  try {
    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
      select: { firstName: true, lastName: true },
    })
    if (staff) {
      displayName = `${staff.firstName} ${staff.lastName}`.trim()
    }
  } catch {
    /* ignore — header falls back to generic label */
  }

  const since = searchParams?.since
  const windowLabel = since
    ? (() => {
        const t = Date.parse(since)
        if (!Number.isFinite(t)) return 'last 24h'
        const diffH = Math.round((Date.now() - t) / 3600000)
        if (diffH < 24) return `last ${diffH}h`
        return `last ${Math.round(diffH / 24)}d`
      })()
    : 'last 24h'

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <PageHeader
        eyebrow="PM Activity"
        title={displayName ? `${displayName} — Activity` : 'Your activity feed'}
        description={`What changed in the ${windowLabel}. Updates live every 60s.`}
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'PM', href: '/ops/portal/pm' },
          { label: 'Activity' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <StatusDot tone="active" label="live" />
            <span className="text-xs text-fg-muted font-mono">LIVE</span>
          </div>
        }
      />

      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <Activity className="w-3.5 h-3.5" />
        <span>
          Scoped to jobs assigned to you. Change orders, material status,
          inbound emails, deliveries, install milestones, and agent alerts.
        </span>
      </div>

      <div className="glass-card p-5">
        <PmActivityFeed staffId={staffId} since={since} />
      </div>

      <div className="flex items-center justify-between text-xs text-fg-muted pt-2">
        <span>
          Data source:{' '}
          <Link
            href={`/api/ops/pm/activity${since ? `?since=${encodeURIComponent(since)}` : ''}`}
            className="underline hover:text-fg"
          >
            /api/ops/pm/activity
          </Link>
        </span>
        <Link href="/ops/portal/pm" className="underline hover:text-fg">
          Back to PM portal →
        </Link>
      </div>
    </div>
  )
}
