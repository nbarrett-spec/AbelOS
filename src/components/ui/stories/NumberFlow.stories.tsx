import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useState } from 'react'
import NumberFlow from '../NumberFlow'

const meta = {
  title: 'Live Signal/NumberFlow',
  component: NumberFlow,
  tags: ['autodocs'],
  argTypes: {
    format: {
      control: 'select',
      options: ['integer', 'decimal', 'currency', 'percent', 'compact'],
    },
    size: { control: 'select', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
    value: { control: { type: 'number' } },
  },
  args: { value: 42150, format: 'currency', size: 'lg' },
} satisfies Meta<typeof NumberFlow>

export default meta
type Story = StoryObj<typeof meta>

export const Currency: Story = { args: { value: 42150.5, format: 'currency' } }
export const Integer: Story = { args: { value: 1847, format: 'integer' } }
export const Percent: Story = { args: { value: 0.234, format: 'percent' } }
export const Compact: Story = { args: { value: 1_240_000, format: 'compact' } }
export const Decimal: Story = { args: { value: 42.5, format: 'decimal', decimals: 2 } }

// Animated demo — increments once per second
export const AnimatedLive: Story = {
  args: { value: 1000, format: 'currency', size: 'xl' },
  render: (args) => {
    const [v, setV] = useState(args.value as number)
    useEffect(() => {
      const t = setInterval(() => {
        setV((x) => (x ?? 0) + Math.round(Math.random() * 500 - 100))
      }, 1500)
      return () => clearInterval(t)
    }, [])
    return <NumberFlow {...args} value={v} />
  },
}

export const AllSizes: Story = {
  args: { value: 42150.5, format: 'currency' },
  render: (args) => (
    <div className="flex items-baseline gap-5">
      <NumberFlow {...args} size="xs" />
      <NumberFlow {...args} size="sm" />
      <NumberFlow {...args} size="md" />
      <NumberFlow {...args} size="lg" />
      <NumberFlow {...args} size="xl" />
    </div>
  ),
}
