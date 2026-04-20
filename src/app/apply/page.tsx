'use client'

import { useState } from 'react'
import Link from 'next/link'

const PRODUCT_INTERESTS = [
  { id: 'doors', label: 'Doors (Interior & Exterior)', icon: '' },
  { id: 'trim-millwork', label: 'Trim & Millwork', icon: '' },
  { id: 'windows', label: 'Windows', icon: '' },
  { id: 'hardware', label: 'Door & Window Hardware', icon: '' },
  { id: 'framing', label: 'Framing & Structural', icon: '' },
  { id: 'cabinets', label: 'Cabinets & Countertops', icon: '' },
  { id: 'siding', label: 'Siding & Exterior', icon: '' },
  { id: 'insulation', label: 'Insulation', icon: '' },
  { id: 'roofing', label: 'Roofing', icon: '' },
  { id: 'flooring', label: 'Flooring', icon: '' },
  { id: 'general', label: 'General Building Materials', icon: '' },
]

const BUSINESS_TYPES = [
  'Custom Home Builder',
  'Production Home Builder',
  'Remodeler / Renovator',
  'General Contractor',
  'Specialty Contractor',
  'Commercial Builder',
  'Multi-Family Developer',
  'Property Management',
  'Other',
]

const VOLUME_RANGES = [
  'Under $25,000/mo',
  '$25,000 - $50,000/mo',
  '$50,000 - $100,000/mo',
  '$100,000 - $250,000/mo',
  '$250,000 - $500,000/mo',
  '$500,000+/mo',
]

const REFERRAL_SOURCES = [
  'Another Builder',
  'Abel Sales Rep',
  'Google Search',
  'Industry Event / Trade Show',
  'Social Media',
  'Supplier Referral',
  'Other',
]

export default function ApplyPage() {
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [refNumber, setRefNumber] = useState('')

  const [form, setForm] = useState({
    companyName: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    website: '',
    address: '',
    city: '',
    state: 'Texas',
    zip: '',
    businessType: '',
    yearsInBusiness: '',
    estimatedAnnualVolume: '',
    productInterests: [] as string[],
    currentSuppliers: '',
    businessLicense: '',
    taxId: '',
    referralSource: '',
    referralDetail: '',
    notes: '',
  })

  const update = (field: string, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setError('')
  }

  const toggleProduct = (id: string) => {
    setForm(prev => ({
      ...prev,
      productInterests: prev.productInterests.includes(id)
        ? prev.productInterests.filter(p => p !== id)
        : [...prev.productInterests, id],
    }))
  }

  const validateStep = (s: number): boolean => {
    if (s === 1) {
      if (!form.companyName.trim()) { setError('Company name is required'); return false }
      if (!form.contactName.trim()) { setError('Contact name is required'); return false }
      if (!form.contactEmail.trim()) { setError('Email is required'); return false }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) { setError('Please enter a valid email'); return false }
    }
    if (s === 2) {
      if (!form.businessType) { setError('Please select your business type'); return false }
    }
    return true
  }

  const nextStep = () => {
    if (validateStep(step)) {
      setStep(step + 1)
      window.scrollTo(0, 0)
    }
  }

  const handleSubmit = async () => {
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/builders/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: form.companyName,
          contactName: form.contactName,
          contactEmail: form.contactEmail,
          contactPhone: form.contactPhone || undefined,
          address: form.address || undefined,
          city: form.city || undefined,
          state: form.state || undefined,
          zip: form.zip || undefined,
          businessLicense: form.businessLicense || undefined,
          taxId: form.taxId || undefined,
          estimatedAnnualVolume: form.estimatedAnnualVolume || undefined,
          referralSource: form.referralSource
            ? (form.referralDetail ? `${form.referralSource}: ${form.referralDetail}` : form.referralSource)
            : undefined,
          notes: [
            form.businessType ? `Business Type: ${form.businessType}` : '',
            form.yearsInBusiness ? `Years in Business: ${form.yearsInBusiness}` : '',
            form.website ? `Website: ${form.website}` : '',
            form.productInterests.length > 0 ? `Product Interests: ${form.productInterests.join(', ')}` : '',
            form.currentSuppliers ? `Current Suppliers: ${form.currentSuppliers}` : '',
            form.notes ? `Additional Notes: ${form.notes}` : '',
          ].filter(Boolean).join('\n'),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit application')
      }

      setRefNumber(data.refNumber)
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── SUCCESS STATE ──
  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-lg w-full text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">Application Submitted</h1>
          <p className="text-gray-600 mb-6">
            Thank you, {form.contactName}. We&apos;ve received your application for <strong>{form.companyName}</strong>.
            Our team will review it within 1-2 business days.
          </p>
          <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-8">
            <p className="text-sm text-gray-500 mb-1">Your Reference Number</p>
            <p className="text-2xl font-mono font-bold text-[#3E2A1E]">{refNumber}</p>
            <p className="text-xs text-gray-400 mt-2">Save this for your records</p>
          </div>
          <div className="bg-[#3E2A1E]/5 rounded-2xl p-6 text-left">
            <h3 className="font-semibold text-[#3E2A1E] mb-3">What happens next?</h3>
            <ol className="space-y-3 text-sm text-gray-600">
              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-[#C9822B] text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                <span>Our team reviews your application and verifies your business details</span>
              </li>
              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-[#C9822B] text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                <span>You&apos;ll receive an email with your account credentials and login details</span>
              </li>
              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-[#C9822B] text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
                <span>Access your builder portal with AI-powered takeoffs, instant quoting, and real-time order tracking</span>
              </li>
            </ol>
          </div>
          <div className="mt-8 flex gap-3 justify-center">
            <Link href="/" className="px-6 py-3 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 transition font-medium">
              Back to Home
            </Link>
            <Link href="/login" className="px-6 py-3 rounded-xl bg-[#3E2A1E] text-white hover:bg-[#3E2A1E]/90 transition font-medium">
              Sign In
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // ── APPLICATION FORM ──
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#C9822B] rounded-xl flex items-center justify-center font-bold text-white text-sm">
              AB
            </div>
            <span className="font-semibold text-xl text-[#3E2A1E]">Abel Builder</span>
          </Link>
          <Link href="/login" className="text-sm text-[#3E2A1E] hover:text-[#C9822B] transition font-medium">
            Already have an account? Sign in
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Hero */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-gray-900 mb-3">Apply for a Builder Account</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Join 40+ DFW builders using Abel&apos;s AI-powered platform. Get better pricing,
            faster quotes, and real-time project tracking — all in one place.
          </p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-0 mb-10">
          {[
            { n: 1, label: 'Company Info' },
            { n: 2, label: 'Business Details' },
            { n: 3, label: 'Products & Volume' },
            { n: 4, label: 'Review & Submit' },
          ].map((s, i) => (
            <div key={s.n} className="flex items-center">
              <div className="flex flex-col items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                  step >= s.n
                    ? 'bg-[#C9822B] text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}>
                  {step > s.n ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : s.n}
                </div>
                <span className={`text-xs mt-1.5 font-medium ${step >= s.n ? 'text-[#3E2A1E]' : 'text-gray-400'}`}>
                  {s.label}
                </span>
              </div>
              {i < 3 && (
                <div className={`w-16 sm:w-24 h-0.5 mx-2 mb-5 ${step > s.n ? 'bg-[#C9822B]' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        {error && (
          <div className="max-w-2xl mx-auto mb-6 bg-red-50 text-red-700 px-5 py-3 rounded-xl text-sm border border-red-100">
            {error}
          </div>
        )}

        <div className="max-w-2xl mx-auto">
          {/* ── STEP 1: Company Info ── */}
          {step === 1 && (
            <div className="bg-white rounded-2xl border border-gray-200 p-8">
              <h2 className="text-xl font-bold text-gray-900 mb-1">Company Information</h2>
              <p className="text-gray-500 text-sm mb-6">Tell us about your business</p>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
                  <input
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#C9822B]/30 focus:border-[#C9822B] outline-none transition"
                    placeholder="Your Building Company, LLC"
                    value={form.companyName}
                    onChange={e => update('companyName', e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name *</label>
                    <input
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#C9822B]/30 focus:border-[#C9822B] outline-none transition"
                      placeholder="John Smith"
                      value={form.contactName}
                      onChange={e => update('contactName', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email Address *</label>
                    <input
                      type="email"
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#C9822B]/30 focus:border-[#C9822B] outline-none transition"
                      placeholder="john@yourcompany.com"
                      value={form.contactEmail}
                      onChange={e => update('contactEmail', e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                    <input
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#C9822B]/30 focus:border-[#C9822B] outline-none transition"
                      placeholder="(214) 555-0100"
                      value={form.contactPhone}
                      onChange={e => update('contactPhone', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
                    <input
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#C9822B]/30 focus:border-[#C9822B] outline-none transition"
                      placeholder="www.yourcompany.com"
                      value={form.website}
                      onChange={e => update('website', e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Street Address</label>
                  <input
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#C9822B]/30 focus:border-[#C9822B] outline-none transition"
                    placeholder="1234 Commerce Dr"
                    value={form.address}
                    onChange={e => update('address', e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                    <input
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#C9822B]/30 focus:border-[#C9822B] outline-none transition"
                      placeholder="Dallas"
                      value={form.city}
                      onChange={e => update('city', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                    <input
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#C9822B]/30 focus:border-[#C9822B] outline-none transition"
                      value={form.state}
                      onChange={e => update('state', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">ZIP</label>
                    <input
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#C9822B]/30 focus:border-[#C9822B] outline-none transition"
                      placeholder="75201"
                      value={form.zip}
                      onChange={e => update('zip', e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-8 flex justify-end">
                <button onClick={nextStep} className="px-8 py-3 bg-[#C9822B] text-white rounded-xl font-semibold hover:bg-[#A86B1F] transition">
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: Business Details ── */}
          {step === 2 && (
            <div className="bg-white rounded-2xl border border-gray-200 p-8">
              <h2 className="text-xl font-bold text-gray-900 mb-1">Business Details</h2>
              <p className="text-gray-500 text-sm mb-6">Help us understand your business so we can serve you better</p>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Business Type *</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {BUSINESS_TYPES.map(type => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => update('businessType', type)}
                        className={`text-left px-4 py-3 rounded-xl border-2 transition text-sm font-medium ${
                          form.businessType === type
                            ? 'border-[#C9822B] bg-orange-50 text-[#3E2A1E]'
                            : 'border-gray-200 text-gray-700 hover:border-gray-300'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Years in Business</label>
                    <input
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#C9822B]/30 focus:border-[#C9822B] outline-none transition"
                      placeholder="e.g. 12"
                      value={form.yearsInBusiness}
                      onChange={e => update('yearsInBusiness', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Business License #</label>
                    <input
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#C9822B]/30 focus:border-[#C9822B] outline-none transition"
                      placeholder="Optional"
                      value={form.businessLicense}
                      onChange={e => update('businessLicense', e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tax ID / EIN</label>
                  <input
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#C9822B]/30 focus:border-[#C9822B] outline-none transition"
                    placeholder="XX-XXXXXXX"
                    value={form.taxId}
                    onChange={e => update('taxId', e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Current Material Suppliers</label>
                  <textarea
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#C9822B]/30 focus:border-[#C9822B] outline-none transition resize-none"
                    rows={3}
                    placeholder="List your current door, trim, window, and lumber suppliers (e.g. DW Distribution, 84 Lumber, Home Depot Pro)"
                    value={form.currentSuppliers}
                    onChange={e => update('currentSuppliers', e.target.value)}
                  />
                  <p className="text-xs text-gray-400 mt-1">This helps us understand how we can save you money</p>
                </div>
              </div>

              <div className="mt-8 flex gap-3 justify-between">
                <button onClick={() => { setStep(1); window.scrollTo(0,0) }} className="px-6 py-3 border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 transition font-medium">
                  Back
                </button>
                <button onClick={nextStep} className="px-8 py-3 bg-[#C9822B] text-white rounded-xl font-semibold hover:bg-[#A86B1F] transition">
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3: Products & Volume ── */}
          {step === 3 && (
            <div className="bg-white rounded-2xl border border-gray-200 p-8">
              <h2 className="text-xl font-bold text-gray-900 mb-1">Products & Estimated Volume</h2>
              <p className="text-gray-500 text-sm mb-6">Select the product categories you&apos;re interested in</p>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">Product Interests (select all that apply)</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {PRODUCT_INTERESTS.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggleProduct(p.id)}
                        className={`text-left px-4 py-3 rounded-xl border-2 transition text-sm ${
                          form.productInterests.includes(p.id)
                            ? 'border-[#C9822B] bg-orange-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <span className="font-medium text-gray-800">{p.label}</span>
                        {form.productInterests.includes(p.id) && (
                          <svg className="w-4 h-4 text-[#C9822B] inline ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Estimated Monthly Volume</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {VOLUME_RANGES.map(vol => (
                      <button
                        key={vol}
                        type="button"
                        onClick={() => update('estimatedAnnualVolume', vol)}
                        className={`text-left px-4 py-3 rounded-xl border-2 transition text-sm font-medium ${
                          form.estimatedAnnualVolume === vol
                            ? 'border-[#C9822B] bg-orange-50 text-[#3E2A1E]'
                            : 'border-gray-200 text-gray-700 hover:border-gray-300'
                        }`}
                      >
                        {vol}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">How did you hear about us?</label>
                  <select
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#C9822B]/30 focus:border-[#C9822B] outline-none transition"
                    value={form.referralSource}
                    onChange={e => update('referralSource', e.target.value)}
                  >
                    <option value="">Select...</option>
                    {REFERRAL_SOURCES.map(src => (
                      <option key={src} value={src}>{src}</option>
                    ))}
                  </select>
                  {(form.referralSource === 'Another Builder' || form.referralSource === 'Abel Sales Rep' || form.referralSource === 'Other') && (
                    <input
                      className="w-full mt-3 px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#C9822B]/30 focus:border-[#C9822B] outline-none transition"
                      placeholder={form.referralSource === 'Another Builder' ? 'Builder name' : form.referralSource === 'Abel Sales Rep' ? 'Rep name' : 'Please specify'}
                      value={form.referralDetail}
                      onChange={e => update('referralDetail', e.target.value)}
                    />
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Anything else we should know?</label>
                  <textarea
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#C9822B]/30 focus:border-[#C9822B] outline-none transition resize-none"
                    rows={3}
                    placeholder="Special requirements, delivery preferences, project timeline, etc."
                    value={form.notes}
                    onChange={e => update('notes', e.target.value)}
                  />
                </div>
              </div>

              <div className="mt-8 flex gap-3 justify-between">
                <button onClick={() => { setStep(2); window.scrollTo(0,0) }} className="px-6 py-3 border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 transition font-medium">
                  Back
                </button>
                <button onClick={nextStep} className="px-8 py-3 bg-[#C9822B] text-white rounded-xl font-semibold hover:bg-[#A86B1F] transition">
                  Review Application
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 4: Review & Submit ── */}
          {step === 4 && (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl border border-gray-200 p-8">
                <h2 className="text-xl font-bold text-gray-900 mb-1">Review Your Application</h2>
                <p className="text-gray-500 text-sm mb-6">Please confirm your details before submitting</p>

                <div className="space-y-6">
                  {/* Company Info */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-[#3E2A1E]">Company Information</h3>
                      <button onClick={() => setStep(1)} className="text-sm text-[#C9822B] hover:underline">Edit</button>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Company</span>
                        <span className="font-medium text-gray-900">{form.companyName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Contact</span>
                        <span className="font-medium text-gray-900">{form.contactName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Email</span>
                        <span className="font-medium text-gray-900">{form.contactEmail}</span>
                      </div>
                      {form.contactPhone && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Phone</span>
                          <span className="font-medium text-gray-900">{form.contactPhone}</span>
                        </div>
                      )}
                      {form.city && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Location</span>
                          <span className="font-medium text-gray-900">{form.city}, {form.state} {form.zip}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Business Details */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-[#3E2A1E]">Business Details</h3>
                      <button onClick={() => setStep(2)} className="text-sm text-[#C9822B] hover:underline">Edit</button>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Type</span>
                        <span className="font-medium text-gray-900">{form.businessType}</span>
                      </div>
                      {form.yearsInBusiness && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Years in Business</span>
                          <span className="font-medium text-gray-900">{form.yearsInBusiness}</span>
                        </div>
                      )}
                      {form.currentSuppliers && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Current Suppliers</span>
                          <span className="font-medium text-gray-900 text-right max-w-[60%]">{form.currentSuppliers}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Products & Volume */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-[#3E2A1E]">Products & Volume</h3>
                      <button onClick={() => setStep(3)} className="text-sm text-[#C9822B] hover:underline">Edit</button>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                      {form.productInterests.length > 0 && (
                        <div>
                          <span className="text-gray-500 block mb-2">Product Interests</span>
                          <div className="flex flex-wrap gap-2">
                            {form.productInterests.map(id => {
                              const product = PRODUCT_INTERESTS.find(p => p.id === id)
                              return (
                                <span key={id} className="inline-flex px-3 py-1 bg-[#3E2A1E]/10 text-[#3E2A1E] rounded-full text-xs font-medium">
                                  {product?.label || id}
                                </span>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      {form.estimatedAnnualVolume && (
                        <div className="flex justify-between pt-2">
                          <span className="text-gray-500">Estimated Volume</span>
                          <span className="font-medium text-gray-900">{form.estimatedAnnualVolume}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Value Props */}
              <div className="bg-[#3E2A1E]/5 rounded-2xl p-6">
                <h3 className="font-semibold text-[#3E2A1E] mb-3">What you get with Abel Builder</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-gray-700">
                  <div className="flex gap-2">
                    <svg className="w-5 h-5 text-[#C9822B] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <span>AI-powered takeoffs from blueprints</span>
                  </div>
                  <div className="flex gap-2">
                    <svg className="w-5 h-5 text-[#C9822B] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <span>Instant quotes with real-time pricing</span>
                  </div>
                  <div className="flex gap-2">
                    <svg className="w-5 h-5 text-[#C9822B] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <span>Real-time order & delivery tracking</span>
                  </div>
                  <div className="flex gap-2">
                    <svg className="w-5 h-5 text-[#C9822B] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <span>Flexible payment terms (NET 15/30)</span>
                  </div>
                  <div className="flex gap-2">
                    <svg className="w-5 h-5 text-[#C9822B] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <span>Dedicated account manager</span>
                  </div>
                  <div className="flex gap-2">
                    <svg className="w-5 h-5 text-[#C9822B] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <span>Volume discounts & rebate programs</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 justify-between">
                <button onClick={() => { setStep(3); window.scrollTo(0,0) }} className="px-6 py-3 border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 transition font-medium">
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="px-10 py-3 bg-[#C9822B] text-white rounded-xl font-bold hover:bg-[#A86B1F] transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Submitting...' : 'Submit Application'}
                </button>
              </div>
            </div>
          )}

          {/* Trust Signals */}
          <div className="mt-10 text-center text-sm text-gray-400">
            <p>Serving the DFW metroplex since 2008. Trusted by 40+ professional builders.</p>
            <p className="mt-1">Questions? Email sales@abellumber.com or call (469) 300-0090</p>
          </div>
        </div>
      </div>
    </div>
  )
}
