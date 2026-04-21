import type { Meta, StoryObj } from '@storybook/react'
import Skeleton, { SkeletonText, SkeletonCard, SkeletonKPIRow } from '../Skeleton'

const meta = {
  title: 'Primitives/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
} satisfies Meta<typeof Skeleton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { className: 'w-40 h-4' } }
export const Text: Story = { render: () => <SkeletonText lines={4} /> }
export const Card: Story = { render: () => <SkeletonCard /> }
export const KPIRow: Story = { render: () => <SkeletonKPIRow /> }
