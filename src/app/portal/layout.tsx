/**
 * Builder Portal — root layout (server component).
 *
 * Phase 1 of BUILDER-PORTAL-SPEC.md (§1 Layout Shell).
 *
 * Server responsibilities:
 *   1. Auth gate — read abel_session via getSession(); redirect to /login on miss
 *   2. Hydrate the PortalSession (builder + matching BuilderContact +
 *      portalRole computed default)
 *   3. Fetch communities visible to this builder for the topbar selector
 *   4. Wrap children in <PortalProvider> + <PortalShell>
 *
 * Notification fetching is intentionally deferred to Phase 2 (will use the
 * derived getBuilderNotifications() server function from spec §0.3).
 */

import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PortalProvider } from '@/components/portal/PortalContext'
import { PortalShell } from '@/components/portal/PortalShell'
import type {
  PortalCommunity,
  PortalRole,
  PortalSession,
} from '@/types/portal'
import { getDataPortalAttribute } from './_internal/data-portal'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: { default: 'Abel Portal', template: '%s | Abel Portal' },
  description: 'Manage your orders, catalog, and deliveries with Abel Lumber.',
}

/** Map ContactRole → default PortalRole when the contact has no explicit value. */
function defaultPortalRole(contactRole: string | null): PortalRole {
  if (contactRole === 'OWNER' || contactRole === 'DIVISION_VP') return 'EXECUTIVE'
  return 'PM'
}

async function loadPortalContext(): Promise<{
  session: PortalSession
  communities: PortalCommunity[]
} | null> {
  const sessionPayload = await getSession()
  if (!sessionPayload?.builderId) return null

  // Best-effort lookup of the BuilderContact matching the session email.
  // If not found, we still render the portal — the contact pieces just go
  // null and the role defaults to PM. This avoids locking out a freshly
  // self-registered builder.
  let contact: {
    id: string
    firstName: string
    lastName: string
    role: string | null
    portalRole: string | null
  } | null = null

  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT id, "firstName", "lastName", role::text AS role,
              "portalRole"::text AS "portalRole"
         FROM "BuilderContact"
        WHERE "builderId" = $1
          AND email = $2
          AND active = true
        LIMIT 1`,
      sessionPayload.builderId,
      sessionPayload.email,
    )) as Array<{
      id: string
      firstName: string
      lastName: string
      role: string | null
      portalRole: string | null
    }>
    contact = rows[0] || null
  } catch {
    // BuilderContact.portalRole column may not exist yet (migration not applied).
    // Re-try without it; the field defaults to PM at the type level.
    try {
      const rows = (await prisma.$queryRawUnsafe(
        `SELECT id, "firstName", "lastName", role::text AS role
           FROM "BuilderContact"
          WHERE "builderId" = $1
            AND email = $2
            AND active = true
          LIMIT 1`,
        sessionPayload.builderId,
        sessionPayload.email,
      )) as Array<{
        id: string
        firstName: string
        lastName: string
        role: string | null
      }>
      contact = rows[0] ? { ...rows[0], portalRole: null } : null
    } catch {
      contact = null
    }
  }

  const portalRole: PortalRole =
    contact?.portalRole === 'EXECUTIVE' ||
    contact?.portalRole === 'ADMIN' ||
    contact?.portalRole === 'PM'
      ? (contact.portalRole as PortalRole)
      : defaultPortalRole(contact?.role ?? null)

  // Communities owned by this builder (for the topbar selector).
  let communities: PortalCommunity[] = []
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT id, name, city, state
         FROM "Community"
        WHERE "builderId" = $1
        ORDER BY name ASC`,
      sessionPayload.builderId,
    )) as PortalCommunity[]
    communities = rows
  } catch {
    communities = []
  }

  const session: PortalSession = {
    builderId: sessionPayload.builderId,
    contactId: contact?.id ?? null,
    email: sessionPayload.email,
    companyName: sessionPayload.companyName,
    contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : null,
    portalRole,
  }

  return { session, communities }
}

export default async function PortalRootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ctx = await loadPortalContext()
  if (!ctx) {
    // No valid session — middleware should have redirected, but defense in
    // depth covers the edge case where the cookie is present but malformed.
    redirect('/login?next=/portal')
  }

  return (
    // The Mockup-3 multi-layer background (warm canvas + radial washes
    // + 24px blueprint grid) is now painted via the [data-portal] CSS
    // block in globals.css. Don't override it with inline styles here.
    <div {...getDataPortalAttribute()} style={{ minHeight: '100vh' }}>
      <PortalProvider session={ctx.session} communities={ctx.communities}>
        <PortalShell>{children}</PortalShell>
      </PortalProvider>
    </div>
  )
}
