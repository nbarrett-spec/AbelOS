import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Aegis — Abel Lumber',
    short_name: 'Aegis',
    description:
      'AI-powered blueprint analysis and instant quotes for builders. Upload your plans, get accurate material takeoffs in minutes.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F3EAD8',
    theme_color: '#0f2a3e',
    orientation: 'portrait-primary',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    categories: ['business', 'productivity'],
  }
}
