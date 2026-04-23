'use client'
import { StaffAuthGuard } from '@/components/StaffAuthGuard'
import type { StaffRole } from '@/lib/permissions'

const INSTALLER_PORTAL_ROLES: StaffRole[] = [
  'ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'INSTALLER',
]

export default function InstallerPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <StaffAuthGuard requiredRoles={INSTALLER_PORTAL_ROLES}>
      {/* Print CSS — field tablets shouldn't print */}
      <style jsx global>{`
        @media print {
          .installer-portal-root { display: none !important; }
        }
      `}</style>
      <div className="installer-portal-root">
        {children}
      </div>
    </StaffAuthGuard>
  )
}
