'use client'
import { StaffAuthGuard } from '@/components/StaffAuthGuard'

const ESTIMATOR_ROLES = ['ADMIN', 'MANAGER', 'ESTIMATOR', 'SALES_REP']

export default function EstimatorPortalLayout({ children }: { children: React.ReactNode }) {
  return <StaffAuthGuard requiredRoles={ESTIMATOR_ROLES as any}>{children}</StaffAuthGuard>
}
