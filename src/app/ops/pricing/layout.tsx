import { StaffAuthGuard } from '@/components/StaffAuthGuard'
import type { StaffRole } from '@/lib/permissions'

const PRICING_ROLES: StaffRole[] = ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'PURCHASING']

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <StaffAuthGuard requiredRoles={PRICING_ROLES}>{children}</StaffAuthGuard>
}
