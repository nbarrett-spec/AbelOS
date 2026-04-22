'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

interface Preferences {
  theme: 'light' | 'dark' | 'system';
  accentColor: string;
  fontSize: 'small' | 'medium' | 'large';
  compactMode: boolean;
}

interface ThemeContextType {
  theme: 'light' | 'dark';
  accentColor: string;
  fontSize: 'small' | 'medium' | 'large';
  compactMode: boolean;
  preferences: Preferences;
  loading: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const DEFAULT_PREFERENCES: Preferences = {
  theme: 'light',
  accentColor: '#C6A24E',
  fontSize: 'medium',
  compactMode: false,
};

const FONT_SIZES = {
  small: '14px',
  medium: '16px',
  large: '18px',
};

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

function createHoverColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.8)`;
}

function applyTheme(theme: 'light' | 'dark', accentColor: string, fontSize: 'small' | 'medium' | 'large') {
  const root = document.documentElement;

  // Toggle dark class — this activates the full Aegis Glass dark token set in globals.css
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  root.setAttribute('data-theme', theme);

  // User accent color → override the signal/accent vars
  if (accentColor && accentColor !== '#C6A24E') {
    const rgb = hexToRgb(accentColor);
    if (rgb) {
      root.style.setProperty('--signal', accentColor);
      root.style.setProperty('--signal-hover', createHoverColor(accentColor));
      root.style.setProperty('--signal-subtle', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.10)`);
      root.style.setProperty('--signal-glow', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.20)`);
      root.style.setProperty('--accent', accentColor);
      root.style.setProperty('--accent-hover', createHoverColor(accentColor));
      root.style.setProperty('--accent-subtle', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08)`);
      root.style.setProperty('--accent-fg', accentColor);
    }
  } else {
    // Reset to default — remove inline overrides so globals.css wins
    ['--signal', '--signal-hover', '--signal-subtle', '--signal-glow',
     '--accent', '--accent-hover', '--accent-subtle', '--accent-fg'].forEach(v => {
      root.style.removeProperty(v);
    });
  }

  // Font size
  root.style.setProperty('--font-size-base', FONT_SIZES[fontSize]);
}

interface ThemeProviderProps {
  children: React.ReactNode;
}

export default function ThemeProvider({ children }: ThemeProviderProps) {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Fetch preferences on mount
  useEffect(() => {
    const fetchPreferences = async () => {
      try {
        const response = await fetch('/api/ops/preferences');
        if (response.ok) {
          const data = await response.json();
          const prefs = data.preferences || data;
          setPreferences({
            theme: prefs.theme || DEFAULT_PREFERENCES.theme,
            accentColor: prefs.accentColor || DEFAULT_PREFERENCES.accentColor,
            fontSize: prefs.fontSize || DEFAULT_PREFERENCES.fontSize,
            compactMode: prefs.compactMode || DEFAULT_PREFERENCES.compactMode,
          });
        } else {
          setPreferences(DEFAULT_PREFERENCES);
        }
      } catch (error) {
        console.error('Failed to fetch preferences:', error);
        setPreferences(DEFAULT_PREFERENCES);
      } finally {
        setLoading(false);
      }
    };

    fetchPreferences();
  }, []);

  // Update theme when preferences change
  useEffect(() => {
    const resolvedTheme = preferences.theme === 'system' ? getSystemTheme() : preferences.theme;
    setTheme(resolvedTheme);
    applyTheme(resolvedTheme, preferences.accentColor, preferences.fontSize);
  }, [preferences]);

  // Listen for system theme changes
  useEffect(() => {
    if (preferences.theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      const newTheme = e.matches ? 'dark' : 'light';
      setTheme(newTheme);
      applyTheme(newTheme, preferences.accentColor, preferences.fontSize);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [preferences]);

  // Listen for preferences-updated event
  useEffect(() => {
    const handlePreferencesUpdated = async () => {
      try {
        const response = await fetch('/api/ops/preferences');
        if (response.ok) {
          const data = await response.json();
          const prefs = data.preferences || data;
          setPreferences({
            theme: prefs.theme || DEFAULT_PREFERENCES.theme,
            accentColor: prefs.accentColor || DEFAULT_PREFERENCES.accentColor,
            fontSize: prefs.fontSize || DEFAULT_PREFERENCES.fontSize,
            compactMode: prefs.compactMode || DEFAULT_PREFERENCES.compactMode,
          });
        }
      } catch (error) {
        console.error('Failed to refresh preferences:', error);
      }
    };

    window.addEventListener('preferences-updated', handlePreferencesUpdated);
    return () => window.removeEventListener('preferences-updated', handlePreferencesUpdated);
  }, []);

  const value: ThemeContextType = {
    theme,
    accentColor: preferences.accentColor,
    fontSize: preferences.fontSize,
    compactMode: preferences.compactMode,
    preferences,
    loading,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
