import type { Meta, StoryObj } from '@storybook/react'
import Input from '../Input'
import { Search, Mail } from 'lucide-react'

const meta = {
  title: 'Primitives/Input',
  component: Input,
  tags: ['autodocs'],
  args: { placeholder: 'Type here…' },
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const WithLabel: Story = { args: { label: 'Email', placeholder: 'you@company.com' } }
export const WithIcon: Story = {
  args: { leftIcon: <Search className="w-4 h-4" />, placeholder: 'Search…' },
}
export const Error: Story = {
  args: { label: 'Email', error: 'Email is required', leftIcon: <Mail className="w-4 h-4" /> },
}
export const Disabled: Story = { args: { disabled: true, placeholder: 'Disabled' } }
