'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'

export default function Home(): JSX.Element {
  const [mounted, setMounted] = useState<boolean>(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleNavigation = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    const href = e.currentTarget.getAttribute('href')
    if (href?.startsWith('#')) {
      e.preventDefault()
      const element = document.querySelector(href)
      element?.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <div className="min-h-screen bg-[#0a1628] text-white overflow-hidden">
      <style>{`
        @keyframes orbPulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.2; }
          50% { transform: translate(-50%, -50%) scale(1.1); opacity: 0.25; }
        }
        @keyframes gradient-shift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .orb-animation {
          animation: orbPulse 6s ease-in-out infinite;
        }
        .smooth-scroll {
          scroll-behavior: smooth;
        }
      `}</style>

      {/* Navigation Bar - Sticky with Glassmorphism */}
      <nav className="fixed top-0 w-full z-50 bg-[#0a1628]/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          {/* Left Side */}
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-white">Abel Lumber</span>
            <span className="text-sm text-signal-hover font-medium">Builder Platform</span>
          </div>

          {/* Right Side */}
          <div className="flex items-center gap-6">
            <Link
              href="/ops/login"
              className="text-sm text-white/40 hover:text-white/70 transition-colors duration-200"
            >
              Staff Login
            </Link>
            <Link
              href="/login"
              className="text-sm text-white/70 hover:text-white transition-colors duration-200"
            >
              Sign In
            </Link>
            <Link
              href="/apply"
              className="bg-signal hover:bg-signal-hover text-black font-semibold px-4 py-2 rounded-lg text-sm transition-colors duration-200"
            >
              Apply Now
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center px-6 pt-20 pb-20 overflow-hidden">
        {/* Animated Gradient Orb Background */}
        {mounted && (
          <div
            className="absolute top-1/2 left-1/2 w-[600px] h-[600px] bg-gradient-to-r from-amber-500/30 via-orange-500/20 to-amber-600/30 rounded-full blur-3xl orb-animation"
            style={{
              transform: 'translate(-50%, -50%)',
            }}
          />
        )}

        <div className="relative z-10 text-center max-w-4xl mx-auto">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 mb-8">
            <div className="w-2 h-2 rounded-full bg-signal-hover animate-pulse" />
            <span className="text-sm font-medium text-signal-hover">
              AI-Powered Blueprint Intelligence
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-5xl md:text-7xl font-bold text-white leading-tight mb-4">
            Upload a Blueprint.
          </h1>
          <h2 className="text-5xl md:text-7xl font-bold text-signal-hover leading-tight mb-8">
            Get a Quote in Minutes.
          </h2>

          {/* Subtitle */}
          <p className="text-lg text-white/60 max-w-2xl mx-auto mb-12 leading-relaxed">
            Abel's AI reads your blueprints, generates accurate material takeoffs, and produces instant quotes—with your custom pricing and flexible payment terms. Built for builders who demand precision.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <Link
              href="/apply"
              className="bg-signal hover:bg-signal-hover text-black font-semibold px-8 py-4 rounded-xl text-lg transition-colors duration-200 shadow-lg shadow-amber-500/20"
            >
              Apply for Builder Account
            </Link>
            <a
              href="#how-it-works"
              onClick={handleNavigation}
              className="border border-white/20 hover:bg-white/5 text-white font-semibold px-8 py-4 rounded-xl text-lg transition-all duration-200"
            >
              See How It Works
            </a>
          </div>
        </div>
      </section>

      {/* Trust Bar */}
      <section className="border-y border-white/5 bg-white/[0.02] py-12 px-6">
        <div className="max-w-7xl mx-auto">
          <p className="text-center text-white/40 text-sm mb-8">
            Trusted by builders across DFW
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { number: '500+', label: 'Jobs Completed' },
              { number: '15+', label: 'Years in Business' },
              { number: '$10M+', label: 'in Materials' },
              { number: '98%', label: 'On-Time Delivery' },
            ].map((stat: { number: string; label: string }, index: number) => (
              <div key={index} className="text-center">
                <p className="text-2xl font-bold text-white">{stat.number}</p>
                <p className="text-sm text-white/50 mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-16">
            How It Works
          </h2>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: '1',
                title: 'Upload Blueprint',
                desc: 'Drop your PDF floor plan and our AI reads every door, trim, and hardware spec with precision.',
                color: 'from-blue-500/20',
                dotColor: 'bg-blue-500',
              },
              {
                step: '2',
                title: 'Review AI Takeoff',
                desc: 'Get a room-by-room material list with confidence scores. Edit or approve in seconds.',
                color: 'from-amber-500/20',
                dotColor: 'bg-signal',
              },
              {
                step: '3',
                title: 'Get Your Quote',
                desc: 'Instant pricing with your negotiated terms applied. Customize doors, upgrades, and extras.',
                color: 'from-emerald-500/20',
                dotColor: 'bg-emerald-500',
              },
            ].map((item: { step: string; title: string; desc: string; color: string; dotColor: string }, index: number) => (
              <div
                key={index}
                className={`group relative bg-gradient-to-br ${item.color} to-transparent border border-white/[0.06] rounded-2xl p-8 hover:border-white/10 transition-all duration-300 hover:scale-[1.01]`}
              >
                {/* Top border glow */}
                <div
                  className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-${item.dotColor.split('-')[1]}-500 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300`}
                />

                {/* Step Number */}
                <div
                  className={`w-12 h-12 rounded-full ${item.dotColor} flex items-center justify-center text-white font-bold text-lg mb-6`}
                >
                  {item.step}
                </div>

                <h3 className="text-xl font-semibold text-white mb-3">
                  {item.title}
                </h3>
                <p className="text-white/60 leading-relaxed">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 px-6 bg-white/[0.01]">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-white mb-16">
            Why Builders Choose Abel
          </h2>

          <div className="grid md:grid-cols-2 gap-8">
            {[
              {
                title: 'AI Blueprint Vision',
                desc: 'Our AI reads every door, trim, and hardware spec from your PDF with industry-leading accuracy. No manual data entry.',
              },
              {
                title: 'Instant Pricing',
                desc: 'Real-time quotes with your negotiated payment terms and volume discounts applied automatically.',
              },
              {
                title: 'Track Every Order',
                desc: 'From quote to delivery, full visibility into your projects. Real-time status updates and delivery tracking.',
              },
              {
                title: 'Flexible Payment Terms',
                desc: 'Pay at Order (3% discount), On Delivery, Net 15, or Net 30. Choose what works for your cash flow.',
              },
            ].map((feature: { title: string; desc: string }, index: number) => (
              <div
                key={index}
                className="bg-gradient-to-br from-white/[0.03] to-transparent border border-white/[0.05] rounded-2xl p-8 hover:border-white/10 transition-all duration-300 hover:scale-[1.01]"
              >
                <h3 className="text-xl font-semibold text-white mb-3">
                  {feature.title}
                </h3>
                <p className="text-white/60 leading-relaxed">
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Payment Terms Section */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-12">
            Flexible Payment Terms
          </h2>

          <div className="grid md:grid-cols-4 gap-6">
            {[
              {
                term: 'Pay at Order',
                perk: '3% Discount',
                badge: 'emerald',
              },
              {
                term: 'Pay on Delivery',
                perk: 'Standard',
                badge: 'white',
              },
              {
                term: 'Net 15',
                perk: '1% Premium',
                badge: 'amber',
              },
              {
                term: 'Net 30',
                perk: '2.5% Premium',
                badge: 'orange',
              },
            ].map((item: { term: string; perk: string; badge: string }, index: number) => (
              <div
                key={index}
                className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-6 text-center hover:border-white/10 transition-all duration-200 hover:scale-[1.01]"
              >
                <p className="text-lg font-semibold text-white mb-2">
                  {item.term}
                </p>
                <div
                  className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                    item.badge === 'emerald'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : item.badge === 'amber'
                        ? 'bg-signal/20 text-amber-300'
                        : item.badge === 'orange'
                          ? 'bg-orange-500/20 text-orange-300'
                          : 'bg-white/10 text-white'
                  }`}
                >
                  {item.perk}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6 border-y border-white/5 bg-gradient-to-r from-amber-600/20 to-orange-600/20">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
            Ready to modernize your ordering?
          </h2>
          <p className="text-white/60 mb-8 text-lg">
            Join builders who have eliminated manual takeoffs and accelerated their quoting process.
          </p>
          <Link
            href="/apply"
            className="inline-block bg-signal hover:bg-signal-hover text-black font-semibold px-8 py-4 rounded-xl text-lg transition-colors duration-200 shadow-lg shadow-amber-500/30"
          >
            Create Free Account
          </Link>
          <p className="text-white/40 text-sm mt-6">
            No credit card required · Free blueprint analysis
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <p className="text-white/30 text-sm">
            Abel Lumber · Building Relationships Since 2010
          </p>
          <div className="flex gap-6">
            <a
              href="#"
              className="text-white/30 hover:text-white/50 transition-colors text-sm"
            >
              Contact
            </a>
            <a
              href="#"
              className="text-white/30 hover:text-white/50 transition-colors text-sm"
            >
              Privacy
            </a>
            <a
              href="#"
              className="text-white/30 hover:text-white/50 transition-colors text-sm"
            >
              Terms
            </a>
          </div>
          <Link
            href="/ops/login"
            className="text-white/30 hover:text-white/50 transition-colors text-sm"
          >
            Employee Portal
          </Link>
        </div>
      </footer>
    </div>
  )
}
