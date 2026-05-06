export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { triggerCronByName } from '@/lib/cron-health'

// POST /api/ops/admin/crons/[name]/trigger
//
// Path-based cron trigger. ADMIN-only. Mirrors the body-based POST on
// /api/ops/admin/crons{ name } so callers can choose either shape; both
// paths share the triggerCronByName() helper in the parent route file.
//
// Auth flow is layered:
//   1. checkStaffAuthWithFallback enforces /api/ops/admin/* prefix
//      (ADMIN via API_ACCESS in permissions.ts).
//   2. triggerCronByName re-checks ADMIN from the role header — defensive
//      since this proxy hits the cron handler with CRON_SECRET, which is the
//      most privileged credential we have.
//
// Returns the upstream cron-handler response verbatim (status + body proxied).

export async function POST(
  request: NextRequest,
  context: { params: { name: string } }
) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  const name = decodeURIComponent(context.params.name || '').trim()
  return triggerCronByName(request, name)
}
