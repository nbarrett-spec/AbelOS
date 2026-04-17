import { describe, it, expect } from 'vitest'
import { EFFECTIVE_COST, BOM_MARGIN_PCT, BOM_GROSS_PROFIT } from '../bom-cost'

describe('bom-cost utilities', () => {
  describe('EFFECTIVE_COST', () => {
    it('returns COALESCE expression with default alias', () => {
      expect(EFFECTIVE_COST()).toBe('COALESCE(bom_cost(p.id), p.cost)')
    })

    it('respects custom alias', () => {
      expect(EFFECTIVE_COST('prod')).toBe('COALESCE(bom_cost(prod.id), prod.cost)')
    })
  })

  describe('BOM_MARGIN_PCT', () => {
    it('produces a CASE expression for margin percentage', () => {
      const sql = BOM_MARGIN_PCT('p."basePrice"')
      expect(sql).toContain('CASE WHEN')
      expect(sql).toContain('p."basePrice"')
      expect(sql).toContain('bom_cost(p.id)')
      expect(sql).toContain('* 100')
    })

    it('uses custom alias in cost expression', () => {
      const sql = BOM_MARGIN_PCT('bp."customPrice"', 'prod')
      expect(sql).toContain('bom_cost(prod.id)')
      expect(sql).toContain('bp."customPrice"')
    })
  })

  describe('BOM_GROSS_PROFIT', () => {
    it('produces price minus cost expression', () => {
      const sql = BOM_GROSS_PROFIT('li."unitPrice"', 'li."quantity"')
      expect(sql).toContain('li."unitPrice" * li."quantity"')
      expect(sql).toContain('bom_cost(p.id)')
    })

    it('defaults quantity to 1', () => {
      const sql = BOM_GROSS_PROFIT('p."basePrice"')
      expect(sql).toContain('p."basePrice" * 1')
    })
  })
})
