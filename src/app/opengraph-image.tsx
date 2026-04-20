import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Abel Lumber — Doors, Trim & Hardware for DFW Builders'
export const size = {
  width: 1200,
  height: 630,
}
export const contentType = 'image/png'

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: `linear-gradient(145deg, #3E2A1E 0%, #5A4233 40%, #2A1C14 100%)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px',
          gap: '16px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          position: 'relative',
        }}
      >
        {/* Subtle texture overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 0.03,
            backgroundImage: `repeating-linear-gradient(90deg, transparent, transparent 3px, rgba(255,255,255,0.2) 3px, rgba(255,255,255,0.2) 5px)`,
          }}
        />

        {/* Top accent line */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '4px',
            background: 'linear-gradient(to right, #C9822B, #D9993F, #C9822B)',
          }}
        />

        {/* Logo */}
        <div
          style={{
            width: '80px',
            height: '80px',
            background: '#C9822B',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '48px',
            fontWeight: 'bold',
            color: 'white',
            marginBottom: '12px',
            boxShadow: '0 12px 40px rgba(201, 130, 43, 0.3)',
          }}
        >
          A
        </div>

        {/* Main Title */}
        <h1
          style={{
            fontSize: '68px',
            fontWeight: 'bold',
            color: 'white',
            margin: '0',
            textAlign: 'center',
            lineHeight: '1.1',
            letterSpacing: '-2px',
          }}
        >
          Abel Lumber
        </h1>

        {/* Subtitle */}
        <p
          style={{
            fontSize: '32px',
            color: '#C9822B',
            margin: '0',
            textAlign: 'center',
            fontWeight: '600',
          }}
        >
          Doors · Trim · Hardware
        </p>

        {/* Description */}
        <p
          style={{
            fontSize: '22px',
            color: 'rgba(243, 234, 216, 0.7)',
            margin: '16px 0 0 0',
            textAlign: 'center',
            maxWidth: '800px',
            lineHeight: '1.5',
          }}
        >
          DFW&apos;s partner for production and custom homebuilders.
          Order online, track deliveries, manage your account.
        </p>

        {/* Footer */}
        <div
          style={{
            position: 'absolute',
            bottom: '32px',
            fontSize: '16px',
            color: 'rgba(243, 234, 216, 0.35)',
            textAlign: 'center',
            letterSpacing: '2px',
            textTransform: 'uppercase',
          }}
        >
          Abel Doors & Trim · Gainesville, TX
        </div>
      </div>
    ),
    { ...size },
  )
}
