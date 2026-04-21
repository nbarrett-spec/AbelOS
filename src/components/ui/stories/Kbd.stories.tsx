import type { Meta, StoryObj } from '@storybook/react'
import { Kbd } from '../Kbd'

const meta = {
  title: 'Primitives/Kbd',
  component: Kbd,
  tags: ['autodocs'],
  argTypes: { size: { control: 'select', options: ['xs', 'sm', 'md'] } },
  args: { children: 'K', size: 'sm' },
} satisfies Meta<typeof Kbd>

export default meta
type Story = StoryObj<typeof meta>

export const Single: Story = { args: { children: '⌘' } }
export const Chord: Story = {
  render: () => (
    <span className="flex items-center gap-1">
      <Kbd>⌘</Kbd>
      <span className="text-fg-muted text-xs">+</span>
      <Kbd>K</Kbd>
    </span>
  ),
}
export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Kbd size="xs">Esc</Kbd>
      <Kbd size="sm">Enter</Kbd>
      <Kbd size="md">Shift</Kbd>
    </div>
  ),
}
