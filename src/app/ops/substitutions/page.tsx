// /ops/substitutions — PM substitution approval queue.
//
// Server component that fetches the initial queue payload from
// /api/ops/substitutions (scope=mine by default) and hands it to the
// SubstitutionQueue client component. Approve/reject flows POST to the
// existing /api/ops/substitutions/requests/[id]/approve and /reject
// routes — this page is read-only except for triggering those.
//
// Distinct from /ops/substitutions/requests (the older full-history queue).
// This page is builder-PM-scoped with a filter bar, days-pending sort, and
// a side-drawer review experience.

import { cookies, headers } from 'next/headers'
import { notFound } from 'next/navigation'
import SubstitutionQueue, {
  type QueueRequest,
  type QueueCounts,
} from './SubstitutionQueue'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Substitution Requests · Aegis',
  description: 'PM approval queue for pending substitution requests.',
}

interface ApiResponse {
  scope: 'mine' | 'all'
  status: string
  count: number
  requests: QueueRequest[]
  counts: QueueCounts
  initialized?: boolean
  error?: string
}

async function loadInitial(): Promise<{
  data: ApiResponse | null
  error: string | null
  staffRole: string
  staffId: string
}> {
  try {
    const h = await headers()
    const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000'
    const proto = h.get('x-forwarded-proto') || 'http'
    const url = `${proto}://${host}/api/ops/substitutions?scope=mine&status=QUEUE`

    const staffRole = h.get('x-staff-role') || ''
    const staffRoles = h.get('x-staff-roles') || ''
    const staffId = h.get('x-staff-id') || ''

    const c = await cookies()
    const cookieHeader = c
      .getAll()
      .map((x) => `${x.name}=${x.value}`)
      .join('; ')

    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        cookie: cookieHeader,
        'x-staff-id': staffId,
        'x-staff-role': staffRole,
        'x-staff-roles': staffRoles,
        'x-staff-department': h.get('x-staff-department') || '',
        'x-staff-email': h.get('x-staff-email') || '',
      },
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return {
        data: null,
        error: body?.error || `HTTP ${res.status}`,
        staffRole: staffRoles || staffRole,
        staffId,
      }
    }
    const json = (await res.json()) as ApiResponse
    return {
      data: json,
      error: null,
      staffRole: staffRoles || staffRole,
      staffId,
    }
  } catch (err: any) {
    return {
      data: null,
      error: err?.message || 'Failed to load substitution queue',
      staffRole: '',
      staffId: '',
    }
  }
}

export default async function SubstitutionsQueuePage() {
  // Feature flag — default ON. Explicit "off" hides the page entirely.
  if (process.env.NEXT_PUBLIC_FEATURE_SUB_QUEUE === 'off') {
    notFound()
  }

  const { data, error, staffRole, staffId } = await loadInitial()

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
      <SubstitutionQueue
        initial={data}
        initialError={error}
        staffRole={staffRole}
        staffId={staffId}
      />
    </div>
  )
}
