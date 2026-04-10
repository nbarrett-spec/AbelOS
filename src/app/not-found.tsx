export default function NotFound() {
  return (
    <div style={{ padding: 40, textAlign: 'center', fontFamily: 'Arial, sans-serif', minHeight: '60vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>🔍</div>
      <h1 style={{ color: '#1B4F72', marginBottom: 8, fontSize: 32 }}>Page Not Found</h1>
      <p style={{ color: '#666', marginBottom: 24, maxWidth: 400 }}>
        The page you're looking for doesn't exist or may have been moved.
      </p>
      <a href="/ops" style={{
        padding: '12px 28px',
        backgroundColor: '#1B4F72',
        color: 'white',
        textDecoration: 'none',
        borderRadius: 6,
        fontWeight: 600,
        fontSize: 14
      }}>
        Go to Dashboard
      </a>
    </div>
  )
}
