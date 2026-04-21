'use client'

/**
 * useFeatureFlag — client-side feature flag reader.
 *
 * Resolution precedence (first defined value wins):
 *   1. localStorage override     →  `feature.{name}`  ("1"/"0" or "true"/"false")
 *   2. Per-user pref             →  Staff.preferences.featureFlags[name]
 *   3. Build-time env            →  NEXT_PUBLIC_AEGIS_V2_DRAFTING_ROOM (and siblings)
 *   4. Default                   →  false
 *
 * SSR-safe: on the server we skip localStorage and return the env value
 * (or false). The hook re-reads localStorage on mount so client + SSR
 * converge after hydration without a flash.
 */

import { useEffect, useState } from 'react'

export type KnownFeatureFlag = 'AEGIS_V2_DRAFTING_ROOM' | (string & {})

type StaffPreferences = {
  featureFlags?: Record<string, boolean>
  [k: string]: unknown
}

// ── Env lookup ────────────────────────────────────────────────────────────
// Next.js inlines `process.env.NEXT_PUBLIC_*` at build, so we enumerate the
// ones we know about. Add new flags here as they come online.
const ENV_FLAGS: Record<string, string | undefined> = {
  AEGIS_V2_DRAFTING_ROOM: process.env.NEXT_PUBLIC_AEGIS_V2_DRAFTING_ROOM,
}

function truthy(v: string | undefined | null | boolean): boolean {
  if (v === true) return true
  if (v === false || v == null) return false
  const s = String(v).toLowerCase().trim()
  return s === '1' || s === 'true' || s === 'on' || s === 'yes'
}

function readEnv(name: string): boolean {
  return truthy(ENV_FLAGS[name])
}

function readLocalStorage(name: string): boolean | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(`feature.${name}`)
    if (raw == null) return null
    return truthy(raw)
  } catch {
    return null
  }
}

function readUserPref(name: string): boolean | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem('aegis.staff.preferences')
    if (!raw) return null
    const parsed = JSON.parse(raw) as StaffPreferences
    const v = parsed?.featureFlags?.[name]
    return typeof v === 'boolean' ? v : null
  } catch {
    return null
  }
}

/**
 * Resolve a feature flag. SSR-safe: returns env-only result on the server,
 * then upgrades to the full resolution after hydration.
 */
export function useFeatureFlag(name: KnownFeatureFlag): boolean {
  // Start with the SSR-safe answer: env only. No localStorage access on server.
  const [enabled, setEnabled] = useState<boolean>(() => readEnv(name))

  useEffect(() => {
    const ls = readLocalStorage(name)
    if (ls != null) {
      setEnabled(ls)
      return
    }
    const pref = readUserPref(name)
    if (pref != null) {
      setEnabled(pref)
      return
    }
    setEnabled(readEnv(name))
  }, [name])

  return enabled
}

/**
 * Imperative helper for non-hook contexts (e.g. event handlers).
 * Do not call during SSR — guards against window access.
 */
export function getFeatureFlag(name: KnownFeatureFlag): boolean {
  const ls = readLocalStorage(name)
  if (ls != null) return ls
  const pref = readUserPref(name)
  if (pref != null) return pref
  return readEnv(name)
}

/**
 * Set a localStorage override for the current browser. Pass `null` to clear.
 */
export function setFeatureFlagOverride(name: KnownFeatureFlag, value: boolean | null): void {
  if (typeof window === 'undefined') return
  try {
    if (value == null) window.localStorage.removeItem(`feature.${name}`)
    else window.localStorage.setItem(`feature.${name}`, value ? '1' : '0')
  } catch {
    /* noop */
  }
}
