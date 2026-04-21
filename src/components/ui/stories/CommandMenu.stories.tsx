import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import CommandMenu from '../CommandMenu'
import Button from '../Button'
import { FileText, Home, Search } from 'lucide-react'

const meta = {
  title: 'Primitives/CommandMenu',
  component: CommandMenu,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CommandMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Open ⌘K menu</Button>
        <CommandMenu open={open} onClose={() => setOpen(false)} />
      </div>
    )
  },
}
