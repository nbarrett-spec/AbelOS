'use client'

import { useState, FormEvent } from 'react'
import Link from 'next/link'

export default function StaffForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/ops/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong')
        setLoading(false)
        return
      }

      setSent(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{ width: '100%', maxWidth: 420, padding: '0 20px' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 80, height: 80, borderRadius: 16,
            background: 'linear-gradient(135deg, #C9822B, #A86B1F)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
            boxShadow: '0 8px 32px rgba(230, 126, 34, 0.3)',
          }}>
            <span style={{ fontSize: 36, fontWeight: 800, color: 'white' }}>A</span>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'white', margin: '0 0 4px' }}>
            Reset Password
          </h1>
          <p style={{ fontSize: 14, color: '#94a3b8', margin: 0 }}>
            Abel Operations Staff Portal
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: 'white', borderRadius: 12, padding: 32,
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
        }}>
          {sent ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: '#f0fdf4', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 16px', fontSize: 28,
              }}>
                ✓
              </div>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: '#3E2A1E', margin: '0 0 8px' }}>
                Check Your Email
              </h2>
              <p style={{ fontSize: 14, color: '#666', lineHeight: 1.6 }}>
                If an account exists for <strong>{email}</strong>, we've sent a password reset link. Check your inbox and spam folder.
              </p>
              <Link href="/ops/login" style={{
                display: 'inline-block', marginTop: 20,
                color: '#C9822B', fontSize: 14, fontWeight: 600,
                textDecoration: 'none',
              }}>
                ← Back to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <p style={{ fontSize: 14, color: '#666', margin: '0 0 20px', lineHeight: 1.5 }}>
                Enter your email address and we'll send you a link to reset your password.
              </p>

              <div style={{ marginBottom: 20 }}>
                <label style={{
                  display: 'block', fontSize: 13, fontWeight: 600,
                  color: '#374151', marginBottom: 6,
                }}>
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@abellumber.com"
                  required
                  style={{
                    width: '100%', padding: '10px 14px',
                    border: '1px solid #d1d5db', borderRadius: 8,
                    fontSize: 14, outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>

              {error && (
                <div style={{
                  padding: '10px 14px', background: '#fef2f2',
                  border: '1px solid #fecaca', borderRadius: 8,
                  color: '#dc2626', fontSize: 13, marginBottom: 16,
                }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%', padding: '12px 20px',
                  background: loading ? '#9ca3af' : 'linear-gradient(135deg, #C9822B, #A86B1F)',
                  color: 'white', border: 'none', borderRadius: 8,
                  fontSize: 15, fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>

              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <Link href="/ops/login" style={{
                  color: '#3E2A1E', fontSize: 13, textDecoration: 'none',
                }}>
                  ← Back to Sign In
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
