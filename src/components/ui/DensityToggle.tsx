'use client'

/**
 * DensityToggle — 3-up segmented control that sets :root[data-density].
 *
 * Source of truth order: localStorage `aegis.density` → role default → "default".
 * Persists to:
 *   - localStorage `aegis.density`
 *   - POST /api/ops/staff/preferences  { density }  (best-effort, non-blocking)
 *
 * Hydrates from localStorage on mount to avoid FOUC; the root inline script
 * in `app/layout.tsx` sets `data-density` before React boots.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Rows3, Rows4, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

export type Density = 'comfortable' | 'default' | 'compact'

const LS_KEY = 'aegis.density'
const LS_PREFS = 'aegis.staff.preferences'

/** Role-based defaults per the Aegis v2 brief. */
const ROLE_DEFAULT: Record<string, Density> = {
  ADMIN: 'comfortable',                // Owner
  MANAGER: 'default',                  // COO
  SALES_REP: 'default',
  ACCOUNTING: 'default',
  PROJECT_MANAGER: 'compact',
  DRIVER: 'compact',                   // Logistics
  WAREHOUSE_LEAD: 'compact',           // Shop floor
  WAREHOUSE_TECH: 'compact',           // Shop floor
  INSTALLER: 'compact',
  ESTIMATOR: 'default',
  PURCHASING: 'default',
  QC_INSPECTOR: 'default',
  VIEWER: 'default',
}

export function densityForRole(role?: string | null): Density {
  if (!role) return 'default'
  return ROLE_DEFAULT[role.toUpperCase()] ?? 'default'
}

function isDensity(v: unknown): v is Density {
  return v === 'comfortable' || v === 'default' || v === 'compact'
}

function readStoredDensity(): Density | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    return isDensity(raw) ? raw : null
  } catch {
    return null
  }
}

function applyDensity(d: Density) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.density = d
}

function persistDensity(d: Density) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LS_KEY, d)
    // Also fold into the mirrored staff preferences blob (used by feature-flag hook).
    const raw = window.localStorage.getItem(LS_PREFS)
    const prefs = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    prefs.density = d
    window.localStorage.setItem(LS_PREFS, JSON.stringify(prefs))
  } catch {
    /* noop — private mode / quota */
  }
  // Best-effort server sync — silently ignore failure.
  try {
    fetch('/api/ops/staff/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ density: d }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* noop */
  }
}

export interface DensityToggleProps {
  /** Role to derive the initial default from — if no localStorage value exists. */
  role?: string | null
  className?: string
  /** Label each option (defaults to role "C / D / K"-ish letters). */
  compactLabels?: boolean
}

const OPTIONS: { value: Density; label: string; short: string; Icon: typeof Rows3 }[] = [
  { value: 'comfortable', label: 'Comfortable', short: 'Cf', Icon: Rows3 },
  { value: 'default',     label: 'Default',     short: 'Df', Icon: Rows4 },
  { value: 'compact',     label: 'Compact',     short: 'Cp', Icon: Minus },
]

export default function DensityToggle({ role, className, compactLabels = false }: DensityToggleProps) {
  const roleDefault = useMemo(() => densityForRole(role), [role])
  const [density, setDensity] = useState<Density>('default')
  const [hydrated, setHydrated] = useState(false)

  // Hydrate once on mount — stored value wins over role default.
  useEffect(() => {
    const stored = readStoredDensity()
    const initial = stored ?? roleDefault
    setDensity(initial)
    applyDensity(initial)
    // If we had no stored value, seed localStorage with the role default so
    // server sync happens once and subsequent loads are FOUC-free.
    if (!stored) persistDensity(initial)
    setHydrated(true)
  }, [roleDefault])

  const onSelect = useCallback((d: Density) => {
    setDensity(d)
    applyDensity(d)
    persistDensity(d)
  }, [])

  return (
    <div
      role="radiogroup"
      aria-label="Display density"
      className={cn(
        'inline-flex items-center rounded-md border border-border bg-surface-muted p-0.5',
        className,
      )}
      // Avoid SSR/CSR flash: fade in once hydrated.
      style={{ opacity: hydrated ? 1 : 0.6, transition: 'opacity 120ms var(--ease)' }}
    >
      {OPTIONS.map(({ value, label, short, Icon }) => {
        const active = density === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={label}
            onClick={() => onSelect(value)}
            className={cn(
              'inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium tracking-tight',
              'transition-colors duration-fast',
              active
                ? 'bg-signal text-fg-on-accent shadow-sm'
                : 'text-fg-muted hover:text-fg hover:bg-surface',
            )}
          >
            <Icon className="w-3 h-3" aria-hidden="true" />
            {compactLabels ? short : <span className="hidden sm:inline">{label}</span>}
          </button>
        )
      })}
    </div>
  )
}
