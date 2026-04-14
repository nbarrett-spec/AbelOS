'use client';

import { FC, ReactNode } from 'react';
import { clsx } from 'clsx';
import { X, AlertCircle } from 'lucide-react';

/**
 * Severity level of the anomaly.
 */
export type AnomalySeverity = 'info' | 'warning' | 'critical';

/**
 * Props for the AnomalyBanner component.
 */
export interface AnomalyBannerProps {
  /**
   * Severity level (info, warning, critical).
   */
  severity: AnomalySeverity;
  /**
   * Title/heading of the anomaly.
   */
  title: string;
  /**
   * Detailed description.
   */
  detail: string;
  /**
   * Optional icon (defaults to AlertCircle).
   */
  icon?: ReactNode;
  /**
   * Optional CTA label.
   */
  ctaLabel?: string;
  /**
   * Optional CTA href.
   */
  ctaHref?: string;
  /**
   * Optional CTA callback.
   */
  onCta?: () => void;
  /**
   * Optional callback when dismissed.
   */
  onDismiss?: () => void;
  /**
   * Is the banner dismissible? (default: true).
   */
  dismissible?: boolean;
  /**
   * Additional CSS classes.
   */
  className?: string;
}

/**
 * AnomalyBanner - A full-width alert banner for detected anomalies.
 */
const AnomalyBanner: FC<AnomalyBannerProps> = ({
  severity,
  title,
  detail,
  icon,
  ctaLabel,
  ctaHref,
  onCta,
  onDismiss,
  dismissible = true,
  className,
}) => {
  // Color mapping
  const severityStyles: Record<AnomalySeverity, { bg: string; border: string; text: string; icon: string }> = {
    info: {
      bg: 'bg-info-50 dark:bg-info-900/20',
      border: 'border-info-200 dark:border-info-700',
      text: 'text-info-900 dark:text-info-100',
      icon: 'text-info-600 dark:text-info-400',
    },
    warning: {
      bg: 'bg-warning-50 dark:bg-warning-900/20',
      border: 'border-warning-200 dark:border-warning-700',
      text: 'text-warning-900 dark:text-warning-100',
      icon: 'text-warning-600 dark:text-warning-400',
    },
    critical: {
      bg: 'bg-danger-50 dark:bg-danger-900/20',
      border: 'border-danger-200 dark:border-danger-700',
      text: 'text-danger-900 dark:text-danger-100',
      icon: 'text-danger-600 dark:text-danger-400',
    },
  };

  const styles = severityStyles[severity];

  const displayIcon = icon || <AlertCircle className="w-5 h-5" />;

  return (
    <div
      className={clsx(
        'rounded-lg border p-4 transition-colors duration-fast',
        styles.bg,
        styles.border,
        'flex items-start gap-4',
        className
      )}
      role="alert"
      aria-label={`${severity} anomaly: ${title}`}
    >
      {/* Icon */}
      <div className={clsx('flex-shrink-0 mt-0.5', styles.icon)}>
        {displayIcon}
      </div>

      {/* Content */}
      <div className="flex-grow">
        <h2 className={clsx('font-semibold text-sm mb-1', styles.text)}>
          {title}
        </h2>
        <p className="text-sm text-slate-700 dark:text-slate-300 mb-3">
          {detail}
        </p>

        {/* CTA */}
        {(ctaLabel || ctaHref || onCta) && (
          <div>
            {ctaHref ? (
              <a
                href={ctaHref}
                className={clsx(
                  'inline-block text-sm font-medium px-3 py-1.5 rounded-md',
                  'transition-colors duration-fast',
                  'focus:outline-none focus:ring-2 focus:ring-offset-2',
                  {
                    'bg-info-100 dark:bg-info-800 hover:bg-info-200 dark:hover:bg-info-700 focus:ring-info-300 text-info-700 dark:text-info-100':
                      severity === 'info',
                    'bg-warning-100 dark:bg-warning-800 hover:bg-warning-200 dark:hover:bg-warning-700 focus:ring-warning-300 text-warning-700 dark:text-warning-100':
                      severity === 'warning',
                    'bg-danger-100 dark:bg-danger-800 hover:bg-danger-200 dark:hover:bg-danger-700 focus:ring-danger-300 text-danger-700 dark:text-danger-100':
                      severity === 'critical',
                  }
                )}
              >
                {ctaLabel || 'Take Action'}
              </a>
            ) : onCta ? (
              <button
                onClick={onCta}
                className={clsx(
                  'inline-block text-sm font-medium px-3 py-1.5 rounded-md',
                  'transition-colors duration-fast',
                  'focus:outline-none focus:ring-2 focus:ring-offset-2',
                  {
                    'bg-info-100 dark:bg-info-800 hover:bg-info-200 dark:hover:bg-info-700 focus:ring-info-300 text-info-700 dark:text-info-100':
                      severity === 'info',
                    'bg-warning-100 dark:bg-warning-800 hover:bg-warning-200 dark:hover:bg-warning-700 focus:ring-warning-300 text-warning-700 dark:text-warning-100':
                      severity === 'warning',
                    'bg-danger-100 dark:bg-danger-800 hover:bg-danger-200 dark:hover:bg-danger-700 focus:ring-danger-300 text-danger-700 dark:text-danger-100':
                      severity === 'critical',
                  }
                )}
              >
                {ctaLabel || 'Take Action'}
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* Dismiss button */}
      {dismissible && (
        <button
          onClick={onDismiss}
          className={clsx(
            'flex-shrink-0 p-1 rounded-md',
            'hover:bg-slate-200 dark:hover:bg-slate-700',
            'transition-colors duration-fast',
            'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-300',
            styles.icon
          )}
          aria-label="Dismiss"
        >
          <X className="w-5 h-5" />
        </button>
      )}
    </div>
  );
};

export default AnomalyBanner;
