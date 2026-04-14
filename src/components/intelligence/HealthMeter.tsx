'use client';

import { FC } from 'react';
import { clsx } from 'clsx';

/**
 * Health status type.
 */
export type HealthStatus = 'good' | 'warning' | 'critical';

/**
 * Health segment data.
 */
export interface HealthSegment {
  /**
   * Percentage value for this segment (0-100).
   */
  value: number;
  /**
   * Status of the segment.
   */
  status: HealthStatus;
  /**
   * Optional label for the segment.
   */
  label?: string;
}

/**
 * Props for the HealthMeter component.
 */
export interface HealthMeterProps {
  /**
   * Array of health segments.
   */
  segments: HealthSegment[];
  /**
   * Overall label for the health meter.
   */
  label: string;
  /**
   * Height of the meter in pixels (default: 24).
   */
  height?: number;
  /**
   * Border radius (default: 'lg').
   */
  rounded?: 'sm' | 'md' | 'lg' | 'xl';
  /**
   * Show segment labels (default: false).
   */
  showLabels?: boolean;
  /**
   * Additional CSS classes.
   */
  className?: string;
}

/**
 * HealthMeter - A horizontal health indicator with segment coloring.
 */
const HealthMeter: FC<HealthMeterProps> = ({
  segments,
  label,
  height = 24,
  rounded = 'lg',
  showLabels = false,
  className,
}) => {
  const roundedMap = {
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
  };

  const getStatusColor = (status: HealthStatus) => {
    switch (status) {
      case 'good':
        return 'bg-success-500';
      case 'warning':
        return 'bg-warning-500';
      case 'critical':
        return 'bg-danger-500';
    }
  };

  // Normalize segments to ensure they sum to 100
  const normalizedSegments = segments.map((seg) => ({
    ...seg,
    displayValue: seg.value,
  }));

  return (
    <div className={clsx('flex flex-col gap-2', className)}>
      {/* Label */}
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {label}
        </label>
        {showLabels && (
          <div className="text-xs text-slate-600 dark:text-slate-400">
            {normalizedSegments
              .map((seg) => `${seg.displayValue}%`)
              .join(' / ')}
          </div>
        )}
      </div>

      {/* Meter */}
      <div
        className={clsx(
          'flex overflow-hidden bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600',
          roundedMap[rounded]
        )}
        style={{ height: `${height}px` }}
        role="progressbar"
        aria-label={`Health meter: ${label}`}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {normalizedSegments.map((segment, index) => (
          <div
            key={index}
            className={clsx(
              'transition-all duration-300',
              getStatusColor(segment.status)
            )}
            style={{ width: `${segment.displayValue}%` }}
            title={segment.label || `${segment.status}: ${segment.displayValue}%`}
          />
        ))}
      </div>

      {/* Segment legend */}
      {showLabels && normalizedSegments.some((seg) => seg.label) && (
        <div className="flex flex-wrap gap-3 text-xs mt-1">
          {normalizedSegments
            .filter((seg) => seg.label)
            .map((segment, index) => (
              <div key={index} className="flex items-center gap-1">
                <div
                  className={clsx(
                    'w-2 h-2 rounded-full',
                    getStatusColor(segment.status)
                  )}
                />
                <span className="text-slate-600 dark:text-slate-400">
                  {segment.label}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

export default HealthMeter;
