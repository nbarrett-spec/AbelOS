'use client'

/**
 * Aegis Home — tier-aware hero. Same page, tier-selected content.
 * Pass ?tenant=<slug> in dev to preview any tenant from the roster.
 * Default: brookfield (T5 Production-Large).
 *
 * Reference: AEGIS_TIER_DRIVEN_BUILD_PLAN.md §4.3.
 */

import Link from 'next/link'
import {
  Banknote,
  Calendar,
  FileSignature,
  HardHat,
  Hammer,
  MessageSquare,
  Package,
  Pencil,
  Receipt,
  Ruler,
  Truck,
  Wrench,
  CheckCircle2,
  Home as HomeIcon,
  Briefcase,
  Building2,
  Layers,
  LineChart,
} from 'lucide-react'
import {
  SectionLabel,
  StatusChip,
  KpiTile,
  ExceptionCard,
  QuickActionTile,
  CopilotBar,
  ConfidenceBar,
  TenantSwitcher,
} from '@/components/ui-v2'
import {
  useTenantProfile,
  useTierHomeWidgets,
  useTierNav,
} from '@/hooks/useTenantProfile'
import {
  tierLabel,
  tierShortLabel,
  sizeBandLabel,
  integrationLabel,
} from '@/lib/builder-tiers'

// ── Scenario data per tier ──────────────────────────────────────────────
// The shape is the same at every tier; the *content* reflects the scale
// and workflow of the builder. When we wire real data in Wave 3, this
// will fetch from a tier-aware home dashboard endpoint (route TBD).

type Greeting = { user: string; pending: number; summary: string }
type Kpi = {
  label: string
  value: string | number
  sub?: string
  delta?: string
  trend: 'up' | 'down' | 'flat'
  sparkline: number[]
  accent: 'brand' | 'positive' | 'negative' | 'warning' | 'info'
}
type Exception = {
  key: string
  glyph: React.ReactNode
  title: React.ReactNode
  why: React.ReactNode
  meta?: Array<{ label: string; value: React.ReactNode }>
  tone: 'neutral' | 'negative' | 'warning' | 'info'
  actionLabel?: string
  secondaryLabel?: string
}
type Community = { name: string; on: number; risk: number; late: number }
type Project = { name: string; phase: string; nextMilestone: string; accent: 'brand' | 'warning' | 'info' }
type Delivery = { id: string; number: string; lot: string; items: number; amount: number; eta: string; status: 'on' | 'late' }

function scenarioFor(slug: string, tier: string): {
  greeting: Greeting
  kpis: Kpi[]
  exceptions: Exception[]
  communities?: Community[]
  projects?: Project[]
  deliveries: Delivery[]
  divisions?: Array<{ name: string; starts: number; onTime: number; spend: number }>
} {
  // T1 — Custom · Boutique (Desco, Bella, Alford, Lingenfelter, Homes by J. Anthony)
  if (tier === 'T1_CUSTOM_BOUTIQUE') {
    return {
      greeting: {
        user: 'Alex',
        pending: 2,
        summary:
          "A quote is ready on the Turtle Creek build. Your Preston Hollow door schedule needs a final sign-off before fab.",
      },
      kpis: [
        { label: 'Active projects', value: 3, sub: '2 in design · 1 in trim', delta: '—', trend: 'flat', sparkline: [2, 2, 3, 3, 3, 3, 3], accent: 'brand' },
        { label: 'YTD spend',       value: '$184,210', sub: 'vs $142K last year', delta: '+29.6%', trend: 'up', sparkline: [12, 14, 18, 20, 22, 24, 26], accent: 'brand' },
        { label: 'Open quotes',     value: 1, sub: 'Turtle Creek · due Fri', delta: '—', trend: 'flat', sparkline: [1, 0, 1, 1, 0, 1, 1], accent: 'info' },
        { label: 'Outstanding',     value: '$4,820', sub: '1 invoice · on time', delta: '−$1.2K', trend: 'down', sparkline: [6, 6, 5.5, 5, 5, 5, 4.8], accent: 'positive' },
      ],
      exceptions: [
        {
          key: 'quote-turtle',
          glyph: <FileSignature size={18} />,
          title: <>Quote ready — <span className="v4-numeric">Turtle Creek</span> interior door package.</>,
          why: 'Kiln-dried walnut interior doors, brass Emtek hardware, pre-hung. Lead time 18 business days.',
          meta: [
            { label: 'Total', value: <span className="v4-numeric">$47,320.00</span> },
            { label: 'Expires', value: 'Fri, May 2' },
          ],
          tone: 'info',
          actionLabel: 'Accept quote',
          secondaryLabel: 'Request revise',
        },
        {
          key: 'spec-preston',
          glyph: <Pencil size={18} />,
          title: <>Preston Hollow — door schedule ready to lock.</>,
          why: 'Dalton has confirmed 26 interior + 4 exterior units. Sign off to release to Gainesville fab.',
          meta: [{ label: 'Units', value: <span className="v4-numeric">30</span> }],
          tone: 'warning',
          actionLabel: 'Lock and release',
        },
      ],
      projects: [
        { name: 'Turtle Creek — Barnes residence',     phase: 'Design',  nextMilestone: 'Quote signed', accent: 'info' },
        { name: 'Preston Hollow — Alvarado residence', phase: 'Trim',    nextMilestone: 'Schedule release', accent: 'warning' },
        { name: 'Westlake — Nguyen residence',         phase: 'Install', nextMilestone: 'Punch walk', accent: 'brand' },
      ],
      deliveries: [
        { id: 'd-1', number: 'DEL-00412', lot: 'Westlake — Nguyen', items: 4, amount: 4980, eta: '10:00 AM', status: 'on' },
      ],
    }
  }

  // T3 — Production · Small (Shaddock, Olerio, MSR, Trophy)
  if (tier === 'T3_PRODUCTION_SMALL') {
    return {
      greeting: {
        user: 'Jordan',
        pending: 3,
        summary: 'Two lots are ready for trim release. One invoice just aged into 30 days.',
      },
      kpis: [
        { label: 'Open POs', value: 18, sub: '6 this week', delta: '+2', trend: 'up', sparkline: [12, 14, 13, 15, 16, 17, 18], accent: 'info' },
        { label: 'YTD spend', value: '$612,450', sub: 'vs $498K last year', delta: '+22.9%', trend: 'up', sparkline: [40, 48, 52, 55, 58, 60, 61], accent: 'brand' },
        { label: 'Credit available', value: '$187,550', sub: 'of $250K', delta: 'Net 30', trend: 'flat', sparkline: [240, 230, 220, 210, 200, 195, 188], accent: 'positive' },
        { label: 'Outstanding', value: '$32,110', sub: '2 invoices · 1 due', delta: '—', trend: 'flat', sparkline: [30, 28, 30, 31, 32, 32, 32], accent: 'warning' },
      ],
      exceptions: [
        {
          key: 'po-approve',
          glyph: <FileSignature size={18} />,
          title: <>PO <span className="v4-numeric">#SH-1184</span> awaiting approval — Shaddock Heights Lot 42.</>,
          why: 'Trim 1 pack. Abel flagged kiln-oak casing availability — alt vendor secured, net delta +$62.',
          meta: [
            { label: 'Community', value: 'Shaddock Heights' },
            { label: 'Amount', value: <span className="v4-numeric">$8,940.00</span> },
          ],
          tone: 'warning',
          actionLabel: 'Review & approve',
          secondaryLabel: 'Open redline',
        },
        {
          key: 'inv-aged',
          glyph: <Banknote size={18} />,
          title: <>Invoice <span className="v4-numeric">#1876</span> aged to 31 days.</>,
          why: 'Net 30 lapsed yesterday. Clear this plus one other invoice via batch pay to keep DPO at 28.',
          meta: [
            { label: 'Amount', value: <span className="v4-numeric">$14,220.00</span> },
          ],
          tone: 'negative',
          actionLabel: 'Pay now',
          secondaryLabel: 'Dispute',
        },
        {
          key: 'sched-release',
          glyph: <Pencil size={18} />,
          title: <>Two lots ready for trim release at Shaddock Heights.</>,
          why: 'Frame complete 4/22 on Lots 38 and 42. Abel awaiting your trim-release PO to trigger Gainesville pick.',
          tone: 'info',
          actionLabel: 'Release both',
        },
      ],
      communities: [
        { name: 'Shaddock Heights', on: 12, risk: 2, late: 0 },
        { name: 'Parker Pointe',    on: 8,  risk: 1, late: 1 },
      ],
      deliveries: [
        { id: 'd-1', number: 'DEL-10204', lot: 'Lot 42 · Shaddock Heights', items: 22, amount: 8940, eta: '11:30 AM', status: 'on' },
        { id: 'd-2', number: 'DEL-10206', lot: 'Lot 14 · Parker Pointe',    items: 18, amount: 7620, eta: '2:00 PM',  status: 'on' },
      ],
    }
  }

  // T6 — Production · Enterprise (Lennar, Pulte preserved)
  if (tier === 'T6_PRODUCTION_ENTERPRISE') {
    return {
      greeting: {
        user: 'Diana',
        pending: 11,
        summary:
          'DFW division has 4 POs awaiting approval. Houston EDI 855 lag dropped to 2.3 min (target 3). One invoice batch cleared overnight.',
      },
      kpis: [
        { label: 'Open POs (all divisions)', value: 842, sub: '134 this week', delta: '+12', trend: 'up', sparkline: [720, 740, 760, 780, 800, 820, 842], accent: 'info' },
        { label: 'YTD spend',                value: '$48.2M', sub: 'vs $42.9M last year', delta: '+12.4%', trend: 'up', sparkline: [3.2, 3.6, 3.8, 3.9, 4.0, 4.1, 4.2], accent: 'brand' },
        { label: 'On-time rate',             value: '96.8%', sub: 'trailing 90 days',     delta: '+0.6pp', trend: 'up', sparkline: [95.2, 95.8, 96.0, 96.2, 96.4, 96.6, 96.8], accent: 'positive' },
        { label: 'DSO',                      value: '28.4 days', sub: 'target 28',         delta: '−1.1',   trend: 'down', sparkline: [32, 31, 30, 29.5, 29, 28.8, 28.4], accent: 'positive' },
      ],
      exceptions: [
        {
          key: 'div-dfw',
          glyph: <FileSignature size={18} />,
          title: <>DFW Division — <span className="v4-numeric">4</span> POs awaiting approval.</>,
          why: 'Combined $184K across Mobberly, Treeline, Gateway. Procurement threshold hit at $50K each.',
          meta: [
            { label: 'Community count', value: 3 },
            { label: 'Oldest', value: '6h ago' },
          ],
          tone: 'warning',
          actionLabel: 'Open queue',
          secondaryLabel: 'Delegate',
        },
        {
          key: 'edi-hou',
          glyph: <Truck size={18} />,
          title: <>Houston EDI 855 acks — average 2.3 min (target 3).</>,
          why: 'Ahead of SLA. No action required; logged for the weekly ops review.',
          meta: [{ label: '855s/day', value: <span className="v4-numeric">1,210</span> }],
          tone: 'info',
          actionLabel: 'Open EDI console',
        },
        {
          key: 'batch-cleared',
          glyph: <Banknote size={18} />,
          title: <>Batch payment cleared — <span className="v4-numeric">142</span> invoices, <span className="v4-numeric">$2.18M</span>.</>,
          why: 'Overnight ACH. 100% match rate against POD + PO + Invoice 3-way.',
          tone: 'info',
          actionLabel: 'Remittance summary',
        },
      ],
      communities: [
        { name: 'DFW · Mobberly Farms',     on: 48, risk: 6, late: 2 },
        { name: 'DFW · Treeline Crossing',  on: 52, risk: 3, late: 0 },
        { name: 'DFW · Gateway Heights',    on: 36, risk: 4, late: 2 },
        { name: 'HOU · Cypress Meadows',    on: 62, risk: 5, late: 1 },
        { name: 'AUS · Cedar Park Ridge',   on: 44, risk: 2, late: 0 },
      ],
      divisions: [
        { name: 'DFW Division',     starts: 1420, onTime: 96.2, spend: 18_400_000 },
        { name: 'Houston Division', starts: 1680, onTime: 97.4, spend: 21_200_000 },
        { name: 'Austin Division',  starts: 720,  onTime: 96.8, spend:  8_600_000 },
      ],
      deliveries: [
        { id: 'd-1', number: 'DEL-EDI-88402', lot: 'DFW · Mobberly Lot 214', items: 28, amount: 31220,  eta: '2:40 PM', status: 'late' },
        { id: 'd-2', number: 'DEL-EDI-88415', lot: 'HOU · Cypress Lot 612',  items: 22, amount: 24180,  eta: '3:15 PM', status: 'on' },
        { id: 'd-3', number: 'DEL-EDI-88421', lot: 'DFW · Treeline Lot 41',  items: 34, amount: 42980,  eta: '4:00 PM', status: 'on' },
      ],
    }
  }

  // Default: T4/T5 Production · Mid/Large (Brookfield, Bloomfield, Toll, etc.)
  return {
    greeting: {
      user: 'Brittney',
      pending: 4,
      summary:
        'Two deliveries are on the trucks right now. One invoice just aged past net-30. Chad has a redline waiting on PO #4817. Everything else is running on schedule.',
    },
    kpis: [
      { label: 'Open POs',        value: 47, sub: '12 this week',             delta: '+4',     trend: 'up',   sparkline: [32, 34, 38, 36, 39, 41, 43, 44, 47],    accent: 'info' },
      { label: 'YTD spend',       value: '$2,184,320', sub: 'vs $1.93M a year ago', delta: '+13.2%', trend: 'up', sparkline: [140, 160, 155, 180, 195, 210, 220, 230, 245], accent: 'brand' },
      { label: 'Credit available',value: '$612,450',   sub: 'of $1.00M',       delta: 'Net 30', trend: 'flat', sparkline: [820, 790, 760, 740, 700, 680, 655, 640, 612], accent: 'positive' },
      { label: 'Outstanding AR',  value: '$87,240',    sub: '3 invoices · 1 overdue', delta: '−$12.4K', trend: 'down', sparkline: [140, 130, 120, 110, 105, 99, 96, 94, 87],  accent: 'negative' },
    ],
    exceptions: [
      {
        key: 'po-4817',
        glyph: <FileSignature size={18} />,
        title: <>PO <span className="v4-numeric">#4817</span> for Lot 214 is awaiting your approval.</>,
        why: 'Abel proposed a BoM redline on 3 interior door SKUs. Net delta +$412 (+1.8%). PM: Chad Zeh.',
        meta: [
          { label: 'Community', value: 'Mobberly Farms' },
          { label: 'Amount', value: <span className="v4-numeric">$23,040.50</span> },
          { label: 'Since', value: '4h ago' },
        ],
        tone: 'warning',
        actionLabel: 'Review & approve',
        secondaryLabel: 'Open redline',
      },
      {
        key: 'inv-2214',
        glyph: <Banknote size={18} />,
        title: <>Invoice <span className="v4-numeric">#2214</span> is 4 days overdue.</>,
        why: 'Net 30 lapsed on Apr 19. Abel has not yet dialed; batch-pay with 2 other invoices to keep DPO clean.',
        meta: [
          { label: 'Amount', value: <span className="v4-numeric">$18,970.00</span> },
          { label: 'Days late', value: <span className="v4-numeric">4</span> },
        ],
        tone: 'negative',
        actionLabel: 'Pay now',
        secondaryLabel: 'Dispute',
      },
      {
        key: 'del-truck-12',
        glyph: <Truck size={18} />,
        title: <>Truck <span className="v4-numeric">12</span> running late — ETA slipped to 2:40 PM.</>,
        why: 'Driver reports I-35E slowdown north of Denton. Mobberly Lot 207 delivery window was 1:00–2:00 PM.',
        meta: [
          { label: 'Original ETA', value: '1:15 PM' },
          { label: 'New ETA', value: '2:40 PM' },
        ],
        tone: 'warning',
        actionLabel: 'Reschedule',
        secondaryLabel: 'Notify super',
      },
      {
        key: 'plan-rev-24',
        glyph: <Pencil size={18} />,
        title: <>Plan <span className="v4-numeric">2450 · Rev 4</span> is waiting for your sign-off.</>,
        why: 'Amanda Barham posted the rev Thursday. Affects door schedule on Lots 210, 214, 218 — all currently at trim phase.',
        meta: [
          { label: 'Lots affected', value: <span className="v4-numeric">3</span> },
          { label: 'Net BoM delta', value: <span className="v4-numeric">+$1,418</span> },
        ],
        tone: 'info',
        actionLabel: 'Review plan',
        secondaryLabel: 'Compare to Rev 3',
      },
    ],
    communities: [
      { name: 'Mobberly Farms',    on: 18, risk: 3, late: 1 },
      { name: 'Treeline Crossing', on: 22, risk: 1, late: 0 },
      { name: 'Winchester Park',   on: 11, risk: 2, late: 2 },
      { name: 'Windsor Ridge',     on: 14, risk: 0, late: 0 },
    ],
    deliveries: [
      { id: 'd-1', number: 'DEL-10423', lot: 'Lot 214 · Mobberly',   items: 14, amount: 23040.5, eta: '2:40 PM', status: 'late' },
      { id: 'd-2', number: 'DEL-10427', lot: 'Lot 207 · Mobberly',   items: 8,  amount: 9880.0,  eta: '3:15 PM', status: 'on' },
      { id: 'd-3', number: 'DEL-10431', lot: 'Lot 3 · Winchester',   items: 22, amount: 41120.0, eta: '4:00 PM', status: 'on' },
    ],
  }
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export default function AegisHomePage() {
  const profile = useTenantProfile()
  const nav = useTierNav()
  const widgets = useTierHomeWidgets()
  const scene = scenarioFor(profile.tenantId.replace('demo-', ''), profile.tier)

  const showProjects       = widgets.includes('home.projects')
  const showSchedule       = widgets.includes('home.schedule_confidence')
  const showDivisions      = widgets.includes('home.division_scorecard')
  const rosterName         = profile.tenantId.replace('demo-', '')

  return (
    <div className="aegis-v4">
      <main className="v4-bg-canvas" style={{ minHeight: '100vh', paddingBottom: 96 }}>
        <div className="v4-aurora" style={{ position: 'absolute', inset: '0 0 auto 0', height: 480, pointerEvents: 'none' }} />

        <div style={{ position: 'relative', maxWidth: 1280, margin: '0 auto', padding: '40px 28px 0' }}>
          {/* ── Top bar ────────────────────────────────────────────────── */}
          <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                aria-hidden
                style={{
                  width: 28, height: 28,
                  display: 'grid', placeItems: 'center',
                  borderRadius: 8,
                  background: profile.primaryColor ?? 'var(--v4-walnut-700)',
                  color: 'var(--v4-cream)',
                  fontFamily: 'var(--v4-font-display)',
                  fontSize: 16, fontStyle: 'italic',
                }}
              >
                {rosterName.slice(0, 1).toUpperCase()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.003em' }}>
                  {rosterName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                </div>
                <div style={{ fontFamily: 'var(--v4-font-mono)', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--fg-subtle)' }}>
                  Aegis · {tierLabel(profile.tier)}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <StatusChip tone={profile.status === 'ACTIVE' ? 'info' : profile.status === 'CHURNED' ? 'negative' : 'warning'}>
                {profile.status} · {tierShortLabel(profile.tier)}
              </StatusChip>
              <TenantSwitcher />
            </div>
          </header>

          {/* ── Tier badge strip (preview-only) ────────────────────────── */}
          <section
            className="v4-card"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              padding: '14px 18px',
              gap: 14,
              marginBottom: 28,
            }}
          >
            <TierStat label="Build model"   value={profile.model.replace('_', ' ')} />
            <TierStat label="Size band"     value={profile.size} sub={sizeBandLabel(profile.size)} />
            <TierStat label="Integration"   value={integrationLabel(profile.integration)} />
            <TierStat label="Nav items"     value={String(nav.length)} sub={`${widgets.length} home widgets`} />
          </section>

          {/* ── Greeting ────────────────────────────────────────────────── */}
          <section style={{ marginBottom: 28 }}>
            <SectionLabel>
              Today · {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </SectionLabel>
            <h1
              style={{
                marginTop: 14, marginBottom: 10,
                fontFamily: 'var(--v4-font-sans)',
                fontSize: 34, fontWeight: 500, letterSpacing: '-0.02em',
                color: 'var(--fg)', lineHeight: 1.1,
              }}
            >
              Good morning, {scene.greeting.user}.{' '}
              <span className="v4-display" style={{ color: 'var(--signal)' }}>
                {wordFor(scene.greeting.pending)}
              </span>{' '}
              item{scene.greeting.pending === 1 ? '' : 's'} need{scene.greeting.pending === 1 ? 's' : ''} a decision.
            </h1>
            <p style={{ fontSize: 14.5, color: 'var(--fg-muted)', maxWidth: 720, lineHeight: 1.5 }}>
              {scene.greeting.summary}
            </p>
          </section>

          {/* ── Copilot prompt ─────────────────────────────────────────── */}
          <section style={{ marginBottom: 32 }}>
            <CopilotBar />
          </section>

          {/* ── Urgency feed (always present) ──────────────────────────── */}
          <section style={{ marginBottom: 36 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
              <SectionLabel>Needs a decision</SectionLabel>
              <Link href="/dashboard/activity" style={{ fontSize: 12, fontWeight: 600, color: 'var(--signal)', textDecoration: 'none' }}>
                See all →
              </Link>
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              {scene.exceptions.map(({ key, ...rest }) => (
                <ExceptionCard key={key} {...rest} />
              ))}
            </div>
          </section>

          {/* ── KPI strip (always present; content scales) ─────────────── */}
          <section style={{ marginBottom: 36 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
              <SectionLabel>Account pulse</SectionLabel>
              <span style={{ fontFamily: 'var(--v4-font-mono)', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--fg-subtle)' }}>
                last 30 days
              </span>
            </div>
            <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
              {scene.kpis.map(k => <KpiTile key={k.label} {...k} />)}
            </div>
          </section>

          {/* ── Tier-specific stacks ───────────────────────────────────── */}

          {/* T1/T2 → Projects stack */}
          {showProjects && scene.projects && (
            <section style={{ marginBottom: 36 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
                <SectionLabel>Active projects</SectionLabel>
                <Link href="/dashboard/projects" style={{ fontSize: 12, fontWeight: 600, color: 'var(--signal)', textDecoration: 'none' }}>
                  Open projects →
                </Link>
              </div>
              <div
                className="v4-card v4-card--ruled v4-paper"
                style={{ padding: '22px 24px' }}
              >
                <div style={{ display: 'grid', gap: 4 }}>
                  {scene.projects.map(p => (
                    <div key={p.name} className="v4-row">
                      <div className="v4-row__days" style={{ background: 'var(--signal-subtle)', color: 'var(--signal)' }}>
                        <Briefcase size={18} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div className="v4-row__title">{p.name}</div>
                        <div className="v4-row__sub">
                          Phase · <span style={{ color: 'var(--fg)' }}>{p.phase}</span> · next: {p.nextMilestone}
                        </div>
                      </div>
                      <StatusChip tone={p.accent === 'brand' ? 'positive' : p.accent}>{p.phase}</StatusChip>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* T3+ → Schedule confidence by community */}
          {showSchedule && scene.communities && (
            <section
              style={{
                display: 'grid',
                gap: 28,
                gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)',
                marginBottom: 36,
              }}
            >
              <div className="v4-card v4-card--ruled v4-paper" style={{ padding: '22px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 }}>
                  <SectionLabel>Schedule confidence</SectionLabel>
                  <span style={{ fontSize: 12, color: 'var(--fg-muted)' }} className="v4-numeric">
                    {scene.communities.reduce((s, c) => s + c.on + c.risk + c.late, 0)} lots · {scene.communities.length} communities
                  </span>
                </div>
                <div style={{ display: 'grid', gap: 18 }}>
                  {scene.communities.map(c => (
                    <div key={c.name} style={{ display: 'grid', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{c.name}</span>
                          <span className="v4-numeric" style={{ fontSize: 11, color: 'var(--fg-subtle)', letterSpacing: '0.08em' }}>
                            {c.on + c.risk + c.late} lots
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 10, fontFamily: 'var(--v4-font-mono)', fontSize: 11 }}>
                          <span style={{ color: 'var(--data-positive-fg)' }}>● {c.on} on</span>
                          <span style={{ color: 'var(--data-warning-fg)' }}>● {c.risk} risk</span>
                          <span style={{ color: 'var(--data-negative-fg)' }}>● {c.late} late</span>
                        </div>
                      </div>
                      <ConfidenceBar on={c.on} risk={c.risk} late={c.late} ariaLabel={`${c.name}: ${c.on} on schedule, ${c.risk} at risk, ${c.late} delayed`} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="v4-card v4-card--ruled" style={{ padding: '22px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
                  <SectionLabel>Today's deliveries</SectionLabel>
                  <span style={{ fontSize: 12, color: 'var(--fg-muted)' }} className="v4-numeric">
                    {scene.deliveries.length} loads
                  </span>
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  {scene.deliveries.map(d => (
                    <div key={d.id} className="v4-row">
                      <div className="v4-row__days">
                        <b>{d.eta.split(':')[0]}</b>
                        <span>{d.eta.includes('PM') ? 'pm' : 'am'}</span>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div className="v4-row__title">{d.lot}</div>
                        <div className="v4-row__sub">
                          <span className="v4-numeric">{d.number}</span> · {d.items} items
                          {d.status === 'late' && (
                            <> · <span style={{ color: 'var(--data-warning-fg)', fontWeight: 600 }}>running late</span></>
                          )}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="v4-row__amt">{money(d.amount)}</div>
                        <StatusChip tone={d.status === 'late' ? 'warning' : 'positive'}>
                          {d.status === 'late' ? 'Delayed' : 'On route'}
                        </StatusChip>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* T6 → Division scorecard */}
          {showDivisions && scene.divisions && (
            <section style={{ marginBottom: 36 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
                <SectionLabel>Division scorecard</SectionLabel>
                <span style={{ fontSize: 12, color: 'var(--fg-muted)' }} className="v4-numeric">
                  trailing 90 days
                </span>
              </div>
              <div className="v4-card v4-card--ruled" style={{ padding: '22px 24px' }}>
                <div style={{ display: 'grid', gap: 12 }}>
                  {scene.divisions.map(d => (
                    <div key={d.name} className="v4-row" style={{ gridTemplateColumns: '44px 1fr 120px 120px 160px' }}>
                      <div className="v4-row__days" style={{ background: 'var(--signal-subtle)', color: 'var(--signal)' }}>
                        <Building2 size={18} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div className="v4-row__title">{d.name}</div>
                        <div className="v4-row__sub">3-month trailing</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="v4-row__amt">{d.starts.toLocaleString()}</div>
                        <div className="v4-row__sub">starts</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="v4-row__amt">{d.onTime.toFixed(1)}%</div>
                        <div className="v4-row__sub">on-time</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="v4-row__amt">${(d.spend / 1_000_000).toFixed(1)}M</div>
                        <div className="v4-row__sub">trailing spend</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* ── Quick actions (nav-aware) ──────────────────────────────── */}
          <section style={{ marginBottom: 36 }}>
            <div style={{ marginBottom: 14 }}>
              <SectionLabel>Quick actions</SectionLabel>
            </div>
            <div className="v4-quick">
              {/* Always: a PO + an Invoice action. Rest scale with tier. */}
              <QuickActionTile icon={<Package size={18} />}       label="New PO"         hint="N then P" href="/dashboard/orders" />
              {showProjects ? (
                <QuickActionTile icon={<Briefcase size={18} />}    label="New project"    hint="N then J" href="/dashboard/projects" />
              ) : (
                <QuickActionTile icon={<Layers size={18} />}       label="Communities"    hint="N then C" href="/ops/communities" />
              )}
              <QuickActionTile icon={<Ruler size={18} />}         label="Upload plan"    hint="N then L" href="/dashboard/blueprints/new" />
              <QuickActionTile icon={<Receipt size={18} />}       label="Pay invoices"   hint="G then I" href="/dashboard/invoices" />
              <QuickActionTile icon={<MessageSquare size={18} />} label="Message Abel"   hint="⌘ M"      href="/dashboard/messages" />
            </div>
          </section>

          {/* ── Nav-visibility proof strip (preview-only) ─────────────── */}
          <section className="v4-card" style={{ padding: '16px 20px', marginBottom: 24 }}>
            <div style={{ marginBottom: 10 }}>
              <SectionLabel>Nav at this tier</SectionLabel>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {nav.map(n => (
                <span key={n.key} className="v4-chip v4-chip--info">{n.label}</span>
              ))}
            </div>
          </section>

          {/* ── Footer ─────────────────────────────────────────────────── */}
          <footer
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontFamily: 'var(--v4-font-mono)',
              fontSize: 10.5, letterSpacing: '0.16em', textTransform: 'uppercase',
              color: 'var(--fg-subtle)',
              paddingTop: 20,
              borderTop: '1px solid var(--border)',
            }}
          >
            <span>
              Aegis · Built in Gainesville · <span className="v4-display">on schedule</span>
            </span>
            <span className="v4-numeric">v4.0.0 · tier {tierShortLabel(profile.tier)} · {rosterName}</span>
          </footer>
        </div>
      </main>
    </div>
  )
}

// ── Subcomponents ─────────────────────────────────────────────────────────

function TierStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div
        style={{
          fontFamily: 'var(--v4-font-mono)',
          fontSize: 9.5, letterSpacing: '0.22em', textTransform: 'uppercase',
          color: 'var(--fg-subtle)',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function wordFor(n: number): string {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
  return words[n] ?? String(n)
}
