import type { Meta, StoryObj } from '@storybook/react'
import ToastContainer from '../ToastContainer'
import Button from '../Button'
import { ToastProvider, useToast } from '@/contexts/ToastContext'

const meta = {
  title: 'Overlays/ToastContainer',
  component: ToastContainer,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <ToastProvider>
        <Story />
      </ToastProvider>
    ),
  ],
} satisfies Meta<typeof ToastContainer>

export default meta
type Story = StoryObj<typeof meta>

function DemoButtons() {
  const { addToast } = useToast()
  return (
    <div className="flex gap-2">
      <Button onClick={() => addToast({ type: 'success', title: 'PO #2881 approved', message: 'Boise Cascade confirmed shipment for Friday.' })}>
        Success
      </Button>
      <Button variant="danger" onClick={() => addToast({ type: 'error', title: 'Sync failed', message: 'InFlow returned 502. Retrying in 30s.' })}>
        Error
      </Button>
      <Button variant="secondary" onClick={() => addToast({ type: 'warning', title: 'Credit limit near', message: 'Brookfield within 8% of their cap.' })}>
        Warning
      </Button>
      <Button variant="ghost" onClick={() => addToast({ type: 'info', title: 'New quote', message: 'Dalton drafted a quote for Cross Custom.' })}>
        Info
      </Button>
    </div>
  )
}

export const Playground: Story = {
  render: () => (
    <>
      <DemoButtons />
      <ToastContainer />
    </>
  ),
}
