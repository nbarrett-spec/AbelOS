// /admin/builders/[id] — server-rendered builder detail with Overview + Details tabs.
//
// WHY THIS IS A SERVER COMPONENT NOW
// The original implementation was a client component doing a fetch-on-mount
// waterfall. That was fine when the page was small but isn't great context
// for PMs or Dawn — they want AR exposure, open job count, and who to call
// visible in a single server round-trip (Wave-3 C8 scope).
//
// Strategy: This file is the server wrapper. It:
//   1. Fetches builder + all new data concurrently via Promise.all so the
//      slowest query dominates instead of serialized waits.
//   2. Renders the new Overview tab sections (AR callout, KPIs, contact,
//      open jobs, recent activity, AR detail) as server-rendered HTML.
//   3. Mounts the legacy client component (BuilderDetailClient) under the
//      Details tab. The legacy component preserves all editing behavior
//      (payment term, status, auto-invoice toggle) unchanged.
//
// Tab selection uses the `?tab=` query param so no client JS is required —
// the tab strip is two Links. Default is Overview. Feature flag
// NEXT_PUBLIC_FEATURE_BUILDER_OVERVIEW=off hides the new sections and
// renders only the legacy Details view (graceful rollback).
//
// DATA MODEL NOTES
// - Job has no direct Builder FK — the link is the denormalized
//   Job.builderName column. We match by name using the builder's
//   companyName. This mirrors the pattern in /brittney/page.tsx.
// - Invoice has a builderId column (string, no FK) — filter directly.
// - CommunicationLog has builderId — used for last-communication-date.
// - AuditLog lookup is a broad match: entityId = builder.id for Builder
//   entity rows, PLUS invoiceIds and jobIds that belong to this builder.
//   We cap at 10 rows sorted by createdAt DESC.
//
// GRACEFUL DEGRADATION
// Any of the secondary queries (contacts, comms, audit) can throw without
// killing the page — each is wrapped and defaults to [] / null so a missing
// table or schema drift on one branch degrades to "no data" rather than 500.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { PageHeader, KPICard, Card, CardBody, EmptyState, Badge } from '@/components/ui'
import { formatCurrency, formatDate } from '@/lib/utils'

import AROverview, {
  computeAgingBuckets,
  type ARInvoiceRow,
} from './sections/AROverview'
import OpenJobsSection, { type OpenJobRow } from './sections/OpenJobsSection'
import ContactCard, { type PrimaryContact } from './sections/ContactCard'
import BuilderDetailClient from './sections/BuilderDetailClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ── Types for the raw DB rows we hit via $queryRawUnsafe ─────────────────
// We use raw queries for rows that either (a) don't have a typed Prisma
// relation to Builder or (b) need aggregates Prisma's query builder
// doesn't express cleanly.

interface BuilderRow {
  id: string
  companyName: string
  contactName: string
  email: string
  phone: string | null
  accountBalance: number | null
  status: string
}

interface InvoiceRawRow {
  id: string
  invoiceNumber: string
  total: number
  amountPaid: number
  balanceDue: number
  status: string
  issuedAt: Date | null
  dueDate: Date | null
  createdAt: Date
}

interface JobRawRow {
  id: string
  jobNumber: string
  community: string | null
  lotBlock: string | null
  status: string
  scheduledDate: Date | null
  readinessCheck: boolean
  materialsLocked: boolean
  loadConfirmed: boolean
  assignedPMId: string | null
}

interface StaffNameRow {
  id: string
  firstName: string
  lastName: string
}

interface ContactRawRow {
  id: string
  firstName: string
  lastName: string
  title: string | null
  email: string | null
  phone: string | null
  mobile: string | null
  isPrimary: boolean
  createdAt: Date
}

interface LastCommRow {
  sentAt: Date | null
  createdAt: Date | null
}

interface LastPaymentRow {
  receivedAt: Date
}

interface YtdRow {
  ytd: number | null
}

interface AuditRow {
  id: string
  action: string
  entity: string
  entityId: string | null
  staffId: string | null
  details: any
  severity: string | null
  createdAt: Date
}

// ── Helpers ──────────────────────────────────────────────────────────────

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24))
}

function avgAgeDays(invoices: ARInvoiceRow[]): number {
  if (invoices.length === 0) return 0
  const now = Date.now()
  const total = invoices.reduce((acc, inv) => {
    const anchor = inv.dueDate || inv.issuedAt || inv.createdAt
    return acc + (now - new Date(anchor).getTime()) / (1000 * 60 * 60 * 24)
  }, 0)
  return Math.floor(total / invoices.length)
}

// ── Page ────────────────────────────────────────────────────────────────

export default async function BuilderDetailPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams?: { tab?: string }
}) {
  const builderId = params.id
  const featureOn = process.env.NEXT_PUBLIC_FEATURE_BUILDER_OVERVIEW !== 'off'
  const activeTab = featureOn ? (searchParams?.tab === 'details' ? 'details' : 'overview') : 'details'

  // ── 1. Builder existence + identity ───────────────────────────────────
  // Use raw SQL here because we only need a small projection and want to
  // co-locate with the other raw aggregates below for consistency.
  const builderRows = await prisma.$queryRawUnsafe<BuilderRow[]>(
    `SELECT id, "companyName", "contactName", email, phone,
            "accountBalance", status::text AS status
       FROM "Builder"
      WHERE id = $1
      LIMIT 1`,
    builderId
  )
  const builder = builderRows[0]
  if (!builder) notFound()

  // ── 2. Concurrent fetch for all Overview-tab data ─────────────────────
  // Each block is defensively try/caught so a single bad branch doesn't
  // kill the page. Missing data degrades to empty state.
  const [
    invoices,
    jobs,
    contacts,
    lastCommRow,
    lastPaymentRow,
    ytdRow,
    auditLogs,
  ] = await Promise.all([
    // Outstanding invoices — NOT DRAFT/PAID/VOID/WRITE_OFF
    prisma
      .$queryRawUnsafe<InvoiceRawRow[]>(
        `SELECT id, "invoiceNumber", total, "amountPaid", "balanceDue",
                status::text AS status, "issuedAt", "dueDate", "createdAt"
           FROM "Invoice"
          WHERE "builderId" = $1
            AND "balanceDue" > 0
            AND status::text NOT IN ('DRAFT','PAID','VOID','WRITE_OFF')
          ORDER BY COALESCE("dueDate", "issuedAt", "createdAt") ASC`,
        builderId
      )
      .catch(() => [] as InvoiceRawRow[]),

    // Open jobs — exclude CLOSED (terminal). We intentionally keep
    // COMPLETE/INVOICED visible because PMs care about those until
    // payment clears and status flips to CLOSED.
    prisma
      .$queryRawUnsafe<JobRawRow[]>(
        `SELECT j.id, j."jobNumber", j.community, j."lotBlock",
                j.status::text AS status, j."scheduledDate",
                j."readinessCheck", j."materialsLocked", j."loadConfirmed",
                j."assignedPMId"
           FROM "Job" j
          WHERE j."builderName" ILIKE $1
            AND j.status::text != 'CLOSED'
          ORDER BY j."scheduledDate" ASC NULLS LAST, j."jobNumber" ASC
          LIMIT 200`,
        builder.companyName
      )
      .catch(() => [] as JobRawRow[]),

    // BuilderContacts — pick primary, fall back to earliest
    prisma
      .$queryRawUnsafe<ContactRawRow[]>(
        `SELECT id, "firstName", "lastName", title, email, phone, mobile,
                "isPrimary", "createdAt"
           FROM "BuilderContact"
          WHERE "builderId" = $1
          ORDER BY "isPrimary" DESC, "createdAt" ASC
          LIMIT 10`,
        builderId
      )
      .catch(() => [] as ContactRawRow[]),

    // Last communication on this builder
    prisma
      .$queryRawUnsafe<LastCommRow[]>(
        `SELECT "sentAt", "createdAt"
           FROM "CommunicationLog"
          WHERE "builderId" = $1
          ORDER BY COALESCE("sentAt", "createdAt") DESC
          LIMIT 1`,
        builderId
      )
      .catch(() => [] as LastCommRow[]),

    // Last payment — join Payment -> Invoice to scope to this builder
    prisma
      .$queryRawUnsafe<LastPaymentRow[]>(
        `SELECT p."receivedAt"
           FROM "Payment" p
           JOIN "Invoice" i ON i.id = p."invoiceId"
          WHERE i."builderId" = $1
          ORDER BY p."receivedAt" DESC
          LIMIT 1`,
        builderId
      )
      .catch(() => [] as LastPaymentRow[]),

    // YTD revenue — sum paid invoices issued this calendar year. We use
    // amountPaid (not total) so "revenue" reflects money actually in, not
    // billed. Matches how Dawn talks about it in weekly close calls.
    prisma
      .$queryRawUnsafe<YtdRow[]>(
        `SELECT COALESCE(SUM("amountPaid"), 0)::float8 AS ytd
           FROM "Invoice"
          WHERE "builderId" = $1
            AND "issuedAt" >= date_trunc('year', NOW())`,
        builderId
      )
      .catch(() => [{ ytd: 0 } as YtdRow]),

    // Recent activity — last 10 AuditLog rows touching this builder, its
    // invoices, or its jobs. We build the entityId list in a second step
    // via a CTE to keep the query simple.
    prisma
      .$queryRawUnsafe<AuditRow[]>(
        `WITH scoped AS (
           SELECT id FROM "Invoice" WHERE "builderId" = $1
           UNION
           SELECT id FROM "Job" WHERE "builderName" ILIKE $2
         )
         SELECT id, action, entity, "entityId", "staffId", details,
                severity, "createdAt"
           FROM "AuditLog"
          WHERE ("entity" = 'Builder' AND "entityId" = $1)
             OR ("entity" IN ('Invoice','Payment','Job','PurchaseOrder')
                 AND "entityId" IN (SELECT id FROM scoped))
          ORDER BY "createdAt" DESC
          LIMIT 10`,
        builderId,
        builder.companyName
      )
      .catch(() => [] as AuditRow[]),
  ])

  // ── 3. Derive view-model bits ─────────────────────────────────────────

  const invoiceRows: ARInvoiceRow[] = invoices.map((i) => ({
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    total: Number(i.total),
    amountPaid: Number(i.amountPaid),
    balanceDue: Number(i.balanceDue),
    status: i.status,
    issuedAt: i.issuedAt,
    dueDate: i.dueDate,
    createdAt: i.createdAt,
  }))

  const buckets = computeAgingBuckets(invoiceRows)
  const outstandingAR = invoiceRows.reduce((acc, i) => acc + i.balanceDue, 0)
  const avgAge = avgAgeDays(invoiceRows)
  const arDanger = outstandingAR >= 25000 || avgAge >= 60

  // Resolve PM names for open jobs in one extra query.
  const pmIds = Array.from(
    new Set(jobs.map((j) => j.assignedPMId).filter(Boolean) as string[])
  )
  let pmMap = new Map<string, string>()
  if (pmIds.length > 0) {
    try {
      const staffRows = await prisma.$queryRawUnsafe<StaffNameRow[]>(
        `SELECT id, "firstName", "lastName" FROM "Staff" WHERE id = ANY($1::text[])`,
        pmIds
      )
      pmMap = new Map(
        staffRows.map((s) => [s.id, `${s.firstName} ${s.lastName}`.trim()])
      )
    } catch {
      // ignore — just leave PM column as "Unassigned"
    }
  }

  const jobRows: OpenJobRow[] = jobs.map((j) => ({
    id: j.id,
    jobNumber: j.jobNumber,
    community: j.community,
    lotBlock: j.lotBlock,
    status: j.status,
    scheduledDate: j.scheduledDate,
    readinessCheck: j.readinessCheck,
    materialsLocked: j.materialsLocked,
    loadConfirmed: j.loadConfirmed,
    assignedPMName: j.assignedPMId ? pmMap.get(j.assignedPMId) || null : null,
  }))

  const primaryContact: PrimaryContact | null = contacts[0]
    ? {
        id: contacts[0].id,
        firstName: contacts[0].firstName,
        lastName: contacts[0].lastName,
        title: contacts[0].title,
        email: contacts[0].email,
        phone: contacts[0].phone,
        mobile: contacts[0].mobile,
        isPrimary: contacts[0].isPrimary,
      }
    : null

  const lastCommAt = lastCommRow[0]
    ? lastCommRow[0].sentAt || lastCommRow[0].createdAt
    : null

  const lastPaymentAt = lastPaymentRow[0]?.receivedAt || null
  const daysSinceLastPayment = lastPaymentAt
    ? daysBetween(new Date(), new Date(lastPaymentAt))
    : null

  const ytdRevenue = Number(ytdRow[0]?.ytd || 0)

  // ── 4. Render ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Builder"
        title={builder.companyName}
        description={builder.contactName}
        crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Builders', href: '/admin/builders' },
          { label: builder.companyName },
        ]}
      />

      {/* Tab strip — server-rendered, uses ?tab= query param */}
      {featureOn && (
        <div role="tablist" className="flex border-b border-border gap-1">
          <TabLink
            href={`/admin/builders/${builderId}?tab=overview`}
            active={activeTab === 'overview'}
            label="Overview"
          />
          <TabLink
            href={`/admin/builders/${builderId}?tab=details`}
            active={activeTab === 'details'}
            label="Details"
          />
        </div>
      )}

      {activeTab === 'overview' && featureOn && (
        <>
          {/* KPI summary strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              title="Outstanding AR"
              value={formatCurrency(outstandingAR)}
              accent={arDanger ? 'negative' : outstandingAR > 0 ? 'accent' : 'neutral'}
              subtitle={
                invoiceRows.length > 0
                  ? `${invoiceRows.length} open · avg ${avgAge}d`
                  : 'No open invoices'
              }
            />
            <KPICard
              title="Open jobs"
              value={jobRows.length}
              accent="brand"
              subtitle={
                jobRows.length === 0
                  ? 'None active'
                  : `${
                      jobRows.filter((j) => j.readinessCheck && j.materialsLocked).length
                    } materials ready`
              }
            />
            <KPICard
              title="YTD revenue"
              value={formatCurrency(ytdRevenue)}
              accent={ytdRevenue > 0 ? 'positive' : 'neutral'}
              subtitle="Paid invoices, this year"
            />
            <KPICard
              title="Days since payment"
              value={daysSinceLastPayment ?? '—'}
              accent={
                daysSinceLastPayment === null
                  ? 'neutral'
                  : daysSinceLastPayment > 45
                  ? 'negative'
                  : daysSinceLastPayment > 30
                  ? 'accent'
                  : 'positive'
              }
              subtitle={
                lastPaymentAt
                  ? `Last: ${formatDate(lastPaymentAt)}`
                  : 'No payments on record'
              }
            />
          </div>

          {/* Contact card — top-right on wide screens, standalone on mobile */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <AROverview
                invoices={invoiceRows}
                buckets={buckets}
                openByDefault={arDanger}
              />
              <OpenJobsSection jobs={jobRows} />
            </div>
            <div className="space-y-6">
              <ContactCard
                contact={primaryContact}
                lastCommunicationAt={lastCommAt}
                fallbackName={builder.contactName}
                fallbackEmail={builder.email}
                fallbackPhone={builder.phone}
                mailtoSubject={`Abel Lumber — ${builder.companyName}`}
              />

              {/* Secondary contacts (if any beyond primary) */}
              {contacts.length > 1 && (
                <Card>
                  <CardBody>
                    <div className="text-xs uppercase tracking-wide text-fg-muted mb-3">
                      Other contacts
                    </div>
                    <ul className="space-y-2 text-sm">
                      {contacts.slice(1, 5).map((c) => (
                        <li
                          key={c.id}
                          className="flex items-center justify-between"
                        >
                          <div>
                            <div className="text-fg">
                              {c.firstName} {c.lastName}
                            </div>
                            {c.title && (
                              <div className="text-xs text-fg-muted">
                                {c.title}
                              </div>
                            )}
                          </div>
                          {c.email && (
                            <a
                              href={`mailto:${encodeURIComponent(c.email)}`}
                              className="text-xs text-brand hover:underline"
                            >
                              Email
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              )}
            </div>
          </div>

          {/* Recent activity */}
          <Card>
            <CardBody>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-fg-muted">
                    Recent activity
                  </div>
                  <div className="text-lg font-semibold text-fg">
                    Last {auditLogs.length} events
                  </div>
                </div>
              </div>
              {auditLogs.length === 0 ? (
                <EmptyState
                  title="No audit events yet"
                  description="Actions taken on this builder, their invoices, jobs, and POs will appear here."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {auditLogs.map((a) => {
                    const staffName =
                      (a.details && typeof a.details === 'object' && a.details.staffName) ||
                      a.staffId ||
                      'system'
                    return (
                      <li key={a.id} className="py-2 flex items-center gap-3 text-sm">
                        <Badge
                          variant={
                            a.severity === 'CRITICAL'
                              ? 'danger'
                              : a.severity === 'WARN'
                              ? 'warning'
                              : 'neutral'
                          }
                          size="sm"
                        >
                          {a.action}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <div className="truncate">
                            <span className="text-fg">{a.entity}</span>
                            {a.entityId && (
                              <span className="text-fg-muted text-xs font-mono ml-2">
                                {a.entityId.slice(0, 12)}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-fg-muted truncate">
                            by {staffName}
                          </div>
                        </div>
                        <div className="text-xs text-fg-muted whitespace-nowrap">
                          {formatDate(a.createdAt)}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      )}

      {activeTab === 'details' && (
        <BuilderDetailClient builderId={builderId} />
      )}
    </div>
  )
}

// ── Tab link — server-rendered, no client JS ─────────────────────────────
function TabLink({
  href,
  active,
  label,
}: {
  href: string
  active: boolean
  label: string
}) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className="px-4 py-2 text-sm font-medium transition-colors"
      style={{
        color: active ? 'var(--fg)' : 'var(--fg-muted)',
        borderBottom: active ? '2px solid var(--brand)' : '2px solid transparent',
        marginBottom: '-1px',
      }}
    >
      {label}
    </Link>
  )
}
