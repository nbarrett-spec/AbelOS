'use client'

import { useState, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function StaffLoginInner() {
  const [email, setEmail] = useState<string>('')
  const [password, setPassword] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') || '/ops'

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setEmail(e.target.value)
  }

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setPassword(e.target.value)
  }

  const handleEmailFocus = (e: React.FocusEvent<HTMLInputElement>): void => {
    e.target.style.borderColor = '#f59e0b'
    e.target.style.boxShadow = '0 0 0 3px rgba(245, 158, 11, 0.1)'
  }

  const handleEmailBlur = (e: React.FocusEvent<HTMLInputElement>): void => {
    e.target.style.borderColor = '#1f2937'
    e.target.style.boxShadow = 'none'
  }

  const handlePasswordFocus = (e: React.FocusEvent<HTMLInputElement>): void => {
    e.target.style.borderColor = '#f59e0b'
    e.target.style.boxShadow = '0 0 0 3px rgba(245, 158, 11, 0.1)'
  }

  const handlePasswordBlur = (e: React.FocusEvent<HTMLInputElement>): void => {
    e.target.style.borderColor = '#1f2937'
    e.target.style.boxShadow = 'none'
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/ops/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Login failed')
        setLoading(false)
        return
      }

      // Redirect to intended page or dashboard
      router.push(redirect)
    } catch {
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }

  const handleButtonMouseEnter = (e: React.MouseEvent<HTMLButtonElement>): void => {
    if (!loading) {
      (e.target as HTMLButtonElement).style.background = '#fbbf24'
      ;(e.target as HTMLButtonElement).style.boxShadow = '0 20px 25px rgba(245, 158, 11, 0.3)'
    }
  }

  const handleButtonMouseLeave = (e: React.MouseEvent<HTMLButtonElement>): void => {
    if (!loading) {
      (e.target as HTMLButtonElement).style.background = '#f59e0b'
      ;(e.target as HTMLButtonElement).style.boxShadow = 'none'
    }
  }

  const showSessionExpiredBanner = redirect && redirect !== '/ops'

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#0a1628',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Animated gradient orb background */}
      <div style={{
        position: 'absolute',
        width: '500px',
        height: '500px',
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #f59e0b 0%, #3b82f6 100%)',
        opacity: 0.1,
        filter: 'blur(80px)',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        animation: 'float 8s ease-in-out infinite',
        pointerEvents: 'none',
      }} />

      <style>{`
        @keyframes float {
          0%, 100% {
            transform: translate(-50%, -50%);
          }
          50% {
            transform: translate(-48%, -52%);
          }
        }
      `}</style>

      {/* Top gradient line */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '2px',
        background: 'linear-gradient(to right, #f59e0b, #f97316, #f59e0b)',
      }} />

      {/* Session Expiry Banner */}
      {showSessionExpiredBanner && (
        <div style={{
          position: 'absolute',
          top: 20,
          left: 0,
          right: 0,
          padding: '0 20px',
          display: 'flex',
          justifyContent: 'center',
          zIndex: 20,
        }}>
          <div style={{
            maxWidth: 420,
            width: '100%',
            padding: '12px 16px',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: 12,
            color: '#fcd34d',
            fontSize: 13,
            fontWeight: 500,
            textAlign: 'center',
          }}>
            Your session has expired. Please sign in again.
          </div>
        </div>
      )}

      <div style={{
        width: '100%',
        maxWidth: 420,
        padding: '0 20px',
        position: 'relative',
        zIndex: 10,
      }}>
        {/* Logo + Header */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{
            width: 56,
            height: 56,
            borderRadius: 12,
            background: '#f59e0b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            boxShadow: '0 20px 40px rgba(245, 158, 11, 0.25)',
          }}>
            <span style={{
              fontSize: 28,
              fontWeight: 800,
              color: '#000000',
            }}>A</span>
          </div>
          <h1 style={{
            fontSize: 28,
            fontWeight: 700,
            color: '#ffffff',
            margin: '0 0 8px',
            letterSpacing: '-0.5px',
          }}>
            Abel Operations
          </h1>
          <p style={{
            fontSize: 13,
            color: '#6b7280',
            margin: 0,
            fontWeight: 500,
          }}>
            Staff Portal
          </p>
        </div>

        {/* Login Card */}
        <div style={{
          background: 'rgba(17, 24, 39, 0.8)',
          backdropFilter: 'blur(12px)',
          border: '1px solid #1f2937',
          borderRadius: 16,
          padding: 32,
          boxShadow: '0 25px 50px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
        }}>
          <form onSubmit={handleSubmit}>
            {/* Email */}
            <div style={{ marginBottom: 24 }}>
              <label style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 600,
                color: '#9ca3af',
                marginBottom: 8,
              }}>
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={handleEmailChange}
                onFocus={handleEmailFocus}
                onBlur={handleEmailBlur}
                placeholder="you@abellumber.com"
                required
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: 12,
                  fontSize: 14,
                  color: '#ffffff',
                  outline: 'none',
                  transition: 'all 0.2s',
                  boxSizing: 'border-box',
                  boxShadow: 'none',
                }}
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: 24 }}>
              <label style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 600,
                color: '#9ca3af',
                marginBottom: 8,
              }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={handlePasswordChange}
                onFocus={handlePasswordFocus}
                onBlur={handlePasswordBlur}
                placeholder="Enter your password"
                required
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: 12,
                  fontSize: 14,
                  color: '#ffffff',
                  outline: 'none',
                  transition: 'all 0.2s',
                  boxSizing: 'border-box',
                  boxShadow: 'none',
                }}
              />
            </div>

            {/* Error */}
            {error && (
              <div style={{
                padding: 12,
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: 12,
                color: '#f87171',
                fontSize: 13,
                marginBottom: 20,
              }}>
                {error}
              </div>
            )}

            {/* Forgot Password */}
            <div style={{ textAlign: 'right', marginBottom: 24 }}>
              <a
                href="/ops/forgot-password"
                style={{
                  fontSize: 13,
                  color: '#fbbf24',
                  textDecoration: 'none',
                  fontWeight: 500,
                  transition: 'color 0.2s',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>): void => {
                  (e.target as HTMLAnchorElement).style.color = '#fcd34d'
                }}
                onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>): void => {
                  (e.target as HTMLAnchorElement).style.color = '#fbbf24'
                }}
              >
                Forgot password?
              </a>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              onMouseEnter={handleButtonMouseEnter}
              onMouseLeave={handleButtonMouseLeave}
              style={{
                width: '100%',
                padding: '12px 20px',
                background: loading ? '#6b7280' : '#f59e0b',
                color: loading ? '#d1d5db' : '#000000',
                border: 'none',
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                letterSpacing: '-0.3px',
              }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p style={{
          textAlign: 'center',
          fontSize: 11,
          color: '#4b5563',
          marginTop: 32,
          fontWeight: 500,
        }}>
          Abel Door & Trim · Operations Platform
        </p>
      </div>
    </div>
  )
}

export default function StaffLoginPage() {
  return (
    <Suspense fallback={
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0a1628',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        <p style={{ color: '#6b7280' }}>Loading...</p>
      </div>
    }>
      <StaffLoginInner />
    </Suspense>
  )
}
