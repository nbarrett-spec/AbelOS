import type { Meta, StoryObj } from '@storybook/react'
import Sparkline from '../Sparkline'

const meta = {
  title: 'Live Signal/Sparkline',
  component: Sparkline,
  tags: ['autodocs'],
  args: {
    data: [3, 4, 6, 5, 7, 8, 10, 9, 12, 14, 13, 15],
    width: 120,
    height: 36,
    showArea: true,
    showDot: true,
  },
} satisfies Meta<typeof Sparkline>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const NoArea: Story = { args: { showArea: false } }
export const WithForecast: Story = {
  args: {
    data: [10, 12, 14, 13, 15, 17, 18, 20, 22, 25, 28, 30],
    forecastFromIndex: 8,
  },
}
export const Flat: Story = { args: { data: [5, 5, 5, 5, 5] } }
export const Large: Story = { args: { width: 320, height: 80 } }
