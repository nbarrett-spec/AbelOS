import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/login', '/signup', '/forgot-password'],
        disallow: [
          '/api/',
          '/admin/',
          '/ops/',
          '/dashboard/',
          '/crew/',
          '/homeowner/',
          '/auth/',
          '/catalog/',
          '/orders/',
          '/projects/',
          '/bulk-order/',
          '/quick-order/',
          '/portal/',
          '/apply/',
        ],
      },
    ],
    sitemap: 'https://app.abellumber.com/sitemap.xml',
    host: 'https://app.abellumber.com',
  }
}
