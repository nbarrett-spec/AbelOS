import type { Meta, StoryObj } from '@storybook/react'
import Badge from '../Badge'

const meta = {
  title: 'Primitives/Badge',
  component: Badge,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['neutral', 'brand', 'accent', 'positive', 'negative', 'warning', 'forecast', 'danger', 'success'],
    },
    size: { control: 'select', options: ['xs', 'sm', 'md'] },
    dot: { control: 'boolean' },
  },
  args: { children: 'Badge' },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Neutral: Story = { args: { variant: 'neutral' } }
export const Success: Story = { args: { variant: 'positive' as any } }
export const Danger: Story = { args: { variant: 'danger' as any } }
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="neutral">Neutral</Badge>
      <Badge variant="brand">Brand</Badge>
      <Badge variant="accent">Accent</Badge>
      <Badge variant={'positive' as any}>Positive</Badge>
      <Badge variant={'negative' as any}>Negative</Badge>
      <Badge variant={'warning' as any} dot>With dot</Badge>
    </div>
  ),
}
