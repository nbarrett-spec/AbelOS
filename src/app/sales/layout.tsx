export const dynamic = 'force-dynamic'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyStaffToken, type StaffSessionPayload } from '@/lib/staff-auth'
import { parseRoles } from '@/lib/permissions'
import Link from 'next/link'
import SalesTopNav from './components/SalesTopNav'

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
  const allowedRoles = ['SALES_REP', 'MANAGER', 'ADMIN']
  const userRoles = parseRoles(session.roles || session.role)
  const hasAccessRole = userRoles.some(role => allowedRoles.includes(role))

  if (!hasAccessRole) {
    // Return access denied page
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Access Denied</h1>
          <p className="text-gray-600 mb-6">
            Your roles ({userRoles.join(', ')}) do not have access to the Sales Portal.
            Only Sales Reps, Managers, and Admins can access this area.
          </p>
          <Link
            href="/ops"
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            Return to Operations →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <SalesTopNav
        staffId={session.staffId}
        firstName={session.firstName}
        lastName={session.lastName}
        email={session.email}
        role={session.role}
      />
      <main className="flex-1 overflow-auto bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  )
}
