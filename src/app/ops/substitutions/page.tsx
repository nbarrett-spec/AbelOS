// /ops/substitutions — substitutions hub (two tabs).
//
// Server component that loads the initial PM approval-queue payload from
// /api/ops/substitutions (scope=mine by default), then delegates the UI to
// SubstitutionsTabs which exposes:
//   1. "Approval queue" — the existing PM-scoped review flow
//      (SubstitutionQueue.tsx — unchanged behavior).
//   2. "Catalog browse" — search products with active substitutes, filter
//      by low/out-of-stock, apply a substitute on a job, bulk apply, and
//      view a recent audit trail. Drives /api/ops/substitutions/catalog,
//      /api/ops/substitutions/audit, and the canonical apply endpoint
//      POST /api/ops/products/[productId]/substitutes/apply.
//
// Distinct from /ops/substitutions/requests (the older full-history queue).

import { cookies, headers } from 'next/headers'
import { notFound } from 'next/navigation'
import SubstitutionsTabs from './SubstitutionsTabs'
import type { QueueRequest, QueueCounts } from './SubstitutionQueue'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Substitutions · Aegis',
  description:
    'PM approval queue and substitution catalog browse for ops staff.',
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
      <SubstitutionsTabs
        initial={data}
        initialError={error}
        staffRole={staffRole}
        staffId={staffId}
      />
    </div>
  )
}
