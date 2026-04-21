import type { Meta, StoryObj } from '@storybook/react'
import Avatar from '../Avatar'

const meta = {
  title: 'Primitives/Avatar',
  component: Avatar,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg', 'xl'] },
    status: { control: 'select', options: [undefined, 'online', 'away', 'offline'] },
  },
  args: { name: 'Nate Barrett', size: 'md' },
} satisfies Meta<typeof Avatar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Online: Story = { args: { status: 'online' } }
export const Away: Story = { args: { status: 'away' } }
export const WithImage: Story = {
  args: { src: 'https://i.pravatar.cc/100?img=12', size: 'lg' },
}
export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Avatar name="Sean P" size="sm" />
      <Avatar name="Dawn M" size="md" />
      <Avatar name="Clint V" size="lg" />
      <Avatar name="Nate B" size="xl" />
    </div>
  ),
}
