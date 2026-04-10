'use client'
import { StaffAuthGuard, FINANCE_ROLES } from '@/components/StaffAuthGuard'

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return <StaffAuthGuard requiredRoles={FINANCE_ROLES}>{children}</StaffAuthGuard>
}
