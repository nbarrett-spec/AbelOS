'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { canAccessRoute } from '@/lib/permissions'
import type { StaffRole } from '@/lib/permissions'

interface StaffUser {
  id: string
  firstName: string
  lastName: string
  email: string
  role: StaffRole
  roles?: StaffRole[]
  department: string
  title: string | null
}

interface Permissions {
  canViewExecutive: boolean
  canViewJobs: boolean
  canViewAccounts: boolean
  canViewManufacturing: boolean
  canViewSupplyChain: boolean
  canViewFinance: boolean
  canViewPortals: boolean
  canManageStaff: boolean
  canViewAI: boolean
}

interface StaffAuthState {
  staff: StaffUser | null
  permissions: Permissions | null
  loading: boolean
  error: string | null
}

export function useStaffAuth(options?: { requiredRole?: StaffRole; redirectOnFail?: boolean }) {
  const [state, setState] = useState<StaffAuthState>({
    staff: null,
    permissions: null,
    loading: true,
    error: null,
  })
  const router = useRouter()
  const pathname = usePathname()

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch('/api/ops/auth/me')
      if (res.ok) {
        const data = await res.json()
        setState({
          staff: data.staff,
          permissions: data.permissions,
          loading: false,
          error: null,
        })

        // Check if user can access current route (multi-role aware)
        const rolesForCheck: StaffRole[] = Array.isArray(data.staff?.roles) && data.staff.roles.length > 0
          ? data.staff.roles
          : [data.staff.role as StaffRole]
        if (pathname && !canAccessRoute(rolesForCheck, pathname)) {
          setState(prev => ({
            ...prev,
            error: 'You do not have permission to access this page.',
          }))
          if (options?.redirectOnFail !== false) {
            router.push('/ops?denied=1')
          }
        }
      } else {
        setState({
          staff: null,
          permissions: null,
          loading: false,
          error: 'Not authenticated',
        })
        // Redirect to staff login
        if (options?.redirectOnFail !== false) {
          router.push('/ops/login')
        }
      }
    } catch {
      setState({
        staff: null,
        permissions: null,
        loading: false,
        error: 'Failed to check session',
      })
    }
  }, [pathname, router, options?.redirectOnFail])

  useEffect(() => {
    fetchSession()
  }, [fetchSession])

  const logout = useCallback(async () => {
    await fetch('/api/ops/auth/logout', { method: 'POST' })
    setState({ staff: null, permissions: null, loading: false, error: null })
    router.push('/ops/login')
  }, [router])

  return {
    ...state,
    logout,
    refresh: fetchSession,
    isAdmin: state.staff?.role === 'ADMIN',
    isManager: state.staff?.role === 'ADMIN' || state.staff?.role === 'MANAGER',
    fullName: state.staff ? `${state.staff.firstName} ${state.staff.lastName}` : null,
  }
}
