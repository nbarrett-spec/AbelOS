/**
 * Builder Portal — Schedule.
 *
 * Phase 3 of BUILDER-PORTAL-SPEC.md (§4.6).
 *
 * Server fetches both /api/builder/schedule (jobs + schedule entries +
 * deliveries grouped per job) and /api/builder/deliveries (deliveries
 * grouped by upcoming/in-transit/completed). The client renders:
 *   - Week navigator with calendar grid
 *   - Upcoming deliveries list (with Track + Reschedule actions)
 *   - In-transit ribbon (BorderBeam-style accent)
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import type { DeliveriesResponse } from '@/types/portal'
import {
  ScheduleClient,
  type ScheduleResponse,
} from './_ScheduleClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Schedule',
  description: 'Deliveries, installs, and jobs at a glance.',
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const cookieStore = await cookies()
    const headerStore = await headers()
    const proto =
      headerStore.get('x-forwarded-proto') ||
      (process.env.NODE_ENV === 'production' ? 'https' : 'http')
    const host =
      headerStore.get('x-forwarded-host') ||
      headerStore.get('host') ||
      `localhost:${process.env.PORT || 3000}`
    const url = `${proto}://${host}${path}`
    const res = await fetch(url, {
      headers: { cookie: cookieStore.toString() },
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export default async function PortalSchedulePage() {
  const session = await getSession()
  if (!session) return null

  const [schedule, deliveries] = await Promise.all([
    fetchJson<ScheduleResponse>('/api/builder/schedule'),
    fetchJson<DeliveriesResponse>('/api/builder/deliveries'),
  ])

  return (
    <Suspense fallback={null}>
      <ScheduleClient
        schedule={schedule}
        deliveries={deliveries ?? { upcoming: [], in_transit: [], completed: [], all: [] }}
      />
    </Suspense>
  )
}
