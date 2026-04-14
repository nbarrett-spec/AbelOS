'use client';

import { FC, ReactNode } from 'react';
import { clsx } from 'clsx';
import { ChevronRight } from 'lucide-react';
import SkeletonBlock from './SkeletonBlock';

/**
 * Severity level of the insight.
 */
export type InsightSeverity = 'info' | 'positive' | 'warning' | 'critical';

/**
 * Props for the InsightCard component.
 */
export interface InsightCardProps {
  /**
   * Severity level (info, positive, warning, critical).
   */
  severity: InsightSeverity;
  /**
   * Icon to display.
   */
  icon: ReactNode;
  /**
   * Title/heading of the insight.
   */
  title: string;
  /**
   * Body text/description.
   */
  body: string;
  /**
   * Optional link/action href.
   */
  actionHref?: string;
  /**
   * Optional link/action label.
   */
  actionLabel?: string;
  /**
   * Callback when action is clicked (alternative to href).
   */
  onAction?: () => void;
  /**
   * Is the card loading?
   */
  isLoading?: boolean;
  /**
   * Additional CSS classes.
   */
  className?: string;
}

/**
 * InsightCard - A generic AI insight card with severity, icon, title, body, and optional action.
 */
const InsightCard: FC<InsightCardProps> = ({
  severity,
  icon,
  title,
  body,
  actionHref,
  actionLabel,
  onAction,
  isLoading = false,
  className,
}) => {
  // Color mapping
  const severityStyles: Record<InsightSeverity, { bg: string; border: string; icon: string; title: string }> = {
    info: {
      bg: 'bg-info-50 dark:bg-info-900/20',
      border: 'border-info-200 dark:border-info-700',
      icon: 'text-info-600 dark:text-info-400',
      title: 'text-info-900 dark:text-info-100',
    },
    positive: {
      bg: 'bg-success-50 dark:bg-success-900/20',
      border: 'border-success-200 dark:border-success-700',
      icon: 'text-success-600 dark:text-success-400',
      title: 'text-success-900 dark:text-success-100',
    },
    warning: {
      bg: 'bg-warning-50 dark:bg-warning-900/20',
      border: 'border-warning-200 dark:border-warning-700',
      icon: 'text-warning-600 dark:text-warning-400',
      title: 'text-warning-900 dark:text-warning-100',
    },
    critical: {
      bg: 'bg-danger-50 dark:bg-danger-900/20',
      border: 'border-danger-200 dark:border-danger-700',
      icon: 'text-danger-600 dark:text-danger-400',
      title: 'text-danger-900 dark:text-danger-100',
    },
  };

  const styles = severityStyles[severity];

  return (
    <div
      className={clsx(
        'rounded-lg border p-4 transition-colors duration-fast',
        styles.bg,
        styles.border,
        className
      )}
      role={severity === 'critical' ? 'alert' : 'region'}
      aria-label={`${severity} insight: ${title}`}
    >
      {isLoading ? (
        <SkeletonBlock lines={2} height={16} />
      ) : (
        <>
          {/* Header: Icon + Title */}
          <div className="flex items-start gap-3 mb-2">
            <div className={clsx('flex-shrink-0', styles.icon)}>
              {icon}
            </div>
            <h3 className={clsx('font-semibold text-sm leading-tight', styles.title)}>
              {title}
            </h3>
          </div>

          {/* Body */}
          <p className="text-sm text-slate-700 dark:text-slate-300 mb-3 ml-7">
            {body}
          </p>

          {/* Action */}
          {(actionHref || onAction) && (
            <div className="ml-7">
              {actionHref ? (
                <a
                  href={actionHref}
                  className={clsx(
                    'inline-flex items-center gap-1 text-sm font-medium',
                    'hover:underline transition-colors duration-fast',
                    'focus:outline-none focus:ring-2 focus:ring-offset-2 rounded-sm',
                    {
                      'text-info-600 dark:text-info-400 focus:ring-info-300': severity === 'info',
                      'text-success-600 dark:text-success-400 focus:ring-success-300': severity === 'positive',
                      'text-warning-600 dark:text-warning-400 focus:ring-warning-300': severity === 'warning',
                      'text-danger-600 dark:text-danger-400 focus:ring-danger-300': severity === 'critical',
                    }
                  )}
                >
                  {actionLabel || 'Learn more'}
                  <ChevronRight className="w-4 h-4" />
                </a>
              ) : (
                <button
                  onClick={onAction}
                  className={clsx(
                    'inline-flex items-center gap-1 text-sm font-medium',
                    'hover:underline transition-colors duration-fast',
                    'focus:outline-none focus:ring-2 focus:ring-offset-2 rounded-sm',
                    {
                      'text-info-600 dark:text-info-400 focus:ring-info-300': severity === 'info',
                      'text-success-600 dark:text-success-400 focus:ring-success-300': severity === 'positive',
                      'text-warning-600 dark:text-warning-400 focus:ring-warning-300': severity === 'warning',
                      'text-danger-600 dark:text-danger-400 focus:ring-danger-300': severity === 'critical',
                    }
                  )}
                >
                  {actionLabel || 'Learn more'}
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default InsightCard;
