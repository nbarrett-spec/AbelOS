import type { Meta, StoryObj } from '@storybook/react'
import { Timeline } from '../Timeline'

const meta = {
  title: 'Manufacturing/Timeline',
  component: Timeline,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Timeline>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    nodes: [
      { id: '1', label: 'Order received',   state: 'completed', timestamp: '2026-04-15' },
      { id: '2', label: 'Materials locked', state: 'completed', timestamp: '2026-04-16' },
      { id: '3', label: 'In production',    state: 'active',    timestamp: '2026-04-18', station: 'Line 2' },
      { id: '4', label: 'QC',               state: 'upcoming' },
      { id: '5', label: 'Staging',          state: 'upcoming' },
      { id: '6', label: 'Delivered',        state: 'upcoming' },
    ],
  },
}

export const WithError: Story = {
  args: {
    nodes: [
      { id: '1', label: 'Received',   state: 'completed' },
      { id: '2', label: 'QC',         state: 'error', detail: 'Scratch on frame — rework needed' },
      { id: '3', label: 'Rework',     state: 'active' },
      { id: '4', label: 'Delivered',  state: 'upcoming' },
    ],
  },
}
