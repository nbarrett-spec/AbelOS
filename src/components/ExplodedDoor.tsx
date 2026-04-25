'use client'

/**
 * ExplodedDoor — Interactive animated exploded-view of a 3080 2-Panel door.
 *
 * Two variants:
 *   - "hero"  → large, auto-plays on scroll, labels visible, used on home page
 *   - "compact" → smaller, click-to-toggle, used on BOM page as visual reference
 *
 * All dimensions from Abel's actual product spec:
 *   Slab: 30" × 80" × 1-3/8", primed MDF, 2-panel square top
 *   Jamb: 4-9/16" depth, 1-1/4" thick, 81" cut length
 *   Casing: 3-1/4" flat stock, 5/8" thick
 *   Hinges: 3× satin nickel, 3-1/2" × 3-1/2", radius corners
 *   Stop: 3/4" × 1/2", installed around perimeter
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react'

/* ── Types ─────────────────────────────────────────────────────────────── */

interface ExplodedDoorProps {
  /** "hero" = large auto-play for home page, "compact" = smaller toggle for BOM */
  variant?: 'hero' | 'compact'
  /** Auto-explode on mount (hero) or on first scroll into view */
  autoPlay?: boolean
  /** Auto-cycle between exploded and assembled */
  loop?: boolean
  /** Cycle interval in ms (only when loop=true) */
  loopInterval?: number
  /** Additional classes on the wrapper */
  className?: string
}

/* ── Part definitions ──────────────────────────────────────────────────── */

interface Part {
  id: string
  label: string
  spec?: string
  explodeX: number
  explodeY: number
}

const PARTS: Part[] = [
  { id: 'casing-header',  label: 'Casing header',     spec: '35-1/2″ × 3-1/4″ × 5/8″',  explodeX: 0,   explodeY: -90 },
  { id: 'head-jamb',      label: 'Head jamb',          spec: '34-1/2″ cut length',          explodeX: 0,   explodeY: -55 },
  { id: 'casing-left',    label: 'Casing leg (L)',     spec: '84-1/2″ × 3-1/4″ × 5/8″',  explodeX: -80, explodeY: 0 },
  { id: 'casing-right',   label: 'Casing leg (R)',     spec: '84-1/2″ × 3-1/4″ × 5/8″',  explodeX: 80,  explodeY: 0 },
  { id: 'hinge-jamb',     label: 'Hinge jamb',         spec: '81″ × 4-9/16″ × 1-1/4″',   explodeX: -50, explodeY: 0 },
  { id: 'strike-jamb',    label: 'Strike jamb',        spec: '81″ × 4-9/16″ × 1-1/4″',   explodeX: 50,  explodeY: 0 },
  { id: 'stop-left',      label: 'Door stop (L)',      spec: '3/4″ × 1/2″',                explodeX: -30, explodeY: 0 },
  { id: 'stop-right',     label: 'Door stop (R)',      spec: '3/4″ × 1/2″',                explodeX: 30,  explodeY: 0 },
  { id: 'stop-top',       label: 'Door stop (top)',    spec: '3/4″ × 1/2″',                explodeX: 0,   explodeY: -25 },
  { id: 'hinge-top',      label: 'Hinge (top)',        spec: '3-1/2″ × 3-1/2″ satin Ni',  explodeX: -45, explodeY: 10 },
  { id: 'hinge-mid',      label: 'Hinge (mid)',        spec: '3-1/2″ × 3-1/2″ satin Ni',  explodeX: -45, explodeY: 0 },
  { id: 'hinge-bottom',   label: 'Hinge (bottom)',     spec: '3-1/2″ × 3-1/2″ satin Ni',  explodeX: -45, explodeY: -10 },
  { id: 'door-slab',      label: '3080 door slab',     spec: '30″ × 80″ × 1-3/8″ MDF',   explodeX: 0,   explodeY: 20 },
]

/* ── Easing ────────────────────────────────────────────────────────────── */

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/* ── Component ─────────────────────────────────────────────────────────── */

function ExplodedDoorImpl({
  variant = 'hero',
  autoPlay = true,
  loop = false,
  loopInterval = 5000,
  className = '',
}: ExplodedDoorProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [exploded, setExploded] = useState(false)
  const [hasPlayed, setHasPlayed] = useState(false)
  const animRef = useRef<number[]>([])

  const isHero = variant === 'hero'

  /* ── Animation engine ───────────────────────────────────────────────── */

  const animateTo = useCallback((toExploded: boolean) => {
    const svg = svgRef.current
    if (!svg) return

    // Cancel any running animations
    animRef.current.forEach(id => cancelAnimationFrame(id))
    animRef.current = []

    const dur = 800
    const groups = svg.querySelectorAll<SVGGElement>('[data-ex]')

    groups.forEach((g, i) => {
      const [ex, ey] = (g.dataset.ex || '0,0').split(',').map(Number)
      const targetX = toExploded ? ex : 0
      const targetY = toExploded ? ey : 0

      // Current position
      const tr = g.getAttribute('transform')
      const m = tr?.match(/translate\(([-\d.]+),([-\d.]+)\)/)
      const startX = m ? parseFloat(m[1]) : 0
      const startY = m ? parseFloat(m[2]) : 0

      const labels = g.querySelectorAll<SVGTextElement>('.part-label')
      const delay = i * 35
      const start = performance.now() + delay

      function step(now: number) {
        const elapsed = now - start
        if (elapsed < 0) {
          animRef.current.push(requestAnimationFrame(step))
          return
        }
        const t = Math.min(elapsed / dur, 1)
        const ease = easeInOutCubic(t)
        const x = startX + (targetX - startX) * ease
        const y = startY + (targetY - startY) * ease
        g.setAttribute('transform', `translate(${x},${y})`)
        labels.forEach(l => l.setAttribute('opacity', String(toExploded ? ease : 1 - ease)))
        if (t < 1) {
          animRef.current.push(requestAnimationFrame(step))
        }
      }

      animRef.current.push(requestAnimationFrame(step))
    })

    setExploded(toExploded)
  }, [])

  /* ── Auto-play on scroll (hero) or on mount ─────────────────────────── */

  useEffect(() => {
    if (!autoPlay || hasPlayed) return

    if (isHero) {
      // IntersectionObserver — explode when 40% visible
      const svg = svgRef.current
      if (!svg) return
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting && !hasPlayed) {
            setTimeout(() => animateTo(true), 400)
            setHasPlayed(true)
          }
        },
        { threshold: 0.4 }
      )
      observer.observe(svg)
      return () => observer.disconnect()
    } else {
      // Compact: explode after short delay
      const timer = setTimeout(() => {
        animateTo(true)
        setHasPlayed(true)
      }, 600)
      return () => clearTimeout(timer)
    }
  }, [autoPlay, hasPlayed, isHero, animateTo])

  /* ── Loop mode ──────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!loop || !hasPlayed) return
    const interval = setInterval(() => {
      animateTo(!exploded)
    }, loopInterval)
    return () => clearInterval(interval)
  }, [loop, loopInterval, hasPlayed, exploded, animateTo])

  /* ── Click toggle ───────────────────────────────────────────────────── */

  const toggle = useCallback(() => {
    animateTo(!exploded)
    setHasPlayed(true)
  }, [exploded, animateTo])

  /* ── Render ─────────────────────────────────────────────────────────── */

  const viewBoxH = isHero ? 720 : 660
  const wrapperClasses = isHero
    ? `w-full max-w-[560px] mx-auto ${className}`
    : `w-full max-w-[400px] mx-auto cursor-pointer ${className}`

  return (
    <div className={wrapperClasses} onClick={!isHero ? toggle : undefined}>
      <svg
        ref={svgRef}
        viewBox={`0 0 680 ${viewBoxH}`}
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-auto"
        role="img"
        aria-label="Exploded view of a 3080 2-panel square top prehung door showing all components"
      >
        <defs>
          <linearGradient id="ed-doorFace" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--surface-elevated, #f8f6f2)" />
            <stop offset="100%" stopColor="var(--surface-muted, #eae7e0)" />
          </linearGradient>
          <linearGradient id="ed-jambFace" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--surface-muted, #f0ede6)" />
            <stop offset="100%" stopColor="var(--border, #e2dfd8)" />
          </linearGradient>
          <linearGradient id="ed-hingeFace" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#c0bdb6" />
            <stop offset="100%" stopColor="#9e9b94" />
          </linearGradient>
          <filter id="ed-shadow" x="-4%" y="-4%" width="108%" height="108%">
            <feDropShadow dx="1" dy="2" stdDeviation="3" floodOpacity="0.12" />
          </filter>
        </defs>

        {/* Title (hero only) */}
        {isHero && (
          <>
            <text x="340" y="30" textAnchor="middle" fontSize="16" fontWeight="500"
              fill="var(--fg, #f5f1e8)" fontFamily="var(--font-sans-stack, sans-serif)">
              3080 2-Panel square top door
            </text>
            <text x="340" y="48" textAnchor="middle" fontSize="12"
              fill="var(--fg-muted, #96a8b8)" fontFamily="var(--font-sans-stack, sans-serif)">
              Interactive exploded view — click to toggle
            </text>
          </>
        )}

        <g filter="url(#ed-shadow)" onClick={isHero ? toggle : undefined}
          style={isHero ? { cursor: 'pointer' } : undefined}>

          {/* CASING HEADER */}
          <g data-ex="0,-90">
            <rect x="175" y="80" width="330" height="18" rx="2"
              fill="url(#ed-jambFace)" stroke="var(--border, #c5c0b6)" strokeWidth="0.5" />
            <text className="part-label" x="340" y="68" textAnchor="middle" fontSize="11"
              fontWeight="500" fill="var(--fg-muted, #96a8b8)"
              fontFamily="var(--font-sans-stack, sans-serif)" opacity="0">
              CASING HEADER
            </text>
            <text className="part-label" x="340" y="56" textAnchor="middle" fontSize="10"
              fill="var(--fg-subtle, #6b7d8e)"
              fontFamily="var(--font-sans-stack, sans-serif)" opacity="0">
              35-1/2″ × 3-1/4″ × 5/8″
            </text>
          </g>

          {/* HEAD JAMB */}
          <g data-ex="0,-55">
            <rect x="210" y="98" width="260" height="14" rx="1"
              fill="var(--surface-muted, #e8e5de)" stroke="var(--border, #c5c0b6)" strokeWidth="0.5" />
            <text className="part-label" x="340" y="94" textAnchor="middle" fontSize="10"
              fontWeight="500" fill="var(--fg-muted, #96a8b8)"
              fontFamily="var(--font-sans-stack, sans-serif)" opacity="0">
              HEAD JAMB — 34-1/2″
            </text>
          </g>

          {/* CASING LEG LEFT */}
          <g data-ex="-80,0">
            <rect x="175" y="98" width="18" height="520" rx="2"
              fill="url(#ed-jambFace)" stroke="var(--border, #c5c0b6)" strokeWidth="0.5" />
            <text className="part-label" x="170" y="360" textAnchor="end" fontSize="10"
              fontWeight="500" fill="var(--fg-muted, #96a8b8)"
              fontFamily="var(--font-sans-stack, sans-serif)"
              transform="rotate(-90,170,360)" opacity="0">
              CASING LEG — 84-1/2″
            </text>
          </g>

          {/* CASING LEG RIGHT */}
          <g data-ex="80,0">
            <rect x="487" y="98" width="18" height="520" rx="2"
              fill="url(#ed-jambFace)" stroke="var(--border, #c5c0b6)" strokeWidth="0.5" />
          </g>

          {/* HINGE JAMB */}
          <g data-ex="-50,0">
            <rect x="193" y="112" width="16" height="500" rx="1"
              fill="var(--surface-muted, #e8e5de)" stroke="var(--border, #c5c0b6)" strokeWidth="0.5" />
            <text className="part-label" x="188" y="360" textAnchor="end" fontSize="10"
              fontWeight="500" fill="var(--fg-muted, #96a8b8)"
              fontFamily="var(--font-sans-stack, sans-serif)"
              transform="rotate(-90,188,360)" opacity="0">
              HINGE JAMB — 81″
            </text>
          </g>

          {/* STRIKE JAMB */}
          <g data-ex="50,0">
            <rect x="471" y="112" width="16" height="500" rx="1"
              fill="var(--surface-muted, #e8e5de)" stroke="var(--border, #c5c0b6)" strokeWidth="0.5" />
            <text className="part-label" x="492" y="360" textAnchor="start" fontSize="10"
              fontWeight="500" fill="var(--fg-muted, #96a8b8)"
              fontFamily="var(--font-sans-stack, sans-serif)"
              transform="rotate(90,492,360)" opacity="0">
              STRIKE JAMB — 81″
            </text>
          </g>

          {/* DOOR STOP LEFT */}
          <g data-ex="-30,0">
            <rect x="209" y="116" width="6" height="492" rx="0.5"
              fill="var(--surface, #d8d5ce)" stroke="var(--border, #bbb7af)" strokeWidth="0.5" />
          </g>

          {/* DOOR STOP RIGHT */}
          <g data-ex="30,0">
            <rect x="465" y="116" width="6" height="492" rx="0.5"
              fill="var(--surface, #d8d5ce)" stroke="var(--border, #bbb7af)" strokeWidth="0.5" />
          </g>

          {/* DOOR STOP TOP */}
          <g data-ex="0,-25">
            <rect x="215" y="112" width="250" height="6" rx="0.5"
              fill="var(--surface, #d8d5ce)" stroke="var(--border, #bbb7af)" strokeWidth="0.5" />
          </g>

          {/* HINGE TOP */}
          <g data-ex="-45,10">
            <rect x="208" y="160" width="14" height="28" rx="2"
              fill="url(#ed-hingeFace)" stroke="#908d86" strokeWidth="0.7" />
            <line x1="215" y1="163" x2="215" y2="185" stroke="#a8a5a0" strokeWidth="0.5" />
            <circle cx="215" cy="167" r="1.5" fill="#b0ada6" />
            <circle cx="215" cy="180" r="1.5" fill="#b0ada6" />
          </g>

          {/* HINGE MIDDLE */}
          <g data-ex="-45,0">
            <rect x="208" y="340" width="14" height="28" rx="2"
              fill="url(#ed-hingeFace)" stroke="#908d86" strokeWidth="0.7" />
            <line x1="215" y1="343" x2="215" y2="365" stroke="#a8a5a0" strokeWidth="0.5" />
            <circle cx="215" cy="347" r="1.5" fill="#b0ada6" />
            <circle cx="215" cy="360" r="1.5" fill="#b0ada6" />
          </g>

          {/* HINGE BOTTOM */}
          <g data-ex="-45,-10">
            <rect x="208" y="530" width="14" height="28" rx="2"
              fill="url(#ed-hingeFace)" stroke="#908d86" strokeWidth="0.7" />
            <line x1="215" y1="533" x2="215" y2="555" stroke="#a8a5a0" strokeWidth="0.5" />
            <circle cx="215" cy="537" r="1.5" fill="#b0ada6" />
            <circle cx="215" cy="550" r="1.5" fill="#b0ada6" />
          </g>

          {/* DOOR SLAB */}
          <g data-ex="0,20">
            <rect x="218" y="120" width="244" height="488" rx="2"
              fill="url(#ed-doorFace)" stroke="var(--border, #c5c0b6)" strokeWidth="0.8" />
            {/* Top panel */}
            <rect x="248" y="148" width="184" height="200" rx="3"
              fill="none" stroke="var(--border-strong, #d0cdc6)" strokeWidth="1.2" />
            <rect x="252" y="152" width="176" height="192" rx="2"
              fill="var(--surface-elevated, #f2f0eb)" stroke="var(--border, #dddad3)" strokeWidth="0.5" />
            {/* Bottom panel */}
            <rect x="248" y="378" width="184" height="200" rx="3"
              fill="none" stroke="var(--border-strong, #d0cdc6)" strokeWidth="1.2" />
            <rect x="252" y="382" width="176" height="192" rx="2"
              fill="var(--surface-elevated, #f2f0eb)" stroke="var(--border, #dddad3)" strokeWidth="0.5" />
            {/* Bore hole */}
            <circle cx="448" cy="370" r="5" fill="none" stroke="var(--border, #c5c0b6)" strokeWidth="0.7" />
            <circle cx="448" cy="370" r="2" fill="var(--surface-muted, #d8d5ce)" />
            {/* Labels */}
            <text className="part-label" x="340" y="650" textAnchor="middle" fontSize="11"
              fontWeight="500" fill="var(--fg-muted, #96a8b8)"
              fontFamily="var(--font-sans-stack, sans-serif)" opacity="0">
              3080 DOOR SLAB
            </text>
            <text className="part-label" x="340" y="664" textAnchor="middle" fontSize="10"
              fill="var(--fg-subtle, #6b7d8e)"
              fontFamily="var(--font-sans-stack, sans-serif)" opacity="0">
              30″ × 80″ × 1-3/8″ — Primed MDF
            </text>
          </g>
        </g>
      </svg>

      {/* Controls (hero only) */}
      {isHero && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            onClick={(e) => { e.stopPropagation(); animateTo(true) }}
            className="px-4 py-2 text-xs font-medium rounded-lg
              bg-surface-elevated border border-border text-fg-muted
              hover:text-fg hover:border-border-strong transition-all duration-150
              active:scale-[0.98]"
          >
            Explode
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); animateTo(false) }}
            className="px-4 py-2 text-xs font-medium rounded-lg
              bg-surface-elevated border border-border text-fg-muted
              hover:text-fg hover:border-border-strong transition-all duration-150
              active:scale-[0.98]"
          >
            Assemble
          </button>
        </div>
      )}

      {/* Compact label */}
      {!isHero && (
        <p className="text-center text-xs text-fg-subtle mt-2">
          Click to {exploded ? 'assemble' : 'explode'}
        </p>
      )}
    </div>
  )
}

export default memo(ExplodedDoorImpl)
export { ExplodedDoorImpl as ExplodedDoor }
