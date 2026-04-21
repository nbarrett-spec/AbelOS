'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ActionItem {
  id: string;
  emoji: string;
  label: string;
  subtitle: string;
  href: string;
}

const actions: ActionItem[] = [
  {
    id: 'takeoff',
    emoji: '📐',
    label: 'New Takeoff',
    subtitle: 'Upload plans for AI takeoff',
    href: '/dashboard/blueprints',
  },
  {
    id: 'quick-order',
    emoji: '📦',
    label: 'Quick Order',
    subtitle: 'Order materials fast',
    href: '/quick-order',
  },
  {
    id: 'quote',
    emoji: '📋',
    label: 'New Quote',
    subtitle: 'Request a quote',
    href: '/get-quote',
  },
  {
    id: 'project',
    emoji: '🏗️',
    label: 'New Project',
    subtitle: 'Start a new project',
    href: '/projects/new',
  },
  {
    id: 'delivery',
    emoji: '🚚',
    label: 'Track Delivery',
    subtitle: 'Check delivery status',
    href: '/dashboard/deliveries',
  },
  {
    id: 'intelligence',
    emoji: '⚡',
    label: 'Intelligence',
    subtitle: 'View insights',
    href: '/dashboard/intelligence',
  },
];

export default function MobileQuickActions() {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();

  const handleActionClick = (href: string) => {
    router.push(href);
    setIsOpen(false);
  };

  const handleOverlayClick = () => {
    setIsOpen(false);
  };

  return (
    <div className="mobile-quick-actions-wrapper" style={{ display: 'none' }}>
      {/* Media query wrapper */}
      <style>{`
        @media (max-width: 768px) {
          .mobile-quick-actions-wrapper {
            display: block;
          }
        }
        @media (min-width: 769px) {
          .mobile-quick-actions-wrapper {
            display: none !important;
          }
        }
      `}</style>

      <div className="mobile-quick-actions-wrapper">
        {/* Overlay */}
        {isOpen && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              zIndex: 40,
              animation: 'fadeIn 0.3s ease-out',
            }}
            onClick={handleOverlayClick}
          />
        )}

        {/* Bottom Sheet */}
        {isOpen && (
          <div
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              backgroundColor: 'var(--canvas, #080D1A)',
              borderTopLeftRadius: '1rem',
              borderTopRightRadius: '1rem',
              maxHeight: '60vh',
              zIndex: 50,
              animation: 'slideUp 0.3s ease-out',
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
            }}
          >
            {/* Drag Handle */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                paddingTop: '1rem',
                paddingBottom: '0.5rem',
              }}
            >
              <div
                style={{
                  width: '40px',
                  height: '4px',
                  backgroundColor: '#6B7280',
                  borderRadius: '2px',
                }}
              />
            </div>

            {/* Action Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '1rem',
                padding: '1.5rem',
                paddingTop: '0.5rem',
              }}
            >
              {actions.map((action) => (
                <button
                  key={action.id}
                  onClick={() => handleActionClick(action.href)}
                  style={{
                    backgroundColor: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '0.75rem',
                    padding: '1.5rem 1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.5rem',
                    cursor: 'pointer',
                    transition: 'transform 0.2s ease-out, background-color 0.2s ease-out',
                    color: 'white',
                  }}
                  onMouseDown={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(0.95)';
                  }}
                  onMouseUp={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1.05)';
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(15, 23, 42, 1)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(15, 23, 42, 0.8)';
                  }}
                >
                  <span style={{ fontSize: '1.75rem', lineHeight: 1 }}>
                    {action.emoji}
                  </span>
                  <span
                    style={{
                      fontSize: '0.8125rem',
                      fontWeight: 600,
                      color: 'white',
                      textAlign: 'center',
                      lineHeight: 1.2,
                    }}
                  >
                    {action.label}
                  </span>
                  <span
                    style={{
                      fontSize: '0.6875rem',
                      color: '#9CA3AF',
                      textAlign: 'center',
                      lineHeight: 1.2,
                    }}
                  >
                    {action.subtitle}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Floating Action Button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          style={{
            position: 'fixed',
            bottom: '80px',
            right: '1.5rem',
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--c1, #4F46E5), var(--c2, #2563EB))',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 30,
            boxShadow: '0 4px 12px rgba(79, 70, 229, 0.4)',
            transition: 'transform 0.3s ease-out, box-shadow 0.3s ease-out',
            color: 'white',
            fontSize: '1.5rem',
            fontWeight: 'bold',
            transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 16px rgba(79, 70, 229, 0.6)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(79, 70, 229, 0.4)';
          }}
        >
          +
        </button>

        {/* Animations */}
        <style>{`
          @keyframes slideUp {
            from {
              transform: translateY(100%);
              opacity: 0;
            }
            to {
              transform: translateY(0);
              opacity: 1;
            }
          }
          @keyframes fadeIn {
            from {
              opacity: 0;
            }
            to {
              opacity: 1;
            }
          }
        `}</style>
      </div>
    </div>
  );
}
