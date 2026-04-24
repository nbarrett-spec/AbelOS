'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { Palette } from 'lucide-react';

interface Preferences {
  theme: 'light' | 'dark' | 'system';
  accentColor: string;
  fontSize: 'small' | 'medium' | 'large';
  compactMode: boolean;
  sidebarState: 'expanded' | 'collapsed';
  dashboardLayout: DashboardSection[];
}

interface DashboardSection {
  id: string;
  name: string;
  visible: boolean;
  order: number;
}

const PRESET_COLORS = [
  { hex: '#C6A24E', name: 'Orange (Default)' },
  { hex: '#0f2a3e', name: 'Navy' },
  { hex: '#2ECC71', name: 'Green' },
  { hex: '#E74C3C', name: 'Red' },
  { hex: '#9B59B6', name: 'Purple' },
  { hex: '#3498DB', name: 'Blue' },
  { hex: '#1ABC9C', name: 'Teal' },
  { hex: '#D4B96A', name: 'Gold' },
];

const DEFAULT_SECTIONS: DashboardSection[] = [
  { id: 'overview', name: 'Overview', visible: true, order: 1 },
  { id: 'jobs-projects', name: 'Jobs & Projects', visible: true, order: 2 },
  { id: 'sales-pipeline', name: 'Sales Pipeline', visible: true, order: 3 },
  { id: 'finance', name: 'Finance', visible: true, order: 4 },
  { id: 'inventory', name: 'Inventory', visible: true, order: 5 },
  { id: 'communication', name: 'Communication', visible: true, order: 6 },
  { id: 'ai-operations', name: 'AI Operations', visible: false, order: 7 },
];

export default function AppearancePage() {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [customColor, setCustomColor] = useState('#C6A24E');
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout>();

  // Fetch preferences on mount
  useEffect(() => {
    const fetchPreferences = async () => {
      try {
        const response = await fetch('/api/ops/preferences');
        if (response.ok) {
          const data = await response.json();
          const prefs = data.preferences || data;
          // Ensure dashboardLayout is always an array
          if (!Array.isArray(prefs.dashboardLayout)) {
            prefs.dashboardLayout = DEFAULT_SECTIONS;
          }
          setPreferences(prefs);
          setCustomColor(prefs.accentColor || '#C6A24E');
        } else {
          // Set defaults if fetch fails
          setPreferences({
            theme: 'system',
            accentColor: '#C6A24E',
            fontSize: 'medium',
            compactMode: false,
            sidebarState: 'expanded',
            dashboardLayout: DEFAULT_SECTIONS,
          });
        }
      } catch (error) {
        console.error('Failed to fetch preferences:', error);
        setPreferences({
          theme: 'system',
          accentColor: '#C6A24E',
          fontSize: 'medium',
          compactMode: false,
          sidebarState: 'expanded',
          dashboardLayout: DEFAULT_SECTIONS,
        });
      }
    };

    fetchPreferences();
  }, []);

  // Auto-save preferences with debouncing
  const savePreferences = useCallback(async (prefs: Preferences) => {
    if (!prefs) return;

    setSaving(true);
    setSaved(false);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch('/api/ops/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(prefs),
        });

        if (response.ok) {
          setSaving(false);
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
          // Notify ThemeProvider to pick up changes
          window.dispatchEvent(new Event('preferences-updated'));
        }
      } catch (error) {
        console.error('Failed to save preferences:', error);
        setSaving(false);
      }
    }, 500);
  }, []);

  // Apply theme changes instantly to the DOM for immediate visual feedback
  const applyInstant = useCallback((prefs: Preferences) => {
    const root = document.documentElement;
    const resolvedTheme = prefs.theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : prefs.theme;

    // Toggle dark class — activates the full Aegis Glass dark token set in globals.css
    if (resolvedTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    root.setAttribute('data-theme', resolvedTheme);

    // Font size
    const fontSizes: Record<string, string> = { small: '14px', medium: '16px', large: '18px' };
    root.style.setProperty('--font-size-base', fontSizes[prefs.fontSize]);

    // Accent color → signal/accent CSS vars (only if non-default)
    if (prefs.accentColor && prefs.accentColor !== '#C6A24E') {
      root.style.setProperty('--signal', prefs.accentColor);
      root.style.setProperty('--accent', prefs.accentColor);
      root.style.setProperty('--accent-fg', prefs.accentColor);
    } else {
      root.style.removeProperty('--signal');
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-fg');
    }
  }, []);

  const handleThemeChange = (theme: 'light' | 'dark' | 'system') => {
    if (!preferences) return;
    const updated = { ...preferences, theme };
    setPreferences(updated);
    applyInstant(updated);
    savePreferences(updated);
  };

  const handleAccentColor = (hex: string) => {
    if (!preferences) return;
    const updated = { ...preferences, accentColor: hex };
    setPreferences(updated);
    setCustomColor(hex);
    applyInstant(updated);
    savePreferences(updated);
  };

  const handleCustomColor = (value: string) => {
    setCustomColor(value);
    if (/^#[0-9A-F]{6}$/i.test(value)) {
      if (!preferences) return;
      const updated = { ...preferences, accentColor: value };
      setPreferences(updated);
      savePreferences(updated);
    }
  };

  const handleFontSize = (size: 'small' | 'medium' | 'large') => {
    if (!preferences) return;
    const updated = { ...preferences, fontSize: size };
    setPreferences(updated);
    applyInstant(updated);
    savePreferences(updated);
  };

  const handleCompactMode = (enabled: boolean) => {
    if (!preferences) return;
    const updated = { ...preferences, compactMode: enabled };
    setPreferences(updated);
    savePreferences(updated);
  };

  const handleSidebarState = (state: 'expanded' | 'collapsed') => {
    if (!preferences) return;
    const updated = { ...preferences, sidebarState: state };
    setPreferences(updated);
    savePreferences(updated);
  };

  const handleSectionVisibility = (sectionId: string, visible: boolean) => {
    if (!preferences) return;
    const updated = {
      ...preferences,
      dashboardLayout: preferences.dashboardLayout.map((section) =>
        section.id === sectionId ? { ...section, visible } : section
      ),
    };
    setPreferences(updated);
    savePreferences(updated);
  };

  const handleSectionMove = (sectionId: string, direction: 'up' | 'down') => {
    if (!preferences) return;

    const sections = [...preferences.dashboardLayout];
    const currentIndex = sections.findIndex((s) => s.id === sectionId);

    if (direction === 'up' && currentIndex > 0) {
      [sections[currentIndex], sections[currentIndex - 1]] = [
        sections[currentIndex - 1],
        sections[currentIndex],
      ];
    } else if (direction === 'down' && currentIndex < sections.length - 1) {
      [sections[currentIndex], sections[currentIndex + 1]] = [
        sections[currentIndex + 1],
        sections[currentIndex],
      ];
    }

    // Recalculate orders
    const updated = {
      ...preferences,
      dashboardLayout: sections.map((section, index) => ({
        ...section,
        order: index + 1,
      })),
    };
    setPreferences(updated);
    savePreferences(updated);
  };

  if (!preferences) {
    return (
      <div className="p-8">
        <EmptyState
          icon={<Palette />}
          title="Loading preferences..."
          size="full"
        />
      </div>
    );
  }

  const accentColor = preferences.accentColor || '#C6A24E';

  return (
    <div className="bg-canvas min-h-screen">
      {/* Header with breadcrumb */}
      <div className="bg-surface border-b border-border" style={{ padding: '16px 24px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <PageHeader
            title="Appearance & Layout"
            description="Customize how the platform looks and feels for your needs"
            crumbs={[
              { label: 'Settings', href: '/ops/settings' },
              { label: 'Appearance' },
            ]}
          />
        </div>
      </div>

      {/* Saving indicator */}
      {saving && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            backgroundColor: '#fff',
            padding: '12px 16px',
            borderRadius: '6px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            fontSize: '14px',
            color: '#666',
            zIndex: 1000,
          }}
        >
          ⏳ Saving...
        </div>
      )}

      {saved && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            backgroundColor: '#fff',
            padding: '12px 16px',
            borderRadius: '6px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            fontSize: '14px',
            color: '#2ECC71',
            zIndex: 1000,
          }}
        >
          ✓ Saved
        </div>
      )}

      {/* Main content */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px' }}>
        {/* Section 1: Theme Selection */}
        <div style={{ marginBottom: '48px' }}>
          <h2 className="text-fg" style={{ fontSize: '20px', fontWeight: '600', margin: '0 0 8px 0' }}>
            Theme Selection
          </h2>
          <p className="text-fg-muted" style={{ fontSize: '14px', margin: '0 0 24px 0' }}>
            Choose how the interface should appear
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            {/* Light Theme */}
            <div
              onClick={() => handleThemeChange('light')}
              style={{
                padding: '20px',
                borderRadius: '8px',
                border: `3px solid ${preferences.theme === 'light' ? accentColor : '#e5e7eb'}`,
                backgroundColor: '#fff',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                if (preferences.theme !== 'light') {
                  e.currentTarget.style.borderColor = '#d1d5db';
                }
              }}
              onMouseLeave={(e) => {
                if (preferences.theme !== 'light') {
                  e.currentTarget.style.borderColor = '#e5e7eb';
                }
              }}
            >
              <div
                style={{
                  height: '120px',
                  backgroundColor: '#ffffff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  marginBottom: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  color: '#1a1a1a',
                  fontWeight: '500',
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <div style={{ height: '20px', backgroundColor: '#f3f4f6', borderRadius: '4px', marginBottom: '8px' }} />
                  <div style={{ height: '12px', backgroundColor: '#d1d5db', borderRadius: '4px', marginBottom: '6px' }} />
                  <div style={{ height: '12px', backgroundColor: '#d1d5db', borderRadius: '4px', width: '80%' }} />
                </div>
              </div>
              <h3 className="text-fg" style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: '600' }}>Light</h3>
              <p className="text-fg-subtle" style={{ margin: '0', fontSize: '12px' }}>Bright and easy on the eyes</p>
            </div>

            {/* Dark Theme */}
            <div
              onClick={() => handleThemeChange('dark')}
              style={{
                padding: '20px',
                borderRadius: '8px',
                border: `3px solid ${preferences.theme === 'dark' ? accentColor : '#e5e7eb'}`,
                backgroundColor: '#fff',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                if (preferences.theme !== 'dark') {
                  e.currentTarget.style.borderColor = '#d1d5db';
                }
              }}
              onMouseLeave={(e) => {
                if (preferences.theme !== 'dark') {
                  e.currentTarget.style.borderColor = '#e5e7eb';
                }
              }}
            >
              <div
                style={{
                  height: '120px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #333',
                  borderRadius: '6px',
                  marginBottom: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  color: '#fff',
                  fontWeight: '500',
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <div style={{ height: '20px', backgroundColor: '#2a2a3e', borderRadius: '4px', marginBottom: '8px' }} />
                  <div style={{ height: '12px', backgroundColor: '#404055', borderRadius: '4px', marginBottom: '6px' }} />
                  <div style={{ height: '12px', backgroundColor: '#404055', borderRadius: '4px', width: '80%' }} />
                </div>
              </div>
              <h3 className="text-fg" style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: '600' }}>Dark</h3>
              <p className="text-fg-subtle" style={{ margin: '0', fontSize: '12px' }}>Reduces eye strain at night</p>
            </div>

            {/* System Theme */}
            <div
              onClick={() => handleThemeChange('system')}
              style={{
                padding: '20px',
                borderRadius: '8px',
                border: `3px solid ${preferences.theme === 'system' ? accentColor : '#e5e7eb'}`,
                backgroundColor: '#fff',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                if (preferences.theme !== 'system') {
                  e.currentTarget.style.borderColor = '#d1d5db';
                }
              }}
              onMouseLeave={(e) => {
                if (preferences.theme !== 'system') {
                  e.currentTarget.style.borderColor = '#e5e7eb';
                }
              }}
            >
              <div
                style={{
                  height: '120px',
                  borderRadius: '6px',
                  marginBottom: '12px',
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '1px',
                  overflow: 'hidden',
                  border: '1px solid #e5e7eb',
                }}
              >
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    color: '#1a1a1a',
                  }}
                >
                  <div style={{ textAlign: 'center', fontSize: '10px' }}>Light</div>
                </div>
                <div
                  style={{
                    backgroundColor: '#1a1a2e',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    color: '#fff',
                  }}
                >
                  <div style={{ textAlign: 'center', fontSize: '10px' }}>Dark</div>
                </div>
              </div>
              <h3 className="text-fg" style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: '600' }}>System</h3>
              <p className="text-fg-subtle" style={{ margin: '0', fontSize: '12px' }}>Matches your OS settings</p>
            </div>
          </div>
        </div>

        {/* Section 2: Accent Color Picker */}
        <div style={{ marginBottom: '48px' }}>
          <h2 className="text-fg" style={{ fontSize: '20px', fontWeight: '600', margin: '0 0 8px 0' }}>
            Accent Color
          </h2>
          <p className="text-fg-muted" style={{ fontSize: '14px', margin: '0 0 24px 0' }}>
            Select the primary accent color used throughout the interface
          </p>

          {/* Preset colors */}
          <div style={{ marginBottom: '24px' }}>
            <h3 className="text-fg" style={{ fontSize: '14px', fontWeight: '600', margin: '0 0 12px 0' }}>
              Preset Colors
            </h3>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              {PRESET_COLORS.map((color) => (
                <div
                  key={color.hex}
                  onClick={() => handleAccentColor(color.hex)}
                  style={{
                    position: 'relative',
                    width: '48px',
                    height: '48px',
                    borderRadius: '50%',
                    backgroundColor: color.hex,
                    cursor: 'pointer',
                    border: `3px solid ${preferences.accentColor === color.hex ? '#1a1a1a' : 'transparent'}`,
                    boxShadow:
                      preferences.accentColor === color.hex
                        ? `0 0 0 2px ${color.hex}, 0 2px 8px rgba(0,0,0,0.15)`
                        : '0 2px 8px rgba(0,0,0,0.1)',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                  title={color.name}
                >
                  {preferences.accentColor === color.hex && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: '0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        fontSize: '20px',
                        fontWeight: 'bold',
                      }}
                    >
                      ✓
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Custom color input */}
          <div>
            <h3 className="text-fg" style={{ fontSize: '14px', fontWeight: '600', margin: '0 0 12px 0' }}>
              Custom Hex Color
            </h3>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <input
                type="text"
                value={customColor}
                onChange={(e) => handleCustomColor(e.target.value)}
                placeholder="#C6A24E"
                style={{
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontFamily: 'monospace',
                  width: '140px',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = accentColor;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#d1d5db';
                }}
              />
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  backgroundColor: customColor,
                  borderRadius: '6px',
                  border: '1px solid #d1d5db',
                  cursor: 'default',
                }}
              />
            </div>
          </div>
        </div>

        {/* Section 3: Display Preferences */}
        <div style={{ marginBottom: '48px' }}>
          <h2 className="text-fg" style={{ fontSize: '20px', fontWeight: '600', margin: '0 0 8px 0' }}>
            Display Preferences
          </h2>
          <p className="text-fg-muted" style={{ fontSize: '14px', margin: '0 0 24px 0' }}>
            Adjust how information is displayed throughout the platform
          </p>

          {/* Font Size */}
          <div style={{ marginBottom: '32px' }}>
            <h3 className="text-fg" style={{ fontSize: '14px', fontWeight: '600', margin: '0 0 12px 0' }}>
              Font Size
            </h3>
            <div style={{ display: 'flex', gap: '12px' }}>
              {(['small', 'medium', 'large'] as const).map((size) => (
                <button
                  key={size}
                  onClick={() => handleFontSize(size)}
                  style={{
                    padding: '10px 20px',
                    border: `2px solid ${preferences.fontSize === size ? accentColor : '#d1d5db'}`,
                    borderRadius: '6px',
                    backgroundColor: preferences.fontSize === size ? accentColor : '#fff',
                    color: preferences.fontSize === size ? '#fff' : '#1a1a1a',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (preferences.fontSize !== size) {
                      e.currentTarget.style.borderColor = accentColor;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (preferences.fontSize !== size) {
                      e.currentTarget.style.borderColor = '#d1d5db';
                    }
                  }}
                >
                  {size.charAt(0).toUpperCase() + size.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Compact Mode */}
          <div style={{ marginBottom: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 className="text-fg" style={{ fontSize: '14px', fontWeight: '600', margin: '0' }}>
                  Compact Mode
                </h3>
                <p className="text-fg-muted" style={{ fontSize: '12px', margin: '4px 0 0 0' }}>
                  Reduces padding for a denser layout
                </p>
              </div>
              <button
                onClick={() => handleCompactMode(!preferences.compactMode)}
                style={{
                  width: '56px',
                  height: '32px',
                  borderRadius: '16px',
                  border: 'none',
                  backgroundColor: preferences.compactMode ? accentColor : '#d1d5db',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'background-color 0.2s',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: '2px',
                    left: preferences.compactMode ? '28px' : '2px',
                    width: '28px',
                    height: '28px',
                    backgroundColor: '#fff',
                    borderRadius: '50%',
                    transition: 'left 0.2s',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  }}
                />
              </button>
            </div>
          </div>

          {/* Sidebar State */}
          <div>
            <h3 className="text-fg" style={{ fontSize: '14px', fontWeight: '600', margin: '0 0 12px 0' }}>
              Sidebar Default State
            </h3>
            <div style={{ display: 'flex', gap: '12px' }}>
              {(['expanded', 'collapsed'] as const).map((state) => (
                <button
                  key={state}
                  onClick={() => handleSidebarState(state)}
                  style={{
                    padding: '10px 20px',
                    border: `2px solid ${preferences.sidebarState === state ? accentColor : '#d1d5db'}`,
                    borderRadius: '6px',
                    backgroundColor: preferences.sidebarState === state ? accentColor : '#fff',
                    color: preferences.sidebarState === state ? '#fff' : '#1a1a1a',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (preferences.sidebarState !== state) {
                      e.currentTarget.style.borderColor = accentColor;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (preferences.sidebarState !== state) {
                      e.currentTarget.style.borderColor = '#d1d5db';
                    }
                  }}
                >
                  {state === 'expanded' ? 'Expanded' : 'Collapsed'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Section 4: Dashboard Layout */}
        <div>
          <h2 className="text-fg" style={{ fontSize: '20px', fontWeight: '600', margin: '0 0 8px 0' }}>
            Dashboard Layout
          </h2>
          <p className="text-fg-muted" style={{ fontSize: '14px', margin: '0 0 24px 0' }}>
            Customize which sections appear and their order on your dashboard
          </p>

          <div style={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
            {preferences.dashboardLayout
              .sort((a, b) => a.order - b.order)
              .map((section, index) => (
                <div
                  key={section.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '16px',
                    borderBottom: index < preferences.dashboardLayout.length - 1 ? '1px solid #f3f4f6' : 'none',
                    transition: 'background-color 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f9fafb';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {/* Move buttons */}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      onClick={() => handleSectionMove(section.id, 'up')}
                      disabled={index === 0}
                      style={{
                        padding: '4px 8px',
                        border: '1px solid #d1d5db',
                        borderRadius: '4px',
                        backgroundColor: '#fff',
                        color: index === 0 ? '#d1d5db' : '#1a1a1a',
                        cursor: index === 0 ? 'default' : 'pointer',
                        fontSize: '12px',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        if (index > 0) {
                          e.currentTarget.style.borderColor = accentColor;
                          e.currentTarget.style.color = accentColor;
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (index > 0) {
                          e.currentTarget.style.borderColor = '#d1d5db';
                          e.currentTarget.style.color = '#1a1a1a';
                        }
                      }}
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => handleSectionMove(section.id, 'down')}
                      disabled={index === preferences.dashboardLayout.length - 1}
                      style={{
                        padding: '4px 8px',
                        border: '1px solid #d1d5db',
                        borderRadius: '4px',
                        backgroundColor: '#fff',
                        color: index === preferences.dashboardLayout.length - 1 ? '#d1d5db' : '#1a1a1a',
                        cursor: index === preferences.dashboardLayout.length - 1 ? 'default' : 'pointer',
                        fontSize: '12px',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        if (index < preferences.dashboardLayout.length - 1) {
                          e.currentTarget.style.borderColor = accentColor;
                          e.currentTarget.style.color = accentColor;
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (index < preferences.dashboardLayout.length - 1) {
                          e.currentTarget.style.borderColor = '#d1d5db';
                          e.currentTarget.style.color = '#1a1a1a';
                        }
                      }}
                    >
                      ▼
                    </button>
                  </div>

                  {/* Section name */}
                  <div style={{ flex: 1 }}>
                    <h4 className="text-fg" style={{ fontSize: '14px', fontWeight: '600', margin: '0' }}>
                      {section.name}
                    </h4>
                  </div>

                  {/* Visibility toggle */}
                  <button
                    onClick={() => handleSectionVisibility(section.id, !section.visible)}
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '6px',
                      border: '1px solid #d1d5db',
                      backgroundColor: '#fff',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '16px',
                      transition: 'all 0.2s',
                      color: section.visible ? accentColor : '#d1d5db',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = accentColor;
                      e.currentTarget.style.backgroundColor = '#f9fafb';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#d1d5db';
                      e.currentTarget.style.backgroundColor = '#fff';
                    }}
                    title={section.visible ? 'Hide section' : 'Show section'}
                  >
                    {section.visible ? '👁' : '👁‍🗨'}
                  </button>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
