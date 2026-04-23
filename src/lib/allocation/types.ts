export type AllocationStatus =
  | 'RESERVED'
  | 'BACKORDERED'
  | 'PICKED'
  | 'CONSUMED'
  | 'RELEASED'

export interface AllocatedRow {
  productId: string
  quantity: number
  status: 'RESERVED' | 'PICKED'
  allocationId: string
}

export interface ShortfallRow {
  productId: string
  shortBy: number
}

export interface BackorderedRow {
  productId: string
  quantity: number
  allocationId: string
}

export interface AllocateResult {
  jobId: string
  allocated: AllocatedRow[]
  backordered: BackorderedRow[]
  shortfall: ShortfallRow[]
  skipped: boolean
  reason?: string
}
