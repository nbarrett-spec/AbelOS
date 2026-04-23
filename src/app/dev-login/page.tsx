'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface BuilderInfo {
  id: string
  email: string
  company: string
  contact: string
  tier: string
  status: string
  orderCount: number
  totalSpend: number
}

export default function DevLoginPage() {
  const router = useRouter()
  const [builders, setBuilders] = useState<BuilderInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [loggingIn, setLoggingIn] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchBuilders()
  }, [])

  async function fetchBuilders() {
    try {
      const res = await fetch('/api/auth/dev-login')
      const data = await res.json()
      setBuilders(data.builders || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function loginAs(email: string) {
    try {
      setLoggingIn(email)
      setError(null)
      const res = await fetch('/api/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (data.success) {
        router.push('/dashboard')
      } else {
        setError(data.error || 'Login failed')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoggingIn(null)
    }
  }

  async function loginAsFirst() {
    try {
      setLoggingIn('auto')
      setError(null)
      const res = await fetch('/api/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.success) {
        router.push('/dashboard')
      } else {
        setError(data.error || 'Login failed')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoggingIn(null)
    }
  }

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

  const tierColors: Record<string, string> = {
    STANDARD: '#6B7280',
    SILVER: '#9CA3AF',
    GOLD: '#F59E0B',
    PLATINUM: '#8B5CF6',
    CUSTOM: '#C6A24E',
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
      padding: '40px 20px',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔧</div>
          <h1 style={{ color: '#F8FAFC', fontSize: 28, fontWeight: 700, margin: 0 }}>
            Dev Test Login
          </h1>
          <p style={{ color: '#94A3B8', fontSize: 14, marginTop: 8 }}>
            Pick a builder account to test the portal — no password required
          </p>
          <div style={{
            display: 'inline-block',
            marginTop: 12,
            padding: '6px 16px',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 8,
            color: '#EF4444',
            fontSize: 12,
            fontWeight: 600,
          }}>
            ⚠️ REMOVE BEFORE PRODUCTION
          </div>
        </div>

        {/* Quick Login Button */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <button
            onClick={loginAsFirst}
            disabled={loggingIn === 'auto'}
            style={{
              padding: '14px 32px',
              background: '#C6A24E',
              color: 'white',
              border: 'none',
              borderRadius: 12,
              fontSize: 16,
              fontWeight: 700,
              cursor: loggingIn === 'auto' ? 'wait' : 'pointer',
              opacity: loggingIn === 'auto' ? 0.7 : 1,
              transition: 'all 0.2s',
            }}
          >
            {loggingIn === 'auto' ? 'Signing in...' : '⚡ Quick Login (First Active Builder)'}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            padding: '12px 16px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 12,
            color: '#EF4444',
            fontSize: 14,
            marginBottom: 24,
            textAlign: 'center',
          }}>
            {error}
          </div>
        )}

        {/* Builder List */}
        {loading ? (
          <div style={{ textAlign: 'center', color: '#94A3B8', padding: 40 }}>
            Loading builders...
          </div>
        ) : builders.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#94A3B8', padding: 40 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
            <p>No builders found in the database.</p>
            <p style={{ fontSize: 13, marginTop: 8 }}>
              Make sure the database is seeded and the connection string is configured.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ color: '#94A3B8', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
              {builders.length} Builder Accounts
            </div>
            {builders.map((b) => (
              <div
                key={b.id}
                style={{
                  background: 'rgba(30, 41, 59, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 16,
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  transition: 'border-color 0.2s',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'rgba(230, 126, 34, 0.3)'
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255, 255, 255, 0.08)'
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ color: '#F8FAFC', fontSize: 15, fontWeight: 600 }}>
                      {b.company}
                    </span>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: `${tierColors[b.tier] || '#6B7280'}20`,
                      color: tierColors[b.tier] || '#6B7280',
                    }}>
                      {b.tier}
                    </span>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: b.status === 'ACTIVE' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: b.status === 'ACTIVE' ? '#22C55E' : '#EF4444',
                    }}>
                      {b.status}
                    </span>
                  </div>
                  <div style={{ color: '#94A3B8', fontSize: 13 }}>
                    {b.email}
                    {b.contact ? ` · ${b.contact}` : ''}
                  </div>
                  <div style={{ color: '#64748B', fontSize: 12, marginTop: 4 }}>
                    {b.orderCount} orders · {fmt(b.totalSpend)} lifetime
                  </div>
                </div>
                <button
                  onClick={() => loginAs(b.email)}
                  disabled={!!loggingIn}
                  style={{
                    padding: '10px 20px',
                    background: loggingIn === b.email ? '#94A3B8' : '#0f2a3e',
                    color: 'white',
                    border: 'none',
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: loggingIn ? 'wait' : 'pointer',
                    opacity: loggingIn && loggingIn !== b.email ? 0.5 : 1,
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s',
                  }}
                >
                  {loggingIn === b.email ? 'Signing in...' : 'Login →'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
