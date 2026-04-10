'use client'

import { StaffAuthGuard, WAREHOUSE_ROLES } from '@/components/StaffAuthGuard'

export default function ScheduleLayout({
  children,
}: {
  children: React.ReactNode
}): JSX.Element {
  return (
    <StaffAuthGuard requiredRoles={WAREHOUSE_ROLES}>
      {children}
    </StaffAuthGuard>
  )
}
