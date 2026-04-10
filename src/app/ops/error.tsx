'use client'

export default function OpsError({ error, reset }: { error: Error & { digest?: string }, reset: () => void }) {
  return (
    <div style={{ padding: 40, textAlign: 'center', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
      <h2 style={{ color: '#1B4F72', marginBottom: 8 }}>Operations Error</h2>
      <p style={{ color: '#666', marginBottom: 16 }}>
        {error.message || 'Something went wrong loading this page.'}
      </p>
      <button
        onClick={reset}
        style={{
          padding: '10px 24px',
          backgroundColor: '#E67E22',
          color: 'white',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 14
        }}
      >
        Try Again
      </button>
    </div>
  )
}
