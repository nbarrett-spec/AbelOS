'use client'

import { useEffect } from 'react'

export default function PWARegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          if (process.env.NODE_ENV !== 'production') {
            console.log('SW registered:', registration.scope)
          }

          // Check for updates every 30 minutes
          setInterval(() => {
            registration.update()
          }, 30 * 60 * 1000)
        })
        .catch((err) => {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('SW registration failed:', err)
          }
        })
    }
  }, [])

  return null
}
