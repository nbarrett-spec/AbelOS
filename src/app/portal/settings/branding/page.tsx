'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface BrandingSettings {
  logoUrl: string
  portalTitle: string
  welcomeMessage: string
  primaryColor: string
  secondaryColor: string
  accentColor: string
  theme: 'light' | 'dark'
  fontFamily: 'Inter' | 'Roboto' | 'Open Sans' | 'Lato' | 'Poppins'
  compactMode: boolean
  widgets: {
    name: string
    visible: boolean
  }[]
}

const WIDGET_LIST = [
  'Recent Orders',
  'Account Balance',
  'Quick Order',
  'Quotes',
  'Delivery Tracking',
  'Product Catalog',
  'Warranty Claims',
  'Messages'
]

const FONT_OPTIONS = ['Inter', 'Roboto', 'Open Sans', 'Lato', 'Poppins']

export default function BrandingPage() {
  const [settings, setSettings] = useState<BrandingSettings>({
    logoUrl: '',
    portalTitle: 'Your Company Portal',
    welcomeMessage: 'Welcome to your builder portal',
    primaryColor: '#1B4F72',
    secondaryColor: '#E67E22',
    accentColor: '#2ECC71',
    theme: 'light',
    fontFamily: 'Inter',
    compactMode: false,
    widgets: WIDGET_LIST.map(name => ({ name, visible: true }))
  })

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [isLoading, setIsLoading] = useState(true)
  const debounceTimer = useRef<NodeJS.Timeout | null>(null)

  // Fetch settings on mount
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch('/api/builder/branding')
        if (response.ok) {
          const data = await response.json()
          setSettings(prev => ({
            ...prev,
            ...data,
            widgets: data.widgets || WIDGET_LIST.map(name => ({ name, visible: true }))
          }))
        }
      } catch (error) {
        console.error('Failed to fetch branding settings:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchSettings()
  }, [])

  // Auto-save with debounce
  const saveSettings = useCallback(async () => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }

    debounceTimer.current = setTimeout(async () => {
      setSaveStatus('saving')
      try {
        const response = await fetch('/api/builder/branding', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings)
        })

        if (response.ok) {
          setSaveStatus('saved')
          setTimeout(() => setSaveStatus('idle'), 2000)
        } else {
          setSaveStatus('error')
          setTimeout(() => setSaveStatus('idle'), 3000)
        }
      } catch (error) {
        console.error('Failed to save branding settings:', error)
        setSaveStatus('error')
        setTimeout(() => setSaveStatus('idle'), 3000)
      }
    }, 500)
  }, [settings])

  // Trigger save on settings change
  useEffect(() => {
    if (!isLoading) {
      saveSettings()
    }
  }, [settings, saveSettings, isLoading])

  const handleSettingChange = (key: keyof BrandingSettings, value: any) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }))
  }

  const handleWidgetToggle = (index: number) => {
    setSettings(prev => ({
      ...prev,
      widgets: prev.widgets.map((w, i) =>
        i === index ? { ...w, visible: !w.visible } : w
      )
    }))
  }

  if (isLoading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: '#666' }}>Loading branding settings...</p>
      </div>
    )
  }

  const fontFamilyMap: Record<string, string> = {
    'Inter': 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    'Roboto': 'Roboto, sans-serif',
    'Open Sans': '"Open Sans", sans-serif',
    'Lato': 'Lato, sans-serif',
    'Poppins': 'Poppins, sans-serif'
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: settings.theme === 'light' ? '#f9fafb' : '#1f2937',
      padding: '2rem',
      fontFamily: fontFamilyMap[settings.fontFamily],
      transition: 'background-color 0.3s'
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{
            fontSize: '2rem',
            fontWeight: 700,
            margin: 0,
            color: settings.theme === 'light' ? '#111' : '#fff'
          }}>
            Portal Branding & Customization
          </h1>
          <p style={{
            fontSize: '1rem',
            color: settings.theme === 'light' ? '#666' : '#aaa',
            marginTop: '0.5rem',
            marginBottom: 0
          }}>
            Customize your builder portal appearance and features
          </p>
        </div>

        {/* Save Status Indicator */}
        {saveStatus !== 'idle' && (
          <div style={{
            marginBottom: '1.5rem',
            padding: '0.75rem 1rem',
            borderRadius: '0.5rem',
            fontSize: '0.875rem',
            backgroundColor: saveStatus === 'saving' ? '#e0e7ff' :
                            saveStatus === 'saved' ? '#d1fae5' : '#fee2e2',
            color: saveStatus === 'saving' ? '#4f46e5' :
                  saveStatus === 'saved' ? '#047857' : '#dc2626',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            {saveStatus === 'saving' && '⏱️ Saving...'}
            {saveStatus === 'saved' && '✓ Saved'}
            {saveStatus === 'error' && '✕ Error saving changes'}
          </div>
        )}

        {/* Section 1: Portal Branding */}
        <Section
          title="Portal Branding"
          subtitle="Configure your portal's logo and messaging"
          theme={settings.theme}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
            {/* Logo Upload */}
            <div>
              <label style={{
                display: 'block',
                fontSize: '0.875rem',
                fontWeight: 600,
                marginBottom: '0.5rem',
                color: settings.theme === 'light' ? '#374151' : '#e5e7eb'
              }}>
                Logo URL
              </label>
              <div style={{
                display: 'flex',
                gap: '0.5rem',
                marginBottom: '0.5rem'
              }}>
                <input
                  type="text"
                  value={settings.logoUrl}
                  onChange={(e) => handleSettingChange('logoUrl', e.target.value)}
                  placeholder="https://example.com/logo.png"
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    border: `1px solid ${settings.theme === 'light' ? '#d1d5db' : '#4b5563'}`,
                    borderRadius: '0.375rem',
                    fontSize: '0.875rem',
                    backgroundColor: settings.theme === 'light' ? '#fff' : '#111827',
                    color: settings.theme === 'light' ? '#000' : '#fff'
                  }}
                />
              </div>
              <div style={{
                width: '100%',
                height: '120px',
                border: `2px dashed ${settings.primaryColor}`,
                borderRadius: '0.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: settings.theme === 'light' ? '#f3f4f6' : '#1f2937',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}>
                {settings.logoUrl ? (
                  <img src={settings.logoUrl} alt="Logo" style={{ maxHeight: '100px', maxWidth: '100%' }} />
                ) : (
                  <span style={{ color: settings.theme === 'light' ? '#9ca3af' : '#6b7280' }}>
                    Click to upload or paste URL
                  </span>
                )}
              </div>
            </div>

            {/* Portal Title */}
            <div>
              <label style={{
                display: 'block',
                fontSize: '0.875rem',
                fontWeight: 600,
                marginBottom: '0.5rem',
                color: settings.theme === 'light' ? '#374151' : '#e5e7eb'
              }}>
                Portal Title
              </label>
              <input
                type="text"
                value={settings.portalTitle}
                onChange={(e) => handleSettingChange('portalTitle', e.target.value)}
                placeholder="Your Company Portal"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: `1px solid ${settings.theme === 'light' ? '#d1d5db' : '#4b5563'}`,
                  borderRadius: '0.375rem',
                  fontSize: '0.875rem',
                  backgroundColor: settings.theme === 'light' ? '#fff' : '#111827',
                  color: settings.theme === 'light' ? '#000' : '#fff',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          </div>

          {/* Welcome Message */}
          <div style={{ marginTop: '1.5rem' }}>
            <label style={{
              display: 'block',
              fontSize: '0.875rem',
              fontWeight: 600,
              marginBottom: '0.5rem',
              color: settings.theme === 'light' ? '#374151' : '#e5e7eb'
            }}>
              Welcome Message
            </label>
            <textarea
              value={settings.welcomeMessage}
              onChange={(e) => handleSettingChange('welcomeMessage', e.target.value)}
              placeholder="Welcome to your builder portal"
              rows={4}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: `1px solid ${settings.theme === 'light' ? '#d1d5db' : '#4b5563'}`,
                borderRadius: '0.375rem',
                fontSize: '0.875rem',
                backgroundColor: settings.theme === 'light' ? '#fff' : '#111827',
                color: settings.theme === 'light' ? '#000' : '#fff',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
                resize: 'vertical'
              }}
            />
          </div>
        </Section>

        {/* Section 2: Color Scheme */}
        <Section
          title="Color Scheme"
          subtitle="Customize your portal's color palette"
          theme={settings.theme}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
            <ColorInput
              label="Primary Color"
              value={settings.primaryColor}
              onChange={(color) => handleSettingChange('primaryColor', color)}
              theme={settings.theme}
            />
            <ColorInput
              label="Secondary Color"
              value={settings.secondaryColor}
              onChange={(color) => handleSettingChange('secondaryColor', color)}
              theme={settings.theme}
            />
            <ColorInput
              label="Accent Color"
              value={settings.accentColor}
              onChange={(color) => handleSettingChange('accentColor', color)}
              theme={settings.theme}
            />
          </div>

          {/* Color Preview */}
          <div style={{
            backgroundColor: settings.theme === 'light' ? '#fff' : '#1f2937',
            border: `1px solid ${settings.theme === 'light' ? '#e5e7eb' : '#4b5563'}`,
            borderRadius: '0.5rem',
            overflow: 'hidden'
          }}>
            {/* Preview Header */}
            <div style={{
              backgroundColor: settings.primaryColor,
              color: '#fff',
              padding: '1rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>Portal Preview</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button style={{
                  backgroundColor: settings.secondaryColor,
                  color: '#fff',
                  border: 'none',
                  padding: '0.5rem 1rem',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 500
                }}>
                  Secondary Action
                </button>
              </div>
            </div>
            {/* Preview Content */}
            <div style={{ padding: '1.5rem' }}>
              <p style={{ margin: '0 0 1rem 0', color: settings.theme === 'light' ? '#666' : '#aaa' }}>
                This preview shows how your colors work together
              </p>
              <div style={{
                display: 'flex',
                gap: '1rem',
                flexWrap: 'wrap',
                alignItems: 'center'
              }}>
                <div style={{
                  backgroundColor: settings.accentColor,
                  color: '#fff',
                  padding: '0.5rem 1rem',
                  borderRadius: '0.375rem',
                  fontSize: '0.875rem',
                  fontWeight: 500
                }}>
                  Accent Element
                </div>
                <span style={{
                  color: settings.primaryColor,
                  fontWeight: 600,
                  fontSize: '0.875rem'
                }}>
                  Primary Highlight
                </span>
                <span style={{
                  color: settings.secondaryColor,
                  fontWeight: 600,
                  fontSize: '0.875rem'
                }}>
                  Secondary Highlight
                </span>
              </div>
            </div>
          </div>
        </Section>

        {/* Section 3: Theme & Display */}
        <Section
          title="Theme & Display"
          subtitle="Customize appearance and typography"
          theme={settings.theme}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
            {/* Theme Selection */}
            <div>
              <label style={{
                display: 'block',
                fontSize: '0.875rem',
                fontWeight: 600,
                marginBottom: '0.75rem',
                color: settings.theme === 'light' ? '#374151' : '#e5e7eb'
              }}>
                Theme
              </label>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                {['light', 'dark'].map((themeOption) => (
                  <button
                    key={themeOption}
                    onClick={() => handleSettingChange('theme', themeOption as 'light' | 'dark')}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      border: `2px solid ${settings.theme === themeOption ? settings.primaryColor : settings.theme === 'light' ? '#d1d5db' : '#4b5563'}`,
                      borderRadius: '0.375rem',
                      backgroundColor: settings.theme === themeOption ? `${settings.primaryColor}20` : 'transparent',
                      color: settings.theme === 'light' ? '#000' : '#fff',
                      cursor: 'pointer',
                      fontWeight: 500,
                      fontSize: '0.875rem',
                      textTransform: 'capitalize',
                      transition: 'all 0.2s'
                    }}
                  >
                    {themeOption === 'light' ? '☀️ Light' : '🌙 Dark'}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Family Selection */}
            <div>
              <label style={{
                display: 'block',
                fontSize: '0.875rem',
                fontWeight: 600,
                marginBottom: '0.5rem',
                color: settings.theme === 'light' ? '#374151' : '#e5e7eb'
              }}>
                Font Family
              </label>
              <select
                value={settings.fontFamily}
                onChange={(e) => handleSettingChange('fontFamily', e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: `1px solid ${settings.theme === 'light' ? '#d1d5db' : '#4b5563'}`,
                  borderRadius: '0.375rem',
                  fontSize: '0.875rem',
                  backgroundColor: settings.theme === 'light' ? '#fff' : '#111827',
                  color: settings.theme === 'light' ? '#000' : '#fff',
                  cursor: 'pointer',
                  boxSizing: 'border-box'
                }}
              >
                {FONT_OPTIONS.map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </select>
            </div>

            {/* Compact Mode Toggle */}
            <div>
              <label style={{
                display: 'block',
                fontSize: '0.875rem',
                fontWeight: 600,
                marginBottom: '0.75rem',
                color: settings.theme === 'light' ? '#374151' : '#e5e7eb'
              }}>
                Display Mode
              </label>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem',
                backgroundColor: settings.theme === 'light' ? '#f3f4f6' : '#111827',
                borderRadius: '0.375rem'
              }}>
                <button
                  onClick={() => handleSettingChange('compactMode', !settings.compactMode)}
                  style={{
                    width: '48px',
                    height: '24px',
                    borderRadius: '12px',
                    border: 'none',
                    backgroundColor: settings.compactMode ? settings.primaryColor : '#d1d5db',
                    cursor: 'pointer',
                    position: 'relative',
                    transition: 'background-color 0.2s'
                  }}
                >
                  <div style={{
                    position: 'absolute',
                    width: '20px',
                    height: '20px',
                    backgroundColor: '#fff',
                    borderRadius: '50%',
                    top: '2px',
                    left: settings.compactMode ? '26px' : '2px',
                    transition: 'left 0.2s'
                  }} />
                </button>
                <span style={{ fontSize: '0.875rem', color: settings.theme === 'light' ? '#666' : '#aaa' }}>
                  {settings.compactMode ? 'Compact Mode' : 'Standard Mode'}
                </span>
              </div>
            </div>
          </div>
        </Section>

        {/* Section 4: Dashboard Widgets */}
        <Section
          title="Dashboard Widgets"
          subtitle="Show or hide widgets on your dashboard"
          theme={settings.theme}
        >
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem'
          }}>
            {settings.widgets.map((widget, index) => (
              <div
                key={widget.name}
                style={{
                  padding: '1rem',
                  backgroundColor: settings.theme === 'light' ? '#fff' : '#111827',
                  border: `1px solid ${settings.theme === 'light' ? '#e5e7eb' : '#4b5563'}`,
                  borderRadius: '0.375rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <span style={{
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: settings.theme === 'light' ? '#111' : '#fff'
                }}>
                  {widget.name}
                </span>
                <button
                  onClick={() => handleWidgetToggle(index)}
                  style={{
                    width: '44px',
                    height: '24px',
                    borderRadius: '12px',
                    border: 'none',
                    backgroundColor: widget.visible ? settings.primaryColor : '#d1d5db',
                    cursor: 'pointer',
                    position: 'relative',
                    transition: 'background-color 0.2s'
                  }}
                >
                  <div style={{
                    position: 'absolute',
                    width: '20px',
                    height: '20px',
                    backgroundColor: '#fff',
                    borderRadius: '50%',
                    top: '2px',
                    left: widget.visible ? '22px' : '2px',
                    transition: 'left 0.2s'
                  }} />
                </button>
              </div>
            ))}
          </div>
        </Section>

        {/* Section 5: Preview */}
        <Section
          title="Portal Header Preview"
          subtitle="See how your portal will look with current settings"
          theme={settings.theme}
        >
          <div style={{
            backgroundColor: settings.primaryColor,
            color: '#fff',
            padding: '2rem',
            borderRadius: '0.5rem',
            overflow: 'hidden'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1.5rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                {settings.logoUrl && (
                  <img
                    src={settings.logoUrl}
                    alt="Logo"
                    style={{ maxHeight: '50px', maxWidth: '100px' }}
                  />
                )}
                <h1 style={{
                  margin: 0,
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  fontFamily: fontFamilyMap[settings.fontFamily]
                }}>
                  {settings.portalTitle}
                </h1>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button style={{
                  backgroundColor: settings.secondaryColor,
                  color: '#fff',
                  border: 'none',
                  padding: '0.625rem 1.25rem',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                  fontWeight: 500,
                  fontSize: '0.875rem'
                }}>
                  Account
                </button>
                <button style={{
                  backgroundColor: settings.accentColor,
                  color: '#fff',
                  border: 'none',
                  padding: '0.625rem 1.25rem',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                  fontWeight: 500,
                  fontSize: '0.875rem'
                }}>
                  Support
                </button>
              </div>
            </div>
            <p style={{
              margin: 0,
              fontSize: '1rem',
              opacity: 0.95,
              fontFamily: fontFamilyMap[settings.fontFamily]
            }}>
              {settings.welcomeMessage}
            </p>
          </div>
        </Section>
      </div>
    </div>
  )
}

// Section Component
function Section({
  title,
  subtitle,
  children,
  theme
}: {
  title: string
  subtitle: string
  children: React.ReactNode
  theme: 'light' | 'dark'
}) {
  return (
    <div style={{
      marginBottom: '2rem',
      backgroundColor: theme === 'light' ? '#fff' : '#111827',
      borderRadius: '0.75rem',
      border: `1px solid ${theme === 'light' ? '#e5e7eb' : '#4b5563'}`,
      padding: '1.5rem'
    }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{
          fontSize: '1.25rem',
          fontWeight: 700,
          margin: '0 0 0.25rem 0',
          color: theme === 'light' ? '#111' : '#fff'
        }}>
          {title}
        </h2>
        <p style={{
          fontSize: '0.875rem',
          color: theme === 'light' ? '#666' : '#aaa',
          margin: 0
        }}>
          {subtitle}
        </p>
      </div>
      {children}
    </div>
  )
}

// Color Input Component
function ColorInput({
  label,
  value,
  onChange,
  theme
}: {
  label: string
  value: string
  onChange: (color: string) => void
  theme: 'light' | 'dark'
}) {
  return (
    <div>
      <label style={{
        display: 'block',
        fontSize: '0.875rem',
        fontWeight: 600,
        marginBottom: '0.5rem',
        color: theme === 'light' ? '#374151' : '#e5e7eb'
      }}>
        {label}
      </label>
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: '60px',
            height: '40px',
            border: 'none',
            borderRadius: '0.375rem',
            cursor: 'pointer'
          }}
        />
        <input
          type="text"
          value={value.toUpperCase()}
          onChange={(e) => {
            const hex = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`
            if (/^#[0-9A-F]{6}$/i.test(hex)) {
              onChange(hex)
            }
          }}
          placeholder="#000000"
          style={{
            flex: 1,
            padding: '0.75rem',
            border: `1px solid ${theme === 'light' ? '#d1d5db' : '#4b5563'}`,
            borderRadius: '0.375rem',
            fontSize: '0.875rem',
            backgroundColor: theme === 'light' ? '#fff' : '#111827',
            color: theme === 'light' ? '#000' : '#fff',
            fontFamily: 'monospace',
            boxSizing: 'border-box',
            textTransform: 'uppercase'
          }}
        />
      </div>
    </div>
  )
}
