// ── Abel OS Design System ─────────────────────────────────────────────────
// Shared UI primitives for consistent look and feel across the platform.
//
// Usage:
//   import { Button, Card, Badge, Input, Modal, KPICard } from '@/components/ui'
//
// Each component supports light/dark mode, accessibility, and Abel branding.
// ──────────────────────────────────────────────────────────────────────────

export { default as Button } from './Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button'

export { default as Card, CardHeader, CardBody, CardFooter } from './Card'
export type { CardProps, CardVariant, CardPadding } from './Card'

export { default as Badge } from './Badge'
export type { BadgeProps, BadgeVariant, BadgeSize } from './Badge'

export { default as Input } from './Input'
export type { InputProps } from './Input'

export { default as Modal } from './Modal'
export type { ModalProps } from './Modal'

export { default as KPICard } from './KPICard'
export type { KPICardProps } from './KPICard'

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
