import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { Sheet } from '../Sheet'
import Button from '../Button'

const meta = {
  title: 'Overlays/Sheet',
  component: Sheet,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Sheet>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(false)
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Open Sheet</Button>
        <Sheet
          open={open}
          onClose={() => setOpen(false)}
          title="Pulte — Walnut Hills, Plan 2450"
          subtitle="Job #JOB-004212 · PM: Brittney Werner"
          timeline={[
            { id: '1', at: '2026-04-15', label: 'Order created', tone: 'brand' },
            { id: '2', at: '2026-04-16', label: 'Materials reserved' },
            { id: '3', at: '2026-04-18', label: 'In production', tone: 'accent' },
            { id: '4', at: '2026-04-20', label: 'Delivered', tone: 'success' },
          ] as any}
          files={[
            { id: 'f1', name: 'takeoff.pdf', size: 142_008, uploadedAt: '2026-04-15' },
          ] as any}
          raw={{ id: 'JOB-004212', builder: 'Pulte', total: 42_150 }}
        >
          <div className="space-y-2 text-sm">
            <p>Quick-look details panel.</p>
            <p className="text-fg-muted">
              Spec: 32 doors, Therma-Tru S200, Kwikset Austin, knocker in kit.
            </p>
          </div>
        </Sheet>
      </div>
    )
  },
}

export const Wide: Story = {
  render: () => {
    const [open, setOpen] = useState(false)
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Open Wide</Button>
        <Sheet open={open} onClose={() => setOpen(false)} width="wide" title="Wide sheet example">
          <p className="text-sm">Wider 540px variant.</p>
        </Sheet>
      </div>
    )
  },
}
