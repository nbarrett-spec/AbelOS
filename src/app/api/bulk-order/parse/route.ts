export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface ParsedItem {
  sku: string
  productId?: string
  name?: string
  price?: number
  requestedQty: number
  stock?: number
  matched: boolean
}

interface ParseResponse {
  parsed: ParsedItem[]
  matchedCount: number
  unmatchedCount: number
}

function detectDelimiter(text: string): string {
  // Count occurrences of each delimiter in the first non-empty line
  const firstLine = text.split('\n').find(line => line.trim())
  if (!firstLine) return ','

  const commaCount = (firstLine.match(/,/g) || []).length
  const tabCount = (firstLine.match(/\t/g) || []).length
  const spaceCount = (firstLine.match(/ /g) || []).length

  // Prefer tab > comma > space
  if (tabCount > 0) return '\t'
  if (commaCount > 0) return ','
  if (spaceCount > 0) return ' '
  return ','
}

function parseLines(text: string, delimiter: string): Array<[string, string]> {
  return text
    .trim()
    .split('\n')
    .map(line => {
      const parts = line.split(delimiter).map(p => p.trim()).filter(p => p)
      return [parts[0], parts[1]] as [string, string]
    })
    .filter(([sku, qty]) => sku && qty && !isNaN(Number(qty)))
}

export async function POST(request: NextRequest) {
  const auth = await getSession()
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { lines } = body

    if (!lines || typeof lines !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "lines" parameter' },
        { status: 400 }
      )
    }

    // Auto-detect delimiter
    const delimiter = detectDelimiter(lines)
    const parsed = parseLines(lines, delimiter)

    const result: ParsedItem[] = []

    for (const [sku, qtyStr] of parsed) {
      const qty = parseInt(qtyStr, 10)

      // Query product by SKU
      const product = await prisma.$queryRawUnsafe<
        Array<{ id: string; sku: string; name: string; basePrice: number; cleanCategory: string }>
      >(
        `
        SELECT "id", "sku", "name", "basePrice", "cleanCategory"
        FROM "Product"
        WHERE LOWER("sku") = LOWER($1) AND "active" = true
        LIMIT 1
        `,
        sku
      )

      if (product.length === 0) {
        result.push({
          sku,
          requestedQty: qty,
          matched: false,
        })
        continue
      }

      const prod = product[0]

      // Check inventory
      const inventory = await prisma.$queryRawUnsafe<
        Array<{ quantity: number }>
      >(
        `
        SELECT "onHand" as quantity
        FROM "InventoryItem"
        WHERE "productId" = $1
        LIMIT 1
        `,
        prod.id
      )

      const stock = inventory.length > 0 ? inventory[0].quantity : 0

      result.push({
        sku: prod.sku,
        productId: prod.id,
        name: prod.name,
        price: prod.basePrice,
        requestedQty: qty,
        stock,
        matched: true,
      })
    }

    const matchedCount = result.filter(r => r.matched).length
    const unmatchedCount = result.filter(r => !r.matched).length

    const response: ParseResponse = {
      parsed: result,
      matchedCount,
      unmatchedCount,
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    console.error('POST /api/bulk-order/parse error:', error)
    return NextResponse.json(
      { error: 'Failed to parse bulk order' },
      { status: 500 }
    )
  }
}
