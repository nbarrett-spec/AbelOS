'use client'

import { useEffect, useState } from 'react'

interface Toast {
  message: string
  type: 'success' | 'error'
  id: number
}

interface SystemSettings {
  companyName: string
  companyEmail: string
  companyPhone: string
  companyAddress: string
  defaultPaymentTerms: string
  quoteValidityDays: string
  warrantyAutoApprove: string
  emailNotifications: string
  smsNotifications: string
  [key: string]: string
}

const BLUE = '#1B4F72'
const ORANGE = '#E67E22'
const WHITE = '#FFFFFF'

export default function SettingsPage() {
  const [settings, setSettings] = useState<SystemSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingSection, setSavingSection] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  // Track changed values by section
  const [companyChanges, setCompanyChanges] = useState<Partial<SystemSettings>>({})
  const [systemChanges, setSystemChanges] = useState<Partial<SystemSettings>>({})
  const [notificationChanges, setNotificationChanges] = useState<Partial<SystemSettings>>({})

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/ops/settings', {
        headers: {
          'x-staff-id': 'current-staff', // In real app, get from session
        },
      })

      if (!response.ok) throw new Error('Failed to load settings')

      const data = await response.json()
      setSettings(data.settings)
    } catch (err) {
      console.error('Failed to load settings:', err)
      showToast('Failed to load settings', 'error')
    } finally {
      setLoading(false)
    }
  }

  const showToast = (message: string, type: 'success' | 'error') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { message, type, id }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 5000)
  }

  const handleCompanyChange = (key: keyof SystemSettings, value: string) => {
    setCompanyChanges((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const handleSystemChange = (key: keyof SystemSettings, value: string) => {
    setSystemChanges((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const handleNotificationChange = (key: keyof SystemSettings) => {
    const currentValue = notificationChanges[key] || settings?.[key] || 'false'
    const newValue = currentValue === 'true' ? 'false' : 'true'
    setNotificationChanges((prev) => ({
      ...prev,
      [key]: newValue,
    }))
  }

  const saveSection = async (section: string, changes: Partial<SystemSettings>) => {
    if (Object.keys(changes).length === 0) {
      showToast('No changes to save', 'error')
      return
    }

    try {
      setSavingSection(section)

      const response = await fetch('/api/ops/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-staff-id': 'current-staff', // In real app, get from session
          'x-staff-role': 'ADMIN', // In real app, get from session
        },
        body: JSON.stringify({
          settings: changes,
        }),
      })

      if (!response.ok) throw new Error('Failed to save settings')

      // Clear changes
      if (section === 'company') {
        setCompanyChanges({})
      } else if (section === 'system') {
        setSystemChanges({})
      } else if (section === 'notifications') {
        setNotificationChanges({})
      }

      // Update local state
      setSettings((prev) => (prev ? { ...prev, ...changes } as SystemSettings : null))
      showToast(`${section.charAt(0).toUpperCase() + section.slice(1)} settings saved successfully`, 'success')
    } catch (err) {
      console.error(`Failed to save ${section} settings:`, err)
      showToast(`Failed to save ${section} settings`, 'error')
    } finally {
      setSavingSection(null)
    }
  }

  const getCompanyValue = (key: string): string => {
    return companyChanges[key] !== undefined ? (companyChanges[key] as string) : (settings?.[key] || '')
  }

  const getSystemValue = (key: string): string => {
    return systemChanges[key] !== undefined ? (systemChanges[key] as string) : (settings?.[key] || '')
  }

  const getNotificationValue = (key: string): boolean => {
    return (notificationChanges[key] !== undefined ? notificationChanges[key] : settings?.[key]) === 'true'
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div style={{ display: 'inline-block', marginRight: '0.75rem' }}>
          <div
            style={{
              width: '24px',
              height: '24px',
              border: '3px solid #f3f4f6',
              borderTop: `3px solid ${ORANGE}`,
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }}
          />
        </div>
        <p>Loading settings...</p>
      </div>
    )
  }

  if (!settings) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#e74c3c' }}>
        <p>Failed to load settings</p>
      </div>
    )
  }

  return (
    <div style={{ backgroundColor: '#f8f9fa', minHeight: '100vh', padding: '2rem' }}>
      {/* Toast Notifications */}
      <div style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 50, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '4px',
              color: WHITE,
              fontWeight: '500',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
              backgroundColor: toast.type === 'success' ? '#22c55e' : '#ef4444',
            }}
          >
            {toast.message}
          </div>
        ))}
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 'bold', color: BLUE, margin: 0 }}>Settings</h1>
          <p style={{ color: '#666', marginTop: '0.5rem', fontSize: '0.95rem' }}>Manage system configuration and preferences</p>
        </div>

        {/* Quick Links */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
          <a href="/ops/settings/appearance" style={{
            backgroundColor: WHITE, borderRadius: '8px', padding: '1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '1rem', border: '2px solid transparent',
            transition: 'border-color 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = ORANGE)}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'transparent')}
          >
            <div style={{ fontSize: '2rem' }}>🎨</div>
            <div>
              <div style={{ fontWeight: '600', color: BLUE, fontSize: '1rem' }}>Appearance & Layout</div>
              <div style={{ color: '#666', fontSize: '0.85rem', marginTop: '0.25rem' }}>Theme, colors, font size, dashboard layout</div>
            </div>
          </a>
          <a href="/ops/profile" style={{
            backgroundColor: WHITE, borderRadius: '8px', padding: '1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '1rem', border: '2px solid transparent',
            transition: 'border-color 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = ORANGE)}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'transparent')}
          >
            <div style={{ fontSize: '2rem' }}>👤</div>
            <div>
              <div style={{ fontWeight: '600', color: BLUE, fontSize: '1rem' }}>My Profile</div>
              <div style={{ color: '#666', fontSize: '0.85rem', marginTop: '0.25rem' }}>Name, email, password, avatar</div>
            </div>
          </a>
        </div>

        {/* Company Profile */}
        <div style={{ backgroundColor: WHITE, borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: '600', color: BLUE, margin: 0 }}>Company Profile</h2>
            {Object.keys(companyChanges).length > 0 && (
              <button
                onClick={() => saveSection('company', companyChanges)}
                disabled={savingSection === 'company'}
                style={{
                  backgroundColor: ORANGE,
                  color: WHITE,
                  border: 'none',
                  padding: '0.5rem 1rem',
                  borderRadius: '4px',
                  cursor: savingSection === 'company' ? 'not-allowed' : 'pointer',
                  fontSize: '0.9rem',
                  opacity: savingSection === 'company' ? 0.7 : 1,
                }}
              >
                {savingSection === 'company' ? 'Saving...' : 'Save Changes'}
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '500', color: '#666', marginBottom: '0.5rem' }}>Company Name</label>
              <input
                type="text"
                value={getCompanyValue('companyName')}
                onChange={(e) => handleCompanyChange('companyName', e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '500', color: '#666', marginBottom: '0.5rem' }}>Phone</label>
              <input
                type="text"
                value={getCompanyValue('companyPhone')}
                onChange={(e) => handleCompanyChange('companyPhone', e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '500', color: '#666', marginBottom: '0.5rem' }}>Address</label>
              <input
                type="text"
                value={getCompanyValue('companyAddress')}
                onChange={(e) => handleCompanyChange('companyAddress', e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '500', color: '#666', marginBottom: '0.5rem' }}>Email</label>
              <input
                type="email"
                value={getCompanyValue('companyEmail')}
                onChange={(e) => handleCompanyChange('companyEmail', e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        </div>

        {/* System Defaults */}
        <div style={{ backgroundColor: WHITE, borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: '600', color: BLUE, margin: 0 }}>System Defaults</h2>
            {Object.keys(systemChanges).length > 0 && (
              <button
                onClick={() => saveSection('system', systemChanges)}
                disabled={savingSection === 'system'}
                style={{
                  backgroundColor: ORANGE,
                  color: WHITE,
                  border: 'none',
                  padding: '0.5rem 1rem',
                  borderRadius: '4px',
                  cursor: savingSection === 'system' ? 'not-allowed' : 'pointer',
                  fontSize: '0.9rem',
                  opacity: savingSection === 'system' ? 0.7 : 1,
                }}
              >
                {savingSection === 'system' ? 'Saving...' : 'Save Changes'}
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '500', color: '#666', marginBottom: '0.5rem' }}>Default Payment Terms</label>
              <select
                value={getSystemValue('defaultPaymentTerms')}
                onChange={(e) => handleSystemChange('defaultPaymentTerms', e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                }}
              >
                <option value="NET_15">NET 15</option>
                <option value="NET_30">NET 30</option>
                <option value="NET_60">NET 60</option>
                <option value="NET_90">NET 90</option>
                <option value="COD">Cash on Delivery</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '500', color: '#666', marginBottom: '0.5rem' }}>Quote Validity (days)</label>
              <input
                type="number"
                value={getSystemValue('quoteValidityDays')}
                onChange={(e) => handleSystemChange('quoteValidityDays', e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '500', color: '#666', marginBottom: '0.5rem' }}>Auto-approve Warranties</label>
              <select
                value={getSystemValue('warrantyAutoApprove')}
                onChange={(e) => handleSystemChange('warrantyAutoApprove', e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                }}
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
          </div>
        </div>

        {/* Notification Settings */}
        <div style={{ backgroundColor: WHITE, borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: '600', color: BLUE, margin: 0 }}>Notification Settings</h2>
            {Object.keys(notificationChanges).length > 0 && (
              <button
                onClick={() => saveSection('notifications', notificationChanges)}
                disabled={savingSection === 'notifications'}
                style={{
                  backgroundColor: ORANGE,
                  color: WHITE,
                  border: 'none',
                  padding: '0.5rem 1rem',
                  borderRadius: '4px',
                  cursor: savingSection === 'notifications' ? 'not-allowed' : 'pointer',
                  fontSize: '0.9rem',
                  opacity: savingSection === 'notifications' ? 0.7 : 1,
                }}
              >
                {savingSection === 'notifications' ? 'Saving...' : 'Save Changes'}
              </button>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {[
              { key: 'emailNotifications', label: 'Email Notifications', desc: 'Send email notifications for important events' },
              { key: 'smsNotifications', label: 'SMS Notifications', desc: 'Send SMS notifications for critical alerts' },
            ].map(({ key, label, desc }) => (
              <div
                key={key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingBottom: '1rem',
                  borderBottom: '1px solid #eee',
                }}
              >
                <div>
                  <p style={{ margin: 0, fontWeight: '500', color: BLUE }}>{label}</p>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#666' }}>{desc}</p>
                </div>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    marginLeft: '1rem',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={getNotificationValue(key)}
                    onChange={() => handleNotificationChange(key as keyof SystemSettings)}
                    style={{ marginRight: '0.5rem', cursor: 'pointer', width: '18px', height: '18px' }}
                  />
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* Integration Status */}
        <div style={{ backgroundColor: WHITE, borderRadius: '8px', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: '600', color: BLUE, margin: '0 0 1.5rem 0' }}>Integration Status</h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
            {/* QuickBooks */}
            <div
              style={{
                backgroundColor: '#f8f9fa',
                borderRadius: '8px',
                padding: '1.25rem',
                border: '2px solid #ddd',
              }}
            >
              <h3 style={{ margin: '0 0 0.75rem 0', color: BLUE, fontSize: '1.1rem' }}>QuickBooks</h3>
              <div
                style={{
                  display: 'inline-block',
                  padding: '0.4rem 0.8rem',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  fontWeight: '600',
                  backgroundColor: '#f8d7da',
                  color: '#721c24',
                  marginBottom: '0.75rem',
                }}
              >
                Not Connected
              </div>
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.85rem', color: '#666' }}>Status: Ready to connect</p>
              <button
                style={{
                  marginTop: '1rem',
                  backgroundColor: BLUE,
                  color: WHITE,
                  border: 'none',
                  padding: '0.4rem 0.8rem',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                Configure
              </button>
            </div>

            {/* Gmail/SMTP */}
            <div
              style={{
                backgroundColor: '#f8f9fa',
                borderRadius: '8px',
                padding: '1.25rem',
                border: '2px solid #ddd',
              }}
            >
              <h3 style={{ margin: '0 0 0.75rem 0', color: BLUE, fontSize: '1.1rem' }}>Gmail/SMTP</h3>
              <div
                style={{
                  display: 'inline-block',
                  padding: '0.4rem 0.8rem',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  fontWeight: '600',
                  backgroundColor: '#f8d7da',
                  color: '#721c24',
                  marginBottom: '0.75rem',
                }}
              >
                Not Connected
              </div>
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.85rem', color: '#666' }}>Status: Ready to connect</p>
              <button
                style={{
                  marginTop: '1rem',
                  backgroundColor: BLUE,
                  color: WHITE,
                  border: 'none',
                  padding: '0.4rem 0.8rem',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                Configure
              </button>
            </div>

            {/* Inflow */}
            <div
              style={{
                backgroundColor: '#f8f9fa',
                borderRadius: '8px',
                padding: '1.25rem',
                border: '2px solid #ddd',
              }}
            >
              <h3 style={{ margin: '0 0 0.75rem 0', color: BLUE, fontSize: '1.1rem' }}>Bolt/Inflow</h3>
              <div
                style={{
                  display: 'inline-block',
                  padding: '0.4rem 0.8rem',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  fontWeight: '600',
                  backgroundColor: '#f8d7da',
                  color: '#721c24',
                  marginBottom: '0.75rem',
                }}
              >
                Not Connected
              </div>
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.85rem', color: '#666' }}>Status: Ready to connect</p>
              <button
                style={{
                  marginTop: '1rem',
                  backgroundColor: BLUE,
                  color: WHITE,
                  border: 'none',
                  padding: '0.4rem 0.8rem',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                Configure
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
