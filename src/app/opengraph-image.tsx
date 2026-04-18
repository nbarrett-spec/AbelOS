import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Aegis - AI Blueprint Intelligence for Builders'
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
          background: `linear-gradient(135deg, #1B4F72 0%, #2d6a8f 50%, #154360 100%)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px',
          gap: '20px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Logo/Initials */}
        <div
          style={{
            width: '80px',
            height: '80px',
            background: '#E67E22',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '48px',
            fontWeight: 'bold',
            color: 'white',
            marginBottom: '20px',
          }}
        >
          A
        </div>

        {/* Main Title */}
        <h1
          style={{
            fontSize: '72px',
            fontWeight: 'bold',
            color: 'white',
            margin: '0',
            textAlign: 'center',
            lineHeight: '1.1',
          }}
        >
          Aegis
        </h1>

        {/* Subtitle */}
        <p
          style={{
            fontSize: '36px',
            color: '#E67E22',
            margin: '0',
            textAlign: 'center',
            fontWeight: '600',
          }}
        >
          Blueprint Intelligence, Instantly
        </p>

        {/* Description */}
        <p
          style={{
            fontSize: '24px',
            color: 'rgba(255, 255, 255, 0.85)',
            margin: '20px 0 0 0',
            textAlign: 'center',
            maxWidth: '900px',
            lineHeight: '1.4',
          }}
        >
          Upload your plans. Get material takeoffs and quotes in minutes.
        </p>

        {/* Footer */}
        <div
          style={{
            marginTop: '40px',
            fontSize: '18px',
            color: 'rgba(255, 255, 255, 0.7)',
            textAlign: 'center',
          }}
        >
          AI-powered builder commerce — Built by Abel Lumber
        </div>
      </div>
    ),
    { ...size },
  )
}
