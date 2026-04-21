'use client'

/**
 * PreviewPopover — hover over a trigger element to see a mini detail card (#19).
 * 200ms delay before showing, smooth entry animation.
 */

import { useState, useRef, useCallback, type ReactNode, memo } from 'react'

interface PreviewPopoverProps {
  /** The trigger element (e.g. a table row link) */
  children: ReactNode
  /** Content to show in the popover */
  content: ReactNode
  /** Delay before showing (default 200ms) */
  delay?: number
  /** Position relative to trigger */
  side?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
}

function PreviewPopoverImpl({
  children,
  content,
  delay = 200,
  side = 'right',
  className = '',
}: PreviewPopoverProps) {
  const [visible, setVisible] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const containerRef = useRef<HTMLDivElement>(null)

  const show = useCallback(() => {
    timeoutRef.current = setTimeout(() => setVisible(true), delay)
  }, [delay])

  const hide = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setVisible(false)
  }, [])

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  }

  return (
    <div
      ref={containerRef}
      className="relative inline-block"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <div
          className={`absolute z-50 ${positionClasses[side]} ${className}`}
          style={{ animation: 'slideUp 150ms var(--ease) both' }}
        >
          <div className="glass-card p-4 min-w-[240px] max-w-[360px] shadow-lg">
            {content}
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(PreviewPopoverImpl)
