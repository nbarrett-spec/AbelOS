// ─────────────────────────────────────────────────────────────────────────────
// /ops/pm — Project Managers landing page (roster of all active PMs)
//
// Server component. Queries Prisma DIRECTLY for the PM roster + per-viewer
// AR snapshot (no internal HTTP fetch). Hands the PM list off to
// <PmRosterCards/>. Each card links into /ops/pm/book/[staffId].
//
// Feature flag: NEXT_PUBLIC_FEATURE_PM_ROSTER !== 'off'  (default ON).
// Auth: /ops/* is already gated by middleware.
//
// Why direct Prisma reads instead of fetch()ing /api/ops/pm/roster?
// The previous implementation did `fetch('/api/ops/pm/roster', { headers: { cookie } })`
// from the server component, which forced a second HTTP hop back through
// middleware. That round-trip was fragile in production: cookie forwarding,
// SameSite=strict, and Vercel's internal routing all stacked up to make the
// re-auth step occasionally 403 — even for users with the correct role —
// leaving the page in fallback (or worse, silently failing). Querying Prisma
// directly here eliminates the second hop entirely. The /api/ops/pm/roster
// and /api/ops/pm/ar routes still exist for client-side callers, refresh
// flows, and external/JSON consumers, and their auth gate is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma'
import { PageHeader, StatusDot } from '@/components/ui'
import { getStaffSession } from '@/lib/staff-auth'
import { parseRoles } from '@/lib/permissions'
import PmRosterCards, { type RosterPM } from './PmRosterCards'

export const dynamic = 'force-dynamic'

interface RosterResponse {
  asOf: string
  pms: RosterPM[]
  fallbackUsed: boolean
}

interface PmArResponse {
  asOf: string
  pmId: string
  outstanding: number
  overdueCount: number
  aging: {
    '0-30': number
    '31-60': number
    '61-90': number
    '90+': number
  }
}

// ── Materials rollup — must match /api/ops/pm/roster exactly ──────────────
const TERMINAL_STATUSES = ['COMPLETE', 'INVOICED', 'CLOSED'] as const
const READY_ALLOC = new Set(['PICKED', 'CONSUMED'])
const SHORTAGE_ALLOC = new Set(['BACKORDERED'])
const PENDING_ALLOC = new Set(['RESERVED'])

type MaterialsStatus = 'GREEN' | 'AMBER' | 'RED' | 'NONE'

function rollupMaterials(rows: Array<{ status: string | null }>): MaterialsStatus {
  if (rows.length === 0) return 'NONE'
  let ready = 0
  let short = 0
  let pending = 0
  for (const r of rows) {
    const s = (r.status || '').toUpperCase()
    if (READY_ALLOC.has(s)) ready++
    else if (SHORTAGE_ALLOC.has(s)) short++
    else if (PENDING_ALLOC.has(s)) pending++
  }
  if (short > 0) return 'RED'
  if (pending === 0 && ready === rows.length) return 'GREEN'
  return 'AMBER'
}

// ── Roster — direct Prisma read, mirrors /api/ops/pm/roster shape ─────────
// Logic kept in lockstep with src/app/api/ops/pm/roster/route.ts. If you
// change the KPI math there, change it here too (and vice versa).
async function loadRoster(): Promise<RosterResponse> {
  try {
    // ── 1. Primary PM selector ──────────────────────────────────────────
    let pmStaff = await prisma.staff.findMany({
      where: {
        active: true,
        OR: [
          { role: 'PROJECT_MANAGER' },
          { department: 'PROJECT_MANAGEMENT' },
          { title: { contains: 'Project Manager', mode: 'insensitive' } },
          { roles: { contains: 'PROJECT_MANAGER' } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        title: true,
        role: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    })

    // ── 2. Fallback — pull staff with assignedPMId Jobs if primary empty ──
    let fallbackUsed = false
    if (pmStaff.length === 0) {
      fallbackUsed = true
      const withJobs = await prisma.job.findMany({
        where: { assignedPMId: { not: null } },
        select: { assignedPMId: true },
        distinct: ['assignedPMId'],
      })
      const ids = withJobs
        .map((j) => j.assignedPMId)
        .filter((x): x is string => !!x)
      if (ids.length > 0) {
        pmStaff = await prisma.staff.findMany({
          where: { id: { in: ids }, active: true },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            title: true,
            role: true,
          },
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        })
      }
    }

    if (pmStaff.length === 0) {
      return {
        asOf: new Date().toISOString(),
        pms: [],
        fallbackUsed,
      }
    }

    const pmIds = pmStaff.map((p) => p.id)

    // ── 3. All jobs for these PMs in one query ──────────────────────────
    const jobs = await prisma.job.findMany({
      where: { assignedPMId: { in: pmIds } },
      select: {
        id: true,
        assignedPMId: true,
        status: true,
      },
    })

    const jobToPm = new Map<string, string>()
    const jobsByPm = new Map<string, Array<{ id: string; status: string }>>()
    for (const j of jobs) {
      if (!j.assignedPMId) continue
      jobToPm.set(j.id, j.assignedPMId)
      const arr = jobsByPm.get(j.assignedPMId) ?? []
      arr.push({ id: j.id, status: j.status })
      jobsByPm.set(j.assignedPMId, arr)
    }

    const allJobIds = jobs.map((j) => j.id)

    // ── 4. Allocations ───────────────────────────────────────────────────
    const allocRows =
      allJobIds.length === 0
        ? []
        : await prisma.inventoryAllocation.findMany({
            where: { jobId: { in: allJobIds } },
            select: { jobId: true, status: true },
          })

    const allocByJob = new Map<string, Array<{ status: string | null }>>()
    for (const a of allocRows) {
      if (!a.jobId) continue
      const arr = allocByJob.get(a.jobId) ?? []
      arr.push({ status: a.status })
      allocByJob.set(a.jobId, arr)
    }

    // ── 5. Closing dates ─────────────────────────────────────────────────
    const closingByJob = new Map<string, Date>()
    if (allJobIds.length > 0) {
      try {
        const closingRows: Array<{ jobId: string; closingDate: Date | null }> =
          await prisma.$queryRawUnsafe(
            `SELECT "jobId", MAX("closingDate") AS "closingDate"
               FROM "HyphenDocument"
              WHERE "jobId" = ANY($1::text[])
                AND "closingDate" IS NOT NULL
              GROUP BY "jobId"`,
            allJobIds
          )
        for (const row of closingRows) {
          if (row.jobId && row.closingDate) {
            closingByJob.set(row.jobId, row.closingDate)
          }
        }
      } catch (e) {
        // HyphenDocument may be missing in old snapshots — degrade silently.
        console.warn('[PM Roster page] closingDate lookup skipped:', e)
      }
    }

    // ── 6. Overdue task counts per PM ───────────────────────────────────
    const overdueByPm = new Map<string, number>()
    if (allJobIds.length > 0) {
      try {
        const overdueRows: Array<{ jobId: string; c: number }> =
          await prisma.$queryRawUnsafe(
            `SELECT t."jobId" AS "jobId", COUNT(*)::int AS c
               FROM "Task" t
              WHERE t."jobId" = ANY($1::text[])
                AND t."status"::text NOT IN ('DONE', 'COMPLETE', 'CANCELLED')
                AND t."dueDate" IS NOT NULL
                AND t."dueDate" < NOW()
              GROUP BY t."jobId"`,
            allJobIds
          )
        for (const row of overdueRows) {
          if (!row.jobId) continue
          const pmId = jobToPm.get(row.jobId)
          if (!pmId) continue
          overdueByPm.set(pmId, (overdueByPm.get(pmId) ?? 0) + Number(row.c))
        }
      } catch (e) {
        console.warn('[PM Roster page] overdue tasks lookup skipped:', e)
      }
    }

    // ── 7. Assemble per-PM KPIs ─────────────────────────────────────────
    const now = Date.now()
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000

    const pms: RosterPM[] = pmStaff.map((s) => {
      const pmJobs = jobsByPm.get(s.id) ?? []

      let activeJobs = 0
      let greenCount = 0
      let materialsConsidered = 0
      let closingThisWeek = 0

      for (const j of pmJobs) {
        const isActive = !TERMINAL_STATUSES.includes(j.status as any)
        if (!isActive) continue
        activeJobs++

        const allocs = allocByJob.get(j.id) ?? []
        if (allocs.length > 0) {
          materialsConsidered++
          if (rollupMaterials(allocs) === 'GREEN') greenCount++
        }

        const cd = closingByJob.get(j.id)
        if (cd) {
          const delta = cd.getTime() - now
          if (delta >= 0 && delta <= sevenDaysMs) closingThisWeek++
        }
      }

      const materialsReadyPct =
        materialsConsidered > 0
          ? Math.round((greenCount / materialsConsidered) * 100)
          : 0

      return {
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        email: s.email,
        title: s.title,
        role: s.role,
        activeJobs,
        materialsReadyPct,
        closingThisWeek,
        overdueTasks: overdueByPm.get(s.id) ?? 0,
      }
    })

    return {
      asOf: new Date().toISOString(),
      pms,
      fallbackUsed,
    }
  } catch (e) {
    console.error('[PM Roster page] loadRoster failed:', e)
    return { asOf: new Date().toISOString(), pms: [], fallbackUsed: true }
  }
}

// ── Per-viewer AR snapshot — direct Prisma, mirrors /api/ops/pm/ar shape ──
// Logic kept in lockstep with src/app/api/ops/pm/ar/route.ts.
async function loadMyAr(): Promise<PmArResponse | null> {
  const session = await getStaffSession()
  if (!session) return null

  const allRoles = parseRoles(session.roles || session.role)
  const eligible = allRoles.some((r) =>
    ['ADMIN', 'MANAGER', 'PROJECT_MANAGER'].includes(r)
  )
  if (!eligible) return null

  const pmId = session.staffId
  if (!pmId) return null

  try {
    interface PmInvoiceRow {
      id: string
      total: number
      amountPaid: number
      balanceDue: number
      dueDate: Date | null
      issuedAt: Date | null
      createdAt: Date
    }

    const rows = await prisma.$queryRawUnsafe<PmInvoiceRow[]>(
      `
      SELECT
        i."id",
        i."total"::float AS "total",
        COALESCE(i."amountPaid", 0)::float AS "amountPaid",
        (i."total" - COALESCE(i."amountPaid", 0))::float AS "balanceDue",
        i."dueDate", i."issuedAt", i."createdAt"
      FROM "Invoice" i
      INNER JOIN "Job" j ON j."id" = i."jobId"
      WHERE j."assignedPMId" = $1
        AND i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
        AND (i."total" - COALESCE(i."amountPaid", 0)) > 0
      `,
      pmId
    )

    const now = new Date()
    let outstanding = 0
    let overdueCount = 0
    const aging: PmArResponse['aging'] = {
      '0-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0,
    }

    for (const r of rows) {
      const balance = Number(r.balanceDue)
      if (balance <= 0) continue
      outstanding += balance

      const refDate = r.dueDate || r.issuedAt || r.createdAt
      const daysPastDue = Math.floor(
        (now.getTime() - new Date(refDate).getTime()) / (1000 * 60 * 60 * 24)
      )
      if (daysPastDue > 0) overdueCount++
      const bucket: keyof PmArResponse['aging'] =
        daysPastDue <= 30
          ? '0-30'
          : daysPastDue <= 60
          ? '31-60'
          : daysPastDue <= 90
          ? '61-90'
          : '90+'
      aging[bucket]++
    }

    return {
      asOf: now.toISOString(),
      pmId,
      outstanding,
      overdueCount,
      aging,
    }
  } catch (e) {
    console.error('[PM Roster page] loadMyAr failed:', e)
    return null
  }
}

function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function featureFlagOff(): boolean {
  return process.env.NEXT_PUBLIC_FEATURE_PM_ROSTER === 'off'
}

export default async function PMRosterPage() {
  if (featureFlagOff()) {
    return (
      <div className="p-6">
        <div className="glass-card p-6 text-center">
          <h1 className="text-lg font-semibold mb-2">PM Roster is disabled</h1>
          <p className="text-sm text-fg-muted">
            The PM roster view is currently turned off
            (NEXT_PUBLIC_FEATURE_PM_ROSTER=off). Clear the flag to re-enable.
          </p>
        </div>
      </div>
    )
  }

  const [data, ar] = await Promise.all([loadRoster(), loadMyAr()])

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        eyebrow="Ops"
        title="Project Managers"
        description="Monday workload snapshot — click a PM to open their book"
        crumbs={[{ label: 'Ops', href: '/ops' }, { label: 'Project Managers' }]}
        actions={
          <div className="flex items-center gap-2">
            <StatusDot tone="live" label="live" />
            <span className="text-xs text-fg-muted font-mono">LIVE</span>
          </div>
        }
      />

      {ar && <MyArPanel ar={ar} />}

      <PmRosterCards
        pms={data.pms}
        asOf={data.asOf}
        fallbackUsed={data.fallbackUsed}
      />
    </div>
  )
}

// ── My AR — read-only snapshot of the current PM's open invoices ──────────
function MyArPanel({ ar }: { ar: PmArResponse }) {
  const buckets: Array<{ label: string; key: keyof PmArResponse['aging'] }> = [
    { label: '0-30 d', key: '0-30' },
    { label: '31-60 d', key: '31-60' },
    { label: '61-90 d', key: '61-90' },
    { label: '90+ d', key: '90+' },
  ]

  const hasAny = ar.outstanding > 0 || ar.overdueCount > 0

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-base font-semibold">My AR</h2>
          <p className="text-xs text-fg-muted">
            Open invoices on jobs you own — read-only snapshot
          </p>
        </div>
        <span className="text-xs text-fg-subtle font-mono">
          {new Date(ar.asOf).toLocaleString()}
        </span>
      </div>

      {!hasAny ? (
        <p className="text-sm text-fg-muted">
          No open invoices on jobs assigned to you.
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="text-xs text-fg-muted">Outstanding</div>
            <div className="text-lg font-semibold tabular-nums">
              {fmtMoney(ar.outstanding)}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="text-xs text-fg-muted">Overdue</div>
            <div className="text-lg font-semibold tabular-nums">
              {ar.overdueCount}
            </div>
          </div>
          {buckets.map((b) => (
            <div
              key={b.key}
              className="rounded-lg border border-border bg-surface p-3"
            >
              <div className="text-xs text-fg-muted">{b.label}</div>
              <div className="text-lg font-semibold tabular-nums">
                {ar.aging[b.key]}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
