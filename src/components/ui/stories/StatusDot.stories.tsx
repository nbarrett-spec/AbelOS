import type { Meta, StoryObj } from '@storybook/react'
import StatusDot from '../StatusDot'

const meta = {
  title: 'Live Signal/StatusDot',
  component: StatusDot,
  tags: ['autodocs'],
  argTypes: {
    tone: {
      control: 'select',
      options: ['active', 'success', 'alert', 'info', 'offline', 'live'],
    },
    size: { control: { type: 'number', min: 4, max: 16 } },
  },
  args: { tone: 'live', size: 8 },
} satisfies Meta<typeof StatusDot>

export default meta
type Story = StoryObj<typeof meta>

export const Live: Story = { args: { tone: 'live' } }
export const Active: Story = { args: { tone: 'active' } }
export const Success: Story = { args: { tone: 'success' } }
export const Alert: Story = { args: { tone: 'alert' } }
export const Offline: Story = { args: { tone: 'offline' } }

export const AllTones: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      {(['live', 'active', 'success', 'alert', 'info', 'offline'] as const).map((t) => (
        <div key={t} className="flex items-center gap-2 text-xs text-fg-muted">
          <StatusDot tone={t} size={8} />
          <span>{t}</span>
        </div>
      ))}
    </div>
  ),
}
