// ── Aegis Design System ───────────────────────────────────────────────────
// Shared UI primitives for consistent look and feel across Abel OS.
//
// Usage:
//   import { Button, Card, Badge, StatusBadge, KPICard, Sparkline,
//            PageHeader, Breadcrumb, DataTable, CommandMenu, StatusBar,
//            useCommandMenu } from '@/components/ui'
//
// Three-layer token architecture:
//   Primitive  — walnut-*, amber-*, stone-*, data-green-*, forecast-*
//   Semantic   — canvas, surface, fg, border, accent, data-positive,
//                data-negative, forecast, etc.
//   Component  — Button, Card, KPICard, DataTable, Badge, etc.
// ──────────────────────────────────────────────────────────────────────────

export { default as Button } from './Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button'

export { default as Card, CardHeader, CardBody, CardFooter, CardTitle, CardDescription } from './Card'
export type { CardProps, CardVariant, CardPadding, CardRounded } from './Card'

export { default as Badge, StatusBadge } from './Badge'
export type { BadgeProps, BadgeVariant, BadgeSize, StatusBadgeProps } from './Badge'

export { default as Input } from './Input'
export type { InputProps } from './Input'

export { default as Modal } from './Modal'
export type { ModalProps } from './Modal'

export { default as KPICard } from './KPICard'
export type { KPICardProps } from './KPICard'

export { default as Sparkline } from './Sparkline'
export type { SparklineProps } from './Sparkline'

export { default as PageHeader, Breadcrumb } from './PageHeader'
export type { PageHeaderProps, Crumb } from './PageHeader'

export { default as DataTable } from './DataTable'
export type { DataTableProps, DataTableColumn, SortDir } from './DataTable'

export { default as CommandMenu, useCommandMenu } from './CommandMenu'
export type { CommandMenuProps, CommandItem } from './CommandMenu'

export { default as StatusBar } from './StatusBar'
export type { StatusBarProps, StatusBarItem } from './StatusBar'

export { Table, TableHead, TableHeader, TableBody, TableRow, TableCell, TableEmpty } from './Table'

export { default as Tabs } from './Tabs'
export type { TabsProps, Tab } from './Tabs'

export { default as Avatar } from './Avatar'
export type { AvatarProps } from './Avatar'

export { default as Progress, StepProgress } from './Progress'
export type { ProgressProps, StepProgressProps } from './Progress'

export { default as Tooltip } from './Tooltip'
export type { TooltipProps } from './Tooltip'

export { default as Skeleton, SkeletonText, SkeletonCard, SkeletonTableRow, SkeletonKPIRow } from './Skeleton'
export type { SkeletonProps, SkeletonTextProps, SkeletonCardProps } from './Skeleton'

export { default as EmptyState } from './EmptyState'
export type { EmptyStateProps, EmptyStateIcon } from './EmptyState'

// ── Advanced micro-UX primitives (v2) ────────────────────────────────────
export { default as AnimatedNumber } from './AnimatedNumber'
export type { AnimatedNumberProps } from './AnimatedNumber'

export { default as HoverPreview } from './HoverPreview'
export type { HoverPreviewProps } from './HoverPreview'

export { default as LiveDataIndicator } from './LiveDataIndicator'
export type { LiveDataIndicatorProps } from './LiveDataIndicator'

export { default as ShortcutsOverlay } from './ShortcutsOverlay'
export type { Shortcut, ShortcutsOverlayProps } from './ShortcutsOverlay'

export { default as InfoTip } from './InfoTip'
export type { InfoTipProps } from './InfoTip'

export { default as PresenceBar } from './PresenceBar'
export type { PresenceBarProps, PresenceUser } from './PresenceBar'

// ── Realtime / collaborative / AI surface (v3) ───────────────────────────
export { default as PresenceAvatars } from './PresenceAvatars'
export type { PresenceAvatarsProps } from './PresenceAvatars'

export { default as AIInsight } from './AIInsight'
export type { AIInsightProps } from './AIInsight'

export { default as LiveClock } from './LiveClock'
export { default as HealthChip } from './HealthChip'
export { default as RecentActivityDrawer } from './RecentActivityDrawer'
