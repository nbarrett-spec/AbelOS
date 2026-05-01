'use client'

/**
 * Builder Portal — Settings client.
 *
 * §4.12 Settings. Sections:
 *   - Company Info (read-only)
 *   - Pricing Tier badge (read-only)
 *   - Notification Preferences (localStorage; toggles only — no server
 *     endpoint yet for per-user notification settings)
 *   - Branding link
 *   - Sign-out
 *
 * For v2: hook notification toggles to BuilderContact.notificationPrefs
 * jsonb column when the API is available.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Bell,
  Building2,
  CheckCircle2,
  ChevronRight,
  LogOut,
  Mail,
  Palette,
  Phone,
  Shield,
  Sparkles,
  User,
  X,
} from 'lucide-react'
import { PortalCard } from '@/components/portal/PortalCard'
import { usePortal } from '@/components/portal/PortalContext'

export interface BuilderProfile {
  companyName: string | null
  contactName: string | null
  email: string | null
  phone: string | null
  pricingTier: string | null
  logoUrl: string | null
}

const PREF_KEY = 'abel-portal-notification-prefs'

interface NotificationPrefs {
  orderStatusEmail: boolean
  deliveryUpdatesEmail: boolean
  quoteResponseEmail: boolean
  invoiceReminderEmail: boolean
  weeklyDigestEmail: boolean
}

const DEFAULT_PREFS: NotificationPrefs = {
  orderStatusEmail: true,
  deliveryUpdatesEmail: true,
  quoteResponseEmail: true,
  invoiceReminderEmail: true,
  weeklyDigestEmail: false,
}

interface SettingsClientProps {
  profile: BuilderProfile
}

export function SettingsClient({ profile }: SettingsClientProps) {
  const { role, builder } = usePortal()
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(PREF_KEY)
      if (raw) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) })
    } catch {
      // noop
    }
  }, [])

  function togglePref(key: keyof NotificationPrefs) {
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PREF_KEY, JSON.stringify(next))
    }
    setSavedAt(Date.now())
    setTimeout(() => setSavedAt(null), 2000)
  }

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {})
    } finally {
      window.location.href = '/login'
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2
          className="text-2xl font-medium leading-tight"
          style={{
            fontFamily: 'var(--font-portal-display, Georgia)',
            color: 'var(--portal-text-strong, #3E2A1E)',
            letterSpacing: '-0.02em',
          }}
        >
          Settings
        </h2>
        <p
          className="text-sm mt-1"
          style={{ color: 'var(--portal-text-muted, #6B6056)' }}
        >
          Account info, notifications, and branding for {builder.companyName}.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Company Info */}
        <PortalCard
          title="Company Info"
          subtitle="Contact your Abel rep to update."
        >
          <div className="space-y-3">
            <Row
              icon={<Building2 className="w-3.5 h-3.5" />}
              label="Company"
              value={profile.companyName || builder.companyName}
            />
            {profile.contactName && (
              <Row
                icon={<User className="w-3.5 h-3.5" />}
                label="Primary Contact"
                value={profile.contactName}
              />
            )}
            <Row
              icon={<Mail className="w-3.5 h-3.5" />}
              label="Email"
              value={profile.email || builder.email}
            />
            {profile.phone && (
              <Row
                icon={<Phone className="w-3.5 h-3.5" />}
                label="Phone"
                value={profile.phone}
              />
            )}
            <Row
              icon={<Shield className="w-3.5 h-3.5" />}
              label="Portal Role"
              value={role}
            />
            {profile.pricingTier && (
              <Row
                icon={<Sparkles className="w-3.5 h-3.5" />}
                label="Pricing Tier"
                value={
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                    style={{
                      background: 'rgba(201,130,43,0.12)',
                      color: '#7A4E0F',
                      border: '1px solid rgba(201,130,43,0.2)',
                    }}
                  >
                    {profile.pricingTier}
                  </span>
                }
              />
            )}
          </div>
        </PortalCard>

        {/* Notifications */}
        <PortalCard
          title="Notification Preferences"
          subtitle="Choose what we email you about."
          action={
            savedAt && (
              <span
                className="inline-flex items-center gap-1 text-[11px]"
                style={{ color: 'var(--portal-success, #1A4B21)' }}
              >
                <CheckCircle2 className="w-3 h-3" />
                Saved
              </span>
            )
          }
        >
          <div className="space-y-2.5">
            <Toggle
              label="Order status updates"
              description="Confirmations, production milestones, ETA changes"
              checked={prefs.orderStatusEmail}
              onChange={() => togglePref('orderStatusEmail')}
            />
            <Toggle
              label="Delivery updates"
              description="Driver dispatched, on the way, delivered"
              checked={prefs.deliveryUpdatesEmail}
              onChange={() => togglePref('deliveryUpdatesEmail')}
            />
            <Toggle
              label="Quote responses"
              description="When a quote is approved, rejected, or revised"
              checked={prefs.quoteResponseEmail}
              onChange={() => togglePref('quoteResponseEmail')}
            />
            <Toggle
              label="Invoice reminders"
              description="Due-date and overdue notices"
              checked={prefs.invoiceReminderEmail}
              onChange={() => togglePref('invoiceReminderEmail')}
            />
            <Toggle
              label="Weekly digest"
              description="One summary email every Monday"
              checked={prefs.weeklyDigestEmail}
              onChange={() => togglePref('weeklyDigestEmail')}
            />
          </div>
          <p
            className="text-[11px] mt-4"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            <Bell className="w-3 h-3 inline mr-1" />
            Preferences sync to this device. Server-side sync arrives in v2.
          </p>
        </PortalCard>

        {/* Branding link */}
        <PortalCard title="Branding">
          <p
            className="text-sm leading-relaxed mb-4"
            style={{ color: 'var(--portal-text, #2C2C2C)' }}
          >
            Customize your portal logo, colors, and welcome message.
          </p>
          <Link
            href="/portal/settings/branding"
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-sm font-medium transition-colors"
            style={{
              background: 'var(--portal-bg-card, #FFFFFF)',
              color: 'var(--portal-text-strong, #3E2A1E)',
              border: '1px solid var(--portal-border, #E8DFD0)',
            }}
          >
            <Palette className="w-3.5 h-3.5" />
            Branding & Theme
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </PortalCard>

        {/* Account actions */}
        <PortalCard title="Account">
          <div className="space-y-3">
            <p
              className="text-xs"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              Need to invite another team member or change your password? Email{' '}
              <a
                href="mailto:portal@abellumber.com"
                className="hover:underline"
                style={{ color: 'var(--portal-walnut, #3E2A1E)' }}
              >
                portal@abellumber.com
              </a>{' '}
              and we&apos;ll get it sorted.
            </p>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-sm font-medium transition-colors disabled:opacity-60"
              style={{
                background: 'var(--portal-bg-card, #FFFFFF)',
                color: 'var(--portal-oxblood, #6E2A24)',
                border: '1px solid var(--portal-border, #E8DFD0)',
              }}
            >
              <LogOut className="w-3.5 h-3.5" />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </PortalCard>
      </div>
    </div>
  )
}

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-3 items-baseline">
      <dt
        className="text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5"
        style={{ color: 'var(--portal-kiln-oak, #8B6F47)' }}
      >
        {icon}
        {label}
      </dt>
      <dd
        className="text-sm"
        style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
      >
        {value}
      </dd>
    </div>
  )
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      className="w-full text-left flex items-start gap-3 p-3 rounded-md transition-colors"
      style={{
        background: checked
          ? 'rgba(201,130,43,0.06)'
          : 'var(--portal-bg-card, #FFFFFF)',
        border: '1px solid var(--portal-border-light, #F0E8DA)',
      }}
    >
      <div className="min-w-0 flex-1">
        <div
          className="text-sm font-medium"
          style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
        >
          {label}
        </div>
        <div
          className="text-[11px]"
          style={{ color: 'var(--portal-text-muted, #6B6056)' }}
        >
          {description}
        </div>
      </div>
      <div
        className="shrink-0 w-9 h-5 rounded-full relative transition-colors"
        style={{
          background: checked
            ? 'var(--portal-amber, #C9822B)'
            : 'var(--portal-border, #E8DFD0)',
        }}
      >
        <div
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all"
          style={{
            left: checked ? 18 : 2,
          }}
        />
      </div>
    </button>
  )
}

// Avoid lint warnings on unused imports we keep for future v2 wiring.
void X
