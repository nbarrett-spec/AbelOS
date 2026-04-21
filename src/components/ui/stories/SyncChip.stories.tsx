import type { Meta, StoryObj } from '@storybook/react'
import SyncChip from '../SyncChip'

const meta = {
  title: 'Live Signal/SyncChip',
  component: SyncChip,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof SyncChip>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { pollMs: 5_000 } }

export const WithSources: Story = {
  args: {
    sources: [
      { name: 'InFlow', lastSyncAt: new Date(Date.now() - 2_000).toISOString(), status: 'ok' },
      { name: 'Hyphen', lastSyncAt: new Date(Date.now() - 180_000).toISOString(), status: 'warn', error: '0/80 linked — diagnostic pending' },
      { name: 'Stripe', lastSyncAt: new Date(Date.now() - 10_000).toISOString(), status: 'ok' },
      { name: 'Gmail',  lastSyncAt: new Date(Date.now() - 60_000).toISOString(), status: 'error', error: 'auth expired' },
    ],
  },
}
