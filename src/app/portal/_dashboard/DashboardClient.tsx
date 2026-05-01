'use client'

/**
 * Builder Portal — Dashboard client widget composition.
 *
 * §4.1 Dashboard. Reads the role from PortalContext and shows:
 *   - PM view: KPI strip + Quick Actions + Recent Orders + Activity
 *   - Exec view: KPI strip + Monthly Spend Chart + Recent Orders + Activity
 *
 * The chart-only-for-exec rule lives here. Both views always show the KPI
 * strip and the bottom two-column row.
 */

import Link from 'next/link'
import {
  AlertCircle,
  FilePlus,
  MapPin,
  MessageCircle,
  Repeat,
  type LucideIcon,
} from 'lucide-react'
import { usePortal } from '@/components/portal/PortalContext'
import { PortalKpiCard } from '@/components/portal/PortalKpiCard'
import { PortalCard } from '@/components/portal/PortalCard'
// Use the centralized PORTAL_STATUS_BADGE map (Mockup-3 4-tone palette
// with pulsing dots) instead of redeclaring badge colors here.
import {
  PORTAL_STATUS_BADGE as STATUS_BADGE,
  PortalStatusBadge,
} from '@/components/portal/PortalStatusBadge'
import type { AnalyticsResponse, PortalOrder } from '@/types/portal'

interface QuickAction {
  label: string
  hint: string
  href: string
  icon: LucideIcon
  bg: string
  fg: string
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: 'New Quote',
    hint: 'Start from plan',
    href: '/portal/quotes/new',
    icon: FilePlus,
    bg: 'rgba(62,42,30,0.06)',
    fg: 'var(--portal-walnut, #3E2A1E)',
  },
  {
    label: 'Reorder',
    hint: 'From past order',
    href: '/portal/orders?reorder=1',
    icon: Repeat,
    bg: 'rgba(201,130,43,0.08)',
    fg: 'var(--portal-amber, #C9822B)',
  },
  {
    label: 'Track Delivery',
    hint: 'Real-time ETA',
    href: '/portal/schedule',
    icon: MapPin,
    bg: 'rgba(140,168,184,0.1)',
    fg: 'var(--portal-sky, #8CA8B8)',
  },
  {
    label: 'Message Abel',
    hint: 'Chat with your PM',
    href: '/portal/messages',
    icon: MessageCircle,
    bg: 'rgba(184,135,107,0.1)',
    fg: 'var(--portal-dust, #B8876B)',
  },
  {
    label: 'Report Issue',
    hint: 'Warranty / QC',
    href: '/portal/warranty',
    icon: AlertCircle,
    bg: 'rgba(110,42,36,0.06)',
    fg: 'var(--portal-oxblood, #6E2A24)',
  },
]

interface DashboardClientProps {
  firstName: string
  analytics: AnalyticsResponse | null
  recentOrders: PortalOrder[]
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return `${Math.round(n)}`
}

function fmtPct(n: number, dp = 0): string {
  return `${n.toFixed(dp)}%`
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}


export function DashboardClient({
  firstName,
  analytics,
  recentOrders,
}: DashboardClientProps) {
  const { viewMode, canSeeExec, builder } = usePortal()
  const showExec = canSeeExec && viewMode === 'exec'

  const monthly = analytics?.monthly ?? []
  const sparkSpend = monthly.slice(-6).map((m) => m.spend)
  const sparkOrders = monthly.slice(-6).map((m) => m.orders)
  const ytdOrders = analytics?.keyMetrics?.ytdOrders ?? 0
  const ytdSpend = analytics?.keyMetrics?.ytdSpend ?? 0
  const avgOrder = analytics?.keyMetrics?.avgOrderValue ?? 0
  const approvalRate = analytics?.keyMetrics?.approvalRate ?? 0
  const mtdSpend = monthly.length > 0 ? monthly[monthly.length - 1].spend : 0
  const prevMonthSpend =
    monthly.length > 1 ? monthly[monthly.length - 2].spend : 0
  const mtdDelta = prevMonthSpend
    ? ((mtdSpend - prevMonthSpend) / prevMonthSpend) * 100
    : 0

  // Active orders = anything not DELIVERED/CANCELLED in the recent set is a
  // proxy until /api/builder/analytics exposes a canonical "active" count.
  const activeOrderCount = recentOrders.filter(
    (o) => o.status !== 'DELIVERED' && o.status !== 'CANCELLED',
  ).length

  return (
    <div className="space-y-7">
      {/* ── Welcome banner — Mockup-3 hero pattern (eyebrow + serif H1) ─ */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="portal-eyebrow mb-3">
            {analytics ? `${ytdOrders} orders YTD` : 'Builder portal'}
          </div>
          <h1
            className="portal-page-title"
            style={{ fontSize: 'clamp(28px, 4vw, 44px)' }}
          >
            {greetingFor(new Date())}, <em>{firstName || builder.companyName}</em>.
          </h1>
          <p
            className="text-[15px] mt-3 max-w-[640px]"
            style={{
              color: 'var(--portal-text-muted)',
              fontFamily: 'var(--font-portal-body)',
              lineHeight: 1.55,
            }}
          >
            {activeOrderCount > 0 ? (
              <>
                {activeOrderCount} active order{activeOrderCount === 1 ? '' : 's'} in flight.{' '}
              </>
            ) : (
              <>No active orders right now. </>
            )}
            {analytics
              ? `Welcome back — your account is healthy.`
              : 'Welcome to your portal.'}
          </p>
        </div>
        {!showExec && (
          <div className="flex gap-2">
            <Link
              href="/portal/quotes/new"
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full text-sm font-medium transition-shadow"
              style={{
                background: 'var(--grad)',
                color: 'white',
                boxShadow: '0 6px 20px rgba(79,70,229,0.25)',
                fontFamily: 'var(--font-portal-body)',
              }}
            >
              <FilePlus className="w-3.5 h-3.5" />
              New Quote
            </Link>
            <Link
              href="/portal/schedule"
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full text-sm font-medium transition-colors"
              style={{
                background: 'var(--glass)',
                backdropFilter: 'var(--glass-blur)',
                WebkitBackdropFilter: 'var(--glass-blur)',
                color: 'var(--portal-text-strong)',
                border: '1px solid var(--glass-border)',
                fontFamily: 'var(--font-portal-body)',
              }}
            >
              <MapPin className="w-3.5 h-3.5" />
              Track
            </Link>
          </div>
        )}
      </div>

      {/* ── KPI strip ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <PortalKpiCard
          label="Active Orders"
          value={activeOrderCount}
          accentColor="var(--portal-walnut, #3E2A1E)"
          delta={
            recentOrders.length > 0
              ? {
                  value: recentOrders.length,
                  label: `${recentOrders.length} recent`,
                  direction: 'neutral',
                }
              : undefined
          }
          sparklineData={sparkOrders.length > 1 ? sparkOrders : undefined}
        />
        <PortalKpiCard
          label="YTD Orders"
          value={ytdOrders}
          accentColor="var(--portal-amber, #C9822B)"
          sparklineData={sparkOrders.length > 1 ? sparkOrders : undefined}
        />
        <PortalKpiCard
          label="MTD Spend"
          value={Math.round(mtdSpend / 1000)}
          prefix="$"
          suffix="K"
          accentColor="var(--portal-sky, #8CA8B8)"
          delta={
            prevMonthSpend
              ? {
                  value: mtdDelta,
                  label: `${mtdDelta > 0 ? '+' : ''}${mtdDelta.toFixed(0)}% vs prior`,
                  direction: mtdDelta > 0 ? 'up' : mtdDelta < 0 ? 'down' : 'neutral',
                }
              : undefined
          }
          sparklineData={sparkSpend.length > 1 ? sparkSpend : undefined}
        />
        <PortalKpiCard
          label="Approval Rate"
          value={approvalRate}
          suffix="%"
          decimals={0}
          accentColor="var(--portal-kiln-oak, #8B6F47)"
        />
      </div>

      {/* ── Quick actions (PM) or Spend chart placeholder (Exec) ─────── */}
      {!showExec ? (
        <PortalCard title="Quick Actions">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {QUICK_ACTIONS.map((a) => {
              const Icon = a.icon
              return (
                <Link
                  key={a.label}
                  href={a.href}
                  className="group flex flex-col items-start gap-2 p-3.5 rounded-lg transition-all"
                  style={{
                    background: 'var(--portal-bg-card, #FFFFFF)',
                    border: '1px solid var(--portal-border-light, #F0E8DA)',
                  }}
                >
                  <div
                    className="w-10 h-10 rounded-md flex items-center justify-center transition-transform group-hover:scale-105"
                    style={{ background: a.bg, color: a.fg }}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <div
                      className="text-sm font-medium"
                      style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
                    >
                      {a.label}
                    </div>
                    <div
                      className="text-[11px] mt-0.5"
                      style={{ color: 'var(--portal-text-muted, #6B6056)' }}
                    >
                      {a.hint}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </PortalCard>
      ) : (
        <PortalCard
          title="Monthly Spend Trend"
          subtitle={
            monthly.length > 0
              ? `${monthly.length} months of history · YTD $${fmtMoney(ytdSpend)}`
              : 'No spend data yet'
          }
        >
          <SpendBarChart monthly={monthly} />
        </PortalCard>
      )}

      {/* ── Recent orders + activity ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PortalCard
          title="Recent Orders"
          subtitle={recentOrders.length > 0 ? undefined : 'No recent activity'}
          action={
            <Link
              href="/portal/orders"
              className="text-xs font-medium px-3 h-8 inline-flex items-center rounded transition-colors"
              style={{
                color: 'var(--portal-walnut, #3E2A1E)',
                background: 'var(--portal-bg-elevated, #FAF5E8)',
              }}
            >
              View all
            </Link>
          }
          className="lg:col-span-2"
          noBodyPadding
        >
          {recentOrders.length === 0 ? (
            <div
              className="px-6 py-10 text-center text-sm"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              When you place your first order, it&apos;ll show up here.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left portal-meta-label">
                    <th className="px-6 py-3 font-semibold">Order #</th>
                    <th className="px-2 py-3 font-semibold">Items</th>
                    <th className="px-2 py-3 font-semibold">Total</th>
                    <th className="px-2 py-3 font-semibold">Status</th>
                    <th className="px-6 py-3 font-semibold text-right">Placed</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((o) => (
                    <tr
                      key={o.id}
                      className="border-t transition-colors hover:bg-[rgba(79,70,229,0.04)]"
                      style={{ borderColor: 'var(--portal-border-light)' }}
                    >
                      <td className="px-6 py-3 portal-mono-data text-xs">
                        <Link
                          href={`/portal/orders/${o.id}`}
                          className="hover:underline"
                          style={{ color: 'var(--portal-text-strong)' }}
                        >
                          {o.orderNumber}
                        </Link>
                      </td>
                      <td
                        className="px-2 py-3 portal-mono-data text-[13px]"
                        style={{ color: 'var(--portal-text)' }}
                      >
                        {o.itemCount}
                      </td>
                      <td
                        className="px-2 py-3 portal-mono-data text-[15px]"
                        style={{ color: 'var(--portal-text-strong)' }}
                      >
                        ${o.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-2 py-3">
                        <PortalStatusBadge status={o.status} />
                      </td>
                      <td
                        className="px-6 py-3 text-right portal-mono-data text-[11px]"
                        style={{ color: 'var(--portal-text-subtle)' }}
                      >
                        {relTime(o.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PortalCard>

        <PortalCard
          title="Activity"
          subtitle={recentOrders.length === 0 ? 'No activity yet' : undefined}
        >
          {recentOrders.length === 0 ? (
            <p
              className="text-sm py-6 text-center"
              style={{ color: 'var(--portal-text-muted, #6B6056)' }}
            >
              We&apos;ll show order, delivery, and quote events here.
            </p>
          ) : (
            <ul className="space-y-3">
              {recentOrders.slice(0, 6).map((o) => (
                <li key={o.id} className="flex items-start gap-3 text-sm">
                  <span
                    className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: 'var(--c1)' }}
                  />
                  <div className="min-w-0">
                    <p
                      className="leading-tight"
                      style={{ color: 'var(--portal-text-strong)' }}
                    >
                      Order{' '}
                      <strong
                        className="portal-mono-data"
                        style={{ fontWeight: 600 }}
                      >
                        {o.orderNumber}
                      </strong>{' '}
                      <span style={{ color: 'var(--portal-text-muted)' }}>
                        — {STATUS_BADGE[o.status]?.label ?? o.status}
                      </span>
                    </p>
                    <p
                      className="text-[11px] portal-mono-data mt-0.5"
                      style={{ color: 'var(--portal-text-subtle)' }}
                    >
                      {relTime(o.createdAt)} · ${o.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PortalCard>
      </div>

      {/* ── Exec-only stats footer (visible in exec view, supplementary) ── */}
      {showExec && analytics && (
        <PortalCard title="Spend Snapshot">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <Stat label="YTD Spend" value={`$${fmtMoney(ytdSpend)}`} />
            <Stat label="Avg Order Value" value={`$${fmtMoney(avgOrder)}`} />
            <Stat
              label="Approval Rate"
              value={fmtPct(approvalRate)}
            />
            <Stat
              label="Open Invoices"
              value={String(analytics.paymentStats?.totalInvoices ?? 0)}
              subValue={`${analytics.paymentStats?.overdue ?? 0} overdue`}
            />
          </div>
        </PortalCard>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  subValue,
}: {
  label: string
  value: string
  subValue?: string
}) {
  return (
    <div>
      <div className="portal-meta-label">{label}</div>
      <div
        className="mt-1.5 leading-none"
        style={{
          fontFamily: 'var(--font-portal-display)',
          fontSize: '1.75rem',
          color: 'var(--portal-text-strong)',
          fontWeight: 400,
          letterSpacing: '-0.01em',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      {subValue && (
        <div
          className="text-xs mt-1"
          style={{
            color: 'var(--portal-text-muted)',
            fontFamily: 'var(--font-portal-body)',
          }}
        >
          {subValue}
        </div>
      )}
    </div>
  )
}

function SpendBarChart({
  monthly,
}: {
  monthly: { month: string; orders: number; spend: number }[]
}) {
  if (monthly.length === 0) {
    return (
      <div
        className="text-center py-12 text-sm"
        style={{ color: 'var(--portal-text-muted, #6B6056)' }}
      >
        No monthly spend yet.
      </div>
    )
  }

  const max = Math.max(...monthly.map((m) => m.spend), 1)
  return (
    <div className="flex items-end gap-2 h-44 pt-2">
      {monthly.slice(-12).map((m) => {
        const pct = (m.spend / max) * 100
        return (
          <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-full rounded-t-md transition-colors"
              style={{
                height: `${pct}%`,
                background: 'linear-gradient(180deg, var(--c1), var(--c2))',
                minHeight: 2,
              }}
              title={`${m.month}: $${fmtMoney(m.spend)}`}
            />
            <div
              className="text-[9px] portal-mono-data"
              style={{ color: 'var(--portal-text-subtle)' }}
            >
              {m.month.slice(5) /* MM portion of YYYY-MM */}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function greetingFor(d: Date): string {
  const hour = d.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}
