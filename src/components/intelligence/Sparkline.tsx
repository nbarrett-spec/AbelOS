'use client';

import { FC, useMemo } from 'react';
import { clsx } from 'clsx';

/**
 * Props for the Sparkline component.
 */
export interface SparklineProps {
  /**
   * Array of numeric values to plot.
   */
  data: number[];
  /**
   * Width of the SVG in pixels (default: 60).
   */
  width?: number;
  /**
   * Height of the SVG in pixels (default: 20).
   */
  height?: number;
  /**
   * Stroke color (default: 'currentColor', uses Tailwind color classes).
   * Can be a Tailwind color like 'text-success-500' (pass the hex) or a hex code.
   */
  color?: string;
  /**
   * Stroke width (default: 2).
   */
  strokeWidth?: number;
  /**
   * Show a marker on the last data point (default: true).
   */
  showLastPointMarker?: boolean;
  /**
   * Marker radius in pixels (default: 3).
   */
  markerRadius?: number;
  /**
   * CSS class for accessibility.
   */
  className?: string;
  /**
   * Aria label for accessibility.
   */
  ariaLabel?: string;
}

/**
 * Sparkline - A small inline SVG sparkline for visualizing data trends.
 * No external charting libraries required.
 */
const Sparkline: FC<SparklineProps> = ({
  data,
  width = 60,
  height = 20,
  color = '#0ea5e9',
  strokeWidth = 2,
  showLastPointMarker = true,
  markerRadius = 3,
  className,
  ariaLabel = 'Sparkline chart',
}) => {
  const pathData = useMemo(() => {
    if (!data || data.length === 0) return '';
    if (data.length === 1) return '';

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const padding = strokeWidth + markerRadius + 2;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const points = data.map((value, index) => {
      const x = padding + (index / (data.length - 1)) * chartWidth;
      const y = padding + chartHeight - ((value - min) / range) * chartHeight;
      return `${x},${y}`;
    });

    return points.join(' ');
  }, [data, width, height, strokeWidth, markerRadius]);

  if (!data || data.length === 0) {
    return null;
  }

  if (data.length === 1) {
    return (
      <svg
        width={width}
        height={height}
        className={clsx('inline-block', className)}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-label={ariaLabel}
        role="img"
      >
        <circle
          cx={width / 2}
          cy={height / 2}
          r={markerRadius}
          fill={color}
        />
      </svg>
    );
  }

  const lastDataIndex = data.length - 1;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = strokeWidth + markerRadius + 2;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  const lastX = padding + (lastDataIndex / (data.length - 1)) * chartWidth;
  const lastY = padding + chartHeight - ((data[lastDataIndex] - min) / range) * chartHeight;

  return (
    <svg
      width={width}
      height={height}
      className={clsx('inline-block', className)}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-label={ariaLabel}
      role="img"
    >
      <polyline
        points={pathData}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {showLastPointMarker && (
        <circle
          cx={lastX}
          cy={lastY}
          r={markerRadius}
          fill={color}
        />
      )}
    </svg>
  );
};

export default Sparkline;
