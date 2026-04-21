'use client'

/**
 * PortalBackground — unique animated SVG background per portal type.
 *
 * Each portal gets its own blueprint-style line-drawn illustration that
 * draws in on mount using stroke-dashoffset animation. All elements render
 * at ~5% opacity so they're atmospheric, not distracting.
 *
 * Portals:
 *   ops       → Workflow flowchart (nodes + arrows)
 *   sales     → Pipeline funnel with trickling deals
 *   dashboard → Door + frame blueprint elevation
 *   homeowner → House front elevation
 *   admin     → Gears + circuit board traces
 */

import { memo } from 'react'

export type PortalType = 'ops' | 'sales' | 'dashboard' | 'homeowner' | 'admin'

interface PortalBackgroundProps {
  portal: PortalType
  className?: string
}

// Shared animation style for stroke draw-in
const drawStyle = (length: number, delay: number = 0, width: number = 1.2) => ({
  strokeDasharray: length,
  strokeDashoffset: length,
  animation: `bp-draw 6s cubic-bezier(0.6, 0.1, 0.2, 1) ${delay}s forwards`,
  strokeWidth: width,
  stroke: 'var(--fg)',
  fill: 'none',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

// Floating element style
const floatStyle = (delay: number = 0) => ({
  animation: `orb-float 20s ease-in-out ${delay}s infinite`,
})

/* ── OPS: Workflow flowchart ────────────────────────────────────────── */
function OpsBackground() {
  return (
    <svg viewBox="0 0 800 600" className="w-full h-full portal-bg-element">
      {/* Node 1 — Start */}
      <rect x="100" y="80" width="120" height="50" rx="8" style={drawStyle(340, 0)} />
      <line x1="220" y1="105" x2="300" y2="105" style={drawStyle(80, 0.5)} />
      {/* Arrow */}
      <polyline points="290,98 300,105 290,112" style={drawStyle(20, 0.6)} />

      {/* Node 2 — Process */}
      <rect x="300" y="80" width="140" height="50" rx="8" style={drawStyle(380, 0.8)} />
      <line x1="440" y1="105" x2="520" y2="105" style={drawStyle(80, 1.2)} />
      <polyline points="510,98 520,105 510,112" style={drawStyle(20, 1.3)} />

      {/* Node 3 — Decision diamond */}
      <polygon points="590,60 660,105 590,150 520,105" style={drawStyle(280, 1.5)} />

      {/* Branch down */}
      <line x1="590" y1="150" x2="590" y2="230" style={drawStyle(80, 2.0)} />
      <polyline points="583,220 590,230 597,220" style={drawStyle(20, 2.1)} />

      {/* Node 4 — Action */}
      <rect x="520" y="230" width="140" height="50" rx="8" style={drawStyle(380, 2.3)} />

      {/* Branch right */}
      <line x1="660" y1="105" x2="740" y2="105" style={drawStyle(80, 2.0)} />
      <polyline points="730,98 740,105 730,112" style={drawStyle(20, 2.1)} />

      {/* Node 5 — End */}
      <rect x="740" y="80" width="100" height="50" rx="25" style={drawStyle(300, 2.5)} />

      {/* Lower flow */}
      <line x1="660" y1="255" x2="740" y2="255" style={drawStyle(80, 2.8)} />
      <rect x="740" y="230" width="100" height="50" rx="8" style={drawStyle(300, 3.0)} />

      {/* Connecting dashed lines */}
      <line x1="790" y1="280" x2="790" y2="350" style={{ ...drawStyle(70, 3.5), strokeDasharray: '6,4' }} />
      <rect x="720" y="350" width="140" height="50" rx="8" style={drawStyle(360, 3.8)} />

      {/* Floating pulse nodes */}
      <circle cx="160" cy="105" r="4" style={{ fill: 'var(--c1)', opacity: 0.3, ...floatStyle(0) }} />
      <circle cx="370" cy="105" r="4" style={{ fill: 'var(--c2)', opacity: 0.3, ...floatStyle(-5) }} />
      <circle cx="590" cy="255" r="4" style={{ fill: 'var(--c3)', opacity: 0.3, ...floatStyle(-10) }} />
    </svg>
  )
}

/* ── SALES: Pipeline funnel with deals ──────────────────────────────── */
function SalesBackground() {
  return (
    <svg viewBox="0 0 800 600" className="w-full h-full portal-bg-element">
      {/* Funnel outline */}
      <path d="M200,60 L600,60 L500,250 L480,400 L320,400 L300,250 Z" style={drawStyle(1200, 0, 1.5)} />

      {/* Stage lines */}
      <line x1="230" y1="120" x2="570" y2="120" style={{ ...drawStyle(340, 0.8), strokeDasharray: '8,4' }} />
      <line x1="275" y1="185" x2="525" y2="185" style={{ ...drawStyle(250, 1.2), strokeDasharray: '8,4' }} />
      <line x1="305" y1="250" x2="495" y2="250" style={{ ...drawStyle(190, 1.6), strokeDasharray: '8,4' }} />
      <line x1="325" y1="325" x2="475" y2="325" style={{ ...drawStyle(150, 2.0), strokeDasharray: '8,4' }} />

      {/* Trickling deal circles — float animation */}
      <circle cx="350" cy="90" r="6" style={{ fill: 'var(--c1)', opacity: 0.2, ...floatStyle(0) }} />
      <circle cx="450" cy="90" r="5" style={{ fill: 'var(--c2)', opacity: 0.2, ...floatStyle(-3) }} />
      <circle cx="400" cy="85" r="7" style={{ fill: 'var(--c3)', opacity: 0.2, ...floatStyle(-6) }} />
      <circle cx="380" cy="150" r="5" style={{ fill: 'var(--c1)', opacity: 0.15, ...floatStyle(-2) }} />
      <circle cx="430" cy="155" r="4" style={{ fill: 'var(--c2)', opacity: 0.15, ...floatStyle(-8) }} />
      <circle cx="400" cy="210" r="5" style={{ fill: 'var(--c3)', opacity: 0.12, ...floatStyle(-4) }} />
      <circle cx="370" cy="280" r="4" style={{ fill: 'var(--c1)', opacity: 0.1, ...floatStyle(-7) }} />
      <circle cx="400" cy="360" r="5" style={{ fill: 'var(--c4)', opacity: 0.15, ...floatStyle(-1) }} />

      {/* Dollar sign watermarks */}
      <text x="650" y="200" style={{ fontSize: '48px', fill: 'var(--c1)', opacity: 0.04, fontFamily: 'var(--font-mono-stack)', ...floatStyle(-5) }}>$</text>
      <text x="120" y="350" style={{ fontSize: '36px', fill: 'var(--c3)', opacity: 0.03, fontFamily: 'var(--font-mono-stack)', ...floatStyle(-10) }}>$</text>
      <text x="680" y="420" style={{ fontSize: '28px', fill: 'var(--c2)', opacity: 0.03, fontFamily: 'var(--font-mono-stack)', ...floatStyle(-15) }}>$</text>
    </svg>
  )
}

/* ── DASHBOARD: Door + frame blueprint ──────────────────────────────── */
function DashboardBackground() {
  return (
    <svg viewBox="0 0 800 600" className="w-full h-full portal-bg-element">
      {/* Door frame outer */}
      <rect x="250" y="40" width="300" height="520" rx="2" style={drawStyle(1640, 0, 1.5)} />

      {/* Door panel */}
      <rect x="270" y="60" width="260" height="480" rx="2" style={drawStyle(1480, 0.5)} />

      {/* Upper panel detail */}
      <rect x="300" y="90" width="200" height="160" rx="2" style={drawStyle(720, 1.0)} />

      {/* Lower panel detail */}
      <rect x="300" y="300" width="200" height="200" rx="2" style={drawStyle(800, 1.5)} />

      {/* Handle/knob */}
      <circle cx="490" cy="320" r="8" style={drawStyle(50, 2.0, 1.5)} />
      <circle cx="490" cy="320" r="3" style={drawStyle(19, 2.2, 1)} />

      {/* Hinges */}
      <rect x="272" y="120" width="8" height="20" rx="2" style={drawStyle(56, 2.5)} />
      <rect x="272" y="420" width="8" height="20" rx="2" style={drawStyle(56, 2.7)} />

      {/* Dimension lines */}
      <line x1="230" y1="40" x2="230" y2="560" style={{ ...drawStyle(520, 3.0, 0.8), strokeDasharray: '4,4' }} />
      <line x1="225" y1="40" x2="235" y2="40" style={drawStyle(10, 3.0, 0.8)} />
      <line x1="225" y1="560" x2="235" y2="560" style={drawStyle(10, 3.0, 0.8)} />

      <line x1="250" y1="575" x2="550" y2="575" style={{ ...drawStyle(300, 3.3, 0.8), strokeDasharray: '4,4' }} />
      <line x1="250" y1="570" x2="250" y2="580" style={drawStyle(10, 3.3, 0.8)} />
      <line x1="550" y1="570" x2="550" y2="580" style={drawStyle(10, 3.3, 0.8)} />

      {/* Hardware detail — deadbolt */}
      <rect x="484" y="280" width="12" height="24" rx="3" style={drawStyle(72, 3.5)} />
    </svg>
  )
}

/* ── HOMEOWNER: House front elevation ───────────────────────────────── */
function HomeownerBackground() {
  return (
    <svg viewBox="0 0 800 600" className="w-full h-full portal-bg-element">
      {/* House body */}
      <rect x="200" y="250" width="400" height="300" rx="2" style={drawStyle(1400, 0, 1.5)} />

      {/* Roof */}
      <path d="M170,250 L400,80 L630,250" style={drawStyle(700, 0.5, 1.5)} />

      {/* Front door (hero element — it IS what we sell) */}
      <rect x="350" y="370" width="100" height="180" rx="3" style={drawStyle(560, 1.0, 2)} />
      <rect x="365" y="385" width="70" height="60" rx="2" style={drawStyle(260, 1.5)} />
      <rect x="365" y="460" width="70" height="70" rx="2" style={drawStyle(280, 1.8)} />
      <circle cx="435" cy="470" r="5" style={drawStyle(31, 2.2)} />

      {/* Left window */}
      <rect x="230" y="310" width="80" height="70" rx="2" style={drawStyle(300, 2.0)} />
      <line x1="270" y1="310" x2="270" y2="380" style={drawStyle(70, 2.3)} />
      <line x1="230" y1="345" x2="310" y2="345" style={drawStyle(80, 2.4)} />

      {/* Right window */}
      <rect x="490" y="310" width="80" height="70" rx="2" style={drawStyle(300, 2.0)} />
      <line x1="530" y1="310" x2="530" y2="380" style={drawStyle(70, 2.3)} />
      <line x1="490" y1="345" x2="570" y2="345" style={drawStyle(80, 2.4)} />

      {/* Chimney */}
      <rect x="500" y="120" width="40" height="100" rx="2" style={drawStyle(280, 3.0)} />

      {/* Landscaping */}
      <ellipse cx="160" cy="545" rx="50" ry="25" style={{ ...drawStyle(160, 3.5, 0.8), strokeDasharray: '4,4' }} />
      <ellipse cx="640" cy="545" rx="50" ry="25" style={{ ...drawStyle(160, 3.7, 0.8), strokeDasharray: '4,4' }} />

      {/* Ground line */}
      <line x1="100" y1="550" x2="700" y2="550" style={drawStyle(600, 3.2, 0.8)} />
    </svg>
  )
}

/* ── ADMIN: Gears + circuit board ───────────────────────────────────── */
function AdminBackground() {
  return (
    <svg viewBox="0 0 800 600" className="w-full h-full portal-bg-element">
      {/* Large gear */}
      <circle cx="300" cy="250" r="80" style={drawStyle(502, 0, 1.5)} />
      <circle cx="300" cy="250" r="60" style={drawStyle(377, 0.3)} />
      <circle cx="300" cy="250" r="15" style={drawStyle(94, 0.5)} />
      {/* Gear teeth (simplified as outer bumps) */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => {
        const rad = (angle * Math.PI) / 180
        const x1 = 300 + 78 * Math.cos(rad)
        const y1 = 250 + 78 * Math.sin(rad)
        const x2 = 300 + 95 * Math.cos(rad)
        const y2 = 250 + 95 * Math.sin(rad)
        return (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
            style={drawStyle(17, 0.8 + i * 0.1, 3)} />
        )
      })}

      {/* Small gear (interlocking) */}
      <circle cx="430" cy="320" r="50" style={drawStyle(314, 1.5)} />
      <circle cx="430" cy="320" r="35" style={drawStyle(220, 1.8)} />
      <circle cx="430" cy="320" r="10" style={drawStyle(63, 2.0)} />
      {[0, 60, 120, 180, 240, 300].map((angle, i) => {
        const rad = (angle * Math.PI) / 180
        const x1 = 430 + 48 * Math.cos(rad)
        const y1 = 320 + 48 * Math.sin(rad)
        const x2 = 430 + 62 * Math.cos(rad)
        const y2 = 320 + 62 * Math.sin(rad)
        return (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
            style={drawStyle(14, 2.2 + i * 0.1, 2.5)} />
        )
      })}

      {/* Circuit traces */}
      <path d="M430,270 L430,150 L550,150 L550,200" style={drawStyle(240, 3.0)} />
      <path d="M480,320 L600,320 L600,250 L680,250" style={drawStyle(270, 3.3)} />
      <path d="M300,170 L300,100 L500,100" style={drawStyle(300, 3.5)} />
      <path d="M430,370 L430,450 L350,450 L350,500" style={drawStyle(230, 3.8)} />
      <path d="M240,250 L150,250 L150,400 L250,400" style={drawStyle(300, 4.0)} />

      {/* Circuit nodes */}
      <circle cx="550" cy="200" r="4" style={{ fill: 'var(--c1)', opacity: 0.3, ...floatStyle(0) }} />
      <circle cx="680" cy="250" r="4" style={{ fill: 'var(--c2)', opacity: 0.3, ...floatStyle(-3) }} />
      <circle cx="500" cy="100" r="4" style={{ fill: 'var(--c3)', opacity: 0.3, ...floatStyle(-6) }} />
      <circle cx="350" cy="500" r="4" style={{ fill: 'var(--c4)', opacity: 0.3, ...floatStyle(-9) }} />
      <circle cx="250" cy="400" r="4" style={{ fill: 'var(--c1)', opacity: 0.3, ...floatStyle(-12) }} />

      {/* Data flow pulses along traces */}
      <circle cx="0" cy="0" r="3" style={{ fill: 'var(--c2)', opacity: 0.4 }}>
        <animateMotion dur="4s" repeatCount="indefinite" path="M430,270 L430,150 L550,150 L550,200" />
      </circle>
      <circle cx="0" cy="0" r="3" style={{ fill: 'var(--c3)', opacity: 0.4 }}>
        <animateMotion dur="5s" repeatCount="indefinite" path="M480,320 L600,320 L600,250 L680,250" />
      </circle>
    </svg>
  )
}

/* ── Map portal type → component ────────────────────────────────────── */
const PORTAL_MAP: Record<PortalType, React.FC> = {
  ops: OpsBackground,
  sales: SalesBackground,
  dashboard: DashboardBackground,
  homeowner: HomeownerBackground,
  admin: AdminBackground,
}

function PortalBackgroundImpl({ portal, className = '' }: PortalBackgroundProps) {
  const PortalSVG = PORTAL_MAP[portal]
  if (!PortalSVG) return null

  return (
    <div
      className={`fixed inset-0 pointer-events-none overflow-hidden ${className}`}
      style={{ zIndex: 0, opacity: 0.05 }}
      aria-hidden="true"
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-[80vw] h-[80vh] max-w-[1200px] max-h-[800px]">
          <PortalSVG />
        </div>
      </div>
    </div>
  )
}

export default memo(PortalBackgroundImpl)
export { PortalBackgroundImpl as PortalBackground }
export type { PortalBackgroundProps }
