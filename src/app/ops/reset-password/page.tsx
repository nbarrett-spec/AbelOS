'use client'

import { useState, FormEvent, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

function StaffResetPasswordInner() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/ops/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong')
        setLoading(false)
        return
      }

      setSuccess(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        <div style={{ background: 'white', borderRadius: 12, padding: 32, maxWidth: 420, textAlign: 'center' }}>
          <h2 style={{ color: '#dc2626', margin: '0 0 12px' }}>Invalid Reset Link</h2>
          <p style={{ color: '#666', fontSize: 14 }}>This password reset link is invalid or has expired.</p>
          <Link href="/ops/forgot-password" style={{
            display: 'inline-block', marginTop: 16,
            color: '#C9822B', fontSize: 14, fontWeight: 600, textDecoration: 'none',
          }}>
            Request a new link →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
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
            New Password
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
          {success ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: '#f0fdf4', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 16px', fontSize: 28, color: '#16a34a',
              }}>
                ✓
              </div>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: '#3E2A1E', margin: '0 0 8px' }}>
                Password Updated
              </h2>
              <p style={{ fontSize: 14, color: '#666', lineHeight: 1.6 }}>
                Your password has been reset successfully. You can now sign in with your new password.
              </p>
              <Link href="/ops/login" style={{
                display: 'inline-block', marginTop: 20, padding: '12px 32px',
                background: 'linear-gradient(135deg, #3E2A1E, #5A4233)',
                color: 'white', borderRadius: 8, fontSize: 15, fontWeight: 600,
                textDecoration: 'none',
              }}>
                Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <p style={{ fontSize: 14, color: '#666', margin: '0 0 20px', lineHeight: 1.5 }}>
                Choose a new password for your account. Must be at least 8 characters.
              </p>

              <div style={{ marginBottom: 16 }}>
                <label style={{
                  display: 'block', fontSize: 13, fontWeight: 600,
                  color: '#374151', marginBottom: 6,
                }}>
                  New Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter new password"
                  required
                  minLength={8}
                  style={{
                    width: '100%', padding: '10px 14px',
                    border: '1px solid #d1d5db', borderRadius: 8,
                    fontSize: 14, outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{
                  display: 'block', fontSize: 13, fontWeight: 600,
                  color: '#374151', marginBottom: 6,
                }}>
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Confirm new password"
                  required
                  minLength={8}
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
                {loading ? 'Resetting...' : 'Reset Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export default function StaffResetPasswordPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%)' }}><p style={{ color: '#94a3b8' }}>Loading...</p></div>}>
      <StaffResetPasswordInner />
    </Suspense>
  )
}
