'use client'
import { StaffAuthGuard } from '@/components/StaffAuthGuard'
import type { StaffRole } from '@/lib/permissions'

const QC_ROLES: StaffRole[] = ['ADMIN', 'MANAGER', 'QC_INSPECTOR', 'WAREHOUSE_LEAD'] as StaffRole[]

export default function QCPortalLayout({ children }: { children: React.ReactNode }) {
  return <StaffAuthGuard requiredRoles={QC_ROLES}>{children}</StaffAuthGuard>
}
