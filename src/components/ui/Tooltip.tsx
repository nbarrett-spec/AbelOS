'use client'

import { useState, useRef, type ReactNode } from 'react'
import { clsx } from 'clsx'

export interface TooltipProps {
  content: string | ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
  className?: string
}

const positions = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
}

const arrows = {
  top: 'top-full left-1/2 -translate-x-1/2 border-t-gray-900 border-x-transparent border-b-transparent',
  bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-gray-900 border-x-transparent border-t-transparent',
  left: 'left-full top-1/2 -translate-y-1/2 border-l-gray-900 border-y-transparent border-r-transparent',
  right: 'right-full top-1/2 -translate-y-1/2 border-r-gray-900 border-y-transparent border-l-transparent',
}

export default function Tooltip({ content, children, side = 'top', delay = 200, className }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timeout = useRef<ReturnType<typeof setTimeout>>()

  const show = () => {
    timeout.current = setTimeout(() => setVisible(true), delay)
  }

  const hide = () => {
    clearTimeout(timeout.current)
    setVisible(false)
  }

  return (
    <div className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {visible && (
        <div
          role="tooltip"
          className={clsx(
            'absolute z-50 pointer-events-none',
            'px-2.5 py-1.5 text-xs font-medium text-white bg-gray-900 dark:bg-gray-700',
            'rounded-lg shadow-lg whitespace-nowrap',
            'animate-[fadeIn_100ms_ease-out]',
            positions[side],
            className
          )}
        >
          {content}
          <span className={clsx('absolute w-0 h-0 border-4', arrows[side])} />
        </div>
      )}
    </div>
  )
}
