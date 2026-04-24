'use client'

/**
 * TenantSwitcher — preview-only control that lets the design reviewer / AE
 * flip between tenants on /aegis-home without auth. Writes the slug to
 * `?tenant=<slug>` so useTenantProfile() picks it up.
 *
 * Only renders on /aegis-home (design-review surface). In the real portal
 * this would be swapped for the production tenant switcher that lists
 * only tenants the signed-in user has access to.
 */

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { ROSTER } from '@/lib/tenant-roster'
import { tierShortLabel } from '@/lib/builder-tiers'

export function TenantSwitcher() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const current = searchParams?.get('tenant') ?? 'brookfield'

  function pick(slug: string) {
    const sp = new URLSearchParams(searchParams?.toString() ?? '')
    sp.set('tenant', slug)
    router.replace(`${pathname}?${sp.toString()}`)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span
        style={{
          fontFamily: 'var(--v4-font-mono)',
          fontSize: 10,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--fg-subtle)',
        }}
      >
        Tenant
      </span>
      <select
        value={current}
        onChange={(e) => pick(e.target.value)}
        aria-label="Switch tenant"
        style={{
          appearance: 'none',
          background: 'var(--surface)',
          color: 'var(--fg)',
          border: '1px solid var(--border-strong)',
          borderRadius: 6,
          padding: '6px 28px 6px 10px',
          fontFamily: 'var(--v4-font-sans)',
          fontSize: 12.5,
          fontWeight: 600,
          lineHeight: 1,
          cursor: 'pointer',
          outline: 'none',
          backgroundImage:
            'linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)',
          backgroundPosition:
            'calc(100% - 14px) 50%, calc(100% - 9px) 50%',
          backgroundSize: '5px 5px, 5px 5px',
          backgroundRepeat: 'no-repeat',
        }}
      >
        {ROSTER.map((r) => (
          <option key={r.slug} value={r.slug}>
            {tierShortLabel(r.tier)} · {r.name}
          </option>
        ))}
      </select>
    </div>
  )
}

export default TenantSwitcher
