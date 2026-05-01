'use client'

/**
 * Builder Portal — Projects client.
 *
 * §4.10 Projects. Renders project cards (one per Project record in DB)
 * with: address, plan name, community, status, active orders count,
 * upcoming deliveries, total spend.
 *
 * Filter controls:
 *   - Search box (name/address)
 *   - Community pills (derived from project list distinct communities)
 *   - Status tabs
 *
 * "How builders think: 'What's happening at Lot 42?' — not 'show me order
 * SO-24831.'" Each card links to the project detail page (deferred to a
 * future expansion; for now we anchor to /portal/orders?projectId=… via
 * the existing orders search endpoint).
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Box,
  Building2,
  Calendar,
  ChevronRight,
  MapPin,
  Search,
  Truck,
  X,
} from 'lucide-react'
import { PortalCard } from '@/components/portal/PortalCard'

export interface PortalProjectRow {
  id: string
  builderId: string
  name: string
  address?: string | null
  community?: string | null
  status: string
  planName?: string | null
  createdAt: string
  updatedAt: string
  orderCount: number
  totalSpend: number
  upcomingDeliveryCount: number
  nextDeliveryDate: string | null
}

const STATUS_BADGE: Record<
  string,
  { bg: string; fg: string; label: string }
> = {
  DRAFT:           { bg: 'rgba(107,96,86,0.12)',  fg: '#5A4F46', label: 'Draft' },
  QUOTE_GENERATED: { bg: 'rgba(140,168,184,0.16)', fg: '#3D5A6A', label: 'Quoted' },
  IN_PROGRESS:     { bg: 'rgba(201,130,43,0.14)',  fg: '#7A4E0F', label: 'In Progress' },
  ON_HOLD:         { bg: 'rgba(212,165,74,0.16)',  fg: '#7A5413', label: 'On Hold' },
  COMPLETE:        { bg: 'rgba(56,128,77,0.12)',   fg: '#1A4B21', label: 'Complete' },
  COMPLETED:       { bg: 'rgba(56,128,77,0.12)',   fg: '#1A4B21', label: 'Complete' },
  ARCHIVED:        { bg: 'rgba(107,96,86,0.12)',   fg: '#5A4F46', label: 'Archived' },
}

function fmtUsd(n: number, dp = 0): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${n.toFixed(dp)}`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return '—'
  }
}

export function ProjectsClient({
  projects,
}: {
  projects: PortalProjectRow[]
}) {
  const [query, setQuery] = useState('')
  const [community, setCommunity] = useState<string>('')
  const [status, setStatus] = useState<string>('')

  const communities = useMemo(() => {
    const seen = new Set<string>()
    for (const p of projects) {
      if (p.community) seen.add(p.community)
    }
    return Array.from(seen).sort()
  }, [projects])

  const statusOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const p of projects) {
      if (p.status) seen.add(p.status)
    }
    return Array.from(seen)
  }, [projects])

  const filtered = useMemo(() => {
    let list = projects
    if (community) list = list.filter((p) => p.community === community)
    if (status) list = list.filter((p) => p.status === status)
    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.address?.toLowerCase().includes(q) ?? false) ||
          (p.planName?.toLowerCase().includes(q) ?? false),
      )
    }
    return list
  }, [projects, community, status, query])

  const totalSpend = useMemo(
    () => filtered.reduce((sum, p) => sum + (p.totalSpend || 0), 0),
    [filtered],
  )
  const totalUpcoming = useMemo(
    () => filtered.reduce((sum, p) => sum + (p.upcomingDeliveryCount || 0), 0),
    [filtered],
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2
            className="text-2xl font-medium leading-tight"
            style={{
              fontFamily: 'var(--font-portal-display, Georgia)',
              color: 'var(--portal-text-strong, #3E2A1E)',
              letterSpacing: '-0.02em',
            }}
          >
            Projects
          </h2>
          <p
            className="text-sm mt-1"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            {projects.length > 0
              ? `${projects.length} project${projects.length === 1 ? '' : 's'} on file`
              : 'Your projects will appear here as you start placing orders.'}
          </p>
        </div>
      </div>

      {/* Summary stats */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Stat
            label="Filtered Projects"
            value={String(filtered.length)}
            accent="var(--portal-walnut, #3E2A1E)"
          />
          <Stat
            label="Total Spend (Filtered)"
            value={fmtUsd(totalSpend)}
            accent="var(--portal-amber, #C9822B)"
          />
          <Stat
            label="Upcoming Deliveries"
            value={String(totalUpcoming)}
            accent="var(--portal-sky, #8CA8B8)"
          />
        </div>
      )}

      {/* Filters */}
      <div className="space-y-3">
        <div className="relative max-w-xl">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by project name, address, or plan…"
            className="h-10 w-full pl-10 pr-9 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--portal-amber,#C9822B)]/30"
            style={{
              background: 'var(--portal-bg-card, #FFFFFF)',
              border: '1px solid var(--portal-border, #E8DFD0)',
              color: 'var(--portal-text-strong, #3E2A1E)',
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 inline-flex items-center justify-center rounded-full hover:bg-[var(--portal-bg-elevated)]"
              aria-label="Clear search"
            >
              <X
                className="w-3 h-3"
                style={{ color: 'var(--portal-text-muted, #6B6056)' }}
              />
            </button>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {communities.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-[10px] uppercase tracking-wider font-semibold"
                style={{ color: 'var(--portal-kiln-oak, #8B6F47)' }}
              >
                Community:
              </span>
              <button
                type="button"
                onClick={() => setCommunity('')}
                className="h-7 px-2.5 rounded-full text-[11px] font-medium transition-colors"
                style={
                  !community
                    ? {
                        background: 'var(--portal-walnut, #3E2A1E)',
                        color: 'white',
                      }
                    : {
                        background: 'var(--portal-bg-card, #FFFFFF)',
                        color: 'var(--portal-text-strong, #3E2A1E)',
                        border: '1px solid var(--portal-border, #E8DFD0)',
                      }
                }
              >
                All
              </button>
              {communities.slice(0, 8).map((c) => {
                const active = community === c
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCommunity(c)}
                    className="h-7 px-2.5 rounded-full text-[11px] font-medium transition-colors truncate max-w-[180px]"
                    style={
                      active
                        ? {
                            background: 'var(--portal-walnut, #3E2A1E)',
                            color: 'white',
                          }
                        : {
                            background: 'var(--portal-bg-card, #FFFFFF)',
                            color: 'var(--portal-text-strong, #3E2A1E)',
                            border: '1px solid var(--portal-border, #E8DFD0)',
                          }
                    }
                    title={c}
                  >
                    {c}
                  </button>
                )
              })}
            </div>
          )}
          {statusOptions.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-[10px] uppercase tracking-wider font-semibold"
                style={{ color: 'var(--portal-kiln-oak, #8B6F47)' }}
              >
                Status:
              </span>
              <button
                type="button"
                onClick={() => setStatus('')}
                className="h-7 px-2.5 rounded-full text-[11px] font-medium transition-colors"
                style={
                  !status
                    ? {
                        background: 'var(--portal-walnut, #3E2A1E)',
                        color: 'white',
                      }
                    : {
                        background: 'var(--portal-bg-card, #FFFFFF)',
                        color: 'var(--portal-text-strong, #3E2A1E)',
                        border: '1px solid var(--portal-border, #E8DFD0)',
                      }
                }
              >
                All
              </button>
              {statusOptions.map((s) => {
                const active = status === s
                const badge = STATUS_BADGE[s]
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    className="h-7 px-2.5 rounded-full text-[11px] font-medium transition-colors"
                    style={
                      active
                        ? {
                            background: 'var(--portal-walnut, #3E2A1E)',
                            color: 'white',
                          }
                        : {
                            background: 'var(--portal-bg-card, #FFFFFF)',
                            color: 'var(--portal-text-strong, #3E2A1E)',
                            border: '1px solid var(--portal-border, #E8DFD0)',
                          }
                    }
                  >
                    {badge?.label ?? s}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Project grid */}
      {filtered.length === 0 ? (
        <PortalCard>
          <div
            className="px-6 py-16 text-center"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            <Building2
              className="w-10 h-10 mx-auto mb-3 opacity-30"
              aria-hidden="true"
            />
            <p
              className="text-base font-medium"
              style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
            >
              {projects.length === 0
                ? 'No projects yet'
                : 'No projects match your filters'}
            </p>
            <p className="text-sm mt-1 max-w-sm mx-auto">
              {projects.length === 0
                ? 'Once your first quote is created, the project will appear here.'
                : 'Try clearing the search or community filter.'}
            </p>
          </div>
        </PortalCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  )
}

function ProjectCard({ project }: { project: PortalProjectRow }) {
  const badge = STATUS_BADGE[project.status] || STATUS_BADGE.DRAFT
  return (
    <Link
      href={`/portal/orders?q=${encodeURIComponent(project.name)}`}
      className="group block rounded-[14px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--portal-amber,#C9822B)] focus-visible:ring-offset-2"
    >
      <div
        className="relative h-full p-4 rounded-[14px] transition-shadow group-hover:shadow-md"
        style={{
          background: 'var(--portal-bg-card, #FFFFFF)',
          border: '1px solid var(--portal-border-light, #F0E8DA)',
        }}
      >
        {/* Top row: status + spend */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
            style={{ background: badge.bg, color: badge.fg }}
          >
            {badge.label}
          </span>
          <div className="text-right">
            <div
              className="text-[10px] uppercase tracking-wider"
              style={{ color: 'var(--portal-kiln-oak, #8B6F47)' }}
            >
              Spend
            </div>
            <div
              className="text-sm font-semibold tabular-nums font-mono"
              style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
            >
              {fmtUsd(project.totalSpend)}
            </div>
          </div>
        </div>

        {/* Title */}
        <h3
          className="text-base font-medium leading-tight line-clamp-2 mb-1"
          style={{
            fontFamily: 'var(--font-portal-display, Georgia)',
            color: 'var(--portal-text-strong, #3E2A1E)',
            letterSpacing: '-0.01em',
          }}
        >
          {project.name}
        </h3>
        {project.planName && (
          <div
            className="text-xs mb-1"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            Plan: {project.planName}
          </div>
        )}
        {project.address && (
          <div
            className="text-xs flex items-center gap-1 mb-1"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">{project.address}</span>
          </div>
        )}
        {project.community && (
          <div
            className="text-xs flex items-center gap-1"
            style={{ color: 'var(--portal-text-muted, #6B6056)' }}
          >
            <Building2 className="w-3 h-3 shrink-0" />
            <span className="truncate">{project.community}</span>
          </div>
        )}

        {/* Footer stats */}
        <div
          className="mt-4 pt-3 grid grid-cols-3 gap-2 text-center"
          style={{ borderTop: '1px solid var(--portal-border-light, #F0E8DA)' }}
        >
          <Mini
            icon={<Box className="w-3 h-3" />}
            label="Orders"
            value={project.orderCount}
          />
          <Mini
            icon={<Truck className="w-3 h-3" />}
            label="Coming"
            value={project.upcomingDeliveryCount}
          />
          <Mini
            icon={<Calendar className="w-3 h-3" />}
            label="Next"
            value={fmtDate(project.nextDeliveryDate)}
          />
        </div>

        {/* Hover affordance */}
        <ChevronRight
          className="absolute bottom-4 right-4 w-4 h-4 opacity-0 group-hover:opacity-60 transition-opacity"
          style={{ color: 'var(--portal-walnut, #3E2A1E)' }}
        />
      </div>
    </Link>
  )
}

function Mini({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
}) {
  return (
    <div>
      <div
        className="flex items-center justify-center gap-1 text-[9px] uppercase tracking-wider"
        style={{ color: 'var(--portal-kiln-oak, #8B6F47)' }}
      >
        {icon}
        {label}
      </div>
      <div
        className="text-sm font-medium tabular-nums mt-0.5"
        style={{ color: 'var(--portal-text-strong, #3E2A1E)' }}
      >
        {value}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent: string
}) {
  return (
    <div
      className="rounded-[14px] p-4 relative overflow-hidden"
      style={{
        background: 'var(--portal-bg-card, #FFFFFF)',
        border: '1px solid var(--portal-border-light, #F0E8DA)',
      }}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ background: accent }}
      />
      <div className="pl-1.5">
        <div
          className="text-[10px] uppercase tracking-wider font-semibold"
          style={{ color: 'var(--portal-kiln-oak, #8B6F47)' }}
        >
          {label}
        </div>
        <div
          className="text-2xl font-semibold tabular-nums mt-1"
          style={{
            fontFamily: 'var(--font-portal-display, Georgia)',
            color: 'var(--portal-text-strong, #3E2A1E)',
            letterSpacing: '-0.02em',
          }}
        >
          {value}
        </div>
      </div>
    </div>
  )
}
