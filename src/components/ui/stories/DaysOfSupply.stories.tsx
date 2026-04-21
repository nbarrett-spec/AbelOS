import type { Meta, StoryObj } from '@storybook/react'
import { DaysOfSupply } from '../DaysOfSupply'

const meta = {
  title: 'Supply Chain/DaysOfSupply',
  component: DaysOfSupply,
  tags: ['autodocs'],
  argTypes: {
    days: { control: { type: 'number', min: 0, max: 60 } },
    daysUntilDelivery: { control: { type: 'number', min: 0, max: 30 } },
    max: { control: { type: 'number', min: 10, max: 60 } },
  },
  args: { days: 12, max: 30, showLabel: true },
} satisfies Meta<typeof DaysOfSupply>

export default meta
type Story = StoryObj<typeof meta>

export const Healthy: Story = { args: { days: 22 } }
export const Warn: Story = { args: { days: 10 } }
export const Critical: Story = { args: { days: 4 } }
export const StockoutBeforeDelivery: Story = {
  args: { days: 5, daysUntilDelivery: 9 },
}
export const AllStates: Story = {
  render: () => (
    <div className="w-[320px] space-y-3">
      <DaysOfSupply days={22} label="SKU-1001 Jeld-Wen IWP" />
      <DaysOfSupply days={10} label="SKU-1002 Masonite Logan" />
      <DaysOfSupply days={4}  label="SKU-1003 Therma-Tru Pulse" />
      <DaysOfSupply days={5} daysUntilDelivery={9} label="SKU-1004 Emtek Levers" />
    </div>
  ),
}
