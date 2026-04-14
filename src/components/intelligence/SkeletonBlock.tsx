'use client';

import { FC } from 'react';
import { clsx } from 'clsx';

/**
 * Props for the SkeletonBlock component.
 */
export interface SkeletonBlockProps {
  /**
   * Number of skeleton lines to display (default: 3).
   */
  lines?: number;
  /**
   * Height of each line in pixels (default: 12).
   */
  height?: number;
  /**
   * Border radius class (default: 'md').
   */
  rounded?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /**
   * Additional CSS classes.
   */
  className?: string;
  /**
   * Vertical gap between lines in pixels (default: 8).
   */
  gap?: number;
}

/**
 * SkeletonBlock - A shimmer skeleton utility for loading states.
 * Renders multiple animated placeholder lines for content loading.
 */
const SkeletonBlock: FC<SkeletonBlockProps> = ({
  lines = 3,
  height = 12,
  rounded = 'md',
  className,
  gap = 8,
}) => {
  const roundedMap = {
    xs: 'rounded-xs',
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    '2xl': 'rounded-2xl',
  };

  return (
    <div className={clsx('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={clsx(
            'bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200',
            'dark:from-slate-700 dark:via-slate-600 dark:to-slate-700',
            'animate-shimmer',
            roundedMap[rounded]
          )}
          style={{
            height: `${height}px`,
            backgroundSize: '1000px 100%',
            marginBottom: i < lines - 1 ? `${gap}px` : '0',
          }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
};

export default SkeletonBlock;
