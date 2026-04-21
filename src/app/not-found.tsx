/**
 * 404 — Aegis v2 "Drafting Room" styling.
 * Navy canvas, a half-open Dutch-door blueprint (using the shared library),
 * and "Nothing here" in Playfair Display italic.
 */

import Link from 'next/link'
import BlueprintAnimation from '@/components/BlueprintAnimation'

export default function NotFound() {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-6 py-12 relative overflow-hidden"
      style={{ backgroundColor: 'var(--navy-deep, #050d16)', color: '#f5f1e8' }}
    >
      {/* Drafting grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(198,162,78,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(198,162,78,0.06) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, black 0%, transparent 100%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 70% 60% at 50% 50%, black 0%, transparent 100%)',
        }}
      />

      <div className="relative flex flex-col lg:flex-row items-center gap-12 max-w-4xl w-full">
        <div
          className="w-full max-w-[320px] mx-auto"
          style={{ color: 'var(--gold, #c6a24e)' }}
        >
          <BlueprintAnimation
            id="dutch"
            loop={false}
            duration={4200}
            strokeWidth={1.2}
            ariaLabel="An open Dutch door"
          />
        </div>

        <div className="flex-1 text-center lg:text-left">
          <p
            className="font-mono text-[10px] uppercase tracking-[0.24em] mb-3"
            style={{ color: '#c6a24e' }}
          >
            <span
              aria-hidden
              className="inline-block w-7 h-px align-middle mr-2"
              style={{ background: '#c6a24e' }}
            />
            404
          </p>
          <h1
            className="text-[44px] leading-[1.02] tracking-tight"
            style={{
              fontFamily: 'var(--font-display, Georgia, serif)',
              fontStyle: 'italic',
              color: '#f5f1e8',
            }}
          >
            Nothing here.
          </h1>
          <p className="mt-4 text-[13px] leading-relaxed max-w-md mx-auto lg:mx-0" style={{ color: '#8a9aaa' }}>
            The page you&rsquo;re looking for doesn&rsquo;t exist — or it moved.
            Let&rsquo;s get you back to somewhere useful.
          </p>

          <div className="mt-8 flex flex-wrap gap-3 justify-center lg:justify-start">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center h-10 px-5 rounded-md font-semibold text-[13px]"
              style={{
                background: 'linear-gradient(3deg, #c6a24e, #a88a3a)',
                color: '#050d16',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 16px rgba(198,162,78,0.12)',
              }}
            >
              Back to dashboard
            </Link>
            <Link
              href="/ops"
              className="inline-flex items-center justify-center h-10 px-5 rounded-md font-medium text-[13px]"
              style={{
                border: '1px solid rgba(198,162,78,0.25)',
                color: '#f5f1e8',
              }}
            >
              Ops portal
            </Link>
          </div>

          <p className="mt-8 text-[11px] font-mono" style={{ color: '#5a6a7a' }}>
            Need help? <a href="mailto:support@abellumber.com" className="underline" style={{ color: '#c6a24e' }}>support@abellumber.com</a>
          </p>
        </div>
      </div>
    </div>
  )
}
