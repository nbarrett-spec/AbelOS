'use client'
import { StaffAuthGuard, PURCHASING_ROLES } from '@/components/StaffAuthGuard'

export default function PurchasingBriefingLayout({ children }: { children: React.ReactNode }) {
  return <StaffAuthGuard requiredRoles={PURCHASING_ROLES}>{children}</StaffAuthGuard>
}
