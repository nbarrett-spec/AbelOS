'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useToast, Toast, ToastType } from '@/contexts/ToastContext';

const getIconAndColor = (type: ToastType) => {
  switch (type) {
    case 'success':
      return { icon: '✓', color: '#16a34a', bgColor: 'rgba(22, 163, 74, 0.1)' };
    case 'error':
      return { icon: '✗', color: '#dc2626', bgColor: 'rgba(220, 38, 38, 0.1)' };
    case 'warning':
      return { icon: '⚠', color: '#ca8a04', bgColor: 'rgba(202, 138, 4, 0.1)' };
    case 'info':
      return { icon: 'ℹ', color: '#2563eb', bgColor: 'rgba(37, 99, 235, 0.1)' };
    default:
      return { icon: 'ℹ', color: '#2563eb', bgColor: 'rgba(37, 99, 235, 0.1)' };
  }
};

interface ToastItemProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onRemove }) => {
  const [isRemoving, setIsRemoving] = useState(false);
  const [progress, setProgress] = useState(100);
  const { icon, color, bgColor } = getIconAndColor(toast.type);
  const duration = toast.duration ?? 4000;

  const handleClose = useCallback(() => {
    setIsRemoving(true);
    setTimeout(() => {
      onRemove(toast.id);
    }, 300);
  }, [toast.id, onRemove]);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [duration]);

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    minWidth: '320px',
    maxWidth: '420px',
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    backdropFilter: 'blur(10px)',
    overflow: 'hidden',
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
    opacity: isRemoving ? 0 : 1,
    transform: isRemoving ? 'translateX(400px)' : 'translateX(0)',
    transition: 'all 0.3s ease-out',
    animation: !isRemoving ? 'slideInRight 0.4s ease-out' : 'none',
  };

  const contentStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '16px',
  };

  const leftBarStyle: React.CSSProperties = {
    width: '4px',
    height: '100%',
    backgroundColor: color,
    position: 'absolute',
    left: 0,
    top: 0,
  };

  const iconContainerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    minWidth: '24px',
    backgroundColor: bgColor,
    borderRadius: '50%',
    color: color,
    fontSize: '14px',
    fontWeight: 'bold',
    marginTop: '2px',
  };

  const textContainerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: 1,
    marginRight: '8px',
  };

  const titleStyle: React.CSSProperties = {
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: 'bold',
    margin: 0,
    lineHeight: '1.4',
  };

  const messageStyle: React.CSSProperties = {
    color: '#cbd5e1',
    fontSize: '12px',
    margin: 0,
    lineHeight: '1.4',
  };

  const closeButtonStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    minWidth: '24px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#94a3b8',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '0',
    lineHeight: '1',
    transition: 'color 0.2s',
  };

  const closeButtonHoverStyle: React.CSSProperties = {
    color: '#ffffff',
  };

  const [isHoveringClose, setIsHoveringClose] = useState(false);

  const progressBarStyle: React.CSSProperties = {
    height: '2px',
    backgroundColor: color,
    width: `${progress}%`,
    transition: 'width 0.05s linear',
  };

  return (
    <div style={containerStyle}>
      <style>{`
        @keyframes slideInRight {
          from {
            opacity: 0;
            transform: translateX(400px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @media (max-width: 768px) {
          @keyframes slideInBottom {
            from {
              opacity: 0;
              transform: translateY(100px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        }
      `}</style>
      <div style={contentStyle}>
        <div style={leftBarStyle} />
        <div style={iconContainerStyle}>{icon}</div>
        <div style={textContainerStyle}>
          <p style={titleStyle}>{toast.title}</p>
          {toast.message && <p style={messageStyle}>{toast.message}</p>}
        </div>
        <button
          style={isHoveringClose ? { ...closeButtonStyle, ...closeButtonHoverStyle } : closeButtonStyle}
          onClick={handleClose}
          onMouseEnter={() => setIsHoveringClose(true)}
          onMouseLeave={() => setIsHoveringClose(false)}
          aria-label="Close notification"
        >
          ×
        </button>
      </div>
      <div style={progressBarStyle} />
    </div>
  );
};

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToast();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    pointerEvents: 'none',
    ...(isMobile
      ? {
          bottom: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'calc(100% - 32px)',
          maxWidth: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          alignItems: 'center',
        }
      : {
          bottom: '24px',
          right: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          alignItems: 'flex-end',
        }),
  };

  const toastWrapperStyle: React.CSSProperties = {
    pointerEvents: 'auto',
    ...(isMobile ? { width: '100%', maxWidth: '500px' } : {}),
  };

  return (
    <div style={containerStyle}>
      {toasts.map((toast) => (
        <div key={toast.id} style={toastWrapperStyle}>
          <ToastItem toast={toast} onRemove={removeToast} />
        </div>
      ))}
    </div>
  );
};
