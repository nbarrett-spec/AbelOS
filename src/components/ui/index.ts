// ── Aegis Design System — Phase 2 "Drafting Room" primitives ──────────────
// Shared UI primitives for consistent look and feel across Aegis (Abel OS).
//
// Three-layer token architecture (see globals.css):
//   Primitive  — navy, gold, walnut, amber, status colors
//   Semantic   — canvas, surface, fg, border, signal, data-positive,
//                data-negative, forecast, etc.
//   Component  — Button, Card, KPICard, DataTable, Badge, etc.
// ──────────────────────────────────────────────────────────────────────────

// Core primitives
export { default as Button, Button as ButtonNamed } from './Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button'

export { default as Input, Input as InputNamed } from './Input'
export type { InputProps } from './Input'

export { default as Badge, Badge as BadgeNamed, StatusBadge } from './Badge'
export type { BadgeProps, BadgeVariant, BadgeSize, StatusBadgeProps } from './Badge'

export { default as Kbd, Kbd as KbdNamed } from './Kbd'
export type { KbdProps } from './Kbd'

export { default as StatusDot, StatusDot as StatusDotNamed } from './StatusDot'
export type { StatusDotProps, StatusDotTone } from './StatusDot'

export { default as Avatar, Avatar as AvatarNamed } from './Avatar'
export type { AvatarProps, AvatarSize, AvatarStatus } from './Avatar'

// Data surfaces
export { default as Sparkline, Sparkline as SparklineNamed } from './Sparkline'
export type { SparklineProps } from './Sparkline'

export { default as NumberFlow, NumberFlow as NumberFlowNamed } from './NumberFlow'
export type { NumberFlowProps, NumberFlowFormat, NumberFlowSize } from './NumberFlow'

export { default as HeatmapCell, HeatmapCell as HeatmapCellNamed } from './HeatmapCell'
export type { HeatmapCellProps } from './HeatmapCell'

export { default as DaysOfSupply, DaysOfSupply as DaysOfSupplyNamed } from './DaysOfSupply'
export type { DaysOfSupplyProps } from './DaysOfSupply'

export { default as Timeline, Timeline as TimelineNamed } from './Timeline'
export type { TimelineProps, TimelineNode, TimelineNodeState } from './Timeline'

// Overlays
export { default as Dialog, Dialog as DialogNamed } from './Dialog'
export type { DialogProps } from './Dialog'

// Back-compat alias — existing callers import { Modal } from '@/components/ui'
export { default as Modal } from './Modal'
export type { ModalProps } from './Modal'

export { default as Sheet, Sheet as SheetNamed } from './Sheet'
export type {
  SheetProps,
  SheetTabId,
  SheetTimelineEntry,
  SheetFile,
  SheetLink,
  SheetAuditEntry,
  SheetWidth,
} from './Sheet'

export { default as CommandMenu, CommandMenu as CommandMenuNamed, useCommandMenu } from './CommandMenu'
export type { CommandMenuProps, CommandItem, CommandScope } from './CommandMenu'

export { default as ToastContainer, ToastContainer as ToastContainerNamed } from './ToastContainer'

// Tables
export {
  Table,
  TableHead,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  TableEmpty,
} from './Table'

export { default as DataTable, DataTable as DataTableNamed } from './DataTable'
export type {
  DataTableProps,
  DataTableColumn,
  DataTableRowAction,
  SortDir,
} from './DataTable'

// Tabs
export { default as Tabs, Tabs as TabsNamed } from './Tabs'
export type { TabsProps, Tab } from './Tabs'

// Skeletons
export {
  default as Skeleton,
  Skeleton as SkeletonNamed,
  SkeletonText,
  SkeletonCard,
  SkeletonTableRow,
  SkeletonKPIRow,
  ContentFade,
  BlueprintReveal,
} from './Skeleton'
export type { SkeletonProps, SkeletonTextProps, SkeletonCardProps } from './Skeleton'

// ── Existing components retained (not part of Phase 2 refactor) ───────────
export { default as Card, CardHeader, CardBody, CardFooter, CardTitle, CardDescription } from './Card'
export type { CardProps, CardVariant, CardPadding, CardRounded } from './Card'

export { default as KPICard } from './KPICard'
export type { KPICardProps } from './KPICard'

export { default as PageHeader, Breadcrumb } from './PageHeader'
export type { PageHeaderProps, Crumb } from './PageHeader'

export { default as StatusBar } from './StatusBar'
export type { StatusBarProps, StatusBarItem } from './StatusBar'

export { default as Progress, StepProgress } from './Progress'
export type { ProgressProps, StepProgressProps } from './Progress'

export { default as Tooltip } from './Tooltip'
export type { TooltipProps } from './Tooltip'

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

export { default as PresenceAvatars } from './PresenceAvatars'
export type { PresenceAvatarsProps } from './PresenceAvatars'

export { default as AIInsight } from './AIInsight'
export type { AIInsightProps } from './AIInsight'

export { default as LiveClock } from './LiveClock'
export { default as HealthChip } from './HealthChip'
export { default as RecentActivityDrawer } from './RecentActivityDrawer'

// ── Sync + density ────────────────────────────────────────────────────────
export { default as SyncChip } from './SyncChip'
export type { SyncChipProps, SyncState, SyncSourceInfo } from './SyncChip'

export { default as DensityToggle } from './DensityToggle'

// ── Signature capture ────────────────────────────────────────────────────
export { default as SignaturePad } from './SignaturePad'
export type { SignaturePadProps } from './SignaturePad'
