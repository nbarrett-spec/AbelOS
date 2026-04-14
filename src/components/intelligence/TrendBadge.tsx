'use client';

import { FC } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { clsx } from 'clsx';

/**
 * Direction of the trend.
 */
export type TrendDirection = 'up' | 'down' | 'flat';

/**
 * Props for the TrendBadge component.
 */
export interface TrendBadgeProps {
  /**
   * Trend value (e.g., 4.2, -2.1, 0).
   */
  value: number;
  /**
   * Percentage sign to display (typically '5' for '5%').
   */
  percent?: number;
  /**
   * Direction override. If not provided, inferred from value.
   */
  direction?: TrendDirection;
  /**
   * Whether the direction is inverted (e.g., down is good).
   */
  inverted?: boolean;
  /**
   * Custom label (overrides auto-formatting).
   */
  label?: string;
  /**
   * Additional CSS classes.
   */
  className?: string;
}

/**
 * TrendBadge - A badge that displays a trend value with arrow and color coding.
 */
const TrendBadge: FC<TrendBadgeProps> = ({
  value,
  percent,
  direction,
  inverted = false,
  label,
  className,
}) => {
  // Determine direction if not provided
  let dir = direction;
  if (!dir) {
    if (value > 0) dir = 'up';
    else if (value < 0) dir = 'down';
    else dir = 'flat';
  }

  // Determine color based on direction and inversion
  let bgColor = 'bg-gray-100 dark:bg-slate-700';
  let textColor = 'text-gray-700 dark:text-gray-300';
  let iconColor = 'text-gray-600 dark:text-gray-400';

  if (dir === 'up' && !inverted) {
    bgColor = 'bg-success-50 dark:bg-success-900/20';
    textColor = 'text-success-700 dark:text-success-400';
    iconColor = 'text-success-600 dark:text-success-500';
  } else if (dir === 'up' && inverted) {
    bgColor = 'bg-danger-50 dark:bg-danger-900/20';
    textColor = 'text-danger-700 dark:text-danger-400';
    iconColor = 'text-danger-600 dark:text-danger-500';
  } else if (dir === 'down' && !inverted) {
    bgColor = 'bg-danger-50 dark:bg-danger-900/20';
    textColor = 'text-danger-700 dark:text-danger-400';
    iconColor = 'text-danger-600 dark:text-danger-500';
  } else if (dir === 'down' && inverted) {
    bgColor = 'bg-success-50 dark:bg-success-900/20';
    textColor = 'text-success-700 dark:text-success-400';
    iconColor = 'text-success-600 dark:text-success-500';
  }

  // Format label
  const displayLabel = label || `${value > 0 ? '+' : ''}${value.toFixed(1)}${percent ? '%' : ''}`;

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 px-2 py-1 rounded-md text-sm font-medium',
        bgColor,
        textColor,
        className
      )}
      role="status"
      aria-label={`Trend ${displayLabel}`}
    >
      {dir === 'up' && <TrendingUp className={clsx('w-3.5 h-3.5', iconColor)} />}
      {dir === 'down' && <TrendingDown className={clsx('w-3.5 h-3.5', iconColor)} />}
      {dir === 'flat' && <Minus className={clsx('w-3.5 h-3.5', iconColor)} />}
      <span>{displayLabel}</span>
    </span>
  );
};

export default TrendBadge;
