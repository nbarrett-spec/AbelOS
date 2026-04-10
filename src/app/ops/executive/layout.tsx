'use client'
import { StaffAuthGuard, EXECUTIVE_ROLES } from '@/components/StaffAuthGuard'

export default function ExecutiveLayout({ children }: { children: React.ReactNode }) {
  return <StaffAuthGuard requiredRoles={EXECUTIVE_ROLES}>{children}</StaffAuthGuard>
}
