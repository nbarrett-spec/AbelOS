'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Zap } from 'lucide-react'

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
      {/* Premium Hero with gradient */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-abel-navy via-abel-navy/95 to-slate-900 border border-abel-navy/20">
        {/* Subtle animated background decoration */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-abel-orange/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-abel-green/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
        </div>

        {/* Content */}
        <div className="relative px-8 py-12 md:px-12 md:py-16 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          {/* Left: Greeting & Date */}
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-semibold text-abel-orange/80 uppercase tracking-wider">Welcome back</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-3 leading-tight">
              {greeting},<br className="hidden sm:block" />{firstName}
            </h1>
            <p className="text-lg text-slate-200 flex items-center gap-2">
              <span>📅</span> {date}
            </p>
          </div>

          {/* Right: CTA + Stats */}
          <div className="flex flex-col gap-4 w-full md:w-auto">
            {/* Primary CTA */}
            <Link
              href="/projects/new"
              className="group inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-abel-orange hover:bg-abel-orange/90 text-white font-semibold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 active:shadow-md"
            >
              <span>Start an Order</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>

            {/* YTD Savings badge */}
            {ytdSavings > 0 && (
              <div className="flex items-center justify-center gap-2 px-6 py-3 bg-abel-orange/10 rounded-xl border border-abel-orange/20">
                <Zap className="w-4 h-4 text-abel-orange" />
                <span className="text-sm font-semibold text-abel-orange">
                  ${(ytdSavings / 1000).toFixed(0)}k saved YTD
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
