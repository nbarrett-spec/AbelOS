/**
 * Intelligence Component Library
 * Reusable, composable insight components for AI-powered intelligence across the app.
 *
 * All components are fully accessible, dark-mode ready, and responsive.
 */

// Utility Components
export { default as SkeletonBlock } from './SkeletonBlock';
export type { SkeletonBlockProps } from './SkeletonBlock';

export { default as Sparkline } from './Sparkline';
export type { SparklineProps } from './Sparkline';

// Data Visualization & Status
export { default as TrendBadge } from './TrendBadge';
export type { TrendBadgeProps, TrendDirection } from './TrendBadge';

export { default as KpiTile } from './KpiTile';
export type { KpiTileProps } from './KpiTile';

export { default as RiskScore } from './RiskScore';
export type { RiskScoreProps, RiskLevel } from './RiskScore';

export { default as HealthMeter } from './HealthMeter';
export type {
  HealthMeterProps,
  HealthSegment,
  HealthStatus,
} from './HealthMeter';

// Insight & Alert Components
export { default as InsightCard } from './InsightCard';
export type { InsightCardProps, InsightSeverity } from './InsightCard';

export { default as InsightStrip } from './InsightStrip';
export type { InsightStripProps, InsightItem } from './InsightStrip';

export { default as AnomalyBanner } from './AnomalyBanner';
export type { AnomalyBannerProps, AnomalySeverity } from './AnomalyBanner';

// Builder/Operations Components
export { default as ForecastStrip } from './ForecastStrip';
export type {
  ForecastStripProps,
  ReorderForecastItem,
} from './ForecastStrip';
