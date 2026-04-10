'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Builder {
  id: string
  companyName: string
  contactName: string
  email: string
  paymentTerm: string
  phone?: string
  status?: string
  creditLimit?: number
  accountBalance?: number
  _count?: { projects: number; orders: number }
}

export function useAuth() {
  const [builder, setBuilder] = useState<Builder | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const data = await res.json()
        setBuilder(data.builder)
      } else {
        setBuilder(null)
      }
    } catch {
      setBuilder(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setBuilder(null)
    router.push('/login')
  }, [router])

  return { builder, loading, logout, refresh: fetchUser }
}
