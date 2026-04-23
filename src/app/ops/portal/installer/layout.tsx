'use client'
import { usePathname } from 'next/navigation'
import { StaffAuthGuard } from '@/components/StaffAuthGuard'
import type { StaffRole } from '@/lib/permissions'

const INSTALLER_PORTAL_ROLES: StaffRole[] = [
  'ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'INSTALLER',
]

export default function InstallerPortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || ''
  // Dedicated print artifacts (e.g. /punch-list/print) opt out of the
  // field-tablet print-suppression so they render a clean page.
  const isPrintRoute = pathname.includes('/print')

  return (
    <StaffAuthGuard requiredRoles={INSTALLER_PORTAL_ROLES}>
      {/* Field-tablet print guard — regular installer screens should not
          print (the tablet UI is not sized for paper). Dedicated /print
          routes bypass by rendering outside this wrapper. */}
      <style jsx global>{`
        @media print {
          .installer-portal-root { display: none !important; }
        }
      `}</style>
      {isPrintRoute ? (
        <>{children}</>
      ) : (
        <div className="installer-portal-root">{children}</div>
      )}
    </StaffAuthGuard>
  )
}
