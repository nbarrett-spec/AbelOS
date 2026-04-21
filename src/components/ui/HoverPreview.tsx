'use client'

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────

export interface HoverPreviewProps {
  /** The inline trigger (link, chip, etc.) — cloned with hover handlers. */
  children: ReactElement
  /** Rich preview content — typically a compact card with stats + actions.
   *  Can also be a function that returns content (for lazy rendering). */
  content: ReactNode | (() => ReactNode)
  /** Delay before showing (ms). Default 300. */
  openDelay?: number
  /** Delay before closing (ms). Default 120. */
  closeDelay?: number
  /** Preferred side. Defaults to 'bottom'. */
  side?: 'top' | 'bottom'
  /** Max width in px. Default 360. */
  maxWidth?: number
  /** Disable on touch / small viewport. Default true. */
  disableOnTouch?: boolean
}

// ── Component ─────────────────────────────────────────────────────────────

/**
 * HoverPreview — 300ms-delayed floating card on hover.
 *
 * No runtime dependencies. Auto-positions above/below, clamps to viewport,
 * dismisses on mouseleave, scroll, or escape. Touch devices: no-op by default
 * (users can click through to detail).
 */
export default function HoverPreview({
  children,
  content,
  openDelay = 300,
  closeDelay = 120,
  side = 'bottom',
  maxWidth = 360,
  disableOnTouch = true,
}: HoverPreviewProps) {
  const triggerRef = useRef<HTMLElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const openTimer = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number; side: 'top' | 'bottom' } | null>(null)
  const [mounted, setMounted] = useState(false)
  const id = useId()

  useEffect(() => { setMounted(true) }, [])

  const isTouch = useCallback(() => {
    if (!disableOnTouch) return false
    if (typeof window === 'undefined') return false
    return window.matchMedia?.('(pointer: coarse)').matches ?? false
  }, [disableOnTouch])

  const place = useCallback(() => {
    const t = triggerRef.current
    const c = cardRef.current
    if (!t || !c) return
    const rect = t.getBoundingClientRect()
    const cr = c.getBoundingClientRect()
    const gap = 8
    let chosenSide: 'top' | 'bottom' = side
    const spaceBelow = window.innerHeight - rect.bottom
    if (side === 'bottom' && spaceBelow < cr.height + gap + 16) chosenSide = 'top'
    if (side === 'top' && rect.top < cr.height + gap + 16) chosenSide = 'bottom'

    let top = chosenSide === 'bottom' ? rect.bottom + gap : rect.top - cr.height - gap
    let left = rect.left + rect.width / 2 - cr.width / 2
    // Clamp to viewport with 8px padding
    left = Math.max(8, Math.min(window.innerWidth - cr.width - 8, left))
    top = Math.max(8, Math.min(window.innerHeight - cr.height - 8, top))
    setCoords({ top, left, side: chosenSide })
  }, [side])

  const scheduleOpen = useCallback(() => {
    if (isTouch()) return
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
    if (openTimer.current) return
    openTimer.current = window.setTimeout(() => {
      setOpen(true)
      openTimer.current = null
      // Wait one tick for card to render, then place.
      requestAnimationFrame(() => requestAnimationFrame(place))
    }, openDelay)
  }, [openDelay, isTouch, place])

  const scheduleClose = useCallback(() => {
    if (openTimer.current) { window.clearTimeout(openTimer.current); openTimer.current = null }
    if (closeTimer.current) return
    closeTimer.current = window.setTimeout(() => {
      setOpen(false)
      closeTimer.current = null
    }, closeDelay)
  }, [closeDelay])

  // Cleanup timers on unmount.
  useEffect(() => () => {
    if (openTimer.current) window.clearTimeout(openTimer.current)
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
  }, [])

  // Dismiss on scroll / escape.
  useEffect(() => {
    if (!open) return
    const onScroll = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  // Clone trigger with ref + handlers.
  if (!isValidElement(children)) return children as any

  const triggerProps: any = children.props
  // Props for the cloned element. React typings for cloneElement() on a
  // generic ReactElement don't include `ref`, so we cast to `any` — this is
  // the standard workaround for composable wrappers like this one.
  const cloneProps: any = {
    ref: (node: HTMLElement | null) => {
      (triggerRef as any).current = node
      const ownRef = (children as any).ref
      if (typeof ownRef === 'function') ownRef(node)
      else if (ownRef && typeof ownRef === 'object') ownRef.current = node
    },
    onMouseEnter: (e: any) => { triggerProps.onMouseEnter?.(e); scheduleOpen() },
    onMouseLeave: (e: any) => { triggerProps.onMouseLeave?.(e); scheduleClose() },
    onFocus:      (e: any) => { triggerProps.onFocus?.(e); scheduleOpen() },
    onBlur:       (e: any) => { triggerProps.onBlur?.(e); scheduleClose() },
    'aria-describedby': open ? id : undefined,
  }
  const clone = cloneElement(children, cloneProps)

  const resolved = typeof content === 'function' ? (open ? (content as () => ReactNode)() : null) : content

  return (
    <>
      {clone}
      {mounted && open && createPortal(
        <div
          ref={cardRef}
          id={id}
          role="tooltip"
          onMouseEnter={() => { if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null } }}
          onMouseLeave={scheduleClose}
          style={{
            position: 'fixed',
            top: coords?.top ?? -9999,
            left: coords?.left ?? -9999,
            maxWidth,
            zIndex: 70,
            opacity: coords ? 1 : 0,
            transform: coords ? 'translateY(0) scale(1)' : 'translateY(-2px) scale(0.98)',
            transition: 'opacity 140ms var(--ease-out), transform 160ms var(--ease-out)',
            pointerEvents: 'auto',
          }}
          className={cn('panel panel-elevated text-sm text-fg')}
        >
          {resolved}
        </div>,
        document.body,
      )}
    </>
  )
}
