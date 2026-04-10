'use client'
import { StaffAuthGuard, WAREHOUSE_ROLES } from '@/components/StaffAuthGuard'

export default function ManufacturingPortalLayout({ children }: { children: React.ReactNode }) {
  return <StaffAuthGuard requiredRoles={WAREHOUSE_ROLES}>{children}</StaffAuthGuard>
}
