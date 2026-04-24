import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * /ops/my-book — zero-UI shortcut that redirects the logged-in PM to their
 * own PM book at /ops/pm/book/[their-staffId]. Bookmark this once and forever
 * land on your own book without knowing your staffId.
 *
 * Auth: middleware attaches x-staff-id from the staff JWT for all /ops/* routes.
 */
export default function MyBookPage() {
  const h = headers()
  const staffId = h.get('x-staff-id')

  if (!staffId) {
    // Defensive — middleware should have already redirected unauthenticated
    // users to /ops/login before reaching this server component.
    redirect('/ops/login?redirect=/ops/my-book')
  }

  redirect(`/ops/pm/book/${staffId}`)
}
