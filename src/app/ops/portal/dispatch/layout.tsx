'use client'
import { StaffAuthGuard } from '@/components/StaffAuthGuard'

const DISPATCH_ROLES = ['ADMIN', 'MANAGER', 'WAREHOUSE_LEAD', 'PROJECT_MANAGER'] as const

export default function DispatchLayout({ children }: { children: React.ReactNode }) {
  return (
    <StaffAuthGuard requiredRoles={[...DISPATCH_ROLES]}>
      {children}
    </StaffAuthGuard>
  )
}
