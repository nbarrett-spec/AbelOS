/**
 * BOM Cost Utilities
 *
 * Use these SQL fragments in raw queries to get dynamic BOM-calculated costs
 * instead of the static Product.cost field.
 *
 * The bom_cost() PostgreSQL function returns:
 *   - SUM(component.cost × qty) + laborCost + overheadCost  (if product has BOM)
 *   - NULL  (if product has no BOM)
 *
 * COALESCE(bom_cost(p.id), p.cost) gives you the true cost:
 *   - BOM-calculated cost for assembled products (doors)
 *   - Stored cost for simple products (slabs, hinges, trim)
 */

/**
 * SQL expression that returns the true cost for a product.
 * Use in SELECT clauses: `${EFFECTIVE_COST('p')} as "effectiveCost"`
 * @param alias - the table alias for Product (default 'p')
 */
export function EFFECTIVE_COST(alias: string = 'p'): string {
  return `COALESCE(bom_cost(${alias}.id), ${alias}.cost)`
}

/**
 * SQL expression for margin calculation using BOM-aware cost.
 * Returns margin percentage: ((price - cost) / price) * 100
 * @param priceExpr - SQL expression for the price (e.g., 'p."basePrice"' or 'bp."customPrice"')
 * @param alias - the table alias for Product (default 'p')
 */
export function BOM_MARGIN_PCT(priceExpr: string, alias: string = 'p'): string {
  const cost = EFFECTIVE_COST(alias)
  return `CASE WHEN ${priceExpr} > 0 THEN ROUND(((${priceExpr} - ${cost}) / ${priceExpr} * 100)::numeric, 1)::float ELSE 0 END`
}

/**
 * SQL expression for gross profit using BOM-aware cost.
 * Returns: price - cost (per unit)
 * @param priceExpr - SQL expression for the unit price
 * @param qtyExpr - SQL expression for quantity (default '1')
 * @param alias - the table alias for Product (default 'p')
 */
export function BOM_GROSS_PROFIT(priceExpr: string, qtyExpr: string = '1', alias: string = 'p'): string {
  const cost = EFFECTIVE_COST(alias)
  return `(${priceExpr} * ${qtyExpr}) - (${cost} * ${qtyExpr})`
}
