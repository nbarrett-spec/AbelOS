'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser, Check } from 'lucide-react'
import Button from './Button'

// ── Aegis SignaturePad ────────────────────────────────────────────────────
// Canvas-based signature capture. Supports touch + mouse + pen.
// No 3rd-party deps. Emits a trimmed base64 PNG data URL on confirm.
// Mobile-first: ≥ 44px tap targets, large canvas, no hover-only affordances.
// ──────────────────────────────────────────────────────────────────────────

export interface SignaturePadProps {
  /** Called when the user taps "Confirm" with a non-empty signature */
  onConfirm: (dataUrl: string) => void
  /** Optional cancel callback */
  onCancel?: () => void
  /** Header label shown above the pad */
  label?: string
  /** Tall form factor — fill most of the vertical container */
  height?: number
  className?: string
  /** Stroke color — defaults to ink-like dark navy */
  strokeColor?: string
  /** Stroke width in px */
  strokeWidth?: number
}

export default function SignaturePad({
  onConfirm,
  onCancel,
  label = 'Customer Signature',
  height = 260,
  className,
  strokeColor = '#0f2a3e',
  strokeWidth = 2.25,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const drawingRef = useRef(false)
  const lastPtRef = useRef<{ x: number; y: number } | null>(null)
  const [hasStrokes, setHasStrokes] = useState(false)

  // Size canvas to container with DPR scaling
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const rect = container.getBoundingClientRect()
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    canvas.width = Math.floor(rect.width * dpr)
    canvas.height = Math.floor(height * dpr)
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${height}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(dpr, dpr)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = strokeWidth
    // Transparent background; baseline drawn via CSS
  }, [height, strokeColor, strokeWidth])

  useEffect(() => {
    resizeCanvas()
    const ro = new ResizeObserver(() => resizeCanvas())
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [resizeCanvas])

  const getPoint = (evt: PointerEvent | React.PointerEvent): { x: number; y: number } => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: (evt as PointerEvent).clientX - rect.left,
      y: (evt as PointerEvent).clientY - rect.top,
    }
  }

  const handlePointerDown = (evt: React.PointerEvent) => {
    evt.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setPointerCapture(evt.pointerId)
    drawingRef.current = true
    lastPtRef.current = getPoint(evt)
  }

  const handlePointerMove = (evt: React.PointerEvent) => {
    if (!drawingRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const pt = getPoint(evt)
    const last = lastPtRef.current
    if (!last) {
      lastPtRef.current = pt
      return
    }
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(pt.x, pt.y)
    ctx.stroke()
    lastPtRef.current = pt
    if (!hasStrokes) setHasStrokes(true)
  }

  const handlePointerUp = (evt: React.PointerEvent) => {
    const canvas = canvasRef.current
    if (canvas && canvas.hasPointerCapture(evt.pointerId)) {
      try { canvas.releasePointerCapture(evt.pointerId) } catch {}
    }
    drawingRef.current = false
    lastPtRef.current = null
  }

  const handleClear = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    setHasStrokes(false)
  }

  const handleConfirm = () => {
    const canvas = canvasRef.current
    if (!canvas || !hasStrokes) return
    const dataUrl = canvas.toDataURL('image/png')
    onConfirm(dataUrl)
  }

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
          {label}
        </span>
        {hasStrokes && (
          <span className="text-[11px] text-fg-muted font-mono">Signed</span>
        )}
      </div>
      <div
        ref={containerRef}
        className="relative rounded-lg border border-border bg-surface"
        style={{ height }}
      >
        {/* Signature baseline */}
        <div
          aria-hidden
          className="absolute left-4 right-4 border-b border-dashed border-border"
          style={{ bottom: 28 }}
        />
        {/* "Sign here" hint */}
        {!hasStrokes && (
          <div
            aria-hidden
            className="absolute left-4 right-4 flex items-center justify-center pointer-events-none text-fg-subtle text-[11px] uppercase tracking-[0.18em]"
            style={{ bottom: 8 }}
          >
            Sign above this line
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 rounded-lg touch-none cursor-crosshair"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </div>

      <div className="flex gap-2 mt-3">
        <Button
          variant="ghost"
          size="lg"
          icon={<Eraser className="w-4 h-4" />}
          onClick={handleClear}
          disabled={!hasStrokes}
          className="!min-h-[48px]"
        >
          Clear
        </Button>
        {onCancel && (
          <Button
            variant="ghost"
            size="lg"
            onClick={onCancel}
            className="!min-h-[48px]"
          >
            Cancel
          </Button>
        )}
        <Button
          variant="primary"
          size="lg"
          icon={<Check className="w-4 h-4" />}
          onClick={handleConfirm}
          disabled={!hasStrokes}
          fullWidth
          className="!min-h-[48px]"
        >
          Confirm Signature
        </Button>
      </div>
    </div>
  )
}
