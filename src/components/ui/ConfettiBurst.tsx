'use client'

/**
 * ConfettiBurst — brief celebratory particle burst (#54).
 * Triggers on mount, auto-cleans after 1.5s. Tasteful, not Candy Crush.
 */

import { useEffect, useState, memo } from 'react'

const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', '#10B981', '#F59E0B']
const PARTICLE_COUNT = 24

interface Particle {
  id: number
  x: number
  y: number
  color: string
  size: number
  angle: number
  velocity: number
  rotation: number
}

function ConfettiBurstImpl({ active = true }: { active?: boolean }) {
  const [particles, setParticles] = useState<Particle[]>([])
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!active) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const p: Particle[] = Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      id: i,
      x: 50 + (Math.random() - 0.5) * 10,
      y: 50 + (Math.random() - 0.5) * 10,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: 4 + Math.random() * 6,
      angle: (Math.PI * 2 * i) / PARTICLE_COUNT + (Math.random() - 0.5) * 0.5,
      velocity: 3 + Math.random() * 4,
      rotation: Math.random() * 720,
    }))

    setParticles(p)
    setVisible(true)

    const t = setTimeout(() => setVisible(false), 1500)
    return () => clearTimeout(t)
  }, [active])

  if (!visible || particles.length === 0) return null

  return (
    <div
      className="fixed inset-0 pointer-events-none z-[100]"
      aria-hidden="true"
    >
      {particles.map((p) => (
        <div
          key={p.id}
          style={{
            position: 'absolute',
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: Math.random() > 0.5 ? '50%' : '2px',
            animation: `confetti-fall 1.2s ease-out forwards`,
            animationDelay: `${Math.random() * 0.2}s`,
            transform: `translate(${Math.cos(p.angle) * p.velocity * 40}px, ${Math.sin(p.angle) * p.velocity * 40}px) rotate(${p.rotation}deg)`,
          }}
        />
      ))}
    </div>
  )
}

export default memo(ConfettiBurstImpl)
