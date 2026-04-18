'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Zap, Sparkles } from 'lucide-react'
import Button from '@/components/ui/Button'

interface HeroSectionProps {
  firstName?: string
  ytdSavings: number
}

function getTimeGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function getCurrentDate(): string {
  const now = new Date()
  return now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export default function HeroSection({ firstName = 'Builder', ytdSavings }: HeroSectionProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const greeting = getTimeGreeting()
  const date = getCurrentDate()

  return (
    <div className={`transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-abel-navy via-[#1a4065] to-[#0d2840]">
        {/* ── Decorative layers ───────────────────────────────── */}
        <div className="absolute inset-0 pointer-events-none">
          {/* Warm glow */}
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-abel-orange/8 rounded-full blur-[120px] -translate-y-1/3 translate-x-1/4" />
          <div className="absolute bottom-0 left-1/4 w-[300px] h-[300px] bg-abel-navy-light/15 rounded-full blur-[80px] translate-y-1/3" />

          {/* Dot grid pattern */}
          <svg className="absolute inset-0 w-full h-full opacity-[0.03]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="hero-dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1" fill="white" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#hero-dots)" />
          </svg>

          {/* Diagonal accent line */}
          <div className="absolute top-0 right-[30%] w-px h-full bg-gradient-to-b from-transparent via-white/5 to-transparent rotate-12 origin-top" />
        </div>

        {/* ── Content ─────────────────────────────────────────── */}
        <div className="relative px-7 py-10 md:px-10 md:py-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          {/* Left */}
          <div className="flex-1">
            <p className="text-sm font-semibold text-abel-orange/90 tracking-wide uppercase mb-1.5 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Welcome back
            </p>
            <h1 className="text-3xl md:text-4xl font-bold text-white leading-tight tracking-tight">
              {greeting}, {firstName}
            </h1>
            <p className="mt-2 text-base text-white/50 font-medium">{date}</p>
          </div>

          {/* Right */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
            {/* YTD Savings pill */}
            {ytdSavings > 0 && (
              <div className="flex items-center justify-center gap-2 px-5 py-2.5 bg-white/[0.06] backdrop-blur-sm rounded-xl border border-white/10 order-2 sm:order-1">
                <Zap className="w-4 h-4 text-abel-orange" />
                <span className="text-sm font-bold text-white">
                  ${(ytdSavings / 1000).toFixed(0)}k
                </span>
                <span className="text-sm text-white/50">saved YTD</span>
              </div>
            )}

            {/* Primary CTA */}
            <Link href="/projects/new" className="order-1 sm:order-2">
              <Button
                variant="accent"
                size="lg"
                icon={<ArrowRight className="w-4.5 h-4.5" />}

                className="w-full sm:w-auto shadow-lg shadow-abel-orange/25 hover:shadow-xl hover:shadow-abel-orange/30"
              >
                Start an Order
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
