import { describe, expect, it } from 'vitest'

import { amountInWords } from '@/lib/words'

describe('amount in words', () => {
  it('uses the Indian numbering system', () => {
    expect(amountInWords(41022200)).toBe(
      'INR Four Lakh Ten Thousand Two Hundred Twenty-Two Only',
    )
  })

  it('handles crores', () => {
    expect(amountInWords(12345678900)).toBe(
      'INR Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine Only',
    )
  })

  it('handles zero', () => {
    expect(amountInWords(0)).toBe('INR Zero Only')
  })

  it('includes paise when they are present', () => {
    expect(amountInWords(15050)).toBe('INR One Hundred Fifty and Fifty Paise Only')
  })

  it('handles negative amounts', () => {
    expect(amountInWords(-10000)).toContain('Minus')
  })

  it('uses the currency code for other currencies', () => {
    expect(amountInWords(10000, 'USD')).toBe('USD One Hundred Only')
  })
})
