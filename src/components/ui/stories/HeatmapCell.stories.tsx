import type { Meta, StoryObj } from '@storybook/react'
import { HeatmapCell } from '../HeatmapCell'

const meta = {
  title: 'Data/HeatmapCell',
  component: HeatmapCell,
  tags: ['autodocs'],
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 1, step: 0.01 } },
    size: { control: { type: 'number', min: 12, max: 64 } },
  },
  args: { value: 0.6, displayValue: '87%', size: 32 },
} satisfies Meta<typeof HeatmapCell>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Grid: Story = {
  render: () => (
    <div className="grid grid-cols-10 gap-1">
      {Array.from({ length: 70 }).map((_, i) => {
        const v = Math.random()
        return (
          <HeatmapCell
            key={i}
            value={v}
            displayValue={`${Math.round(v * 100)}%`}
            label={`Cell ${i}`}
          />
        )
      })}
    </div>
  ),
}
