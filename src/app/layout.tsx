import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import './globals.css'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { ToastContainer } from '@/components/ToastContainer'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#3E2A1E' }],
  colorScheme: 'light dark',
}

export const metadata: Metadata = {
  metadataBase: new URL('https://app.abellumber.com'),
  title: {
    default: 'Aegis | AI Blueprint Intelligence for Builders',
    template: '%s | Aegis',
  },
  description: 'Aegis delivers AI-powered blueprint analysis and instant material quotes for builders. Upload your plans, get accurate takeoffs and pricing in minutes.',
  keywords: [
    'blueprint analysis',
    'construction quotes',
    'lumber supplier',
    'builder software',
    'material takeoffs',
    'AI construction',
    'Abel Lumber',
  ],
  applicationName: 'Aegis',
  authors: [{ name: 'Abel Lumber' }],
  creator: 'Abel Lumber',
  publisher: 'Abel Lumber',
  formatDetection: {
    email: false,
    telephone: false,
    address: false,
  },
  openGraph: {
    title: 'Aegis | AI Blueprint Intelligence for Builders',
    description: 'Upload a blueprint, get a quote in minutes. AI-powered material takeoffs and instant pricing.',
    url: 'https://app.abellumber.com',
    siteName: 'Aegis',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'Aegis - AI Blueprint Intelligence',
        type: 'image/png',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Aegis | AI Blueprint Intelligence for Builders',
    description: 'Upload a blueprint, get a quote in minutes.',
    images: ['/twitter-image'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/icon',
    apple: '/apple-icon',
  },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Aegis',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Pull the request ID set by middleware so client-side error beacons
  // can include it and correlate back to server logs.
  const requestId = headers().get('x-request-id') || ''

  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/images/logos/abel-logo.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Aegis" />
        {requestId && <meta name="x-request-id" content={requestId} />}
      </head>
      <body className="min-h-screen bg-white text-gray-900 transition-colors">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only fixed top-0 left-0 z-[10000] px-4 py-2 bg-[#3E2A1E] text-white font-semibold rounded-br"
        >
          Skip to main content
        </a>
        <ThemeProvider>
          <ToastProvider>
            <main id="main-content">
              {children}
            </main>
            <ToastContainer />
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
