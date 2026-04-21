import type { Meta, StoryObj } from '@storybook/react'
import DataTable from '../DataTable'

type Row = { id: string; builder: string; orders: number; revenue: number; dso: number }

const rows: Row[] = [
  { id: '1', builder: 'Pulte',      orders: 48, revenue: 412_500, dso: 32 },
  { id: '2', builder: 'Brookfield', orders: 22, revenue: 188_230, dso: 41 },
  { id: '3', builder: 'Bloomfield', orders: 17, revenue: 145_600, dso: 28 },
  { id: '4', builder: 'Lennar',     orders: 11, revenue: 92_100,  dso: 36 },
  { id: '5', builder: 'DR Horton',  orders: 9,  revenue: 71_400,  dso: 45 },
]

const meta = {
  title: 'Primitives/DataTable',
  component: DataTable,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof DataTable>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <div className="w-[720px]">
      <DataTable
        data={rows}
        columns={[
          { key: 'builder', header: 'Builder', sortable: true },
          { key: 'orders',  header: 'Orders',  numeric: true },
          { key: 'revenue', header: 'Revenue', numeric: true, cell: (r) => `$${r.revenue.toLocaleString()}` },
          { key: 'dso',     header: 'DSO',     numeric: true, heatmap: true, cell: (r) => `${r.dso}d` },
        ]}
      />
    </div>
  ),
}

export const Loading: Story = {
  render: () => (
    <div className="w-[720px]">
      <DataTable
        data={[]}
        columns={[
          { key: 'builder', header: 'Builder' },
          { key: 'orders',  header: 'Orders', numeric: true },
          { key: 'revenue', header: 'Revenue', numeric: true },
        ]}
        loading
      />
    </div>
  ),
}

export const Compact: Story = {
  render: () => (
    <div className="w-[720px]">
      <DataTable
        density="compact"
        data={rows}
        columns={[
          { key: 'builder', header: 'Builder' },
          { key: 'orders',  header: 'Orders',  numeric: true },
          { key: 'revenue', header: 'Revenue', numeric: true, cell: (r) => `$${r.revenue.toLocaleString()}` },
        ]}
      />
    </div>
  ),
}
