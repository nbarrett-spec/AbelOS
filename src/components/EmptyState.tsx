import React from 'react';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}

export default function EmptyState({
  icon = '📭',
  title,
  description,
  actionLabel,
  actionHref,
}: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 32px',
        backgroundColor: 'rgba(30, 41, 59, 0.3)',
        borderRadius: '16px',
        border: '1px solid rgba(148, 163, 184, 0.2)',
        minHeight: '300px',
      }}
    >
      <div
        style={{
          fontSize: '48px',
          marginBottom: '24px',
          lineHeight: '1',
        }}
      >
        {icon}
      </div>

      <h3
        style={{
          color: 'white',
          fontSize: '18px',
          fontWeight: 600,
          margin: '0 0 12px 0',
          textAlign: 'center',
        }}
      >
        {title}
      </h3>

      <p
        style={{
          color: '#94A3B8',
          fontSize: '14px',
          margin: '0 0 24px 0',
          maxWidth: '400px',
          textAlign: 'center',
          lineHeight: '1.5',
        }}
      >
        {description}
      </p>

      {actionLabel && actionHref && (
        <a
          href={actionHref}
          style={{
            display: 'inline-block',
            padding: '10px 20px',
            backgroundColor: '#C6A24E',
            color: 'white',
            fontSize: '14px',
            fontWeight: 600,
            borderRadius: '8px',
            textDecoration: 'none',
            border: 'none',
            cursor: 'pointer',
            transition: 'background-color 0.2s ease',
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLAnchorElement).style.backgroundColor = '#A8882A';
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLAnchorElement).style.backgroundColor = '#C6A24E';
          }}
        >
          {actionLabel}
        </a>
      )}
    </div>
  );
}
