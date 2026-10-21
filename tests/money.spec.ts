import { describe, expect, it } from 'vitest'

import { formatAmount, formatMoney, formatPercent, formatQuantity, toMajor, toMinor } from '@/lib/money'

describe('money conversion', () => {
  it('converts major units to minor units without float drift', () => {
    expect(toMinor('1234.56')).toBe(123456)
    expect(toMinor('0.1')).toBe(10)
    expect(toMinor('0.29')).toBe(29)
    expect(toMinor('99.99')).toBe(9999)
  })

  it('handles large values exactly', () => {
    expect(toMinor('99999999.99')).toBe(9_999_999_999)
    expect(toMinor(1234.56)).toBe(123456)
  })

  it('round-trips through major units', () => {
    expect(toMajor(toMinor('45678.90'))).toBeCloseTo(45678.9, 10)
  })

  it('treats empty and malformed input as zero', () => {
    expect(toMinor('')).toBe(0)
    expect(toMinor('-')).toBe(0)
    expect(toMinor('.')).toBe(0)
  })

  it('keeps negative amounts negative', () => {
    expect(toMinor('-250.75')).toBe(-25075)
  })
})

describe('money formatting', () => {
  it('formats Indian rupees with the lakh grouping', () => {
    expect(formatMoney(12345678)).toBe('₹1,23,456.78')
  })

  it('renders negative amounts with a leading minus', () => {
    expect(formatMoney(-500000)).toContain('−')
  })

  it('supports a signed variant for variance figures', () => {
    expect(formatMoney(500000, 'INR', { signed: true })).toContain('+')
    expect(formatMoney(-500000, 'INR', { signed: true })).toContain('−')
  })

  it('can hide zero values', () => {
    expect(formatMoney(0, 'INR', { blankZero: true })).toBe('')
    expect(formatMoney(0, 'INR')).not.toBe('')
  })

  it('formats plain amounts and quantities', () => {
    expect(formatAmount(100000)).toBe('1,000.00')
    expect(formatQuantity(12.5, 'Kg')).toBe('12.5 Kg')
    expect(formatPercent(18.25)).toBe('18.3%')
  })
})
