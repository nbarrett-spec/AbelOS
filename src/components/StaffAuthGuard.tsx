'use client'

import { useStaffAuth } from '@/hooks/useStaffAuth'
import type { StaffRole } from '@/lib/permissions'

interface StaffAuthGuardProps {
  children: React.ReactNode
  requiredRoles?: StaffRole[]
  fallback?: React.ReactNode
}

/**
 * Wraps pages that need staff auth + optional role check.
 * Shows loading spinner while checking session, redirects to login if not
 * authenticated, shows access denied if role doesn't match.
 */
export function StaffAuthGuard({ children, requiredRoles, fallback }: StaffAuthGuardProps) {
  const { staff, loading, error } = useStaffAuth({ redirectOnFail: true })

  // Loading state
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 400,
        color: '#6b7280',
        fontSize: 14,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 40,
            height: 40,
            border: '3px solid #e5e7eb',
            borderTopColor: '#0f2a3e',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 12px',
          }} />
          <p>Verifying access...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    )
  }

  // Not authenticated — useStaffAuth will handle redirect
  if (!staff) {
    return null
  }

  // Role check
  if (requiredRoles && requiredRoles.length > 0) {
    // Parse staff roles — handle both array (from API) and comma-separated string formats
    const rolesValue = (staff as any).roles as string | string[] | undefined
    const staffRoles: string[] = Array.isArray(rolesValue)
      ? rolesValue.map((r: string) => String(r).trim())
      : typeof rolesValue === 'string'
        ? rolesValue.split(',').map((r: string) => r.trim())
        : [staff.role]
    const hasRole = staff.role === 'ADMIN' ||
      staffRoles.includes('ADMIN') ||
      requiredRoles.some(r => staffRoles.includes(r))
    if (!hasRole) {
      if (fallback) return <>{fallback}</>
      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 400,
        }}>
          <div style={{
            textAlign: 'center',
            padding: 40,
            background: '#fef2f2',
            borderRadius: 12,
            border: '1px solid #fecaca',
            maxWidth: 400,
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>&#128274;</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#dc2626', margin: '0 0 8px' }}>
              Access Denied
            </h2>
            <p style={{ fontSize: 14, color: '#6b7280', margin: '0 0 16px' }}>
              Your role ({staff.role}) does not have permission to view this page.
              Contact your administrator if you need access.
            </p>
            <a
              href="/ops"
              style={{
                display: 'inline-block',
                padding: '8px 20px',
                background: '#0f2a3e',
                color: 'white',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Back to Dashboard
            </a>
          </div>
        </div>
      )
    }
  }

  return <>{children}</>
}

/**
 * Convenience exports for common role groups
 */
export const ADMIN_ROLES: StaffRole[] = ['ADMIN']
export const MANAGER_ROLES: StaffRole[] = ['ADMIN', 'MANAGER']
export const PM_ROLES: StaffRole[] = ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP']
export const PURCHASING_ROLES: StaffRole[] = ['ADMIN', 'MANAGER', 'PURCHASING']
export const WAREHOUSE_ROLES: StaffRole[] = ['ADMIN', 'MANAGER', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'QC_INSPECTOR']
export const DELIVERY_ROLES: StaffRole[] = ['ADMIN', 'MANAGER', 'DRIVER', 'INSTALLER', 'WAREHOUSE_LEAD']
export const ACCOUNTING_ROLES: StaffRole[] = ['ADMIN', 'MANAGER', 'ACCOUNTING']
export const FINANCE_ROLES: StaffRole[] = ['ADMIN', 'MANAGER', 'ACCOUNTING']
export const EXECUTIVE_ROLES: StaffRole[] = ['ADMIN', 'MANAGER']
