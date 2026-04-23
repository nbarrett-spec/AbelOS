'use client'

import { useState } from 'react'
import Link from 'next/link'

// ──────────────────────────────────────────────────────────────────────────
// /dashboard/onboarding — Builder Onboarding Wizard
//
// Multi-step wizard guiding new builders through initial setup:
// 1. Company info confirmation
// 2. Credit application
// 3. Catalog preferences
// 4. Delivery preferences
// 5. Review & submit
//
// Stores data in local state, submits to /api/builder/onboarding on final step.
// ──────────────────────────────────────────────────────────────────────────

type Step = 'company' | 'credit' | 'catalog' | 'delivery' | 'review'

interface OnboardingData {
  company: {
    name: string
    address: string
    city: string
    state: string
    zip: string
    contactName: string
    contactEmail: string
    contactPhone: string
  }
  credit: {
    creditLimit: string
    reference1Name: string
    reference1Phone: string
    reference2Name: string
    reference2Phone: string
  }
  catalog: {
    doors: boolean
    trim: boolean
    hardware: boolean
    lumber: boolean
    accessories: boolean
  }
  delivery: {
    preferredDays: string[]
    preferredTimes: string
    siteAccessNotes: string
    deliveryContact: string
  }
}

const STEP_ORDER: Step[] = ['company', 'credit', 'catalog', 'delivery', 'review']

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState<Step>('company')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [data, setData] = useState<OnboardingData>({
    company: {
      name: '',
      address: '',
      city: '',
      state: '',
      zip: '',
      contactName: '',
      contactEmail: '',
      contactPhone: '',
    },
    credit: {
      creditLimit: '',
      reference1Name: '',
      reference1Phone: '',
      reference2Name: '',
      reference2Phone: '',
    },
    catalog: {
      doors: false,
      trim: false,
      hardware: false,
      lumber: false,
      accessories: false,
    },
    delivery: {
      preferredDays: [],
      preferredTimes: '',
      siteAccessNotes: '',
      deliveryContact: '',
    },
  })

  const currentStepIndex = STEP_ORDER.indexOf(currentStep)
  const isFirstStep = currentStepIndex === 0
  const isLastStep = currentStepIndex === STEP_ORDER.length - 1

  const handleNext = () => {
    if (!isLastStep) {
      const nextIndex = currentStepIndex + 1
      setCurrentStep(STEP_ORDER[nextIndex])
    }
  }

  const handleBack = () => {
    if (!isFirstStep) {
      const prevIndex = currentStepIndex - 1
      setCurrentStep(STEP_ORDER[prevIndex])
    }
  }

  const handleCompanyChange = (field: keyof typeof data.company, value: string) => {
    setData(prev => ({
      ...prev,
      company: { ...prev.company, [field]: value },
    }))
  }

  const handleCreditChange = (field: keyof typeof data.credit, value: string) => {
    setData(prev => ({
      ...prev,
      credit: { ...prev.credit, [field]: value },
    }))
  }

  const handleCatalogChange = (field: keyof typeof data.catalog) => {
    setData(prev => ({
      ...prev,
      catalog: { ...prev.catalog, [field]: !prev.catalog[field] },
    }))
  }

  const handleDeliveryChange = (field: keyof typeof data.delivery, value: string | string[]) => {
    setData(prev => ({
      ...prev,
      delivery: { ...prev.delivery, [field]: value },
    }))
  }

  const toggleDeliveryDay = (day: string) => {
    setData(prev => ({
      ...prev,
      delivery: {
        ...prev.delivery,
        preferredDays: prev.delivery.preferredDays.includes(day)
          ? prev.delivery.preferredDays.filter(d => d !== day)
          : [...prev.delivery.preferredDays, day],
      },
    }))
  }

  const handleSubmit = async () => {
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/builder/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to submit onboarding')
      }

      setSubmitted(true)
    } catch (err: any) {
      setError(err.message || 'An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-brand/5 via-white to-signal/5 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-surface rounded-lg shadow-lg p-8 text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-abel-green/10 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-abel-green"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-fg mb-2">All set!</h2>
          <p className="text-fg-muted mb-6">
            Thank you for completing your onboarding. Your account is ready to use.
          </p>
          <Link
            href="/dashboard"
            className="inline-block bg-brand hover:bg-brand/90 text-white px-6 py-2 rounded font-medium transition"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand/5 via-white to-signal/5 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-fg mb-2">Welcome to Abel Lumber</h1>
          <p className="text-fg-muted">Let's get your account set up in a few minutes</p>
        </div>

        {/* Step Indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            {STEP_ORDER.map((step, idx) => {
              const isActive = step === currentStep
              const isPast = STEP_ORDER.indexOf(currentStep) > idx
              const labels: Record<Step, string> = {
                company: 'Company',
                credit: 'Credit',
                catalog: 'Catalog',
                delivery: 'Delivery',
                review: 'Review',
              }

              return (
                <div key={step} className="flex items-center flex-1">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm transition ${
                      isActive
                        ? 'bg-brand text-white'
                        : isPast
                        ? 'bg-abel-green text-white'
                        : 'bg-surface-muted text-fg-muted'
                    }`}
                  >
                    {isPast ? '✓' : idx + 1}
                  </div>
                  <div className="text-xs font-medium text-fg-muted ml-2 hidden sm:block">
                    {labels[step]}
                  </div>
                  {idx < STEP_ORDER.length - 1 && (
                    <div
                      className={`flex-1 h-1 mx-2 rounded ${
                        isPast ? 'bg-abel-green' : 'bg-surface-muted'
                      }`}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Form Card */}
        <div className="bg-surface rounded-lg shadow-lg p-8">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
              {error}
            </div>
          )}

          {/* Company Info Step */}
          {currentStep === 'company' && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-fg mb-6">Company Information</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-fg-muted mb-1">
                    Company Name
                  </label>
                  <input
                    type="text"
                    value={data.company.name}
                    onChange={e => handleCompanyChange('name', e.target.value)}
                    className="w-full border border-border-strong rounded px-3 py-2 text-sm"
                    placeholder="Your company name"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-fg-muted mb-1">
                    Street Address
                  </label>
                  <input
                    type="text"
                    value={data.company.address}
                    onChange={e => handleCompanyChange('address', e.target.value)}
                    className="w-full border border-border-strong rounded px-3 py-2 text-sm"
                    placeholder="123 Main St"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-fg-muted mb-1">City</label>
                  <input
                    type="text"
                    value={data.company.city}
                    onChange={e => handleCompanyChange('city', e.target.value)}
                    className="w-full border border-border-strong rounded px-3 py-2 text-sm"
                    placeholder="Dallas"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-fg-muted mb-1">State</label>
                  <input
                    type="text"
                    maxLength={2}
                    value={data.company.state}
                    onChange={e => handleCompanyChange('state', e.target.value.toUpperCase())}
                    className="w-full border border-border-strong rounded px-3 py-2 text-sm"
                    placeholder="TX"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-fg-muted mb-1">ZIP</label>
                  <input
                    type="text"
                    value={data.company.zip}
                    onChange={e => handleCompanyChange('zip', e.target.value)}
                    className="w-full border border-border-strong rounded px-3 py-2 text-sm"
                    placeholder="75201"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-fg-muted mb-1">
                    Primary Contact Name
                  </label>
                  <input
                    type="text"
                    value={data.company.contactName}
                    onChange={e => handleCompanyChange('contactName', e.target.value)}
                    className="w-full border border-border-strong rounded px-3 py-2 text-sm"
                    placeholder="John Smith"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-fg-muted mb-1">
                    Contact Email
                  </label>
                  <input
                    type="email"
                    value={data.company.contactEmail}
                    onChange={e => handleCompanyChange('contactEmail', e.target.value)}
                    className="w-full border border-border-strong rounded px-3 py-2 text-sm"
                    placeholder="john@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-fg-muted mb-1">
                    Contact Phone
                  </label>
                  <input
                    type="tel"
                    value={data.company.contactPhone}
                    onChange={e => handleCompanyChange('contactPhone', e.target.value)}
                    className="w-full border border-border-strong rounded px-3 py-2 text-sm"
                    placeholder="(214) 555-1234"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Credit Application Step */}
          {currentStep === 'credit' && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-fg mb-6">Credit Application</h2>
              <div className="bg-signal/5 border border-signal/20 rounded p-4 mb-6 text-sm text-fg-muted">
                We'll use this information to set up your credit terms with us.
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-fg-muted mb-1">
                  Requested Credit Limit
                </label>
                <input
                  type="text"
                  value={data.credit.creditLimit}
                  onChange={e => handleCreditChange('creditLimit', e.target.value)}
                  className="w-full border border-border-strong rounded px-3 py-2 text-sm"
                  placeholder="$50,000"
                />
              </div>
              <div className="border-t pt-4 mt-4">
                <h3 className="font-semibold text-fg mb-4 text-sm">Trade References</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-fg-muted mb-1">
                      Reference 1 Company
                    </label>
                    <input
                      type="text"
                      value={data.credit.reference1Name}
                      onChange={e => handleCreditChange('reference1Name', e.target.value)}
                      className="w-full border border-border-strong rounded px-3 py-2 text-sm"
                      placeholder="Company name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-fg-muted mb-1">
                      Contact Phone
                    </label>
                    <input
                      type="tel"
                      value={data.credit.reference1Phone}
                      onChange={e => handleCreditChange('reference1Phone', e.target.value)}
                      className="w-full border border-border-strong rounded px-3 py-2 text-sm"
                      placeholder="(214) 555-0001"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-fg-muted mb-1">
                      Reference 2 Company
                    </label>
                    <input
                      type="text"
                      value={data.credit.reference2Name}
                      onChange={e => handleCreditChange('reference2Name', e.target.value)}
                      className="w-full border border-border-strong rounded px-3 py-2 text-sm"
                      placeholder="Company name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-fg-muted mb-1">
                      Contact Phone
                    </label>
                    <input
                      type="tel"
                      value={data.credit.reference2Phone}
                      onChange={e => handleCreditChange('reference2Phone', e.target.value)}
                      className="w-full border border-border-strong rounded px-3 py-2 text-sm"
                      placeholder="(214) 555-0002"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Catalog Preferences Step */}
          {currentStep === 'catalog' && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-fg mb-6">Product Categories</h2>
              <p className="text-fg-muted text-sm mb-4">
                Select the categories that interest your company.
              </p>
              <div className="space-y-3">
                {[
                  { key: 'doors', label: 'Doors', icon: '🚪' },
                  { key: 'trim', label: 'Trim & Molding', icon: '📐' },
                  { key: 'hardware', label: 'Hardware', icon: '🔧' },
                  { key: 'lumber', label: 'Lumber & Plywood', icon: '🪵' },
                  { key: 'accessories', label: 'Accessories', icon: '✨' },
                ].map(cat => (
                  <label key={cat.key} className="flex items-center p-3 border border-border rounded hover:bg-surface-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={data.catalog[cat.key as keyof typeof data.catalog]}
                      onChange={() => handleCatalogChange(cat.key as keyof typeof data.catalog)}
                      className="w-4 h-4 rounded border-border-strong text-brand"
                    />
                    <span className="ml-3 text-base">{cat.icon}</span>
                    <span className="ml-2 font-medium text-fg">{cat.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Delivery Preferences Step */}
          {currentStep === 'delivery' && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-fg mb-6">Delivery Preferences</h2>
              <div>
                <label className="block text-sm font-medium text-fg-muted mb-3">
                  Preferred Delivery Days
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map(day => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDeliveryDay(day)}
                      className={`py-2 px-3 rounded text-sm font-medium border transition ${
                        data.delivery.preferredDays.includes(day)
                          ? 'bg-brand text-white border-brand'
                          : 'bg-surface text-fg border-border-strong hover:border-brand'
                      }`}
                    >
                      {day.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-fg-muted mb-1">
                  Preferred Time Window
                </label>
                <select
                  value={data.delivery.preferredTimes}
                  onChange={e => handleDeliveryChange('preferredTimes', e.target.value)}
                  className="w-full border border-border-strong rounded px-3 py-2 text-sm"
                >
                  <option value="">Select a time window</option>
                  <option value="early">Early morning (6-9 AM)</option>
                  <option value="morning">Morning (9 AM-12 PM)</option>
                  <option value="afternoon">Afternoon (12-5 PM)</option>
                  <option value="flexible">Flexible</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-fg-muted mb-1">
                  Site Access Notes
                </label>
                <textarea
                  value={data.delivery.siteAccessNotes}
                  onChange={e => handleDeliveryChange('siteAccessNotes', e.target.value)}
                  className="w-full border border-border-strong rounded px-3 py-2 text-sm"
                  rows={3}
                  placeholder="e.g., Gate code is 1234, call 10 min before arrival"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-fg-muted mb-1">
                  Delivery Contact Name
                </label>
                <input
                  type="text"
                  value={data.delivery.deliveryContact}
                  onChange={e => handleDeliveryChange('deliveryContact', e.target.value)}
                  className="w-full border border-border-strong rounded px-3 py-2 text-sm"
                  placeholder="Job manager or supervisor"
                />
              </div>
            </div>
          )}

          {/* Review Step */}
          {currentStep === 'review' && (
            <div className="space-y-6">
              <h2 className="text-xl font-bold text-fg mb-6">Review Your Information</h2>

              <div className="border-l-4 border-signal bg-amber-50 p-4 rounded">
                <h3 className="font-semibold text-fg text-sm mb-2">Company Info</h3>
                <dl className="text-sm text-fg-muted space-y-1">
                  <div><dt className="font-medium inline">Name: </dt><dd className="inline">{data.company.name}</dd></div>
                  <div><dt className="font-medium inline">Address: </dt><dd className="inline">{data.company.address}, {data.company.city}, {data.company.state} {data.company.zip}</dd></div>
                  <div><dt className="font-medium inline">Contact: </dt><dd className="inline">{data.company.contactName} ({data.company.contactPhone})</dd></div>
                </dl>
              </div>

              <div className="border-l-4 border-brand bg-amber-50 p-4 rounded">
                <h3 className="font-semibold text-fg text-sm mb-2">Credit Application</h3>
                <dl className="text-sm text-fg-muted space-y-1">
                  <div><dt className="font-medium inline">Requested Limit: </dt><dd className="inline">{data.credit.creditLimit || '—'}</dd></div>
                  <div><dt className="font-medium inline">References: </dt><dd className="inline">{data.credit.reference1Name || '—'}, {data.credit.reference2Name || '—'}</dd></div>
                </dl>
              </div>

              <div className="border-l-4 border-abel-green bg-green-50 p-4 rounded">
                <h3 className="font-semibold text-fg text-sm mb-2">Categories</h3>
                <dl className="text-sm text-fg-muted">
                  <dd className="inline">
                    {Object.entries(data.catalog)
                      .filter(([_, v]) => v)
                      .map(([k]) => {
                        const labels: Record<string, string> = {
                          doors: 'Doors',
                          trim: 'Trim',
                          hardware: 'Hardware',
                          lumber: 'Lumber',
                          accessories: 'Accessories',
                        }
                        return labels[k]
                      })
                      .join(', ') || 'None selected'}
                  </dd>
                </dl>
              </div>

              <div className="border-l-4 border-gray-400 bg-surface-muted p-4 rounded">
                <h3 className="font-semibold text-fg text-sm mb-2">Delivery</h3>
                <dl className="text-sm text-fg-muted space-y-1">
                  <div><dt className="font-medium inline">Days: </dt><dd className="inline">{data.delivery.preferredDays.length > 0 ? data.delivery.preferredDays.join(', ') : '—'}</dd></div>
                  <div><dt className="font-medium inline">Time: </dt><dd className="inline">{data.delivery.preferredTimes || '—'}</dd></div>
                </dl>
              </div>

              <p className="text-sm text-fg-muted">
                By submitting, you confirm that the information above is accurate and complete.
              </p>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex gap-3 mt-8 pt-6 border-t">
            <button
              onClick={handleBack}
              disabled={isFirstStep}
              className={`flex-1 py-2 px-4 rounded font-medium transition ${
                isFirstStep
                  ? 'bg-surface-muted text-fg-subtle cursor-not-allowed'
                  : 'bg-surface-muted text-fg hover:bg-gray-300'
              }`}
            >
              Back
            </button>
            {!isLastStep ? (
              <button
                onClick={handleNext}
                className="flex-1 py-2 px-4 rounded font-medium bg-brand text-white hover:bg-brand/90 transition"
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex-1 py-2 px-4 rounded font-medium bg-abel-green text-white hover:bg-abel-green/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Submitting…' : 'Complete Onboarding'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
