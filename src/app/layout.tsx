import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { Outfit, Inter, JetBrains_Mono, Playfair_Display } from 'next/font/google'
// Azeret Mono + Instrument Serif loaded via next/font below
import { Azeret_Mono, Instrument_Serif } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { ToastContainer } from '@/components/ToastContainer'
import ShortcutsOverlay from '@/components/ui/ShortcutsOverlay'

/* ── Self-hosted fonts (downloaded at build time, served from same domain) ── */
/* Primary stack: Outfit / Azeret Mono / Instrument Serif (Glass v3) */
const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  display: 'swap',
})

const azeretMono = Azeret_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  variable: '--font-display',
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
})

/* Legacy fonts kept loaded for data-design="drafting-room" escape hatch */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans-legacy',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-legacy',
  display: 'swap',
})

const playfairDisplay = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display-legacy',
  style: ['normal', 'italic'],
  display: 'swap',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#080D1A' },
    { media: '(prefers-color-scheme: light)', color: '#F0F4FA' },
  ],
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
    <html lang="en" className={`dark ${outfit.variable} ${azeretMono.variable} ${instrumentSerif.variable} ${inter.variable} ${jetbrainsMono.variable} ${playfairDisplay.variable}`}>
      <head>
        <link rel="apple-touch-icon" href="/images/logos/abel-logo.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Aegis" />
        {requestId && <meta name="x-request-id" content={requestId} />}
        {/* Inline theme + density bootstrap — avoid FOUC, honor user's saved preference */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function(){
                try {
                  var stored = localStorage.getItem('abel-theme');
                  var theme = stored === 'light' ? 'light' : 'dark';
                  if (theme === 'dark') document.documentElement.classList.add('dark');
                  else document.documentElement.classList.remove('dark');
                } catch(e) {}
                try {
                  var d = localStorage.getItem('aegis.density');
                  if (d !== 'comfortable' && d !== 'default' && d !== 'compact') d = 'default';
                  document.documentElement.setAttribute('data-density', d);
                } catch(e) {
                  document.documentElement.setAttribute('data-density', 'default');
                }
                try {
                  var params = new URLSearchParams(window.location.search);
                  var urlDesign = params.get('theme');
                  var dt = urlDesign === 'drafting-room' ? 'drafting-room' : (localStorage.getItem('aegis-design-theme') || 'glass');
                  document.documentElement.setAttribute('data-design', dt);
                } catch(e) {
                  document.documentElement.setAttribute('data-design', 'glass');
                }
                try {
                  var fs = localStorage.getItem('aegis-font-size');
                  var px = fs === 'small' ? '14.4px' : fs === 'large' ? '17.6px' : '16px';
                  document.documentElement.style.fontSize = px;
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-screen bg-canvas text-fg transition-colors">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only fixed top-0 left-0 z-[10000] px-4 py-2 bg-signal text-fg-on-accent font-semibold rounded-br"
        >
          Skip to main content
        </a>
        <ThemeProvider>
          <ToastProvider>
            <main id="main-content">
              {children}
            </main>
            <ToastContainer />
            {/* Global keyboard shortcut cheat sheet — press `?` to open */}
            <ShortcutsOverlay />
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
