'use client'

import { useState } from 'react'
import Link from 'next/link'

/**
 * Customer Catalog — embeds the full Abel Digital Catalog V2
 * (served as a static HTML from /catalog.html in the public directory)
 * within the Abel Builder Platform layout.
 *
 * The catalog is a self-contained vanilla JS app with:
 * - 342 product families, 4,124 products
 * - AI-generated product images
 * - Builder login, tiered pricing, RFQ system
 * - Expansion recommendations & reactivation engine
 * - Permit-based outreach banners
 */
export default function CustomerCatalogPage() {
  const [isFullscreen, setIsFullscreen] = useState(false)

  return (
    <div className={isFullscreen ? 'fixed inset-0 z-50 bg-white' : 'flex flex-col h-full'}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#1B4F72] text-white border-b border-[#163d5c]">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Abel Digital Catalog</h1>
          <span className="text-xs bg-[#E67E22] text-white px-2 py-0.5 rounded-full font-medium">
            V2 — Phase 3
          </span>
          <span className="text-xs text-blue-200">
            342 families &middot; 4,124 products &middot; Builder Pricing &middot; RFQ
          </span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/catalog.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded transition-colors"
          >
            Open in New Tab &#8599;
          </a>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded transition-colors"
          >
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
        </div>
      </div>

      {/* Catalog iframe */}
      <iframe
        src="/catalog.html"
        className="flex-1 w-full border-0"
        style={{ minHeight: isFullscreen ? '100vh' : 'calc(100vh - 120px)' }}
        title="Abel Digital Product Catalog"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  )
}
