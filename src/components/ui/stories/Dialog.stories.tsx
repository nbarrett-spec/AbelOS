import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { Dialog } from '../Dialog'
import Button from '../Button'

const meta = {
  title: 'Overlays/Dialog',
  component: Dialog,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(false)
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Open Dialog</Button>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Credit hold review"
          description="Place Pulte on credit hold until current invoice is settled."
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="danger" onClick={() => setOpen(false)}>Place on hold</Button>
            </div>
          }
        >
          <p className="text-sm text-fg-muted">
            Outstanding balance: $412,500. DSO: 47 days. Last payment: 2026-03-18.
          </p>
        </Dialog>
      </div>
    )
  },
}

export const Large: Story = {
  render: () => {
    const [open, setOpen] = useState(false)
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Open large</Button>
        <Dialog open={open} onClose={() => setOpen(false)} size="lg" title="Order #SO-003707">
          <p className="text-sm">Full order editor goes here.</p>
        </Dialog>
      </div>
    )
  },
}
