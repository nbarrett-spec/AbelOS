'use client';

import { FC, useMemo } from 'react';
import { clsx } from 'clsx';

/**
 * Risk classification level.
 */
export type RiskLevel = 'Low' | 'Medium' | 'High';

/**
 * Props for the RiskScore component.
 */
export interface RiskScoreProps {
  /**
   * Risk score from 0 to 100.
   */
  score: number;
  /**
   * Label for the score. If not provided, auto-determined from score.
   */
  label?: RiskLevel;
  /**
   * Show the numeric score (default: true).
   */
  showScore?: boolean;
  /**
   * Ring thickness in pixels (default: 4).
   */
  ringThickness?: number;
  /**
   * Dial size in pixels (default: 120).
   */
  size?: number;
  /**
   * Additional CSS classes.
   */
  className?: string;
}

/**
 * RiskScore - A circular risk score dial with color coding and classification.
 */
const RiskScore: FC<RiskScoreProps> = ({
  score,
  label,
  showScore = true,
  ringThickness = 4,
  size = 120,
  className,
}) => {
  const clampedScore = Math.max(0, Math.min(100, score));

  // Auto-determine risk level if not provided
  const riskLevel: RiskLevel = useMemo(() => {
    if (label) return label;
    if (clampedScore <= 33) return 'Low';
    if (clampedScore <= 66) return 'Medium';
    return 'High';
  }, [clampedScore, label]);

  // Color coding
  const ringColor = riskLevel === 'Low'
    ? 'url(#gradient-low)'
    : riskLevel === 'Medium'
    ? 'url(#gradient-medium)'
    : 'url(#gradient-high)';

  const labelColor = riskLevel === 'Low'
    ? 'text-success-700 dark:text-success-400'
    : riskLevel === 'Medium'
    ? 'text-warning-700 dark:text-warning-400'
    : 'text-danger-700 dark:text-danger-400';

  const bgColor = riskLevel === 'Low'
    ? 'bg-success-50 dark:bg-success-900/20'
    : riskLevel === 'Medium'
    ? 'bg-warning-50 dark:bg-warning-900/20'
    : 'bg-danger-50 dark:bg-danger-900/20';

  // SVG dimensions
  const viewSize = 200;
  const radius = (viewSize - ringThickness * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (clampedScore / 100) * circumference;

  return (
    <div className={clsx('flex flex-col items-center gap-4', className)}>
      <div className={clsx('rounded-full p-4', bgColor)}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${viewSize} ${viewSize}`}
          className="drop-shadow-elevation-1"
          aria-label={`Risk score: ${clampedScore} out of 100`}
          role="img"
        >
          <defs>
            <linearGradient id="gradient-low" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#16a34a" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
            <linearGradient id="gradient-medium" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#d97706" />
              <stop offset="100%" stopColor="#f59e0b" />
            </linearGradient>
            <linearGradient id="gradient-high" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#dc2626" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
          </defs>

          {/* Background circle */}
          <circle
            cx={viewSize / 2}
            cy={viewSize / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={ringThickness}
            className="text-slate-200 dark:text-slate-700"
          />

          {/* Progress ring */}
          <circle
            cx={viewSize / 2}
            cy={viewSize / 2}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth={ringThickness}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.5s ease-in-out' }}
            transform={`rotate(-90 ${viewSize / 2} ${viewSize / 2})`}
          />

          {/* Center text: score */}
          {showScore && (
            <text
              x={viewSize / 2}
              y={viewSize / 2 - 10}
              textAnchor="middle"
              fontSize="48"
              fontWeight="700"
              fill="currentColor"
              className="text-slate-900 dark:text-white"
            >
              {clampedScore}
            </text>
          )}

          {/* Center text: label */}
          <text
            x={viewSize / 2}
            y={viewSize / 2 + 25}
            textAnchor="middle"
            fontSize="14"
            fontWeight="600"
            fill="currentColor"
            className={labelColor}
          >
            {riskLevel}
          </text>
        </svg>
      </div>

      {/* Legend */}
      <div className="text-center">
        <p className={clsx('text-sm font-semibold', labelColor)}>
          {riskLevel} Risk
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
          Score: {clampedScore}/100
        </p>
      </div>
    </div>
  );
};

export default RiskScore;
