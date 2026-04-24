import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import CalendarGrid from './CalendarGrid'

export const dynamic = 'force-dynamic'

// ──────────────────────────────────────────────────────────────────────────
// /ops/calendar — Month-view job calendar.
//
// Server entry: loads the filter dropdown data (active PMs, builders that
// own any job in the last/next 6 months) and hands off to the client grid,
// which drives its own data fetch from /api/ops/calendar/jobs. Respects
// NEXT_PUBLIC_FEATURE_CALENDAR — only 'off' disables the page.
// ──────────────────────────────────────────────────────────────────────────

export default async function OpsCalendarPage() {
  if (process.env.NEXT_PUBLIC_FEATURE_CALENDAR === 'off') {
    notFound()
  }

  // PM filter — every active staff member who has been a PM on at least one
  // non-closed job. Fallback to all active managers/PMs if no such staff
  // exists (fresh DB).
  const pms = await prisma.staff
    .findMany({
      where: {
        active: true,
        OR: [
          { assignedJobs: { some: {} } },
          { role: { in: ['PROJECT_MANAGER', 'MANAGER', 'ADMIN'] as const } },
        ],
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 50,
    })
    .catch(() => [])

  // Builder filter — any builder that has at least one order we know about.
  // Kept shallow (no window) so the dropdown is stable across months.
  const builders = await prisma.builder
    .findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, companyName: true },
      orderBy: { companyName: 'asc' },
      take: 100,
    })
    .catch(() => [])

  const staffLite = pms.map((s) => ({
    id: s.id,
    name: `${s.firstName} ${s.lastName}`.trim(),
  }))

  const builderLite = builders.map((b) => ({
    id: b.id,
    name: b.companyName,
  }))

  return (
    <div className="space-y-5">
      <CalendarGrid staff={staffLite} builders={builderLite} />
    </div>
  )
}
