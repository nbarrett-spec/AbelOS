'use client'
import { StaffAuthGuard, ADMIN_ROLES } from '@/components/StaffAuthGuard'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <StaffAuthGuard requiredRoles={ADMIN_ROLES}>{children}</StaffAuthGuard>
}
