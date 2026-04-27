/**
 * System Automations — toggle helper for hard-coded cascades and staff
 * notifications.
 *
 * Phase 2 of AUTOMATIONS-HANDOFF.md. Backs the /ops/automations "System
 * Automations" tab. Each cascade or notification call site wraps its action
 * in `if (await isSystemAutomationEnabled(<key>)) { ... }` so admins can flip
 * core platform behavior off without a deploy.
 *
 * Cache strategy: 60-second in-memory map. Toggling a row from the UI calls
 * invalidateSystemAutomationCache() so changes take effect immediately on
 * the writing instance, and propagate to peers within ≤ 60s.
 *
 * Backward compatibility: if the SystemAutomation table doesn't exist yet
 * (e.g. seed endpoint hasn't been hit), every key returns `true`. This means
 * deploying this file ALONE does not change behavior — all existing cascades
 * keep firing as before. Seed the table to gain control.
 */

import { prisma } from '@/lib/prisma'

let cache: Map<string, boolean> = new Map()
let cacheTime = 0
const CACHE_TTL = 60_000

/**
 * Check whether a system automation key is enabled.
 *
 * Defaults to `true` when:
 *   • The table does not exist yet (deploy-before-seed window)
 *   • The key has no row (lets new automations land before being seeded)
 *
 * Override the default by inserting a row with enabled=false.
 */
export async function isSystemAutomationEnabled(key: string): Promise<boolean> {
  if (Date.now() - cacheTime > CACHE_TTL) {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ key: string; enabled: boolean }>>(
        `SELECT "key", "enabled" FROM "SystemAutomation"`,
      )
      cache = new Map(rows.map((r) => [r.key, r.enabled]))
      cacheTime = Date.now()
    } catch {
      // Table doesn't exist yet — default to true so existing cascades keep
      // firing. Once the seed endpoint runs, this branch stops being hit.
      return true
    }
  }

  return cache.get(key) ?? true
}

/**
 * Force the next isSystemAutomationEnabled() call to re-read from the DB.
 * Called by the PATCH endpoint after a toggle so the writing instance sees
 * the change immediately.
 */
export function invalidateSystemAutomationCache(): void {
  cacheTime = 0
}

/**
 * Bulk pre-warm — used by routes that will check several keys in a single
 * request (e.g. cascade chains). Avoids N round trips.
 */
export async function getAllSystemAutomations(): Promise<
  Array<{ key: string; enabled: boolean }>
> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ key: string; enabled: boolean }>>(
      `SELECT "key", "enabled" FROM "SystemAutomation"`,
    )
    return rows
  } catch {
    return []
  }
}
