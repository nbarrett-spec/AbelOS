/**
 * Server-side feature flag resolver — for API routes and server components.
 *
 * Resolution precedence (first defined value wins):
 *   1. Per-user pref on Staff.preferences.featureFlags[name]  (if userId provided)
 *   2. Build-time env  NEXT_PUBLIC_{NAME}
 *   3. Default false
 *
 * This module intentionally has no client-only deps. Safe to import from
 * any route handler or server component.
 */

type StaffPreferences = {
  featureFlags?: Record<string, boolean>
  [k: string]: unknown
}

const ENV_FLAGS: Record<string, string | undefined> = {
  AEGIS_V2_DRAFTING_ROOM: process.env.NEXT_PUBLIC_AEGIS_V2_DRAFTING_ROOM,
}

function truthy(v: string | undefined | null | boolean): boolean {
  if (v === true) return true
  if (v === false || v == null) return false
  const s = String(v).toLowerCase().trim()
  return s === '1' || s === 'true' || s === 'on' || s === 'yes'
}

/**
 * Check whether a feature flag is enabled, optionally for a specific user.
 *
 * If `userId` is passed, we look up Staff.preferences lazily via Prisma.
 * Prisma is imported dynamically so this module stays cheap to import in
 * contexts that don't need a DB hit.
 */
export async function isFeatureEnabled(
  flagName: string,
  userId?: string | null,
): Promise<boolean> {
  if (userId) {
    try {
      const { prisma } = await import('@/lib/prisma')
      // Staff.preferences is a Json? column (see pending_staff_preferences.sql).
      // We select it with `any` to avoid a hard type coupling before the
      // migration is applied — once it runs, TS picks up the new field.
      const staff = (await (prisma as unknown as {
        staff: { findUnique: (args: unknown) => Promise<unknown> }
      }).staff.findUnique({
        where: { id: userId },
        select: { preferences: true },
      })) as { preferences?: StaffPreferences | null } | null

      const v = staff?.preferences?.featureFlags?.[flagName]
      if (typeof v === 'boolean') return v
    } catch {
      // Prisma field may not exist yet (migration pending) — fall through to env.
    }
  }

  return truthy(ENV_FLAGS[flagName])
}

/**
 * Synchronous env-only check. Useful for route handlers where we don't
 * want to hit the DB.
 */
export function isFeatureEnabledEnv(flagName: string): boolean {
  return truthy(ENV_FLAGS[flagName])
}
