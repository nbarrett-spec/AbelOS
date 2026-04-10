/**
 * Boise Cascade Integration — Test Examples & Usage Patterns
 *
 * These are concrete examples showing how to use the integration library.
 * Can be adapted to actual test files or used for manual testing.
 */

import {
  parseCSV,
  matchSKU,
  calculatePriceChange,
  batchImport,
  batchApply,
  getPriceAlerts,
  getBatchHistory
} from './boise-cascade'

// ──────────────────────────────────────────────────────────────────────────
// Example 1: Parse a CSV Price Sheet
// ──────────────────────────────────────────────────────────────────────────

async function example_parseCSV() {
  const csvContent = `Item Number,Description,UOM,List Price,Net Price,Effective Date
234-56789,2x4x8 Framing Lumber,EA,45.99,34.50,2024-03-25
345-67890,3/4 Plywood Sheathing 4x8,SHT,89.99,62.50,2024-03-25
456-78901,1x6x8 Pine Trim,LF,2.99,1.89,2024-03-25`

  const rows = parseCSV(csvContent)

  console.log('Parsed rows:', rows)
  // Output:
  // [
  //   {
  //     supplierSku: '234-56789',
  //     description: '2x4x8 Framing Lumber',
  //     uom: 'EA',
  //     listPrice: 45.99,
  //     netPrice: 34.50
  //   },
  //   ...
  // ]
}

// ──────────────────────────────────────────────────────────────────────────
// Example 2: Match SKU to Abel Product
// ──────────────────────────────────────────────────────────────────────────

async function example_matchSKU() {
  // Exact match (if Abel has product with SKU '234-56789')
  const exactMatch = await matchSKU('234-56789', '2x4x8 Framing Lumber')
  console.log('Exact match:', exactMatch)
  // Output:
  // {
  //   productId: 'prod_123',
  //   productName: '2x4x8 Framing Lumber',
  //   productSku: '234-56789',
  //   matchType: 'exact',
  //   confidence: 1.0,
  //   supplierSku: '234-56789',
  //   supplierProductName: '2x4x8 Framing Lumber'
  // }

  // Fuzzy match (if no exact match but similar name exists)
  const fuzzyMatch = await matchSKU('BC-999', '2x4x8 Lumber')
  console.log('Fuzzy match:', fuzzyMatch)
  // Output:
  // {
  //   productId: 'prod_123',
  //   productName: '2x4x8 Framing Lumber',
  //   productSku: '234-56789',
  //   matchType: 'fuzzy',
  //   confidence: 0.85,
  //   supplierSku: 'BC-999',
  //   supplierProductName: '2x4x8 Lumber'
  // }

  // No match
  const noMatch = await matchSKU('UNKNOWN-999', 'Weird product')
  console.log('No match:', noMatch) // null
}

// ──────────────────────────────────────────────────────────────────────────
// Example 3: Calculate Price Change Impact
// ──────────────────────────────────────────────────────────────────────────

async function example_calculatePriceChange() {
  // Scenario: Cost increases, margin protection kicks in
  const change = await calculatePriceChange('prod_123', 34.50)

  console.log('Price change result:', change)
  // Output (assuming old cost was 32.50):
  // {
  //   productId: 'prod_123',
  //   productName: '2x4x8 Framing Lumber',
  //   supplierSku: '234-56789',
  //   previousCost: 32.50,
  //   newCost: 34.50,
  //   costChange: 2.00,
  //   costChangePct: 6.15,
  //   currentPrice: 89.99,
  //   suggestedPrice: 92.49,        // Adjusted to maintain margin
  //   currentMarginPct: 64.03,
  //   newMarginPct: 62.84,
  //   marginBelowThreshold: false,
  //   minMargin: 0.25
  // }
}

// ──────────────────────────────────────────────────────────────────────────
// Example 4: Batch Import CSV → Matched Updates
// ──────────────────────────────────────────────────────────────────────────

async function example_batchImport() {
  const csvContent = `Item Number,Description,UOM,List Price,Net Price
234-56789,2x4x8 Framing Lumber,EA,45.99,34.50
345-67890,3/4 Plywood Sheathing,SHT,89.99,62.50
999-99999,Unknown Product,EA,99.99,75.00`

  const result = await batchImport(csvContent, 'BOISE_CASCADE')

  console.log('Batch import result:')
  console.log(`- Batch ID: ${result.batchId}`)
  console.log(`- Total rows: ${result.totalRows}`)
  console.log(`- Matched: ${result.matchedProducts}`)
  console.log(`- Unmatched: ${result.unmatchedRows}`)
  console.log('Matched updates:', result.matchedUpdates)
  console.log('Unmatched items:', result.unmatchedItems)

  // Output:
  // {
  //   batchId: 'BOISE_1711353661234_abc123def',
  //   supplier: 'BOISE_CASCADE',
  //   totalRows: 3,
  //   matchedProducts: 2,
  //   unmatchedRows: 1,
  //   matchedUpdates: [
  //     {
  //       id: 'update_1',
  //       supplier: 'BOISE_CASCADE',
  //       batchId: 'BOISE_1711353661234_abc123def',
  //       productId: 'prod_123',
  //       supplierSku: '234-56789',
  //       productName: '2x4x8 Framing Lumber',
  //       previousCost: 32.50,
  //       newCost: 34.50,
  //       costChange: 2.00,
  //       costChangePct: 6.15,
  //       currentPrice: 89.99,
  //       suggestedPrice: 92.49,
  //       currentMarginPct: 64.03,
  //       newMarginPct: 62.84,
  //       status: 'PENDING',
  //       matchType: 'exact',
  //       matchConfidence: 1.0
  //     },
  //     { /* ... more updates ... */ }
  //   ],
  //   unmatchedItems: [
  //     {
  //       supplierSku: '999-99999',
  //       supplierProductName: 'Unknown Product',
  //       reason: 'No matching product found in catalog'
  //     }
  //   ]
  // }
}

// ──────────────────────────────────────────────────────────────────────────
// Example 5: Approve Updates
// ──────────────────────────────────────────────────────────────────────────

async function example_batchApply_approve() {
  // Approve specific updates
  const result = await batchApply(
    ['update_1', 'update_2'],
    'approve',
    'staff_123'
  )

  console.log(`Applied: ${result.appliedCount}`)
  console.log(`Rejected: ${result.rejectedCount}`)
  console.log(`Errors: ${result.errors.length}`)

  // Output:
  // Applied: 2
  // Rejected: 0
  // Errors: []
}

async function example_batchApply_approveAll() {
  // Approve ALL pending updates from current batch
  const result = await batchApply([], 'approve-all', 'staff_123')

  console.log(`Approved all: ${result.appliedCount} updates`)
  // Output: Approved all: 142 updates
}

async function example_batchApply_reject() {
  // Reject specific updates
  const result = await batchApply(['update_789'], 'reject', 'staff_123')

  console.log(`Rejected: ${result.rejectedCount}`)
  // Output: Rejected: 1
}

// ──────────────────────────────────────────────────────────────────────────
// Example 6: Get Price Alerts (Margin Risk Items)
// ──────────────────────────────────────────────────────────────────────────

async function example_getPriceAlerts() {
  const alerts = await getPriceAlerts()

  console.log(`Price alerts (below minMargin): ${alerts.length}`)

  for (const alert of alerts) {
    console.log(`
  - Product: ${alert.productName}
    New Cost: $${alert.newCost}
    Current Price: $${alert.currentPrice}
    Suggested Price: $${alert.suggestedPrice}
    New Margin: ${alert.marginPct.toFixed(2)}%
    Min Margin: ${alert.minMargin}%
    ⚠️  BELOW THRESHOLD!
    `)
  }

  // Output example:
  // Price alerts (below minMargin): 3
  // - Product: Engineered Joist
  //   New Cost: $145.00
  //   Current Price: $175.00
  //   Suggested Price: $193.33
  //   New Margin: 17.14%
  //   Min Margin: 25%
  //   ⚠️  BELOW THRESHOLD!
}

// ──────────────────────────────────────────────────────────────────────────
// Example 7: Get Batch History & Analytics
// ──────────────────────────────────────────────────────────────────────────

async function example_getBatchHistory() {
  const history = await getBatchHistory(10)

  console.log('Recent import batches:')
  for (const batch of history) {
    const approvalRate = batch.total > 0
      ? ((batch.approved / batch.total) * 100).toFixed(1)
      : '0'

    console.log(`
  Batch: ${batch.batchId}
  - Total: ${batch.total} items
  - Approved: ${batch.approved} (${approvalRate}%)
  - Pending: ${batch.pending}
  - Rejected: ${batch.rejected}
  - Avg cost change: ${batch.avg_cost_change_pct || 'N/A'}%
    `)
  }

  // Output example:
  // Recent import batches:
  // Batch: BOISE_1711353661234_abc123def
  // - Total: 150 items
  // - Approved: 142 (94.7%)
  // - Pending: 0
  // - Rejected: 8
  // - Avg cost change: 4.23%
}

// ──────────────────────────────────────────────────────────────────────────
// Example 8: Complete Workflow (Upload → Review → Approve)
// ──────────────────────────────────────────────────────────────────────────

async function example_completeWorkflow() {
  console.log('=== BOISE CASCADE PRICE UPDATE WORKFLOW ===\n')

  // 1. Upload CSV
  console.log('1️⃣  UPLOADING CSV FILE')
  const csvContent = `Item Number,Description,Net Price
234-56789,2x4x8 Framing Lumber,34.50
345-67890,3/4 Plywood Sheathing,62.50`

  const importResult = await batchImport(csvContent, 'BOISE_CASCADE')
  console.log(`✅ Imported batch: ${importResult.batchId}`)
  console.log(`   Matched: ${importResult.matchedProducts}/${importResult.totalRows} products\n`)

  // 2. Review alerts
  console.log('2️⃣  CHECKING FOR PRICE ALERTS')
  const alerts = await getPriceAlerts()
  console.log(`⚠️  Found ${alerts.length} items below margin threshold\n`)

  if (alerts.length > 0) {
    console.log('Items requiring review:')
    for (const alert of alerts.slice(0, 3)) {
      console.log(`  - ${alert.productName}: ${alert.marginPct.toFixed(2)}% (min: ${alert.minMargin}%)`)
    }
    console.log()
  }

  // 3. Approve updates
  console.log('3️⃣  APPROVING PRICE UPDATES')
  const updateIds = importResult.matchedUpdates.map(u => u.id || '')
  const applyResult = await batchApply(updateIds, 'approve', 'staff_demo')
  console.log(`✅ Applied: ${applyResult.appliedCount} updates`)
  console.log(`❌ Rejected: ${applyResult.rejectedCount} updates\n`)

  // 4. View history
  console.log('4️⃣  VIEWING IMPORT HISTORY')
  const history = await getBatchHistory(5)
  console.log(`📊 Recent batches: ${history.length}`)
  if (history.length > 0) {
    const latest = history[0]
    console.log(`   Latest: ${latest.batchId}`)
    console.log(`   Status: ${latest.pending} pending, ${latest.approved} approved, ${latest.rejected} rejected`)
  }

  console.log('\n✅ WORKFLOW COMPLETE')
}

// ──────────────────────────────────────────────────────────────────────────
// Example 9: Error Handling
// ──────────────────────────────────────────────────────────────────────────

async function example_errorHandling() {
  // Invalid CSV
  const invalidCsv = 'This is not a valid CSV'
  const result1 = await batchImport(invalidCsv)
  console.log(`Unmatched rows (invalid CSV): ${result1.unmatchedRows}`)

  // SKU mismatch
  const result2 = await batchImport(
    'Item Number,Description,Net Price\nUNKNOWN-123,Unknown Product,50.00'
  )
  console.log(`Unmatched items: ${result2.unmatchedItems.length}`)
  console.log(`Reason: ${result2.unmatchedItems[0]?.reason}`)

  // Invalid cost
  const result3 = await batchImport(
    'Item Number,Description,Net Price\n234-56789,Product,invalid'
  )
  console.log(`Invalid cost handled: ${result3.unmatchedRows > 0}`)
}

// ──────────────────────────────────────────────────────────────────────────
// Example 10: CSV Format Variations (Boise Cascade supports many formats)
// ──────────────────────────────────────────────────────────────────────────

async function example_csvVariations() {
  // Format 1: Standard Boise Cascade format
  const format1 = `Item Number,Description,List Price,Net Price
234-56789,2x4x8 Lumber,45.99,34.50
345-67890,Plywood,89.99,62.50`

  // Format 2: With dollar signs
  const format2 = `Item #,Product,Cost
234-56789,2x4x8 Lumber,$34.50
345-67890,Plywood,$62.50`

  // Format 3: With quoted fields
  const format3 = `"Item Number","Description","Our Cost"
"234-56789","2x4x8 Framing Lumber","34.50"
"345-67890","3/4"" Plywood Sheathing","62.50"`

  // Format 4: Comma-separated numbers
  const format4 = `SKU,Product Name,Dealer Price
234-56789,2x4x8 Lumber,"1,234.50"
345-67890,Plywood,"2,562.50"`

  // All are handled automatically
  const result1 = parseCSV(format1)
  const result2 = parseCSV(format2)
  const result3 = parseCSV(format3)
  const result4 = parseCSV(format4)

  console.log(`Format 1 parsed: ${result1.length} rows`)
  console.log(`Format 2 parsed: ${result2.length} rows`)
  console.log(`Format 3 parsed: ${result3.length} rows`)
  console.log(`Format 4 parsed: ${result4.length} rows`)
}

// ──────────────────────────────────────────────────────────────────────────
// Example 11: Calculate Profit Impact
// ──────────────────────────────────────────────────────────────────────────

async function example_profitImpact() {
  const imports = await getBatchHistory(5)

  console.log('💰 PROFIT IMPACT ANALYSIS\n')

  for (const batch of imports) {
    const totalCostImpact = batch.total > 0
      ? (batch.avg_cost_change_pct || 0) * 100  // Rough estimate
      : 0

    const direction = totalCostImpact > 0 ? '📉' : '📈'
    console.log(`${direction} Batch ${batch.batchId.slice(0, 20)}...`)
    console.log(`   Total items: ${batch.total}`)
    console.log(`   Avg cost change: ${batch.avg_cost_change_pct || 0}%`)
    console.log(`   Approval rate: ${((batch.approved / batch.total) * 100).toFixed(1)}%`)
    console.log()
  }
}

// Export for testing
export {
  example_parseCSV,
  example_matchSKU,
  example_calculatePriceChange,
  example_batchImport,
  example_batchApply_approve,
  example_batchApply_approveAll,
  example_batchApply_reject,
  example_getPriceAlerts,
  example_getBatchHistory,
  example_completeWorkflow,
  example_errorHandling,
  example_csvVariations,
  example_profitImpact
}
