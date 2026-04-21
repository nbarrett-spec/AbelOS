'use client'

/**
 * TabBarInk — tab bar with a sliding gradient underline indicator (#33).
 * The ink bar physically moves between tabs using CSS transitions.
 */

import { useRef, useEffect, useState, memo, type ReactNode } from 'react'

interface Tab {
  id: string
  label: ReactNode
}

interface TabBarInkProps {
  tabs: Tab[]
  activeId: string
  onChange: (id: string) => void
  className?: string
}

function TabBarInkImpl({ tabs, activeId, onChange, className = '' }: TabBarInkProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [inkStyle, setInkStyle] = useState<{ left: number; width: number }>({ left: 0, width: 0 })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const activeEl = container.querySelector(`[data-tab-id="${activeId}"]`) as HTMLElement
    if (activeEl) {
      setInkStyle({
        left: activeEl.offsetLeft,
        width: activeEl.offsetWidth,
      })
    }
  }, [activeId])

  return (
    <div ref={containerRef} className={`tab-bar ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          data-tab-id={tab.id}
          onClick={() => onChange(tab.id)}
          aria-selected={tab.id === activeId}
          className="tab-bar-item"
          role="tab"
        >
          {tab.label}
        </button>
      ))}
      <div
        className="tab-bar-ink"
        style={{
          left: inkStyle.left,
          width: inkStyle.width,
        }}
      />
    </div>
  )
}

export default memo(TabBarInkImpl)
