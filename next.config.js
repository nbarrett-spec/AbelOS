const { withSentryConfig } = require('@sentry/nextjs')

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: true, // TODO: enable once lint errors are fixed
  },
  // Suppress useSearchParams() Suspense boundary warnings during build
  experimental: {
    missingSuspenseWithCSRBailout: false,
  },
  // Disable x-powered-by header
  poweredByHeader: false,

  // Image optimization configuration for external URLs
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' }
    ],
  },

  async headers() {
    const isProduction = process.env.NODE_ENV === 'production'

    // Base security headers applied to all routes
    const baseHeaders = [
      // Prevent MIME type sniffing
      { key: 'X-Content-Type-Options', value: 'nosniff' },

      // Clickjacking protection — DENY to match middleware-level setting
      { key: 'X-Frame-Options', value: 'DENY' },

      // Referrer Policy: only send referrer to same-origin requests
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

      // Permissions Policy: disable sensitive APIs by default
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(self), interest-cohort=()',
      },

      // DNS prefetch enabled for performance
      { key: 'X-DNS-Prefetch-Control', value: 'on' },

      // XSS protection (legacy, but still helpful for older browsers)
      { key: 'X-XSS-Protection', value: '1; mode=block' },

      // Strict Transport Security (only in production, max-age = 2 years)
      ...(isProduction ? [{
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      }] : [{
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains',
      }]),

      // Content-Security-Policy
      // Next.js App Router inlines RSC payloads as <script> tags, so
      // 'unsafe-inline' and 'unsafe-eval' are required in script-src.
      // We keep the existing Neon allowlist for any client-side connections
      // and add Sentry/Vercel Insights as additive improvements.
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.sentry.io https://*.vercel-insights.com",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data: https://fonts.gstatic.com",
          "connect-src 'self' https://ep-aged-sun-ansm1q2l-pooler.c-6.us-east-1.aws.neon.tech https://*.neon.tech https://*.sentry.io https://*.ingest.sentry.io https://*.vercel-insights.com wss:",
          "frame-src 'self'",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; '),
      },
    ]

    return [
      // Security headers for all routes
      {
        source: '/:path*',
        headers: baseHeaders,
      },

      // Cache static assets aggressively (1 year, immutable)
      {
        source: '/_next/static/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },

      // Cache images for 1 year
      {
        source: '/images/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },

      // Cache public assets for 1 month
      {
        source: '/public/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=2592000',
          },
        ],
      },
    ]
  },

  // Redirect www to non-www
  async redirects() {
    return []
  },
}

module.exports = process.env.SENTRY_DSN
  ? withSentryConfig(nextConfig, { silent: true })
  : nextConfig
