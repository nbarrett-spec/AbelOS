import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Abel Lumber — Doors, Trim & Hardware for DFW Builders'
export const size = {
  width: 1200,
  height: 630,
}
export const contentType = 'image/png'

export default function TwitterImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: `linear-gradient(145deg, #3E2A1E 0%, #5A4233 40%, #2A1C14 100%)`,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px 80px',
          gap: '60px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          position: 'relative',
        }}
      >
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

        {/* Left — Logo */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
          }}
        >
          <div
            style={{
              width: '100px',
              height: '100px',
              background: '#C9822B',
              borderRadius: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '60px',
              fontWeight: 'bold',
              color: 'white',
              boxShadow: '0 16px 48px rgba(201, 130, 43, 0.35)',
            }}
          >
            A
          </div>
        </div>

        {/* Right — Text */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <h1
            style={{
              fontSize: '56px',
              fontWeight: 'bold',
              color: 'white',
              margin: '0',
              lineHeight: '1.1',
              letterSpacing: '-1.5px',
            }}
          >
            Abel Lumber
          </h1>
          <p
            style={{
              fontSize: '28px',
              color: '#C9822B',
              margin: '0',
              fontWeight: '600',
            }}
          >
            Doors · Trim · Hardware
          </p>
          <p
            style={{
              fontSize: '20px',
              color: 'rgba(243, 234, 216, 0.6)',
              margin: '8px 0 0 0',
              maxWidth: '600px',
              lineHeight: '1.5',
            }}
          >
            Your builder portal — order materials, track deliveries, and manage your account online.
          </p>
        </div>

        {/* Footer */}
        <div
          style={{
            position: 'absolute',
            bottom: '28px',
            right: '40px',
            fontSize: '14px',
            color: 'rgba(243, 234, 216, 0.3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
          }}
        >
          app.abellumber.com
        </div>
      </div>
    ),
    { ...size },
  )
}
