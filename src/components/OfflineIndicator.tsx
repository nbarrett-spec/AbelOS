'use client';

import { useState, useEffect } from 'react';

export default function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    // Set initial state
    setIsOnline(navigator.onLine);

    const handleOnline = () => {
      setIsOnline(true);
      setShowSuccess(true);
      // Auto-hide success banner after 3 seconds
      const timer = setTimeout(() => {
        setShowSuccess(false);
      }, 3000);
      return () => clearTimeout(timer);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowSuccess(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Don't render until we know the status
  if (isOnline === null) {
    return null;
  }

  // Offline banner
  if (!isOnline && !showSuccess) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 40,
          backgroundColor: 'rgba(239, 68, 68, 0.95)',
          backdropFilter: 'blur(8px)',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          color: 'white',
          fontSize: '14px',
          fontWeight: 500,
          animation: 'slideDown 0.3s ease-out',
          marginTop: '60px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <style>{`
          @keyframes slideDown {
            from {
              transform: translateY(-100%);
              opacity: 0;
            }
            to {
              transform: translateY(0);
              opacity: 1;
            }
          }
        `}</style>
        <span style={{ fontSize: '16px' }}>⚠️</span>
        <span>You're offline — some features may be unavailable</span>
      </div>
    );
  }

  // Success banner
  if (showSuccess) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 40,
          backgroundColor: 'rgba(34, 197, 94, 0.95)',
          backdropFilter: 'blur(8px)',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          color: 'white',
          fontSize: '14px',
          fontWeight: 500,
          animation: 'slideDown 0.3s ease-out',
          marginTop: '60px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <style>{`
          @keyframes slideDown {
            from {
              transform: translateY(-100%);
              opacity: 0;
            }
            to {
              transform: translateY(0);
              opacity: 1;
            }
          }
        `}</style>
        <span style={{ fontSize: '16px' }}>✓</span>
        <span>Back online!</span>
      </div>
    );
  }

  return null;
}
