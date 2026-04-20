'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function SetupAccountInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState(false)

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [handbookAgreed, setHandbookAgreed] = useState(false)
  const [signature, setSignature] = useState('')
  const [signatureDate, setSignatureDate] = useState('')
  const [showHandbook, setShowHandbook] = useState(false)

  // Set today's date as default
  useEffect(() => {
    const today = new Date()
    const dateStr = today.toISOString().split('T')[0]
    setSignatureDate(dateStr)
  }, [])

  // Validate token on load
  useEffect(() => {
    if (!token) {
      setError('Invalid invitation link. Missing token parameter.')
    }
  }, [token])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    // Validate form
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      setLoading(false)
      return
    }

    if (!signature.trim()) {
      setError('Please enter your signature')
      setLoading(false)
      return
    }

    if (!handbookAgreed) {
      setError('You must agree to the employee handbook')
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/ops/auth/setup-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          password,
          handbookAgreed,
          signatureName: signature,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Setup failed')
        setLoading(false)
        return
      }

      setSuccess(true)
      setTimeout(() => {
        router.push('/ops/login?message=Account setup complete. Please log in.')
      }, 2000)
    } catch (err) {
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0a1628',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        <div style={{
          background: 'rgba(17, 24, 39, 0.8)',
          backdropFilter: 'blur(12px)',
          border: '1px solid #1f2937',
          borderRadius: 16,
          padding: 32,
          maxWidth: 400,
          textAlign: 'center',
        }}>
          <p style={{ color: '#ef4444', marginBottom: 16 }}>Invalid Invitation</p>
          <p style={{ color: '#9ca3af', fontSize: 14 }}>This invitation link is invalid or has expired. Please contact your administrator.</p>
        </div>
      </div>
    )
  }

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
      padding: '20px',
    }}>
      {/* Animated gradient background */}
      <div style={{
        position: 'absolute',
        width: '500px',
        height: '500px',
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #C9822B 0%, #3E2A1E 100%)',
        opacity: 0.08,
        filter: 'blur(80px)',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        animation: 'float 8s ease-in-out infinite',
        pointerEvents: 'none',
      }} />

      <style>{`
        @keyframes float {
          0%, 100% { transform: translate(-50%, -50%); }
          50% { transform: translate(-48%, -52%); }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .setup-container { animation: slideIn 0.5s ease-out; }
      `}</style>

      <div style={{
        width: '100%',
        maxWidth: 500,
        position: 'relative',
        zIndex: 10,
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
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
            <span style={{ fontSize: 28, fontWeight: 800, color: '#000000' }}>A</span>
          </div>
          <h1 style={{
            fontSize: 28,
            fontWeight: 700,
            color: '#ffffff',
            margin: '0 0 8px',
            letterSpacing: '-0.5px',
          }}>
            Complete Your Setup
          </h1>
          <p style={{
            fontSize: 13,
            color: '#6b7280',
            margin: 0,
            fontWeight: 500,
          }}>
            Welcome to Abel Operations
          </p>
        </div>

        {/* Main Card */}
        <div className="setup-container" style={{
          background: 'rgba(17, 24, 39, 0.8)',
          backdropFilter: 'blur(12px)',
          border: '1px solid #1f2937',
          borderRadius: 16,
          padding: 32,
          boxShadow: '0 25px 50px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
        }}>
          {success ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'rgba(34, 197, 94, 0.1)',
                border: '2px solid #22c55e',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
              }}>
                <span style={{ fontSize: 32 }}>✓</span>
              </div>
              <h2 style={{ color: '#22c55e', marginBottom: 8 }}>Success!</h2>
              <p style={{ color: '#6b7280', marginBottom: 0 }}>Your account is ready. Redirecting to login...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {/* Password Section */}
              <div style={{ marginBottom: 24 }}>
                <label style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#9ca3af',
                  marginBottom: 8,
                }}>
                  Create Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
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
                    marginBottom: 8,
                  }}
                />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
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
                  }}
                />
              </div>

              {/* Handbook Agreement */}
              <div style={{ marginBottom: 24 }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  cursor: 'pointer',
                  color: '#d1d5db',
                  fontSize: 13,
                }}>
                  <input
                    type="checkbox"
                    checked={handbookAgreed}
                    onChange={(e) => setHandbookAgreed(e.target.checked)}
                    style={{
                      width: 18,
                      height: 18,
                      marginTop: 2,
                      cursor: 'pointer',
                      accentColor: '#f59e0b',
                    }}
                  />
                  <span>
                    I have read and agree to the{' '}
                    <button
                      type="button"
                      onClick={() => setShowHandbook(true)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#fbbf24',
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        padding: 0,
                        font: 'inherit',
                      }}
                    >
                      Abel Lumber Employee Handbook
                    </button>
                  </span>
                </label>
              </div>

              {/* Digital Signature */}
              <div style={{ marginBottom: 24 }}>
                <label style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#9ca3af',
                  marginBottom: 8,
                }}>
                  Digital Signature
                </label>
                <div style={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: 12,
                  padding: '16px',
                  marginBottom: 8,
                  minHeight: 80,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <input
                    type="text"
                    value={signature}
                    onChange={(e) => setSignature(e.target.value)}
                    placeholder="Type your full name"
                    required
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#ffffff',
                      fontSize: 32,
                      fontFamily: 'cursive',
                      outline: 'none',
                      textAlign: 'center',
                      width: '100%',
                    }}
                  />
                </div>

                {/* Date */}
                <label style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#9ca3af',
                  marginBottom: 8,
                }}>
                  Date
                </label>
                <input
                  type="date"
                  value={signatureDate}
                  onChange={(e) => setSignatureDate(e.target.value)}
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

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
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
                onMouseEnter={(e) => {
                  if (!loading) {
                    (e.target as HTMLButtonElement).style.background = '#fbbf24'
                    ;(e.target as HTMLButtonElement).style.boxShadow = '0 20px 25px rgba(245, 158, 11, 0.3)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading) {
                    (e.target as HTMLButtonElement).style.background = '#f59e0b'
                    ;(e.target as HTMLButtonElement).style.boxShadow = 'none'
                  }
                }}
              >
                {loading ? 'Setting up...' : 'Complete Setup'}
              </button>
            </form>
          )}
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

      {/* Handbook Modal */}
      {showHandbook && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px',
        }}>
          <div style={{
            background: '#0a1628',
            borderRadius: 16,
            width: '100%',
            maxWidth: 800,
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid #1f2937',
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '16px 24px',
              borderBottom: '1px solid #1f2937',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <h2 style={{ color: '#ffffff', margin: 0, fontSize: 18 }}>Employee Handbook</h2>
              <button
                onClick={() => setShowHandbook(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#9ca3af',
                  fontSize: 24,
                  cursor: 'pointer',
                  padding: 0,
                  width: 24,
                  height: 24,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div style={{
              flex: 1,
              overflow: 'auto',
              padding: '24px',
            }}>
              <iframe
                src="/api/ops/handbook"
                style={{
                  width: '100%',
                  height: '600px',
                  border: 'none',
                  borderRadius: 8,
                  backgroundColor: '#1f2937',
                }}
                title="Abel Lumber Employee Handbook"
              />
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '16px 24px',
              borderTop: '1px solid #1f2937',
              display: 'flex',
              gap: 12,
              justifyContent: 'flex-end',
            }}>
              <button
                onClick={() => setShowHandbook(false)}
                style={{
                  padding: '10px 20px',
                  background: '#374151',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SetupAccountPage() {
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
      <SetupAccountInner />
    </Suspense>
  )
}
