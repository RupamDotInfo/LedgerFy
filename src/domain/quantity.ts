/**
 * Exact quantities.
 *
 * A quantity is an integer number of **milli-units** (thousandths of a unit).
 * It is never a binary floating-point value, because a quantity that cannot be
 * represented exactly must be rejected rather than quietly rounded.
 *
 * The rules are set out in `docs/inventory-accounting-policy.md` §3.
 */

import type { Money } from '@/lib/money'

/** Milli-units in one unit. */
export const QUANTITY_SCALE = 1000

/** An exact quantity, in milli-units. */
export type Quantity = number

/** The largest quantity that can be carried exactly. */
export const MAX_QUANTITY = 9_007_199_254_740_991

export function isWholeMilli(value: number): boolean {
  return Number.isInteger(value)
}

/**
 * Convert a number of units into an exact quantity.
 * Throws when the value has more precision than a milli-unit can hold.
 */
export function toQuantity(units: number): Quantity {
  if (!Number.isFinite(units)) {
    throw new Error('A quantity must be a finite number.')
  }
  const milli = Math.round(units * QUANTITY_SCALE)
  if (Math.abs(milli - units * QUANTITY_SCALE) > 1e-6) {
    throw new Error(
      `A quantity cannot be held more precisely than ${1 / QUANTITY_SCALE} of a unit.`,
    )
  }
  if (Math.abs(milli) > MAX_QUANTITY) {
    throw new Error('The quantity is outside the supported range.')
  }
  return milli
}

/** Parse a quantity from what the user typed. */
export function quantityFromString(text: string): Quantity {
  const cleaned = text.replace(/,/g, '').trim()
  if (cleaned === '') return 0
  const value = Number(cleaned)
  if (!Number.isFinite(value)) {
    throw new Error('A quantity must be a number.')
  }
  return toQuantity(value)
}

/** The quantity as a number of units, for display only. */
export function fromQuantity(quantity: Quantity): number {
  return quantity / QUANTITY_SCALE
}

/** Format a quantity for display, trimming trailing zeros. */
export function formatQuantity(quantity: Quantity, decimals = 3): string {
  const value = fromQuantity(quantity)
  const fixed = value.toFixed(decimals)
  return fixed.replace(/\.?0+$/, '')
}

/**
 * Round a rational number half away from zero, using integer arithmetic.
 *
 * `numerator` and `denominator` are exact integers; the result is an integer.
 */
export function divideRounded(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) {
    throw new Error('A cost cannot be divided by zero.')
  }
  const negative = numerator < 0n
  const absNumerator = negative ? -numerator : numerator
  const absDenominator = denominator < 0n ? -denominator : denominator

  let result = absNumerator / absDenominator
  const remainder = absNumerator % absDenominator
  // Half away from zero, never half to even, so the result is predictable.
  if (remainder * 2n >= absDenominator) result += 1n

  return Number(negative ? -result : result)
}

/**
 * The value of a line: quantity in milli-units at a rate in minor units.
 *
 * The result is rounded once, to the nearest minor unit, and that rounded
 * figure is what enters the books.
 */
export function lineValue(quantity: Quantity, rate: Money): Money {
  if (!Number.isInteger(quantity)) {
    throw new Error('A quantity must be a whole number of milli-units.')
  }
  const value = divideRounded(BigInt(quantity) * BigInt(rate), BigInt(QUANTITY_SCALE))
  if (!Number.isSafeInteger(value)) {
    throw new Error('The line value is outside the supported range.')
  }
  return value
}

/**
 * The cost of issuing `quantity` from a pool of `poolQuantity` worth
 * `poolValue`.
 *
 * When the issue takes the whole remaining stock, the entire remaining
 * carrying value is issued, so no residue is left behind by rounding.
 */
export function issueCost(
  poolValue: Money,
  poolQuantity: Quantity,
  issueQuantity: Quantity,
): Money {
  if (issueQuantity <= 0) return 0
  if (poolQuantity <= 0) {
    throw new Error('There is no stock to issue.')
  }
  if (issueQuantity >= poolQuantity) {
    return poolValue
  }
  const cost = divideRounded(
    BigInt(poolValue) * BigInt(issueQuantity),
    BigInt(poolQuantity),
  )
  if (!Number.isSafeInteger(cost)) {
    throw new Error('The issue cost is outside the supported range.')
  }
  return cost
}

/**
 * The average carrying cost per unit, in minor units.
 *
 * The costing itself never uses this rounded figure; it is for display.
 */
export function averageCost(poolValue: Money, poolQuantity: Quantity): number {
  if (poolQuantity <= 0) return 0
  return divideRounded(BigInt(poolValue) * BigInt(QUANTITY_SCALE), BigInt(poolQuantity))
}
