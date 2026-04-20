'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

function scorePassword(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string; color: string } {
  if (!pw) return { score: 0, label: '', color: 'bg-gray-200' }
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++
  const bounded = Math.min(4, score) as 0 | 1 | 2 | 3 | 4
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'] as const
  const colors = ['bg-gray-200', 'bg-red-500', 'bg-amber-500', 'bg-blue-500', 'bg-green-500']
  return { score: bounded, label: labels[bounded], color: colors[bounded] }
}

const PAYMENT_OPTIONS = [
  {
    value: 'PAY_AT_ORDER',
    label: 'Pay at Order',
    desc: '3% discount on every order',
    badge: 'Best Value',
  },
  {
    value: 'PAY_ON_DELIVERY',
    label: 'Pay on Delivery',
    desc: 'Standard pricing, pay when materials arrive',
    badge: null,
  },
  {
    value: 'NET_15',
    label: 'Net 15',
    desc: '15-day payment terms (1% premium)',
    badge: null,
  },
  {
    value: 'NET_30',
    label: 'Net 30',
    desc: '30-day payment terms (2.5% premium)',
    badge: null,
  },
]

const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
  'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana',
  'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi',
  'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
  'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma',
  'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
  'West Virginia', 'Wisconsin', 'Wyoming'
]

export default function SignupPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)

  const handleCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLockOn(typeof e.getModifierState === 'function' && e.getModifierState('CapsLock'))
  }

  const [form, setForm] = useState({
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    paymentTerm: 'NET_15',
    licenseNumber: '',
    taxId: '',
    taxExempt: false,
    address: '',
    city: '',
    state: '',
    zip: '',
  })

  const updateForm = (field: string, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setError('')
  }

  const passwordStrength = useMemo(() => scorePassword(form.password), [form.password])

  const handleSubmit = async () => {
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (!/[A-Z]/.test(form.password)) {
      setError('Password must contain at least one uppercase letter')
      return
    }
    if (!/[0-9]/.test(form.password)) {
      setError('Password must contain at least one number')
      return
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: form.companyName.trim(),
          contactName: form.contactName.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phone.trim() || undefined,
          password: form.password,
          paymentTerm: form.paymentTerm,
          licenseNumber: form.licenseNumber.trim() || undefined,
          taxId: form.taxId.trim() || undefined,
          taxExempt: form.taxExempt,
          address: form.address.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state || undefined,
          zip: form.zip.trim() || undefined,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data?.error || `Signup failed (${res.status})`)
      }

      router.push('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Left Panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-abel-walnut p-12 flex-col justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-abel-amber rounded-xl flex items-center justify-center font-bold text-white">
              AB
            </div>
            <span className="text-white font-semibold text-xl">Abel Builder</span>
          </div>
        </div>
        <div>
          <h2 className="text-4xl font-bold text-white leading-tight">
            Join 40+ builders already using Abel&apos;s platform
          </h2>
          <p className="mt-4 text-white/60 text-lg">
            AI-powered takeoffs, instant quotes, and flexible payment terms —
            all designed for how you build.
          </p>
        </div>
        <div className="text-white/30 text-sm">
          Abel Lumber &middot; Builder Platform
        </div>
      </div>

      {/* Right Panel - Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-bold text-abel-charcoal mb-1">
            Create your account
          </h1>
          <p className="text-gray-500 mb-8">
            Step {step} of 4 — {step === 1 ? 'Company Info' : step === 2 ? 'Your Details' : step === 3 ? 'Business Details' : 'Payment Terms'}
          </p>

          {/* Progress Bar */}
          <div className="flex gap-2 mb-8">
            {[1, 2, 3, 4].map((s) => (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full transition ${
                  s <= step ? 'bg-abel-amber' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>

          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="mb-4 bg-red-50 text-red-700 px-4 py-3 rounded-xl text-sm border border-red-100"
            >
              {error}
            </div>
          )}

          {/* Step 1: Company */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="companyName" className="label">Company Name</label>
                <input
                  id="companyName"
                  name="companyName"
                  autoComplete="organization"
                  className="input"
                  placeholder="Your Building Company"
                  value={form.companyName}
                  onChange={(e) => updateForm('companyName', e.target.value)}
                  required
                  aria-required="true"
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="phone" className="label">Phone</label>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  className="input"
                  placeholder="(555) 123-4567"
                  value={form.phone}
                  onChange={(e) => updateForm('phone', e.target.value)}
                />
              </div>
              <button
                onClick={() => {
                  if (!form.companyName) {
                    setError('Company name is required')
                    return
                  }
                  setStep(2)
                }}
                className="btn-accent w-full mt-4"
              >
                Continue
              </button>
            </div>
          )}

          {/* Step 2: Personal */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="contactName" className="label">Your Name</label>
                <input
                  id="contactName"
                  name="contactName"
                  autoComplete="name"
                  className="input"
                  placeholder="John Smith"
                  value={form.contactName}
                  onChange={(e) => updateForm('contactName', e.target.value)}
                  required
                  aria-required="true"
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="email" className="label">Email</label>
                <input
                  id="email"
                  name="email"
                  className="input"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="john@yourcompany.com"
                  value={form.email}
                  onChange={(e) => updateForm('email', e.target.value)}
                  required
                  aria-required="true"
                />
              </div>
              <div>
                <label htmlFor="password" className="label">Password</label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    className="input pr-16"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Min. 8 chars, 1 uppercase, 1 number"
                    value={form.password}
                    onChange={(e) => updateForm('password', e.target.value)}
                    onKeyUp={handleCapsLock}
                    onKeyDown={handleCapsLock}
                    required
                    minLength={8}
                    aria-required="true"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(s => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    tabIndex={-1}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-abel-amber transition text-sm font-medium"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                {form.password.length > 0 && (
                  <div className="mt-2" aria-live="polite">
                    <div className="flex gap-1 h-1.5" aria-hidden="true">
                      {[1, 2, 3, 4].map(i => (
                        <div
                          key={i}
                          className={`flex-1 rounded-full transition-colors ${i <= passwordStrength.score ? passwordStrength.color : 'bg-gray-200'}`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Strength: <span className="font-medium text-gray-700">{passwordStrength.label}</span>
                    </p>
                  </div>
                )}
                {capsLockOn && (
                  <p className="mt-1.5 text-xs text-amber-600" aria-live="polite">
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1.5 align-middle" />
                    Caps Lock is on
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="confirmPassword" className="label">Confirm Password</label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Re-enter password"
                  value={form.confirmPassword}
                  onChange={(e) => updateForm('confirmPassword', e.target.value)}
                  onKeyUp={handleCapsLock}
                  required
                  minLength={8}
                  aria-required="true"
                  aria-invalid={form.confirmPassword.length > 0 && form.password !== form.confirmPassword}
                />
                {form.confirmPassword.length > 0 && form.password !== form.confirmPassword && (
                  <p className="mt-1.5 text-xs text-red-600" aria-live="polite">
                    Passwords don&apos;t match yet.
                  </p>
                )}
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={() => setStep(1)} className="btn-outline flex-1">
                  Back
                </button>
                <button
                  onClick={() => {
                    if (!form.contactName || !form.email || !form.password) {
                      setError('All fields are required')
                      return
                    }
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
                      setError('Please enter a valid email address')
                      return
                    }
                    setStep(3)
                  }}
                  className="btn-accent flex-1"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Business Details */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="licenseNumber" className="label">License Number (optional)</label>
                <input
                  id="licenseNumber"
                  name="licenseNumber"
                  className="input"
                  placeholder="Your business license #"
                  value={form.licenseNumber}
                  onChange={(e) => updateForm('licenseNumber', e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="taxId" className="label">Tax ID (optional)</label>
                <input
                  id="taxId"
                  name="taxId"
                  className="input"
                  placeholder="Your Tax ID"
                  value={form.taxId}
                  onChange={(e) => updateForm('taxId', e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="taxExempt"
                  checked={form.taxExempt}
                  onChange={(e) => updateForm('taxExempt', e.target.checked)}
                  className="w-4 h-4"
                />
                <label htmlFor="taxExempt" className="text-sm text-gray-700">
                  Tax Exempt Status
                </label>
              </div>
              <div>
                <label htmlFor="address" className="label">Street Address (optional)</label>
                <input
                  id="address"
                  name="address"
                  autoComplete="street-address"
                  className="input"
                  placeholder="123 Main St"
                  value={form.address}
                  onChange={(e) => updateForm('address', e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="city" className="label">City (optional)</label>
                  <input
                    id="city"
                    name="city"
                    autoComplete="address-level2"
                    className="input"
                    placeholder="Austin"
                    value={form.city}
                    onChange={(e) => updateForm('city', e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="zip" className="label">ZIP Code (optional)</label>
                  <input
                    id="zip"
                    name="zip"
                    inputMode="numeric"
                    autoComplete="postal-code"
                    pattern="\d{5}(-\d{4})?"
                    className="input"
                    placeholder="78701"
                    value={form.zip}
                    onChange={(e) => updateForm('zip', e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="state" className="label">State (optional)</label>
                <select
                  id="state"
                  name="state"
                  autoComplete="address-level1"
                  className="input"
                  value={form.state}
                  onChange={(e) => updateForm('state', e.target.value)}
                >
                  <option value="">Select State</option>
                  {US_STATES.map(state => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={() => setStep(2)} className="btn-outline flex-1">
                  Back
                </button>
                <button
                  onClick={() => setStep(4)}
                  className="btn-accent flex-1"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Payment Terms */}
          {step === 4 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 mb-2">
                Select your preferred payment terms. This affects your pricing
                on every order.
              </p>
              {PAYMENT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => updateForm('paymentTerm', opt.value)}
                  className={`w-full text-left p-4 rounded-xl border-2 transition ${
                    form.paymentTerm === opt.value
                      ? 'border-abel-amber bg-orange-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-abel-charcoal">
                      {opt.label}
                    </span>
                    {opt.badge && (
                      <span className="text-xs bg-abel-green text-white px-2 py-0.5 rounded-full">
                        {opt.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">{opt.desc}</p>
                </button>
              ))}
              <div className="flex gap-3 mt-4">
                <button onClick={() => setStep(3)} className="btn-outline flex-1">
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="btn-accent flex-1 disabled:opacity-50"
                >
                  {loading ? 'Creating Account...' : 'Create Account'}
                </button>
              </div>
            </div>
          )}

          <p className="mt-8 text-center text-sm text-gray-500">
            Already have an account?{' '}
            <Link href="/login" className="text-abel-amber font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
