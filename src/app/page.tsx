'use client'

/**
 * Landing page — Mockup-3 "Engineered Warmth" redesign.
 *
 * Per CLAUDE-CODE-VISUAL-HANDOFF.md Part 2. Lives at `/` (the marketing
 * surface visitors see before /apply or /login). Replaces the prior
 * dark-navy SaaS layout with the same warm canvas + indigo gradient +
 * Instrument Serif / Outfit / Azeret Mono stack used in /portal/*.
 *
 * Scope safety:
 *  - Tokens are scoped under `[data-landing]` (mirrors how /portal scopes
 *    to `[data-portal]`). Nothing leaks into /ops, /login, or /portal.
 *  - The fonts (Outfit, Azeret Mono, Instrument Serif) are already loaded
 *    globally by next/font in src/app/layout.tsx — no new dependency.
 *  - Hero is full-bleed 12s MP4 + centered single-column copy. The
 *    ExplodedDoor component lived here in earlier revs but was removed
 *    once the live video background landed — the video carries the
 *    "live door" energy on its own.
 */

import Link from 'next/link'

export default function Home(): JSX.Element {
  const handleNavigation = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    const href = e.currentTarget.getAttribute('href')
    if (href?.startsWith('#')) {
      e.preventDefault()
      const element = document.querySelector(href)
      element?.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <div data-landing className="min-h-screen overflow-hidden">
      {/* Mockup-3 token scope + multi-layer background. Inline so we don't
          pollute globals.css and so the landing page is fully portable. */}
      <style jsx global>{`
        [data-landing] {
          /* Core gradient (indigo → blue → sky → cyan) */
          --c1: #4F46E5;
          --c2: #2563EB;
          --c3: #0EA5E9;
          --c4: #06B6D4;
          --grad: linear-gradient(135deg, var(--c1), var(--c2), var(--c3));

          /* Surfaces */
          --canvas: #F6F4EE;
          --fg: #1A1817;
          --fg-muted: #5A5450;
          --fg-subtle: #8A847F;

          /* Blueprint grid */
          --bp-fine: rgba(79, 70, 229, 0.05);
          --bp-annotation: rgba(79, 70, 229, 0.25);

          /* Glass */
          --glass: rgba(255, 255, 255, 0.82);
          --glass-border: rgba(79, 70, 229, 0.12);
          --glass-blur: blur(24px) saturate(1.4);
          --glass-shadow: 0 10px 44px rgba(30, 58, 138, 0.08),
            0 0 0 1px rgba(79, 70, 229, 0.03);
          --glass-hover: 0 28px 80px rgba(30, 58, 138, 0.14),
            0 0 0 1px rgba(79, 70, 229, 0.06);

          /* Status */
          --data-positive: #0F8A4B;
          --data-positive-bg: rgba(15, 138, 75, 0.08);
          --data-warning: #B45309;
          --data-warning-bg: rgba(180, 83, 9, 0.08);

          /* Type */
          --font-sans: 'Outfit', ui-sans-serif, system-ui, -apple-system, sans-serif;
          --font-mono: 'Azeret Mono', ui-monospace, 'SF Mono', Menlo, monospace;
          --font-display: 'Instrument Serif', Georgia, 'Times New Roman', serif;

          font-family: var(--font-sans);
          color: var(--fg);
          background: var(--canvas);
          background-image:
            radial-gradient(ellipse at top right, rgba(79, 70, 229, 0.09), transparent 55%),
            radial-gradient(ellipse at bottom left, rgba(6, 182, 212, 0.07), transparent 50%),
            linear-gradient(var(--bp-fine) 1px, transparent 1px),
            linear-gradient(90deg, var(--bp-fine) 1px, transparent 1px);
          background-size: 100% 100%, 100% 100%, 24px 24px, 24px 24px;
          background-attachment: fixed;
          font-size: 15px;
          line-height: 1.55;
        }

        [data-landing] .glass-card {
          background: var(--glass);
          backdrop-filter: var(--glass-blur);
          -webkit-backdrop-filter: var(--glass-blur);
          border: 1px solid var(--glass-border);
          border-radius: 14px;
          box-shadow: var(--glass-shadow);
          transition: transform 250ms cubic-bezier(0.16, 1, 0.3, 1),
            box-shadow 250ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        [data-landing] .glass-card:hover {
          transform: translateY(-3px);
          box-shadow: var(--glass-hover);
        }
        [data-landing] .eyebrow {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.18em;
          color: var(--c1);
        }
        [data-landing] .meta-label {
          font-family: var(--font-mono);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--fg-subtle);
        }
        [data-landing] .display {
          font-family: var(--font-display);
          font-weight: 400;
          letter-spacing: -0.02em;
        }
        [data-landing] .display em {
          font-style: italic;
          background: var(--grad);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          font-weight: 400;
        }
        [data-landing] .grad-btn {
          background: var(--grad);
          color: white;
          font-family: var(--font-sans);
          font-weight: 600;
          box-shadow: 0 6px 24px rgba(79, 70, 229, 0.28);
          transition: transform 200ms, box-shadow 200ms;
        }
        [data-landing] .grad-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 12px 32px rgba(79, 70, 229, 0.36);
        }
        [data-landing] .ghost-btn {
          background: var(--glass);
          backdrop-filter: var(--glass-blur);
          -webkit-backdrop-filter: var(--glass-blur);
          border: 1px solid var(--glass-border);
          color: var(--fg);
          font-family: var(--font-sans);
          font-weight: 500;
          transition: background 200ms, border-color 200ms;
        }
        [data-landing] .ghost-btn:hover {
          background: rgba(79, 70, 229, 0.06);
          border-color: rgba(79, 70, 229, 0.25);
        }
        [data-landing] .door-halo {
          position: absolute;
          inset: -10%;
          z-index: 0;
          background: radial-gradient(
            ellipse 60% 50% at 50% 50%,
            rgba(79, 70, 229, 0.18) 0%,
            rgba(6, 182, 212, 0.10) 35%,
            transparent 70%
          );
          filter: blur(40px);
          pointer-events: none;
          animation: landing-halo 8s ease-in-out infinite alternate;
        }
        @keyframes landing-halo {
          0% { transform: scale(1); opacity: 0.85; }
          100% { transform: scale(1.05); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-landing] .door-halo,
          [data-landing] .glass-card:hover,
          [data-landing] .grad-btn:hover {
            animation: none !important;
            transform: none !important;
            transition: none !important;
          }
          /* Reduced-motion: drop the autoplay video. The warm canvas +
             gradient overlay + blueprint grid that's already painted on
             the [data-landing] root reads as the intentional fallback. */
          [data-landing] .hero-with-video video[autoplay] {
            display: none !important;
          }
        }

        /* Mobile: hero collapses to a single column. Switch the gradient
           overlay from a 135deg diagonal (favoring the left text column)
           to a 180deg top-down with a higher minimum opacity so the
           full-width text stays readable while the video still bleeds
           through at the bottom. */
        @media (max-width: 768px) {
          [data-landing] .hero-overlay {
            background: linear-gradient(
              180deg,
              rgba(246, 244, 238, 0.88) 0%,
              rgba(246, 244, 238, 0.85) 60%,
              rgba(246, 244, 238, 0.55) 100%
            ) !important;
          }
        }
      `}</style>

      {/* ── Top nav (Mockup-3 .topbar) ──────────────────────────────── */}
      <nav
        className="fixed top-0 w-full z-50"
        style={{
          height: 68,
          background: 'rgba(255, 255, 255, 0.6)',
          backdropFilter: 'blur(20px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
          borderBottom: '1px solid var(--glass-border)',
        }}
      >
        <div className="max-w-[1180px] mx-auto h-full px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* Brand mark — gradient square w/ inner border (Mockup-3) */}
            <div
              className="relative shrink-0"
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                background: 'var(--grad)',
                boxShadow: '0 6px 20px rgba(79, 70, 229, 0.3)',
              }}
              aria-hidden="true"
            >
              <span
                style={{
                  position: 'absolute',
                  inset: 5,
                  border: '1.5px solid rgba(255, 255, 255, 0.4)',
                  borderRadius: 5,
                }}
              />
            </div>
            <div className="flex flex-col leading-tight">
              <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>
                Abel Lumber
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--fg-subtle)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  marginTop: 1,
                }}
              >
                Builder Platform
              </span>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <Link
              href="/ops/login"
              className="hidden sm:inline text-sm transition-colors"
              style={{ color: 'var(--fg-subtle)' }}
            >
              Staff Login
            </Link>
            <Link
              href="/login"
              className="text-sm transition-colors"
              style={{ color: 'var(--fg-muted)', fontWeight: 500 }}
            >
              Sign In
            </Link>
            <Link
              href="/apply"
              className="grad-btn inline-flex items-center px-4 h-9 rounded-full text-sm"
            >
              Apply Now
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero — 4-layer stack (video → gradient → grid → content) ──
          Per CLAUDE-CODE-VIDEO-HERO-HANDOFF.md. Video plays under the hero
          showing slow-motion door assembly; the warm gradient overlay
          keeps text readable on the left while letting the video bleed
          through on the right. */}
      <section className="hero-with-video relative min-h-screen flex items-center justify-center px-6 pt-28 pb-16 overflow-hidden">
        {/* Layer 0 — full-bleed video (poster shows instantly, then loop) */}
        <video
          className="hero-video absolute inset-0 w-full h-full object-cover z-0"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster="/video/hero-poster.jpg"
          aria-hidden="true"
        >
          <source src="/video/hero-bg-12s.webm" type="video/webm" />
          <source src="/video/hero-bg-12s.mp4" type="video/mp4" />
        </video>

        {/* Layer 1 — asymmetric gradient overlay (strong left, faded right) */}
        <div
          className="hero-overlay absolute inset-0 z-10 pointer-events-none"
          style={{
            background:
              'linear-gradient(135deg, rgba(246,244,238,0.92) 0%, rgba(246,244,238,0.7) 40%, rgba(246,244,238,0.45) 100%)',
          }}
          aria-hidden="true"
        />

        {/* Layer 2 — 24px blueprint grid (paper texture, indigo-tinted) */}
        <div
          className="absolute inset-0 z-20 pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(rgba(79,70,229,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(79,70,229,0.05) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            opacity: 0.6,
          }}
          aria-hidden="true"
        />

        {/* Layer 3 — content (centered single column over the video) */}
        <div className="relative z-30 max-w-3xl mx-auto w-full text-center flex flex-col items-center">
          <div className="eyebrow mb-5">
            AI-Powered Blueprint Intelligence
          </div>

          <h1
            className="display"
            style={{
              fontSize: 'clamp(40px, 6.5vw, 72px)',
              lineHeight: 1.02,
              marginBottom: 22,
            }}
          >
            Upload a Blueprint.
            <br />
            Get a Quote in <em>Minutes.</em>
          </h1>

          <p
            className="mb-10"
            style={{
              maxWidth: '36rem',
              fontSize: 17,
              color: 'var(--fg-muted)',
              lineHeight: 1.55,
            }}
          >
            Abel&apos;s AI reads your blueprints, generates accurate
            material takeoffs, and produces instant quotes — with your
            custom pricing and flexible payment terms.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/apply"
              className="grad-btn inline-flex items-center justify-center px-7 h-12 rounded-xl text-[15px]"
            >
              Apply for Builder Account
            </Link>
            <a
              href="#how-it-works"
              onClick={handleNavigation}
              className="ghost-btn inline-flex items-center justify-center px-7 h-12 rounded-xl text-[15px]"
            >
              See How It Works
            </a>
          </div>
        </div>
      </section>

      {/* ── Trust strip — Mockup-3 summary-card pattern ────────────── */}
      <section className="relative px-6 py-10">
        <div className="max-w-[1180px] mx-auto">
          <p className="meta-label text-center mb-6">
            Trusted by builders across DFW
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { number: '500+', label: 'Jobs Completed', accent: 'var(--c1)' },
              { number: '15+', label: 'Years in Business', accent: 'var(--c2)' },
              { number: '$10M+', label: 'in Materials', accent: 'var(--c3)' },
              { number: '98%', label: 'On-Time Delivery', accent: 'var(--c4)' },
            ].map((s) => (
              <div
                key={s.label}
                className="glass-card relative overflow-hidden p-5 text-center"
                style={{ borderRadius: 14 }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: 0,
                    width: 2,
                    background: s.accent,
                  }}
                />
                <div
                  className="display"
                  style={{
                    fontSize: 'clamp(28px, 4vw, 40px)',
                    lineHeight: 1,
                    fontVariantNumeric: 'tabular-nums',
                    marginBottom: 4,
                    color: 'var(--fg)',
                  }}
                >
                  {s.number}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--fg-muted)',
                  }}
                >
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ────────────────────────────────────────────── */}
      <section id="how-it-works" className="relative px-6 py-20">
        <div className="max-w-[1180px] mx-auto">
          <div className="flex items-baseline justify-between flex-wrap gap-4 mb-12">
            <div>
              <div className="eyebrow mb-2">Three Steps</div>
              <h2
                className="display"
                style={{ fontSize: 'clamp(28px, 4vw, 40px)' }}
              >
                How It Works
              </h2>
            </div>
            <div className="meta-label">Quote in &lt; 5 min</div>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                step: '01',
                title: 'Upload Blueprint',
                desc: 'Drop your PDF floor plan. Our AI reads every door, trim, and hardware spec with precision — no manual entry.',
              },
              {
                step: '02',
                title: 'Review AI Takeoff',
                desc: 'Get a room-by-room material list with confidence scores. Edit or approve in seconds.',
              },
              {
                step: '03',
                title: 'Get Your Quote',
                desc: 'Instant pricing with your negotiated terms applied. Customize doors, upgrades, and extras.',
              },
            ].map((item) => (
              <div key={item.step} className="glass-card p-7" style={{ borderRadius: 16 }}>
                <div
                  className="meta-label"
                  style={{ color: 'var(--c1)', marginBottom: 14 }}
                >
                  Step {item.step}
                </div>
                <h3
                  className="display"
                  style={{
                    fontSize: 24,
                    lineHeight: 1.2,
                    marginBottom: 10,
                    color: 'var(--fg)',
                  }}
                >
                  {item.title}
                </h3>
                <p
                  style={{
                    fontSize: 15,
                    color: 'var(--fg-muted)',
                    lineHeight: 1.55,
                  }}
                >
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why Builders Choose Abel ────────────────────────────────── */}
      <section className="relative px-6 py-20">
        <div className="max-w-[1180px] mx-auto">
          <div className="flex items-baseline justify-between flex-wrap gap-4 mb-12">
            <div>
              <div className="eyebrow mb-2">Built for Production</div>
              <h2
                className="display"
                style={{ fontSize: 'clamp(28px, 4vw, 40px)' }}
              >
                Why Builders Choose Abel
              </h2>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            {[
              {
                title: 'AI Blueprint Vision',
                desc: 'Our AI reads every door, trim, and hardware spec from your PDF with industry-leading accuracy. No manual data entry, no missed pieces.',
              },
              {
                title: 'Instant Pricing',
                desc: 'Real-time quotes with your negotiated payment terms and volume discounts applied automatically.',
              },
              {
                title: 'Track Every Order',
                desc: 'From quote to delivery, full visibility into your projects. Real-time status updates and live delivery ETAs.',
              },
              {
                title: 'Flexible Payment Terms',
                desc: 'Pay at Order (3% discount), On Delivery, Net 15, or Net 30. Choose what works for your cash flow.',
              },
            ].map((f) => (
              <div key={f.title} className="glass-card p-7" style={{ borderRadius: 16 }}>
                <h3
                  className="display"
                  style={{
                    fontSize: 22,
                    lineHeight: 1.2,
                    marginBottom: 10,
                    color: 'var(--fg)',
                  }}
                >
                  {f.title}
                </h3>
                <p
                  style={{
                    fontSize: 15,
                    color: 'var(--fg-muted)',
                    lineHeight: 1.55,
                  }}
                >
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Payment Terms ───────────────────────────────────────────── */}
      <section className="relative px-6 py-20">
        <div className="max-w-[1180px] mx-auto">
          <div className="flex items-baseline justify-between flex-wrap gap-4 mb-10">
            <div>
              <div className="eyebrow mb-2">Cash-Flow Friendly</div>
              <h2
                className="display"
                style={{ fontSize: 'clamp(28px, 4vw, 40px)' }}
              >
                Flexible Payment Terms
              </h2>
            </div>
          </div>

          <div className="grid md:grid-cols-4 gap-4">
            {[
              { term: 'Pay at Order', perk: '3% Discount', tone: 'positive' as const },
              { term: 'Pay on Delivery', perk: 'Standard', tone: 'neutral' as const },
              { term: 'Net 15', perk: '1% Premium', tone: 'warning' as const },
              { term: 'Net 30', perk: '2.5% Premium', tone: 'warning' as const },
            ].map((p) => {
              const accent =
                p.tone === 'positive'
                  ? 'var(--data-positive)'
                  : p.tone === 'warning'
                    ? 'var(--data-warning)'
                    : 'var(--c3)'
              const bg =
                p.tone === 'positive'
                  ? 'var(--data-positive-bg)'
                  : p.tone === 'warning'
                    ? 'var(--data-warning-bg)'
                    : 'rgba(14,165,233,0.10)'
              return (
                <div
                  key={p.term}
                  className="glass-card relative overflow-hidden p-5 text-center"
                  style={{ borderRadius: 14 }}
                >
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: 0,
                      width: 2,
                      background: accent,
                    }}
                  />
                  <div
                    className="display"
                    style={{
                      fontSize: 22,
                      lineHeight: 1.2,
                      marginBottom: 10,
                      color: 'var(--fg)',
                    }}
                  >
                    {p.term}
                  </div>
                  <span
                    className="inline-flex items-center px-2.5 py-[3px] rounded-full uppercase"
                    style={{
                      background: bg,
                      color: accent,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: '0.12em',
                    }}
                  >
                    {p.perk}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── CTA — full-width glass card with gradient tint overlay ──── */}
      <section className="relative px-6 py-16">
        <div className="max-w-[1180px] mx-auto">
          <div
            className="glass-card relative overflow-hidden p-10 md:p-14"
            style={{ borderRadius: 20 }}
          >
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                background: 'var(--grad)',
                opacity: 0.04,
                pointerEvents: 'none',
              }}
            />
            <div className="relative grid md:grid-cols-[1.6fr_1fr] gap-8 items-center">
              <div>
                <div className="eyebrow mb-3">Ready When You Are</div>
                <h2
                  className="display mb-4"
                  style={{
                    fontSize: 'clamp(28px, 4vw, 40px)',
                    lineHeight: 1.05,
                  }}
                >
                  Modernize how you order doors, trim, and hardware.
                </h2>
                <p
                  style={{
                    fontSize: 16,
                    color: 'var(--fg-muted)',
                    lineHeight: 1.55,
                  }}
                >
                  Join the DFW builders who&apos;ve eliminated manual takeoffs
                  and accelerated their quoting process.
                </p>
              </div>
              <div className="flex flex-col gap-3 md:items-end">
                <Link
                  href="/apply"
                  className="grad-btn inline-flex items-center justify-center px-7 h-12 rounded-xl text-[15px] w-full md:w-auto"
                >
                  Create Free Account
                </Link>
                <p
                  className="meta-label"
                  style={{ textAlign: 'center' }}
                >
                  No credit card · Free analysis
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer — dashed bp-annotation ──────────────────────────── */}
      <footer
        className="relative px-6 py-8"
        style={{ borderTop: '1px dashed var(--bp-annotation)' }}
      >
        <div className="max-w-[1180px] mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="meta-label">
            Abel Lumber · Doors, Trim &amp; Hardware · DFW Since 2010
          </p>
          <div className="flex gap-6">
            <a
              href="#"
              className="meta-label hover:opacity-100 transition-opacity"
              style={{ opacity: 0.7 }}
            >
              Contact
            </a>
            <a
              href="#"
              className="meta-label hover:opacity-100 transition-opacity"
              style={{ opacity: 0.7 }}
            >
              Privacy
            </a>
            <a
              href="#"
              className="meta-label hover:opacity-100 transition-opacity"
              style={{ opacity: 0.7 }}
            >
              Terms
            </a>
          </div>
          <Link
            href="/ops/login"
            className="meta-label hover:opacity-100 transition-opacity"
            style={{ opacity: 0.7 }}
          >
            Employee Portal
          </Link>
        </div>
      </footer>
    </div>
  )
}
