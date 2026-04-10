'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  icon: string;
  label: string;
  href: string;
  isCenter?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { icon: '🏠', label: 'Home', href: '/dashboard' },
  { icon: '📦', label: 'Orders', href: '/dashboard/orders' },
  { icon: '⚡', label: 'Quick Order', href: '/quick-order', isCenter: true },
  { icon: '📅', label: 'Schedule', href: '/dashboard/schedule' },
  { icon: '⚡', label: 'Intelligence', href: '/dashboard/intelligence' },
];

function isRouteActive(pathname: string, href: string): boolean {
  // Exact match for /dashboard
  if (href === '/dashboard') {
    return pathname === '/dashboard';
  }
  // Starts with href for other routes
  return pathname.startsWith(href);
}

export default function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile-only bottom navigation */}
      <nav
        style={{
          display: 'none',
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          backdropFilter: 'blur(20px)',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          '@media (max-width: 768px)': {
            display: 'flex',
          },
        } as React.CSSProperties & { '@media (max-width: 768px)'?: Record<string, string> }}
      >
        {/* Media query styles injected via style tag for mobile visibility */}
        <style>{`
          @media (max-width: 768px) {
            nav {
              display: flex !important;
            }
          }
        `}</style>

        <div
          style={{
            display: 'flex',
            width: '100%',
            justifyContent: 'space-around',
            alignItems: 'center',
            padding: '8px 0',
            position: 'relative',
          }}
        >
          {NAV_ITEMS.map((item) => {
            const isActive = isRouteActive(pathname, item.href);

            if (item.isCenter) {
              // Center Quick Order button
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    position: 'relative',
                    bottom: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '56px',
                    height: '56px',
                    borderRadius: '50%',
                    backgroundColor: '#E67E22',
                    textDecoration: 'none',
                    boxShadow: '0 4px 12px rgba(230, 126, 34, 0.4)',
                    transition: 'all 0.2s ease-in-out',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.transform =
                      'scale(1.05)';
                    (e.currentTarget as HTMLAnchorElement).style.boxShadow =
                      '0 6px 16px rgba(230, 126, 34, 0.5)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.transform =
                      'scale(1)';
                    (e.currentTarget as HTMLAnchorElement).style.boxShadow =
                      '0 4px 12px rgba(230, 126, 34, 0.4)';
                  }}
                >
                  <span style={{ fontSize: '20px' }}>{item.icon}</span>
                </Link>
              );
            }

            // Regular nav items
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textDecoration: 'none',
                  position: 'relative',
                  padding: '8px 12px',
                  minWidth: '60px',
                  transition: 'color 0.2s ease-in-out',
                }}
              >
                {/* Icon container with badge for Orders */}
                <div style={{ position: 'relative' }}>
                  <span
                    style={{
                      fontSize: '20px',
                      display: 'block',
                    }}
                  >
                    {item.icon}
                  </span>

                  {/* Unread badge for Orders */}
                  {item.label === 'Orders' && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '-2px',
                        right: '-4px',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: '#EF4444',
                      }}
                    />
                  )}
                </div>

                {/* Label */}
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: '600',
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    marginTop: '4px',
                    color: isActive ? '#E67E22' : '#94A3B8',
                    transition: 'color 0.2s ease-in-out',
                  }}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Spacer for fixed nav */}
      <style>{`
        @media (max-width: 768px) {
          body {
            padding-bottom: calc(70px + env(safe-area-inset-bottom));
          }
        }
      `}</style>
    </>
  );
}
