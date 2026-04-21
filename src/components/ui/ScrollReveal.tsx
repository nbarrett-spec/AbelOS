'use client'

/**
 * ScrollReveal — page sections animate in as you scroll (#51).
 * Uses IntersectionObserver, triggers at 20% visibility.
 */

import { useEffect, useRef, type ReactNode, memo } from 'react'

interface ScrollRevealProps {
  children: ReactNode
  /** Stagger delay in ms for child index (default 0) */
  delay?: number
  className?: string
}

function ScrollRevealImpl({ children, delay = 0, className = '' }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Check prefers-reduced-motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add('is-visible')
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('is-visible')
          observer.disconnect()
        }
      },
      { threshold: 0.2 }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={`scroll-reveal ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}

export default memo(ScrollRevealImpl)
