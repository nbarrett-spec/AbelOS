'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { StaffAuthGuard } from '@/components/StaffAuthGuard'
import type { StaffRole } from '@/lib/permissions'

// ── Types ────────────────────────────────────────────────────────────────
interface JobOnTruck {
  jobId: string
  jobNumber: string
  builderName: string
  jobAddress: string | null
  community: string | null
  jobStatus: string
  loadConfirmed: boolean
  deliveryNumber: string
  deliveryStatus: string
  materialStatus: 'READY' | 'PARTIAL' | 'PENDING' | 'SHORT'
  materialCounts: { reserved: number; picked: number; short: number }
}
interface TruckCard {
  truckId: string | null
  truckName: string
  vehiclePlate: string | null
  scheduledDeparture: string | null
  loadStatus: 'PENDING' | 'LOADING' | 'LOADED' | 'DEPARTED'
  jobs: JobOnTruck[]
  departedAt: string | null
}
interface ProductionJob {
  jobId: string
  jobNumber: string
  builderName: string
  community: string | null
  jobAddress: string | null
  scheduledDate: string
  status: string
  pickListGenerated: boolean
  materialsLocked: boolean
  dropPlan: string | null
  buildSheetNotes: string | null
  pmName: string | null
  pickCount: number
}
interface IncomingPO {
  poId: string
  poNumber: string
  expectedDate: string
  status: string
  total: number
  vendorId: string | null
  vendorName: string | null
  lineCount: number
  crossDockFlags: number
}
interface ShortageJob {
  jobId: string
  jobNumber: string
  builderName: string
  scheduledDate: string
  status: string
  shortCount: number
}
interface GoldStockLow { id: string; name: string; minQty: number; currentQty: number }
interface CycleCountBatch { id: string; batchNumber: string; status: string; startedAt: string; lineCount: number; countedCount: number }
interface InboxItemMini { id: string; title: string; description: string | null; priority: string; dueBy: string | null; createdAt: string }
interface TeamMember { id: string; firstName: string; lastName: string; role: string; title?: string | null }
interface DriverRow extends TeamMember { crewId: string | null; crewName: string | null; vehiclePlate: string | null; stopsToday: number }

interface DailyPlan {
  generatedAt: string
  summary: {
    trucksOut: number
    productionJobs: number
    incomingPOs: number
    exceptionCount: number
    teamOnShift: number
  }
  sections: {
    todayDeliveries: TruckCard[]
    productionQueue: ProductionJob[]
    incomingPOs: IncomingPO[]
    exceptions: {
      shortageJobs: ShortageJob[]
      goldStockLow: GoldStockLow[]
      cycleCounts: CycleCountBatch[]
      materialConfirmItems: InboxItemMini[]
    }
    teamQueue: {
      drivers: DriverRow[]
      warehouseTeam: TeamMember[]
    }
  }
}

// ── Permissions for this page ────────────────────────────────────────────
const DAILY_PLAN_ROLES: StaffRole[] = [
  'ADMIN',
  'MANAGER',
  'WAREHOUSE_LEAD',
  'WAREHOUSE_TECH',
  'DRIVER',
  'INSTALLER',
]

// ── Utility formatters ───────────────────────────────────────────────────
function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch { return '—' }
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  } catch { return '—' }
}

// ── Status color helpers (walnut/gold/cream + data colors) ──────────────
const LOAD_STATUS_STYLE: Record<TruckCard['loadStatus'], { bg: string; fg: string; label: string }> = {
  PENDING: { bg: '#2A1C14', fg: '#E8D9C9', label: 'PENDING' },
  LOADING: { bg: '#A86B1F', fg: '#FDF6E8', label: 'LOADING' },
  LOADED:  { bg: '#23632C', fg: '#EEF7EF', label: 'LOADED' },
  DEPARTED:{ bg: '#3E4861', fg: '#EEF0F5', label: 'DEPARTED' },
}
const MAT_STATUS_STYLE: Record<JobOnTruck['materialStatus'], { bg: string; fg: string; label: string }> = {
  READY:   { bg: '#23632C', fg: '#EEF7EF', label: 'READY' },
  PARTIAL: { bg: '#A86B1F', fg: '#FDF6E8', label: 'PARTIAL' },
  PENDING: { bg: '#3E2A1E', fg: '#E8D9C9', label: 'WAITING' },
  SHORT:   { bg: '#9B3826', fg: '#FAEEEB', label: 'SHORT' },
}

// ── Page body (guarded) ──────────────────────────────────────────────────
export default function DailyPlanPage() {
  return (
    <StaffAuthGuard requiredRoles={DAILY_PLAN_ROLES}>
      <DailyPlanDashboard />
    </StaffAuthGuard>
  )
}

function DailyPlanDashboard() {
  const [plan, setPlan] = useState<DailyPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  const fetchPlan = useCallback(async () => {
    try {
      setError(null)
      const res = await fetch('/api/ops/warehouse/daily-plan', { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as DailyPlan
      setPlan(data)
      setLastRefreshed(new Date())
    } catch (e: any) {
      setError(e?.message || 'Failed to load daily plan')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchPlan() }, [fetchPlan])

  // Auto-refresh every 60s
  useEffect(() => {
    const int = setInterval(() => { fetchPlan() }, 60_000)
    return () => clearInterval(int)
  }, [fetchPlan])

  // Keyboard: Cmd/Ctrl+R triggers manual refresh (without full page reload)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault()
        fetchPlan()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fetchPlan])

  if (loading && !plan) {
    return (
      <div style={styles.loadingWrap}>
        <div style={styles.spinner} />
        <p style={{ color: '#E8D9C9', marginTop: 16, fontSize: 18 }}>Loading daily plan…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (error && !plan) {
    return (
      <div style={{ ...styles.root, padding: 32 }}>
        <h1 style={{ color: '#E9AE4F', fontSize: 28, margin: 0 }}>Daily Plan</h1>
        <div style={{ marginTop: 24, padding: 20, background: '#42160E', color: '#F1CFC6', borderRadius: 12, maxWidth: 640 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Could not load plan</p>
          <p style={{ margin: '6px 0 12px', fontSize: 14, opacity: 0.9 }}>{error}</p>
          <button onClick={() => fetchPlan()} style={styles.primaryButton}>Retry</button>
        </div>
      </div>
    )
  }

  if (!plan) return null

  const { summary, sections } = plan
  const hasExceptions =
    sections.exceptions.shortageJobs.length > 0 ||
    sections.exceptions.goldStockLow.length > 0 ||
    sections.exceptions.cycleCounts.length > 0 ||
    sections.exceptions.materialConfirmItems.length > 0

  return (
    <div style={styles.root}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @media print {
          .dp-no-print { display: none !important; }
          .dp-root { background: #fff !important; color: #1C120C !important; }
          .dp-card { break-inside: avoid; background: #fff !important; color: #1C120C !important; border: 1px solid #C9A98C !important; }
          .dp-section-h { color: #2A1C14 !important; }
          .dp-muted { color: #5A4233 !important; }
        }
      `}</style>

      {/* ── Header ──────────────────────────────────────── */}
      <div style={styles.header} className="dp-no-print">
        <div>
          <div style={{ fontSize: 12, letterSpacing: 2, color: '#C6A24E', fontWeight: 700 }}>AEGIS / WAREHOUSE</div>
          <h1 style={styles.title}>Daily Production Plan</h1>
          <p style={styles.subtitle}>{fmtDate(new Date().toISOString())} · 8 AM Standup · auto-refresh 60s</p>
        </div>
        <div style={styles.headerRight}>
          <div style={styles.refreshMeta}>
            <div style={{ fontSize: 11, color: '#9C7A5C', letterSpacing: 1 }}>LAST REFRESH</div>
            <div style={{ fontSize: 14, color: '#E8D9C9', fontFamily: 'Azeret Mono, monospace' }}>
              {lastRefreshed ? fmtTime(lastRefreshed.toISOString()) : '—'}
            </div>
          </div>
          <button onClick={() => fetchPlan()} style={styles.refreshButton} title="Refresh (⌘R)">
            ⟳ Refresh
          </button>
          <button onClick={() => typeof window !== 'undefined' && window.print()} style={styles.printButton} title="Print to hang on wall">
            Print
          </button>
        </div>
      </div>

      {/* ── Summary strip ──────────────────────────────── */}
      <div style={styles.summaryStrip}>
        <SummaryPill label="TRUCKS OUT" value={summary.trucksOut} accent="#C6A24E" />
        <SummaryPill label="PRODUCTION" value={summary.productionJobs} accent="#E9AE4F" />
        <SummaryPill label="PO ARRIVALS" value={summary.incomingPOs} accent="#6FBA78" />
        <SummaryPill label="EXCEPTIONS" value={summary.exceptionCount} accent={summary.exceptionCount > 0 ? '#D07564' : '#6E543D'} />
        <SummaryPill label="ON SHIFT" value={summary.teamOnShift} accent="#A5AFC3" />
      </div>

      {/* ── Main grid: main column + right sidebar ──────── */}
      <div style={styles.mainGrid}>
        <div style={styles.mainColumn}>

          {/* SECTION 1: Today Deliveries */}
          <section style={{ marginBottom: 28 }}>
            <SectionHeader title="Today — Trucks Loading Out" count={sections.todayDeliveries.length} accent="#C6A24E" />
            {sections.todayDeliveries.length === 0 ? (
              <EmptyCard message="No deliveries scheduled today." />
            ) : (
              <div style={styles.truckGrid}>
                {sections.todayDeliveries.map((truck, i) => {
                  const loadStyle = LOAD_STATUS_STYLE[truck.loadStatus]
                  return (
                    <div key={truck.truckId || `t_${i}`} style={styles.truckCard} className="dp-card">
                      <div style={styles.truckHeader}>
                        <div>
                          <div style={styles.truckName}>{truck.truckName}</div>
                          {truck.vehiclePlate && (
                            <div style={{ fontSize: 12, color: '#9C7A5C', fontFamily: 'Azeret Mono, monospace' }}>
                              {truck.vehiclePlate}
                            </div>
                          )}
                        </div>
                        <span style={{ ...styles.badge, background: loadStyle.bg, color: loadStyle.fg }}>
                          {loadStyle.label}
                        </span>
                      </div>
                      <div style={styles.truckMeta}>
                        <span className="dp-muted" style={{ color: '#C9A98C', fontSize: 12 }}>
                          Depart: {fmtTime(truck.scheduledDeparture)}
                        </span>
                        <span className="dp-muted" style={{ color: '#C9A98C', fontSize: 12 }}>
                          {truck.jobs.length} {truck.jobs.length === 1 ? 'stop' : 'stops'}
                        </span>
                      </div>
                      <div style={{ marginTop: 10 }}>
                        {truck.jobs.map(job => {
                          const matStyle = MAT_STATUS_STYLE[job.materialStatus]
                          return (
                            <Link
                              key={job.deliveryNumber + job.jobId}
                              href={`/ops/jobs/${job.jobId}`}
                              style={styles.jobRow}
                            >
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, color: '#F5EFE9', fontSize: 14 }}>
                                  {job.jobNumber}
                                </div>
                                <div style={{ fontSize: 12, color: '#C9A98C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {job.builderName}{job.community ? ` · ${job.community}` : ''}
                                </div>
                              </div>
                              <span style={{ ...styles.badgeSm, background: matStyle.bg, color: matStyle.fg }}>
                                {matStyle.label}
                              </span>
                            </Link>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* SECTION 2: Production Queue */}
          <section style={{ marginBottom: 28 }}>
            <SectionHeader title="Production Queue — Next 48h" count={sections.productionQueue.length} accent="#E9AE4F" />
            {sections.productionQueue.length === 0 ? (
              <EmptyCard message="Nothing queued for production in the next two days." />
            ) : (
              <div style={styles.prodGrid}>
                {sections.productionQueue.map(job => (
                  <Link key={job.jobId} href={`/ops/jobs/${job.jobId}`} style={{ textDecoration: 'none' }}>
                    <div style={styles.prodCard} className="dp-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 16, color: '#F5EFE9' }}>{job.jobNumber}</div>
                          <div style={{ fontSize: 12, color: '#C9A98C', marginTop: 2 }}>{job.builderName}</div>
                        </div>
                        <span style={{ ...styles.badgeSm, background: '#2A1C14', color: '#E9AE4F', border: '1px solid #6E543D' }}>
                          {job.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      {job.community && (
                        <div style={{ fontSize: 12, color: '#9C7A5C', marginTop: 6 }}>{job.community}</div>
                      )}
                      <div style={styles.prodMetaRow}>
                        <div>
                          <div style={styles.prodMetaLabel}>DROP</div>
                          <div style={styles.prodMetaValue}>{job.dropPlan || '—'}</div>
                        </div>
                        <div>
                          <div style={styles.prodMetaLabel}>PICKS</div>
                          <div style={styles.prodMetaValue}>{job.pickCount}</div>
                        </div>
                        <div>
                          <div style={styles.prodMetaLabel}>SCHEDULED</div>
                          <div style={styles.prodMetaValue}>{fmtDate(job.scheduledDate)}</div>
                        </div>
                      </div>
                      {job.pmName && (
                        <div style={{ marginTop: 8, fontSize: 11, color: '#C6A24E', letterSpacing: 0.5 }}>
                          PM · {job.pmName}
                        </div>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* SECTION 3: Incoming POs */}
          <section style={{ marginBottom: 28 }}>
            <SectionHeader title="Incoming PO Arrivals — Today + 48h" count={sections.incomingPOs.length} accent="#6FBA78" />
            {sections.incomingPOs.length === 0 ? (
              <EmptyCard message="No POs scheduled to arrive in the next two days." />
            ) : (
              <div style={styles.poList}>
                {sections.incomingPOs.map(po => (
                  <Link key={po.poId} href={`/ops/purchase-orders/${po.poId}`} style={{ textDecoration: 'none' }}>
                    <div style={styles.poRow} className="dp-card">
                      <div style={{ flex: '0 0 130px' }}>
                        <div style={{ fontWeight: 700, color: '#F5EFE9', fontSize: 15, fontFamily: 'Azeret Mono, monospace' }}>
                          {po.poNumber}
                        </div>
                        <div style={{ fontSize: 11, color: '#9C7A5C' }}>{po.status.replace(/_/g, ' ')}</div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: '#E8D9C9', fontSize: 14 }}>
                          {po.vendorName || '(no vendor)'}
                        </div>
                        <div style={{ fontSize: 12, color: '#C9A98C', marginTop: 2 }}>
                          {po.lineCount} {po.lineCount === 1 ? 'line' : 'lines'}
                          {po.total > 0 ? ` · $${Math.round(po.total).toLocaleString()}` : ''}
                        </div>
                      </div>
                      <div style={{ flex: '0 0 auto', textAlign: 'right', marginLeft: 12 }}>
                        <div style={{ fontSize: 12, color: '#C6A24E', fontWeight: 700 }}>
                          {fmtDate(po.expectedDate)}
                        </div>
                        <div style={{ fontSize: 11, color: '#C9A98C', fontFamily: 'Azeret Mono, monospace' }}>
                          {fmtTime(po.expectedDate)}
                        </div>
                      </div>
                      {po.crossDockFlags > 0 && (
                        <span style={{ ...styles.badge, background: '#9B3826', color: '#FAEEEB', marginLeft: 12, animation: 'none' }}>
                          CROSS-DOCK · {po.crossDockFlags}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* SECTION 4: Exceptions */}
          <section style={{ marginBottom: 28 }}>
            <SectionHeader title="Exceptions" count={summary.exceptionCount} accent="#D07564" />
            {!hasExceptions ? (
              <EmptyCard message="No exceptions — clean slate." />
            ) : (
              <div style={styles.exceptionsWrap}>
                {sections.exceptions.shortageJobs.length > 0 && (
                  <ExceptionGroup title="Material Shortages" tone="RED">
                    {sections.exceptions.shortageJobs.map(s => (
                      <Link key={s.jobId} href={`/ops/jobs/${s.jobId}`} style={styles.exceptionRow}>
                        <div>
                          <div style={{ fontWeight: 700, color: '#F1CFC6' }}>{s.jobNumber}</div>
                          <div style={{ fontSize: 12, color: '#E3A495' }}>{s.builderName} · {fmtDate(s.scheduledDate)}</div>
                        </div>
                        <span style={{ ...styles.badgeSm, background: '#7D2B1C', color: '#FAEEEB' }}>
                          {s.shortCount} short
                        </span>
                      </Link>
                    ))}
                  </ExceptionGroup>
                )}
                {sections.exceptions.goldStockLow.length > 0 && (
                  <ExceptionGroup title="Gold Stock Below Min" tone="AMBER">
                    {sections.exceptions.goldStockLow.map(g => (
                      <div key={g.id} style={styles.exceptionRow}>
                        <div>
                          <div style={{ fontWeight: 700, color: '#F9E4BB' }}>{g.name}</div>
                          <div style={{ fontSize: 12, color: '#E9AE4F' }}>
                            on-hand {g.currentQty} / min {g.minQty}
                          </div>
                        </div>
                      </div>
                    ))}
                  </ExceptionGroup>
                )}
                {sections.exceptions.cycleCounts.length > 0 && (
                  <ExceptionGroup title="Active Cycle Counts" tone="BLUE">
                    {sections.exceptions.cycleCounts.map(c => (
                      <div key={c.id} style={styles.exceptionRow}>
                        <div>
                          <div style={{ fontWeight: 700, color: '#D4D9E3' }}>{c.batchNumber}</div>
                          <div style={{ fontSize: 12, color: '#A5AFC3' }}>
                            {c.countedCount}/{c.lineCount} counted · {c.status}
                          </div>
                        </div>
                      </div>
                    ))}
                  </ExceptionGroup>
                )}
                {sections.exceptions.materialConfirmItems.length > 0 && (
                  <ExceptionGroup title="Material Confirm Required (T-7)" tone="AMBER">
                    {sections.exceptions.materialConfirmItems.map(m => (
                      <div key={m.id} style={styles.exceptionRow}>
                        <div>
                          <div style={{ fontWeight: 700, color: '#F9E4BB' }}>{m.title}</div>
                          {m.description && (
                            <div style={{ fontSize: 12, color: '#E9AE4F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 480 }}>
                              {m.description}
                            </div>
                          )}
                        </div>
                        <span style={{ ...styles.badgeSm, background: '#5E3A0E', color: '#F9E4BB' }}>
                          {m.priority}
                        </span>
                      </div>
                    ))}
                  </ExceptionGroup>
                )}
              </div>
            )}
          </section>
        </div>

        {/* ── SECTION 5: Right sidebar / Team Queue ─────── */}
        <aside style={styles.sidebar}>
          <SectionHeader title="Team on Shift" count={summary.teamOnShift} accent="#A5AFC3" />

          <div style={styles.teamGroup}>
            <div style={styles.teamGroupLabel}>DRIVERS</div>
            {sections.teamQueue.drivers.length === 0 ? (
              <div style={{ color: '#9C7A5C', fontSize: 13, padding: 8 }}>No active drivers.</div>
            ) : (
              sections.teamQueue.drivers.map(d => (
                <div key={d.id} style={styles.teamRow}>
                  <div>
                    <div style={{ color: '#F5EFE9', fontSize: 14, fontWeight: 600 }}>
                      {d.firstName} {d.lastName}
                    </div>
                    <div style={{ color: '#C9A98C', fontSize: 12 }}>
                      {d.crewName || 'no crew'}{d.vehiclePlate ? ` · ${d.vehiclePlate}` : ''}
                    </div>
                  </div>
                  <span style={{ ...styles.badgeSm, background: '#2A1C14', color: '#C6A24E', border: '1px solid #6E543D' }}>
                    {d.stopsToday} stops
                  </span>
                </div>
              ))
            )}
          </div>

          <div style={styles.teamGroup}>
            <div style={styles.teamGroupLabel}>WAREHOUSE</div>
            {sections.teamQueue.warehouseTeam.length === 0 ? (
              <div style={{ color: '#9C7A5C', fontSize: 13, padding: 8 }}>No warehouse staff active.</div>
            ) : (
              sections.teamQueue.warehouseTeam.map(t => (
                <div key={t.id} style={styles.teamRow}>
                  <div>
                    <div style={{ color: '#F5EFE9', fontSize: 14, fontWeight: 600 }}>
                      {t.firstName} {t.lastName}
                    </div>
                    <div style={{ color: '#C9A98C', fontSize: 12 }}>
                      {t.title || t.role.replace(/_/g, ' ')}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>

      {/* Footer generated-at */}
      <div style={{ textAlign: 'center', padding: '20px 0 32px', color: '#6E543D', fontSize: 11, letterSpacing: 2 }} className="dp-no-print">
        GENERATED {fmtTime(plan.generatedAt)} · AUTO-REFRESH 60s · ⌘R TO REFRESH
      </div>
    </div>
  )
}

// ── Tiny sub-components ──────────────────────────────────────────────────
function SummaryPill({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div style={{ ...styles.summaryPill, borderLeftColor: accent }} className="dp-card">
      <div style={{ fontSize: 11, color: '#C9A98C', letterSpacing: 2 }}>{label}</div>
      <div style={{ fontSize: 34, fontWeight: 700, color: '#F5EFE9', lineHeight: 1.1, fontFamily: 'Instrument Serif, serif' }}>
        {value}
      </div>
    </div>
  )
}
function SectionHeader({ title, count, accent }: { title: string; count: number; accent: string }) {
  return (
    <div style={styles.sectionHeader}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <div style={{ width: 6, height: 24, background: accent, borderRadius: 2 }} />
        <h2 className="dp-section-h" style={{ fontSize: 20, fontWeight: 700, color: '#F5EFE9', margin: 0 }}>
          {title}
        </h2>
        <span style={{ fontSize: 14, color: '#9C7A5C', fontFamily: 'Azeret Mono, monospace' }}>
          {count}
        </span>
      </div>
    </div>
  )
}
function EmptyCard({ message }: { message: string }) {
  return (
    <div style={{ ...styles.emptyCard }} className="dp-card">
      {message}
    </div>
  )
}
function ExceptionGroup({ title, tone, children }: { title: string; tone: 'RED' | 'AMBER' | 'BLUE'; children: React.ReactNode }) {
  const accent = tone === 'RED' ? '#9B3826' : tone === 'AMBER' ? '#A86B1F' : '#3E4861'
  return (
    <div style={{ ...styles.exceptionGroup, borderTopColor: accent }} className="dp-card">
      <div style={{ fontSize: 12, letterSpacing: 2, color: accent, fontWeight: 700, marginBottom: 8 }}>
        {title.toUpperCase()}
      </div>
      <div>{children}</div>
    </div>
  )
}

// ── Styles (inline object — wall display / dark / walnut+gold+cream) ────
const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    background: '#0F0906',
    color: '#F5EFE9',
    fontFamily: "'Outfit', ui-sans-serif, system-ui, -apple-system, sans-serif",
    padding: '24px 32px 40px',
  },
  loadingWrap: {
    minHeight: '100vh',
    background: '#0F0906',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    width: 52, height: 52,
    border: '4px solid #3E2A1E',
    borderTopColor: '#C6A24E',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: 16,
    borderBottom: '1px solid #2A1C14',
    paddingBottom: 16,
    marginBottom: 20,
  },
  title: {
    fontFamily: "'Instrument Serif', Georgia, serif",
    fontSize: 46,
    margin: '4px 0 0',
    color: '#F3EAD8',
    letterSpacing: -1,
  },
  subtitle: { color: '#9C7A5C', margin: '6px 0 0', fontSize: 14 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 12 },
  refreshMeta: { textAlign: 'right', paddingRight: 8, borderRight: '1px solid #2A1C14', marginRight: 4 },
  refreshButton: {
    padding: '10px 18px',
    background: '#2A1C14',
    color: '#E8D9C9',
    border: '1px solid #6E543D',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
  },
  printButton: {
    padding: '10px 18px',
    background: '#C6A24E',
    color: '#2A1C14',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 700,
  },
  primaryButton: {
    padding: '10px 18px',
    background: '#C6A24E',
    color: '#2A1C14',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 700,
  },
  summaryStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 12,
    marginBottom: 24,
  },
  summaryPill: {
    background: '#1C120C',
    border: '1px solid #2A1C14',
    borderLeft: '4px solid #C6A24E',
    borderRadius: 10,
    padding: '14px 18px',
  },
  mainGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 320px',
    gap: 24,
    alignItems: 'start',
  },
  mainColumn: { minWidth: 0 },
  sidebar: {
    position: 'sticky',
    top: 16,
    background: '#1C120C',
    border: '1px solid #2A1C14',
    borderRadius: 12,
    padding: 16,
    maxHeight: 'calc(100vh - 48px)',
    overflowY: 'auto',
  },
  sectionHeader: { marginBottom: 12 },
  truckGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 14,
  },
  truckCard: {
    background: '#1C120C',
    border: '1px solid #2A1C14',
    borderRadius: 12,
    padding: 16,
  },
  truckHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  truckName: { fontSize: 17, fontWeight: 700, color: '#F3EAD8' },
  truckMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    borderTop: '1px solid #2A1C14',
    borderBottom: '1px solid #2A1C14',
    padding: '6px 0',
  },
  jobRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '8px 4px',
    borderBottom: '1px solid #2A1C14',
    textDecoration: 'none',
    color: 'inherit',
  },
  prodGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 14,
  },
  prodCard: {
    background: '#1C120C',
    border: '1px solid #2A1C14',
    borderRadius: 12,
    padding: 14,
    cursor: 'pointer',
    transition: 'border-color 0.2s',
  },
  prodMetaRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTop: '1px solid #2A1C14',
  },
  prodMetaLabel: { fontSize: 9, color: '#9C7A5C', letterSpacing: 1.5, fontWeight: 700 },
  prodMetaValue: { fontSize: 13, color: '#E8D9C9', marginTop: 2, fontFamily: 'Azeret Mono, monospace' },
  poList: { display: 'flex', flexDirection: 'column', gap: 8 },
  poRow: {
    display: 'flex',
    alignItems: 'center',
    background: '#1C120C',
    border: '1px solid #2A1C14',
    borderRadius: 10,
    padding: '12px 16px',
    textDecoration: 'none',
    color: 'inherit',
    cursor: 'pointer',
  },
  exceptionsWrap: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 },
  exceptionGroup: {
    background: '#1C120C',
    border: '1px solid #2A1C14',
    borderTop: '3px solid #9B3826',
    borderRadius: 10,
    padding: 14,
  },
  exceptionRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '8px 0',
    borderBottom: '1px solid #2A1C14',
    textDecoration: 'none',
    color: 'inherit',
  },
  emptyCard: {
    background: '#1C120C',
    border: '1px dashed #3E2A1E',
    borderRadius: 10,
    padding: 24,
    textAlign: 'center',
    color: '#9C7A5C',
    fontStyle: 'italic',
    fontSize: 14,
  },
  teamGroup: { marginTop: 14 },
  teamGroupLabel: {
    fontSize: 11,
    letterSpacing: 2,
    color: '#C6A24E',
    fontWeight: 700,
    borderBottom: '1px solid #2A1C14',
    paddingBottom: 6,
    marginBottom: 8,
  },
  teamRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '6px 2px',
    borderBottom: '1px solid #2A1C14',
  },
  badge: {
    display: 'inline-block',
    padding: '5px 10px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1,
  },
  badgeSm: {
    display: 'inline-block',
    padding: '3px 8px',
    borderRadius: 5,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.5,
    whiteSpace: 'nowrap',
  },
}
