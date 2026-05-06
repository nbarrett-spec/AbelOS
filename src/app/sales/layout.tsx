export const dynamic = 'force-dynamic'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyStaffToken, type StaffSessionPayload } from '@/lib/staff-auth'
import { parseRoles } from '@/lib/permissions'
import Link from 'next/link'
import SalesTopNav from './components/SalesTopNav'
import PortalBackground from '@/components/PortalBackground'
import PageBackgroundRouter from '@/components/PageBackgroundRouter'

const STAFF_COOKIE_NAME = 'abel_staff_session'

export default async function SalesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Server-side auth check using cookies
  const cookieStore = await cookies()
  const token = cookieStore.get(STAFF_COOKIE_NAME)?.value

  if (!token) {
    redirect('/sales/login')
  }

  const session = await verifyStaffToken(token)

  if (!session) {
    redirect('/sales/login')
  }

  // Check if user has appropriate role for sales portal (multi-role aware)
  // PROJECT_MANAGER added 2026-05-05 — PMs need access to /sales/documents to
  // pull contracts/spec sheets while running their builders' jobs.
  const allowedRoles = ['SALES_REP', 'MANAGER', 'ADMIN', 'PROJECT_MANAGER']
  const userRoles = parseRoles(session.roles || session.role)
  const hasAccessRole = userRoles.some(role => allowedRoles.includes(role))

  if (!hasAccessRole) {
    // Return access denied page
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="glass-card p-8 max-w-md">
          <h1 className="text-2xl font-bold text-data-negative mb-4">Access Denied</h1>
          <p className="text-fg-muted mb-6">
            Your roles ({userRoles.join(', ')}) do not have access to the Sales Portal.
            Only Sales Reps, Managers, and Admins can access this area.
          </p>
          <Link
            href="/ops"
            className="text-c1 hover:text-c2 font-medium"
          >
            Return to Operations →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-canvas flex flex-col relative">
      <PortalBackground portal="sales" />
      <SalesTopNav
        staffId={session.staffId}
        firstName={session.firstName}
        lastName={session.lastName}
        email={session.email}
        role={session.role}
      />
      <main className="flex-1 overflow-auto bg-canvas relative">
        <PageBackgroundRouter />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-enter relative z-[1]">
          {children}
        </div>
      </main>
    </div>
  )
}
