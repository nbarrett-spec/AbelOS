import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import Tabs from '../Tabs'

const meta = {
  title: 'Primitives/Tabs',
  component: Tabs,
  tags: ['autodocs'],
} satisfies Meta<typeof Tabs>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => {
    const [active, setActive] = useState('overview')
    return (
      <div className="w-[500px]">
        <Tabs
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'builders', label: 'Builders', badge: 12 },
            { id: 'orders',   label: 'Orders',   badge: 3 },
            { id: 'reports',  label: 'Reports' },
          ]}
          activeId={active}
          onChange={setActive}
        />
        <div className="p-4 text-sm text-fg-muted">Active: {active}</div>
      </div>
    )
  },
}
