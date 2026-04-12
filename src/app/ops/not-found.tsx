import Link from 'next/link'

export default function NotFound() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: '#f5f5f5',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{ textAlign: 'center', maxWidth: 500 }}>
        <div style={{ fontSize: 72, marginBottom: 16, color: '#999' }}>404</div>
        <h1 style={{ fontSize: 28, marginBottom: 8, color: '#1B4F72' }}>Page not found</h1>
        <p style={{ fontSize: 16, color: '#666', marginBottom: 32 }}>
          The page you're looking for doesn't exist in the operations section.
        </p>
        <Link href="/ops" style={{
          display: 'inline-block',
          padding: '12px 32px',
          backgroundColor: '#1B4F72',
          color: 'white',
          textDecoration: 'none',
          borderRadius: 6,
          fontWeight: 600,
          fontSize: 14,
          transition: 'background-color 0.2s'
        }}>
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
