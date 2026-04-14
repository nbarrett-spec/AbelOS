'use client';

import { FC, ReactNode } from 'react';
import { clsx } from 'clsx';
import Sparkline from './Sparkline';
import TrendBadge, { TrendDirection } from './TrendBadge';
import SkeletonBlock from './SkeletonBlock';

/**
 * Props for the KpiTile component.
 */
export interface KpiTileProps {
  /**
   * Label/title of the KPI.
   */
  label: string;
  /**
   * The main value to display.
   */
  value: string | number | null;
  /**
   * Delta numeric value (e.g., 4.2 for +4.2).
   */
  delta?: number;
  /**
   * Percentage of the delta (if not included in delta value).
   */
  percent?: number;
  /**
   * Trend direction (up, down, flat). If not provided, inferred from delta.
   */
  direction?: TrendDirection;
  /**
   * Sparkline data array for inline chart.
   */
  sparklineData?: number[];
  /**
   * Color for the sparkline.
   */
  sparklineColor?: string;
  /**
   * Optional context line below the value.
   */
  contextLine?: string;
  /**
   * Is the tile loading?
   */
  isLoading?: boolean;
  /**
   * Icon to display beside the label.
   */
  icon?: ReactNode;
  /**
   * Whether the delta value is inverted (e.g., lower is better).
   */
  invertedDelta?: boolean;
  /**
   * Additional CSS classes.
   */
  className?: string;
}

/**
 * KpiTile - A tile displaying a KPI with label, value, delta, and optional sparkline.
 */
const KpiTile: FC<KpiTileProps> = ({
  label,
  value,
  delta,
  percent,
  direction,
  sparklineData,
  sparklineColor = '#0ea5e9',
  contextLine,
  isLoading = false,
  icon,
  invertedDelta = false,
  className,
}) => {
  return (
    <div
      className={clsx(
        'rounded-lg border border-slate-200 dark:border-slate-700',
        'bg-white dark:bg-slate-800',
        'p-4 flex flex-col gap-3',
        'transition-colors duration-fast',
        className
      )}
    >
      {/* Header: Label + Icon */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon && <div className="text-slate-600 dark:text-slate-400">{icon}</div>}
          <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {label}
          </h3>
        </div>
      </div>

      {/* Main Value */}
      {isLoading ? (
        <SkeletonBlock lines={1} height={32} />
      ) : value !== null ? (
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-slate-900 dark:text-white">
            {value}
          </span>
          {delta !== undefined && (
            <TrendBadge
              value={delta}
              percent={percent}
              direction={direction}
              inverted={invertedDelta}
            />
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">No data</p>
      )}

      {/* Context Line */}
      {contextLine && (
        <p className="text-xs text-slate-600 dark:text-slate-400">
          {contextLine}
        </p>
      )}

      {/* Sparkline */}
      {sparklineData && sparklineData.length > 0 && !isLoading && (
        <div className="pt-2 flex items-end justify-between gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Trend
          </span>
          <Sparkline
            data={sparklineData}
            color={sparklineColor}
            width={120}
            height={24}
            strokeWidth={2}
          />
        </div>
      )}
    </div>
  );
};

export default KpiTile;
