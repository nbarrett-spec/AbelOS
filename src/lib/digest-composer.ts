/**
 * Daily Digest Composer
 *
 * Builds a role-aware "what's on your plate today" email for every active
 * staff member. Runs from the 6 AM CT cron (src/app/api/cron/daily-digest)
 * and can also be previewed by admins via /ops/admin/digest-preview.
 *
 * Design goals:
 *   - One email per staff with ONLY the sections that apply to their roles
 *   - Zero noise: if nothing is on the plate, the sender skips the email
 *   - Fast: all section queries batch in Promise.all, raw SQL where it's
 *     shorter than Prisma's relation joins
 *   - No side effects: composer is a pure function of (staffId, now) — the
 *     sender is the one that writes EmailSendLog / calls Resend
 *
 * Role → section mapping mirrors the role-scoped inbox API
 * (/api/ops/inbox/scoped):
 *
 *   ALL active staff:      Inbox (assigned), Tasks (assigned)
 *   DRIVER:                Today's deliveries
 *   INSTALLER:             Today's installs
 *   ACCOUNTING / MANAGER:  Overdue invoices
 *   SALES_REP:             Deals with stage change yesterday + quotes SENT
 *                          awaiting response
 *   PROJECT_MANAGER:       Orphan RECEIVED orders (no confirmation yet)
 *   ADMIN / MANAGER:       Sees everything above (executive rollup)
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'https://app.abellumber.com'
    : 'http://localhost:3000')

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface DigestSection {
  key: string
  title: string
  count: number
  /** One-line headline for the subject-line summary ("2 overdue invoices") */
  summary: string
  /** Deep link back into Abel OS for the section header */
  href: string
  /** Rendered HTML for the section body (already wrapped in a block) */
  html: string
  /** Plain-text fallback body */
  text: string
}

export interface ComposedDigest {
  staffId: string
  staffEmail: string
  staffFirstName: string
  /** Final subject line */
  subject: string
  /** Wrapped HTML body (ready for Resend) */
  htmlBody: string
  /** Plain-text equivalent */
  textBody: string
  sections: DigestSection[]
  /** Total meaningful rows across all sections — sender uses this for skip-if-empty */
  totalItems: number
  /** Date the digest covers (today in CT) */
  digestDate: string
}

// Shape of the staff row we need. Typed loosely because the `preferences`
// column is a Json? we cast at the call site, and `roles` is a CSV string.
interface StaffRow {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  roles: string | null
  active: boolean
  preferences: Record<string, unknown> | null
}

// ──────────────────────────────────────────────────────────────────────────
// Role helpers
// ──────────────────────────────────────────────────────────────────────────

function parseRoles(staff: { role: string; roles: string | null }): string[] {
  const set = new Set<string>()
  if (staff.role) set.add(staff.role)
  if (staff.roles) {
    staff.roles
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean)
      .forEach((r) => set.add(r))
  }
  return Array.from(set)
}

function hasRole(roles: string[], ...candidates: string[]): boolean {
  return candidates.some((c) => roles.includes(c))
}

// ──────────────────────────────────────────────────────────────────────────
// Date helpers
//
// We think of "today" in Central Time because that's what Nate + the team
// operate on. The cron fires at 11:00 UTC (6 AM CT) so "today" is the CT
// calendar day containing the cron invocation.
// ──────────────────────────────────────────────────────────────────────────

function todayInCT(): Date {
  const now = new Date()
  // Convert to CT-equivalent by offsetting UTC. America/Chicago is UTC-6
  // (CST) or UTC-5 (CDT). We use the en-US locale to extract CT year/mo/day.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const year = Number(parts.find((p) => p.type === 'year')!.value)
  const month = Number(parts.find((p) => p.type === 'month')!.value)
  const day = Number(parts.find((p) => p.type === 'day')!.value)
  // Build a UTC midnight that lines up with CT midnight. We don't need
  // exact CT wall-clock, just a stable "today" boundary that's close enough
  // for day-bucket SQL. Use UTC so downstream queries are timezone-agnostic.
  return new Date(Date.UTC(year, month - 1, day))
}

function formatSubjectDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC', // d is already CT-midnight in UTC
  })
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(n || 0)
}

function formatShortDate(d: Date | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

// ──────────────────────────────────────────────────────────────────────────
// Section builders
//
// Each builder returns a DigestSection OR null when it has nothing to say.
// ──────────────────────────────────────────────────────────────────────────

async function buildInboxSection(staff: StaffRow): Promise<DigestSection | null> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string
      title: string
      description: string | null
      priority: string
      type: string
      dueBy: Date | null
      financialImpact: number | null
    }>
  >(
    `SELECT id, title, description, priority, type, "dueBy", "financialImpact"
       FROM "InboxItem"
      WHERE status = 'PENDING'
        AND ("assignedTo" = $1 OR "assignedTo" = $2)
        AND ("snoozedUntil" IS NULL OR "snoozedUntil" <= NOW())
      ORDER BY
        CASE priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
        COALESCE("dueBy", NOW() + INTERVAL '100 years') ASC
      LIMIT 10`,
    staff.id,
    staff.email,
  )
  if (!rows.length) return null

  const href = `${APP_URL}/ops/inbox`
  const html = renderItemList(
    rows.map((r) => ({
      title: r.title,
      sub: r.description || r.type.replace(/_/g, ' ').toLowerCase(),
      meta: [
        r.priority !== 'MEDIUM' ? r.priority : null,
        r.dueBy ? `due ${formatShortDate(r.dueBy)}` : null,
        r.financialImpact ? formatCurrency(r.financialImpact) : null,
      ]
        .filter(Boolean)
        .join(' · '),
    })),
  )
  const text = rows
    .map(
      (r) =>
        `- [${r.priority}] ${r.title}${r.dueBy ? ` (due ${formatShortDate(r.dueBy)})` : ''}`,
    )
    .join('\n')

  return {
    key: 'inbox',
    title: 'Inbox',
    count: rows.length,
    summary: plural(rows.length, 'inbox item', 'inbox'),
    href,
    html,
    text,
  }
}

async function buildTasksSection(staff: StaffRow, today: Date): Promise<DigestSection | null> {
  const tasks = await prisma.task.findMany({
    where: {
      assigneeId: staff.id,
      status: { in: ['TODO', 'IN_PROGRESS', 'BLOCKED'] },
      completedAt: null,
    },
    orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
    take: 10,
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      dueDate: true,
      status: true,
      category: true,
    },
  })
  if (!tasks.length) return null

  const href = `${APP_URL}/ops/tasks`
  const html = renderItemList(
    tasks.map((t) => ({
      title: t.title,
      sub: t.category.replace(/_/g, ' ').toLowerCase(),
      meta: [
        t.priority !== 'MEDIUM' ? t.priority : null,
        t.dueDate ? `due ${formatShortDate(t.dueDate)}` : null,
        t.status !== 'TODO' ? t.status.replace(/_/g, ' ').toLowerCase() : null,
      ]
        .filter(Boolean)
        .join(' · '),
      overdue: t.dueDate ? new Date(t.dueDate) < today : false,
    })),
  )
  const text = tasks
    .map((t) => `- ${t.title}${t.dueDate ? ` (due ${formatShortDate(t.dueDate)})` : ''}`)
    .join('\n')

  return {
    key: 'tasks',
    title: 'Open Tasks',
    count: tasks.length,
    summary: plural(tasks.length, 'task', 'tasks'),
    href,
    html,
    text,
  }
}

async function buildDeliveriesSection(
  staff: StaffRow,
  today: Date,
): Promise<DigestSection | null> {
  // "Their" deliveries = crew whose member list includes this staff.
  // We filter by crewId via the CrewMember join, and by scheduled date today.
  const deliveries = await prisma.$queryRawUnsafe<
    Array<{
      id: string
      deliveryNumber: string
      address: string
      status: string
      jobId: string
      jobNumber: string
      builderName: string
    }>
  >(
    `SELECT d.id, d."deliveryNumber", d.address, d.status::text AS status,
            d."jobId", j."jobNumber", j."builderName"
       FROM "Delivery" d
       JOIN "Job" j ON j.id = d."jobId"
       LEFT JOIN "CrewMember" cm ON cm."crewId" = d."crewId"
      WHERE cm."staffId" = $1
        AND d."status"::text NOT IN ('COMPLETE','REFUSED','RESCHEDULED')
        AND (
          j."scheduledDate"::date = $2::date
          OR d."createdAt"::date = $2::date
        )
      ORDER BY d."routeOrder" ASC, d."deliveryNumber" ASC
      LIMIT 20`,
    staff.id,
    today.toISOString().slice(0, 10),
  )
  if (!deliveries.length) return null

  const href = `${APP_URL}/ops/delivery`
  const html = renderItemList(
    deliveries.map((d) => ({
      title: `${d.deliveryNumber} — ${d.builderName}`,
      sub: d.address,
      meta: [d.status.replace(/_/g, ' ').toLowerCase()].join(' · '),
    })),
  )
  const text = deliveries
    .map((d) => `- ${d.deliveryNumber}: ${d.builderName} → ${d.address}`)
    .join('\n')

  return {
    key: 'deliveries',
    title: "Today's Deliveries",
    count: deliveries.length,
    summary: plural(deliveries.length, 'delivery', 'deliveries'),
    href,
    html,
    text,
  }
}

async function buildInstallsSection(
  staff: StaffRow,
  today: Date,
): Promise<DigestSection | null> {
  const installs = await prisma.$queryRawUnsafe<
    Array<{
      id: string
      installNumber: string
      scopeNotes: string | null
      status: string
      jobNumber: string
      jobAddress: string | null
      builderName: string
    }>
  >(
    `SELECT i.id, i."installNumber", i."scopeNotes", i.status::text AS status,
            j."jobNumber", j."jobAddress", j."builderName"
       FROM "Installation" i
       JOIN "Job" j ON j.id = i."jobId"
       LEFT JOIN "CrewMember" cm ON cm."crewId" = i."crewId"
      WHERE cm."staffId" = $1
        AND i."status"::text NOT IN ('COMPLETE','CANCELLED')
        AND (
          i."scheduledDate"::date = $2::date
          OR (i."scheduledDate" IS NULL AND i."createdAt"::date = $2::date)
        )
      ORDER BY i."scheduledDate" ASC NULLS LAST, i."installNumber" ASC
      LIMIT 20`,
    staff.id,
    today.toISOString().slice(0, 10),
  )
  if (!installs.length) return null

  const href = `${APP_URL}/ops/installations`
  const html = renderItemList(
    installs.map((i) => ({
      title: `${i.installNumber} — ${i.builderName}`,
      sub: i.jobAddress || i.scopeNotes || i.jobNumber,
      meta: [i.status.replace(/_/g, ' ').toLowerCase()].join(' · '),
    })),
  )
  const text = installs
    .map((i) => `- ${i.installNumber}: ${i.builderName}`)
    .join('\n')

  return {
    key: 'installs',
    title: "Today's Installs",
    count: installs.length,
    summary: plural(installs.length, 'install', 'installs'),
    href,
    html,
    text,
  }
}

async function buildOverdueInvoicesSection(): Promise<DigestSection | null> {
  // ACCOUNTING / MANAGER see ALL overdue invoices (company-wide) — they own
  // the AR process. If we wanted to scope per-staff we'd filter on createdById.
  const invoices = await prisma.invoice.findMany({
    where: {
      status: 'OVERDUE',
    },
    orderBy: [{ dueDate: 'asc' }],
    take: 10,
    select: {
      id: true,
      invoiceNumber: true,
      builderId: true,
      total: true,
      balanceDue: true,
      dueDate: true,
    },
  })
  if (!invoices.length) return null

  // Pull builder names in one batch
  const builderIds = Array.from(new Set(invoices.map((i) => i.builderId)))
  const builders = await prisma.builder.findMany({
    where: { id: { in: builderIds } },
    select: { id: true, companyName: true },
  })
  const builderMap = new Map(builders.map((b) => [b.id, b.companyName]))

  const href = `${APP_URL}/ops/finance/ar`
  const html = renderItemList(
    invoices.map((inv) => ({
      title: `${inv.invoiceNumber} — ${builderMap.get(inv.builderId) || 'Unknown'}`,
      sub: `Balance ${formatCurrency(inv.balanceDue)} of ${formatCurrency(inv.total)}`,
      meta: inv.dueDate ? `due ${formatShortDate(inv.dueDate)}` : null,
      overdue: true,
    })),
  )
  const text = invoices
    .map(
      (inv) =>
        `- ${inv.invoiceNumber} (${builderMap.get(inv.builderId) || 'Unknown'}): ${formatCurrency(inv.balanceDue)} overdue`,
    )
    .join('\n')

  return {
    key: 'overdue_invoices',
    title: 'Overdue Invoices',
    count: invoices.length,
    summary: plural(invoices.length, 'overdue invoice', 'overdue invoices'),
    href,
    html,
    text,
  }
}

async function buildSalesSection(staff: StaffRow): Promise<DigestSection | null> {
  // Yesterday = CT yesterday → use (NOW() - INTERVAL '36 hours', NOW() - INTERVAL '12 hours')
  // simplification: anything with a STAGE_CHANGE activity in the last 36h.
  const stageChanges = await prisma.$queryRawUnsafe<
    Array<{
      dealId: string
      dealNumber: string
      companyName: string
      stage: string
      lastChange: Date
    }>
  >(
    `SELECT d.id AS "dealId", d."dealNumber", d."companyName",
            d.stage::text AS stage, MAX(da."createdAt") AS "lastChange"
       FROM "Deal" d
       JOIN "DealActivity" da ON da."dealId" = d.id
      WHERE d."ownerId" = $1
        AND da.type = 'STAGE_CHANGE'
        AND da."createdAt" >= NOW() - INTERVAL '36 hours'
        AND d.stage::text NOT IN ('WON','LOST','ONBOARDED')
      GROUP BY d.id
      ORDER BY "lastChange" DESC
      LIMIT 5`,
    staff.id,
  )

  // Quotes owned by this rep that are SENT and haven't been touched in ≥2 days.
  // Quote doesn't have owner → we key on the Project's builder (not exactly
  // the rep). Simplest accurate surrogate: just get SENT quotes company-wide
  // for SALES_REP (they watch the board). For ADMIN/MANAGER, the executive
  // view already rolls this up. If the roles table grows an "accountManager"
  // column later, tighten this here.
  const awaitingQuotes = await prisma.quote.findMany({
    where: {
      status: 'SENT',
      updatedAt: { lt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
      validUntil: { gt: new Date() },
    },
    orderBy: { updatedAt: 'asc' },
    take: 5,
    select: {
      id: true,
      quoteNumber: true,
      total: true,
      validUntil: true,
      project: { select: { name: true, builder: { select: { companyName: true } } } },
    },
  })

  if (!stageChanges.length && !awaitingQuotes.length) return null

  const items: Array<{ title: string; sub: string; meta: string | null }> = []
  for (const sc of stageChanges) {
    items.push({
      title: `${sc.dealNumber} — ${sc.companyName}`,
      sub: `Moved to ${sc.stage.replace(/_/g, ' ').toLowerCase()}`,
      meta: `${formatShortDate(sc.lastChange)}`,
    })
  }
  for (const q of awaitingQuotes) {
    items.push({
      title: `${q.quoteNumber} — ${q.project?.builder?.companyName || 'Unknown'}`,
      sub: `${q.project?.name || ''} · ${formatCurrency(q.total)}`,
      meta: q.validUntil ? `expires ${formatShortDate(q.validUntil)}` : null,
    })
  }

  const href = `${APP_URL}/ops/sales/deals`
  const text = items.map((i) => `- ${i.title}: ${i.sub}`).join('\n')
  const total = items.length

  return {
    key: 'sales',
    title: 'Sales Activity',
    count: total,
    summary: plural(total, 'sales update', 'sales updates'),
    href,
    html: renderItemList(items),
    text,
  }
}

async function buildPMOrdersSection(_staff: StaffRow): Promise<DigestSection | null> {
  // "Orphan" orders: RECEIVED but no Job row yet → means nobody has picked
  // them up for confirmation / scheduling. A PM's first morning job is to
  // clear these out.
  const orders = await prisma.$queryRawUnsafe<
    Array<{
      id: string
      orderNumber: string
      builderName: string
      total: number
      createdAt: Date
    }>
  >(
    `SELECT o.id, o."orderNumber", b."companyName" AS "builderName",
            o.total, o."createdAt"
       FROM "Order" o
       JOIN "Builder" b ON b.id = o."builderId"
       LEFT JOIN "Job" j ON j."orderId" = o.id
      WHERE o.status::text = 'RECEIVED'
        AND j.id IS NULL
        AND o."isForecast" = false
      ORDER BY o."createdAt" ASC
      LIMIT 10`,
  )
  if (!orders.length) return null

  const href = `${APP_URL}/ops/orders`
  const html = renderItemList(
    orders.map((o) => ({
      title: `${o.orderNumber} — ${o.builderName}`,
      sub: `Received ${formatShortDate(o.createdAt)} · ${formatCurrency(o.total)}`,
      meta: 'needs confirmation',
      overdue:
        Date.now() - new Date(o.createdAt).getTime() > 48 * 60 * 60 * 1000,
    })),
  )
  const text = orders
    .map((o) => `- ${o.orderNumber}: ${o.builderName} (${formatCurrency(o.total)}) needs confirmation`)
    .join('\n')

  return {
    key: 'pending_orders',
    title: 'New Orders Awaiting Confirmation',
    count: orders.length,
    summary: plural(orders.length, 'order pending', 'orders pending'),
    href,
    html,
    text,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// HTML helpers
// ──────────────────────────────────────────────────────────────────────────

interface ListItem {
  title: string
  sub?: string | null
  meta?: string | null
  overdue?: boolean
}

function renderItemList(items: ListItem[]): string {
  return items
    .map(
      (i) => `
        <div style="padding: 10px 0; border-bottom: 1px solid #eef0f3;">
          <div style="font-size: 14px; font-weight: 600; color: ${i.overdue ? '#C0392B' : '#0f2a3e'};">
            ${escapeHtml(i.title)}
          </div>
          ${i.sub ? `<div style="font-size: 13px; color: #555; margin-top: 2px;">${escapeHtml(i.sub)}</div>` : ''}
          ${i.meta ? `<div style="font-size: 12px; color: #888; margin-top: 2px;">${escapeHtml(i.meta)}</div>` : ''}
        </div>`,
    )
    .join('')
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function renderSection(section: DigestSection): string {
  return `
    <div style="background: #f9fafb; border-left: 4px solid #C6A24E; padding: 20px; margin-bottom: 20px; border-radius: 4px;">
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
        <h2 style="font-size: 14px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin: 0;">
          ${escapeHtml(section.title)} (${section.count})
        </h2>
        <a href="${section.href}" style="font-size: 12px; color: #C6A24E; text-decoration: none; font-weight: 600;">View all →</a>
      </div>
      ${section.html}
    </div>
  `
}

function wrapDigestHtml(params: {
  firstName: string
  dateStr: string
  summaryLine: string
  sectionsHtml: string
  optOutUrl: string
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
  <div style="max-width: 640px; margin: 0 auto; background: white; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <div style="background-color: #0f2a3e; padding: 20px 24px;">
      <table><tr>
        <td style="background-color: #C6A24E; border-radius: 8px; width: 32px; height: 32px; text-align: center; vertical-align: middle; font-weight: bold; color: white; font-size: 13px;">AB</td>
        <td style="padding-left: 10px; color: white; font-size: 16px; font-weight: 600;">Abel OS</td>
      </tr></table>
    </div>
    <div style="padding: 28px 24px 8px;">
      <h1 style="font-size: 22px; font-weight: 700; color: #0f2a3e; margin: 0 0 4px;">
        Good morning, ${escapeHtml(params.firstName)}.
      </h1>
      <p style="margin: 0 0 20px; color: #6b7280; font-size: 14px;">
        ${escapeHtml(params.dateStr)} &middot; ${escapeHtml(params.summaryLine)}
      </p>
    </div>
    <div style="padding: 0 24px 16px;">
      ${params.sectionsHtml}
    </div>
    <div style="padding: 16px 24px 24px; text-align: center; color: #999; font-size: 11px; border-top: 1px solid #eef0f3;">
      <p style="margin: 0;">
        Abel Lumber &middot; <a href="${APP_URL}" style="color: #C6A24E; text-decoration: none;">app.abellumber.com</a>
        &middot;
        <a href="${params.optOutUrl}" style="color: #888; text-decoration: underline;">digest settings</a>
      </p>
    </div>
  </div>
</body>
</html>`
}

// ──────────────────────────────────────────────────────────────────────────
// Main entry point
// ──────────────────────────────────────────────────────────────────────────

/**
 * Compose a digest for one staff member. Returns null iff the staff is not
 * active or missing an email — the sender treats null as "skip silently".
 */
export async function composeDigestForStaff(
  staffId: string,
): Promise<ComposedDigest | null> {
  // Load staff (typed loosely because of the Json preferences cast — same
  // pattern used in /api/ops/staff/preferences).
  const staffModel = (prisma as unknown as {
    staff: {
      findUnique: (args: unknown) => Promise<any>
    }
  }).staff
  const staff: StaffRow | null = await staffModel.findUnique({
    where: { id: staffId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      roles: true,
      active: true,
      preferences: true,
    },
  })

  if (!staff || !staff.active || !staff.email) {
    return null
  }

  const roles = parseRoles(staff)
  const isAdminLike = hasRole(roles, 'ADMIN', 'MANAGER')
  const today = todayInCT()

  // Run section builders in parallel — keep it tight so one person's digest
  // compose doesn't dominate the 5/sec throttle budget downstream.
  const sectionPromises: Array<Promise<DigestSection | null>> = [
    buildInboxSection(staff),
    buildTasksSection(staff, today),
  ]

  if (hasRole(roles, 'DRIVER') || isAdminLike) {
    sectionPromises.push(buildDeliveriesSection(staff, today))
  }
  if (hasRole(roles, 'INSTALLER') || isAdminLike) {
    sectionPromises.push(buildInstallsSection(staff, today))
  }
  if (hasRole(roles, 'ACCOUNTING') || isAdminLike) {
    sectionPromises.push(buildOverdueInvoicesSection())
  }
  if (hasRole(roles, 'SALES_REP') || isAdminLike) {
    sectionPromises.push(buildSalesSection(staff))
  }
  if (hasRole(roles, 'PROJECT_MANAGER') || isAdminLike) {
    sectionPromises.push(buildPMOrdersSection(staff))
  }

  const sectionResults = await Promise.all(sectionPromises)
  const sections = sectionResults.filter((s): s is DigestSection => s !== null)
  const totalItems = sections.reduce((sum, s) => sum + s.count, 0)

  // Build subject: "Abel OS · Thu Apr 23 — 3 inbox · 2 overdue invoices · 1 ship today"
  const dateStr = formatSubjectDate(today)
  const summaryParts = sections.map((s) => s.summary)
  const summaryLine =
    summaryParts.length === 0
      ? 'All clear'
      : summaryParts.slice(0, 3).join(' · ') +
        (summaryParts.length > 3 ? ` · +${summaryParts.length - 3} more` : '')
  const subject = `Abel OS · ${dateStr} — ${summaryLine}`

  const optOutUrl = `${APP_URL}/ops/profile#digest`
  const sectionsHtml = sections.map(renderSection).join('\n')
  const htmlBody = wrapDigestHtml({
    firstName: staff.firstName,
    dateStr,
    summaryLine,
    sectionsHtml,
    optOutUrl,
  })

  const textBody = [
    `Abel OS — ${dateStr}`,
    `Hi ${staff.firstName},`,
    ``,
    ...sections.map(
      (s) => `## ${s.title} (${s.count})\n${s.text}\n  → ${s.href}\n`,
    ),
    ``,
    `Digest settings: ${optOutUrl}`,
  ].join('\n')

  return {
    staffId: staff.id,
    staffEmail: staff.email,
    staffFirstName: staff.firstName,
    subject,
    htmlBody,
    textBody,
    sections,
    totalItems,
    digestDate: today.toISOString().slice(0, 10),
  }
}

// Expose formatter helpers for the preview page (so preview renders the
// same way the real email does without duplicating logic).
export { formatSubjectDate, todayInCT }

/**
 * Guard used by the sender: a digest is "empty" if every section is empty.
 * We also treat an all-null composer result as empty. If a staff member
 * wants a zero-item email anyway, they'd opt in via preferences in future.
 */
export function isDigestEmpty(digest: ComposedDigest | null): boolean {
  if (!digest) return true
  return digest.totalItems === 0
}

// Logged swallow for the preview page so one bad section doesn't nuke the
// whole compose. Used above where we don't want to throw out of a batch.
export function _safeLogComposeError(staffId: string, err: unknown) {
  logger.error('digest_compose_error', err as any, { staffId })
}
