'use client'
import { StaffAuthGuard, ACCOUNTING_ROLES } from '@/components/StaffAuthGuard'

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return <StaffAuthGuard requiredRoles={ACCOUNTING_ROLES}>{children}</StaffAuthGuard>
}
