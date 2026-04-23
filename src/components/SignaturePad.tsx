'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

// ──────────────────────────────────────────────────────────────────────────
// SignaturePad — canvas signature capture, touch + mouse friendly
//
// Designed for the driver portal but reusable (PM sign-offs, homeowner walks,
// punch list acceptance, etc.). Uses Pointer Events so it works with a
// finger, stylus, mouse, or trackpad.
//
// The canvas is rendered at device pixel ratio for crisp strokes, then
// exported as a PNG data URL via the imperative ref handle.
// ──────────────────────────────────────────────────────────────────────────

export interface SignaturePadHandle {
  /** Returns PNG data URL or null if the pad is empty */
  toDataURL: () => string | null
  /** Returns true if at least one stroke was drawn */
  isEmpty: () => boolean
  /** Clears all strokes */
  clear: () => void
}

export interface SignaturePadProps {
  height?: number
  /** Optional callback fired when the user begins / ends drawing */
  onChange?: (hasStrokes: boolean) => void
  className?: string
  /** Stroke color — defaults to a light ink matching dark canvas */
  strokeColor?: string
  /** Background color — defaults to surface */
  backgroundColor?: string
  disabled?: boolean
}

const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  function SignaturePad(
    {
      height = 200,
      onChange,
      className,
      strokeColor = '#e7e1d6',
      backgroundColor,
      disabled = false,
    },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const drawingRef = useRef(false)
    const hasStrokesRef = useRef(false)
    const lastPointRef = useRef<{ x: number; y: number } | null>(null)
    const [, setTick] = useState(0)

    // Size the canvas to its container at device pixel ratio for crispness
    const resize = useCallback(() => {
      const canvas = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container) return
      const rect = container.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${height}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(dpr, dpr)
      ctx.lineWidth = 2.4
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = strokeColor
      if (backgroundColor) {
        ctx.fillStyle = backgroundColor
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
    }, [height, strokeColor, backgroundColor])

    useEffect(() => {
      resize()
      const onResize = () => resize()
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }, [resize])

    const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current!
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled) return
      e.preventDefault()
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      canvas.setPointerCapture?.(e.pointerId)
      drawingRef.current = true
      const p = getPoint(e)
      lastPointRef.current = p
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      // Paint a dot so a single tap leaves a mark
      ctx.lineTo(p.x + 0.01, p.y + 0.01)
      ctx.stroke()
      if (!hasStrokesRef.current) {
        hasStrokesRef.current = true
        onChange?.(true)
        setTick((t) => t + 1)
      }
    }

    const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current || disabled) return
      const ctx = canvasRef.current?.getContext('2d')
      if (!ctx) return
      const p = getPoint(e)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
      lastPointRef.current = p
    }

    const end = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return
      drawingRef.current = false
      canvasRef.current?.releasePointerCapture?.(e.pointerId)
      lastPointRef.current = null
    }

    const clearInternal = useCallback(() => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (backgroundColor) {
        ctx.fillStyle = backgroundColor
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
      hasStrokesRef.current = false
      onChange?.(false)
      setTick((t) => t + 1)
    }, [backgroundColor, onChange])

    useImperativeHandle(
      ref,
      () => ({
        toDataURL: () => {
          if (!hasStrokesRef.current) return null
          return canvasRef.current?.toDataURL('image/png') ?? null
        },
        isEmpty: () => !hasStrokesRef.current,
        clear: clearInternal,
      }),
      [clearInternal]
    )

    return (
      <div
        ref={containerRef}
        className={className}
        style={{ position: 'relative', userSelect: 'none' }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
          style={{
            touchAction: 'none',
            display: 'block',
            width: '100%',
            height,
            borderRadius: 8,
            cursor: disabled ? 'not-allowed' : 'crosshair',
          }}
        />
        <button
          type="button"
          onClick={clearInternal}
          disabled={disabled || !hasStrokesRef.current}
          className="absolute top-1 right-1 text-[11px] px-2 py-1 rounded border border-border bg-surface/80 text-fg-muted hover:text-fg disabled:opacity-40"
        >
          Clear
        </button>
        {!hasStrokesRef.current && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              color: 'var(--fg-subtle, #7a7369)',
              fontSize: 13,
              fontStyle: 'italic',
              userSelect: 'none',
            }}
          >
            Sign here
          </div>
        )}
      </div>
    )
  }
)

export default SignaturePad
