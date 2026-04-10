'use client'
import { StaffAuthGuard, DELIVERY_ROLES } from '@/components/StaffAuthGuard'

export default function DeliveryPortalLayout({ children }: { children: React.ReactNode }) {
  return <StaffAuthGuard requiredRoles={DELIVERY_ROLES}>{children}</StaffAuthGuard>
}
