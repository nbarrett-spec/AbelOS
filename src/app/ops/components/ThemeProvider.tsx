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
  accentColor: '#3b82f6',
  fontSize: 'medium',
  compactMode: false,
};

const THEME_COLORS = {
  light: {
    '--bg-primary': '#ffffff',
    '--bg-secondary': '#f8f9fa',
    '--bg-sidebar': '#1B2A4A',
    '--text-primary': '#1a1a2e',
    '--text-secondary': '#6b7280',
    '--border-color': '#e5e7eb',
    '--card-bg': '#ffffff',
  },
  dark: {
    '--bg-primary': '#1a1a2e',
    '--bg-secondary': '#16213e',
    '--bg-sidebar': '#0f1526',
    '--text-primary': '#e8e8e8',
    '--text-secondary': '#9ca3af',
    '--border-color': '#2d3748',
    '--card-bg': '#1e2a3a',
  },
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

function applyThemeColors(theme: 'light' | 'dark', accentColor: string, fontSize: 'small' | 'medium' | 'large') {
  const root = document.documentElement;

  // Apply theme-specific colors
  const themeColors = THEME_COLORS[theme];
  Object.entries(themeColors).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });

  // Apply accent color
  root.style.setProperty('--accent-color', accentColor);
  root.style.setProperty('--accent-color-hover', createHoverColor(accentColor));

  // Apply font size
  root.style.setProperty('--font-size-base', FONT_SIZES[fontSize]);

  // Set data-theme attribute AND dark class (for globals.css dark mode overrides)
  root.setAttribute('data-theme', theme);
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
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
          setPreferences({
            theme: data.theme || DEFAULT_PREFERENCES.theme,
            accentColor: data.accentColor || DEFAULT_PREFERENCES.accentColor,
            fontSize: data.fontSize || DEFAULT_PREFERENCES.fontSize,
            compactMode: data.compactMode || DEFAULT_PREFERENCES.compactMode,
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
    applyThemeColors(resolvedTheme, preferences.accentColor, preferences.fontSize);
  }, [preferences]);

  // Listen for system theme changes
  useEffect(() => {
    if (preferences.theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      const newTheme = e.matches ? 'dark' : 'light';
      setTheme(newTheme);
      applyThemeColors(newTheme, preferences.accentColor, preferences.fontSize);
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
          setPreferences({
            theme: data.theme || DEFAULT_PREFERENCES.theme,
            accentColor: data.accentColor || DEFAULT_PREFERENCES.accentColor,
            fontSize: data.fontSize || DEFAULT_PREFERENCES.fontSize,
            compactMode: data.compactMode || DEFAULT_PREFERENCES.compactMode,
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
