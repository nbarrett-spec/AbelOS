import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6 py-16 bg-gray-50">
      <div className="max-w-lg w-full text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-abel-navy/10 text-abel-navy mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </div>
        <p className="text-sm font-semibold tracking-wider text-abel-orange uppercase mb-2">404</p>
        <h1 className="text-3xl font-bold text-abel-navy mb-3">Page not found</h1>
        <p className="text-gray-600 mb-8 leading-relaxed">
          The page you&rsquo;re looking for doesn&rsquo;t exist or may have been moved. Let&rsquo;s get you back on track.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link href="/portal" className="btn-primary">
            Builder portal
          </Link>
          <Link href="/ops" className="btn-outline">
            Admin
          </Link>
          <Link href="/" className="btn-outline">
            Home
          </Link>
        </div>
        <p className="mt-8 text-sm text-gray-500">
          Need help? Contact{' '}
          <a href="mailto:support@abellumber.com" className="text-abel-navy hover:underline font-medium">
            support@abellumber.com
          </a>
        </p>
      </div>
    </div>
  )
}
