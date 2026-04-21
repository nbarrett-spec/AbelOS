'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

type Theme = 'light' | 'dark'
type DesignTheme = 'glass' | 'drafting-room'

interface ThemeContextType {
  theme: Theme
  toggleTheme: () => void
  isDark: boolean
  designTheme: DesignTheme
  setDesignTheme: (t: DesignTheme) => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  toggleTheme: () => {},
  isDark: true,
  designTheme: 'glass',
  setDesignTheme: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Dark is the canonical Aegis experience; light is opt-in.
  const [theme, setTheme] = useState<Theme>('dark')
  const [designTheme, setDesignThemeState] = useState<DesignTheme>('glass')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const stored = localStorage.getItem('abel-theme') as Theme | null
    if (stored === 'dark' || stored === 'light') {
      setTheme(stored)
    } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
      setTheme('light')
    }

    // Design theme escape hatch: ?theme=drafting-room in URL or stored preference
    const params = new URLSearchParams(window.location.search)
    const urlDesign = params.get('theme')
    if (urlDesign === 'drafting-room') {
      setDesignThemeState('drafting-room')
      localStorage.setItem('aegis-design-theme', 'drafting-room')
    } else {
      const storedDesign = localStorage.getItem('aegis-design-theme') as DesignTheme | null
      if (storedDesign === 'drafting-room') {
        setDesignThemeState('drafting-room')
      }
    }
  }, [])

  useEffect(() => {
    if (!mounted) return
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    localStorage.setItem('abel-theme', theme)
  }, [theme, mounted])

  useEffect(() => {
    if (!mounted) return
    document.documentElement.setAttribute('data-design', designTheme)
  }, [designTheme, mounted])

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))
  }

  const setDesignTheme = (t: DesignTheme) => {
    setDesignThemeState(t)
    localStorage.setItem('aegis-design-theme', t)
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, isDark: theme === 'dark', designTheme, setDesignTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
