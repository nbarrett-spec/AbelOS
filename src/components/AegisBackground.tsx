'use client'

/**
 * AegisBackground — the Glass v3 living background system.
 *
 * Layers (bottom → top):
 *   1. Gradient orbs — blurred color spheres, slow drift
 *   2. Blueprint grid — fine (60px) + major (300px) lines, slow diagonal drift
 *   3. Door plan watermark — one of 12 door SVGs at low opacity, draws in on mount
 *   4. Dimension markers — subtle crop marks near viewport edges
 *
 * All layers respect prefers-reduced-motion.
 * Mobile: orbs hidden, grid static at 30% opacity, no door watermark.
 * Print: all hidden via .aegis-bg class.
 */

import { memo, useMemo } from 'react'
import { blueprintForSeed, type Blueprint } from '@/lib/blueprints'

export interface AegisBackgroundProps {
  /** Controls the intensity of the background layers */
  variant?: 'full' | 'subtle' | 'minimal' | 'none'
  /** Number of gradient orbs (0-3) */
  orbCount?: 0 | 1 | 2 | 3
  /** Show a faded door SVG in the bottom-right corner */
  doorBlueprint?: boolean
  /** Seed for picking which of the 12 door SVGs to show */
  doorSeed?: number
  className?: string
}

// Orb configs — position, color, size, animation delay
const ORB_CONFIGS = [
  { cx: '15%', cy: '20%', r: 300, color: 'var(--c1)', delay: '0s' },
  { cx: '75%', cy: '60%', r: 250, color: 'var(--c3)', delay: '-7s' },
  { cx: '50%', cy: '85%', r: 280, color: 'var(--c2)', delay: '-14s' },
] as const

function AegisBackgroundImpl({
  variant = 'full',
  orbCount = 2,
  doorBlueprint = false,
  doorSeed,
  className = '',
}: AegisBackgroundProps) {
  if (variant === 'none') return null

  const opacityScale = variant === 'full' ? 1 : variant === 'subtle' ? 0.6 : 0.3
  const gridOpacity = variant === 'full' ? 1 : variant === 'subtle' ? 0.7 : 0.4

  // Resolve door blueprint once
  const door: Blueprint | null = useMemo(() => {
    if (!doorBlueprint) return null
    const seed = doorSeed ?? new Date().getDate()
    return blueprintForSeed(seed)
  }, [doorBlueprint, doorSeed])

  return (
    <div
      className={`aegis-bg fixed inset-0 pointer-events-none overflow-hidden ${className}`}
      style={{ zIndex: 0 }}
      aria-hidden="true"
    >
      {/* Layer 1: Gradient orbs */}
      {orbCount > 0 && (
        <div className="aegis-bg-orbs hidden md:block absolute inset-0">
          {ORB_CONFIGS.slice(0, orbCount).map((orb, i) => (
            <div
              key={i}
              className="absolute rounded-full aegis-bg-orb"
              style={{
                left: orb.cx,
                top: orb.cy,
                width: orb.r,
                height: orb.r,
                background: orb.color,
                opacity: 0.07 * opacityScale,
                filter: 'blur(100px)',
                animation: `orb-float 20s ease-in-out infinite`,
                animationDelay: orb.delay,
                transform: 'translate(-50%, -50%)',
              }}
            />
          ))}
        </div>
      )}

      {/* Layer 2: Blueprint grid — fine lines (60px) + major lines (300px) */}
      <div
        className="aegis-bg-grid absolute inset-0"
        style={{
          opacity: gridOpacity,
          backgroundImage: `
            linear-gradient(var(--bp-fine) 1px, transparent 1px),
            linear-gradient(90deg, var(--bp-fine) 1px, transparent 1px),
            linear-gradient(var(--bp-major) 1px, transparent 1px),
            linear-gradient(90deg, var(--bp-major) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px, 60px 60px, 300px 300px, 300px 300px',
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 50%, black 0%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 70% at 50% 50%, black 0%, transparent 100%)',
          animation: variant === 'full' ? 'bp-drift 60s linear infinite' : 'none',
        }}
      />

      {/* Layer 3: Dimension markers (crop marks near edges) */}
      {variant === 'full' && (
        <svg
          className="aegis-bg-marks absolute inset-0 w-full h-full hidden lg:block"
          style={{ opacity: 0.06 * opacityScale }}
          preserveAspectRatio="none"
        >
          {/* Top-left registration */}
          <line x1="40" y1="24" x2="40" y2="40" stroke="var(--bp-annotation)" strokeWidth="1" />
          <line x1="24" y1="40" x2="40" y2="40" stroke="var(--bp-annotation)" strokeWidth="1" />
          {/* Top-right registration */}
          <line x1="calc(100% - 40)" y1="24" x2="calc(100% - 40)" y2="40" stroke="var(--bp-annotation)" strokeWidth="1" />
          <line x1="calc(100% - 24)" y1="40" x2="calc(100% - 40)" y2="40" stroke="var(--bp-annotation)" strokeWidth="1" />
          {/* Bottom-left registration */}
          <line x1="40" y1="calc(100% - 24)" x2="40" y2="calc(100% - 40)" stroke="var(--bp-annotation)" strokeWidth="1" />
          <line x1="24" y1="calc(100% - 40)" x2="40" y2="calc(100% - 40)" stroke="var(--bp-annotation)" strokeWidth="1" />
        </svg>
      )}

      {/* Layer 4: Door plan watermark */}
      {door && (
        <div
          className="aegis-bg-door hidden md:block absolute"
          style={{
            bottom: '5%',
            right: '5%',
            width: 280,
            height: 420,
            opacity: 0.03 * opacityScale,
          }}
        >
          <svg
            viewBox={door.viewBox}
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-full"
            style={{ overflow: 'visible' }}
          >
            {door.paths.map((path, i) => (
              <path
                key={i}
                d={path.d}
                stroke="var(--fg)"
                strokeWidth={path.width ?? 1.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                style={{
                  strokeDasharray: path.length,
                  strokeDashoffset: path.length,
                  animation: `bp-draw 9s cubic-bezier(0.6, 0.1, 0.2, 1) ${i * 0.3}s forwards`,
                }}
              />
            ))}
          </svg>
        </div>
      )}
    </div>
  )
}

export default memo(AegisBackgroundImpl)
export { AegisBackgroundImpl as AegisBackground }
