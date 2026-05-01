/**
 * Builder Portal — Settings.
 *
 * Phase 4 of BUILDER-PORTAL-SPEC.md (§4.12).
 *
 * v1 surface area:
 *   - Company Info (read-only from session/builder record)
 *   - Notification Preferences (toggles persisted to localStorage —
 *     real per-user preferences live in BuilderContact and need a server
 *     endpoint that doesn't yet exist; defer to v2)
 *   - Branding link → /portal/settings/branding (existing page)
 *   - Sign-out button
 */

import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  SettingsClient,
  type BuilderProfile,
} from './_SettingsClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Account, notifications, and branding.',
}

async function fetchProfile(builderId: string): Promise<BuilderProfile | null> {
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT "companyName", "contactName", email, phone, "pricingTier", "logoUrl"
         FROM "Builder"
        WHERE id = $1
        LIMIT 1`,
      builderId,
    )) as Array<{
      companyName: string | null
      contactName: string | null
      email: string | null
      phone: string | null
      pricingTier: string | null
      logoUrl: string | null
    }>
    return rows[0] || null
  } catch {
    return null
  }
}

export default async function PortalSettingsPage() {
  const session = await getSession()
  if (!session) return null

  const profile = await fetchProfile(session.builderId)

  return (
    <Suspense fallback={null}>
      <SettingsClient
        profile={
          profile ?? {
            companyName: session.companyName,
            contactName: null,
            email: session.email,
            phone: null,
            pricingTier: null,
            logoUrl: null,
          }
        }
      />
    </Suspense>
  )
}
