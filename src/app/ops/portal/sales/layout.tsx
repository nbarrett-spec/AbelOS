'use client'
import { StaffAuthGuard } from '@/components/StaffAuthGuard'
import type { StaffRole } from '@/lib/permissions'

const SALES_ROLES: StaffRole[] = ['ADMIN', 'MANAGER', 'SALES_REP'] as StaffRole[]

export default function SalesPortalLayout({ children }: { children: React.ReactNode }) {
  return <StaffAuthGuard requiredRoles={SALES_ROLES}>{children}</StaffAuthGuard>
}
