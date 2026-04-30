'use client'

/**
 * Builder Portal — Role + community context.
 *
 * Phase 1 of BUILDER-PORTAL-SPEC.md (§1 Layout Shell, §4.1 Role switching).
 *
 * Provides:
 *   - viewer role (PM / EXECUTIVE / ADMIN) — drives which dashboard widgets render
 *   - active community filter — null = all communities, otherwise a Community.id
 *   - "view as" PM↔EXEC toggle for users with EXECUTIVE permission (persisted in
 *     localStorage so the choice survives refresh)
 *   - builder + contact identity from the session
 *
 * The provider is mounted in src/app/portal/layout.tsx and reads the actual
 * builder + contact from the server. localStorage keys:
 *   abel-portal-role-view       PM | EXEC
 *   abel-portal-community       <community-id> or empty
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { PortalRole, PortalSession, PortalCommunity } from '@/types/portal'

type ViewMode = 'pm' | 'exec'

export interface PortalContextValue {
  /** True permission tier (from BuilderContact.portalRole). */
  role: PortalRole
  /** Whether the viewer is allowed to use exec-only widgets. */
  canSeeExec: boolean
  /** What the viewer is currently looking at. Always 'pm' for non-EXECs. */
  viewMode: ViewMode
  setViewMode: (m: ViewMode) => void
  builder: { id: string; companyName: string; email: string }
  contact: { firstName: string; lastName: string } | null
  activeCommunity: string | null
  setActiveCommunity: (id: string | null) => void
  communities: PortalCommunity[]
}

const PortalContext = createContext<PortalContextValue | null>(null)

const ROLE_KEY = 'abel-portal-role-view'
const COMMUNITY_KEY = 'abel-portal-community'

interface PortalProviderProps {
  session: PortalSession
  communities: PortalCommunity[]
  children: ReactNode
}

export function PortalProvider({ session, communities, children }: PortalProviderProps) {
  const role = session.portalRole
  const canSeeExec = role === 'EXECUTIVE' || role === 'ADMIN'

  // Default the view to 'exec' for execs, 'pm' otherwise. Restore from
  // localStorage if the viewer made a choice last time.
  const [viewMode, setViewModeState] = useState<ViewMode>(
    canSeeExec ? 'exec' : 'pm',
  )
  const [activeCommunity, setActiveCommunityState] = useState<string | null>(null)

  // Hydrate from localStorage on mount (client-only).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (canSeeExec) {
      const saved = window.localStorage.getItem(ROLE_KEY)
      if (saved === 'pm' || saved === 'exec') setViewModeState(saved)
    }
    const savedCommunity = window.localStorage.getItem(COMMUNITY_KEY)
    if (savedCommunity) setActiveCommunityState(savedCommunity)
  }, [canSeeExec])

  const setViewMode = useCallback(
    (m: ViewMode) => {
      // Non-execs can never go to 'exec' view, even if localStorage was tampered.
      if (m === 'exec' && !canSeeExec) return
      setViewModeState(m)
      if (typeof window !== 'undefined') window.localStorage.setItem(ROLE_KEY, m)
    },
    [canSeeExec],
  )

  const setActiveCommunity = useCallback((id: string | null) => {
    setActiveCommunityState(id)
    if (typeof window === 'undefined') return
    if (id) window.localStorage.setItem(COMMUNITY_KEY, id)
    else window.localStorage.removeItem(COMMUNITY_KEY)
  }, [])

  const value = useMemo<PortalContextValue>(
    () => ({
      role,
      canSeeExec,
      viewMode,
      setViewMode,
      builder: {
        id: session.builderId,
        companyName: session.companyName,
        email: session.email,
      },
      contact: session.contactName
        ? {
            firstName: session.contactName.split(' ')[0] || '',
            lastName: session.contactName.split(' ').slice(1).join(' ') || '',
          }
        : null,
      activeCommunity,
      setActiveCommunity,
      communities,
    }),
    [
      role,
      canSeeExec,
      viewMode,
      setViewMode,
      session,
      activeCommunity,
      setActiveCommunity,
      communities,
    ],
  )

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>
}

export function usePortal(): PortalContextValue {
  const ctx = useContext(PortalContext)
  if (!ctx) {
    throw new Error('usePortal must be used inside a <PortalProvider>')
  }
  return ctx
}
