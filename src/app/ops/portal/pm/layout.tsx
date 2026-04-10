'use client'
import { StaffAuthGuard, PM_ROLES } from '@/components/StaffAuthGuard'

export default function PMPortalLayout({ children }: { children: React.ReactNode }) {
  return <StaffAuthGuard requiredRoles={PM_ROLES}>{children}</StaffAuthGuard>
}
