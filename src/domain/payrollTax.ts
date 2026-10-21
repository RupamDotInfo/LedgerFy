/**
 * The tax deducted at source from salary.
 *
 * The employer estimates the employee's income for the year, applies the
 * regime and the deductions the employee is entitled to, works out the tax
 * for the year, and spreads it across the pay periods. Nothing here is a
 * flat rate: a salary deduction is the slab rate of the year, and the year
 * changed on 1 April 2026 even though the rates did not.
 */

import type { SalaryTdsRuleParameters, TaxSlab } from '@/domain/types'
import type { Money } from '@/lib/money'

/** Round to the nearest rupee, half away from zero. */
export function roundToRupee(amount: number): number {
  const sign = amount < 0 ? -1 : 1
  const absolute = Math.abs(amount)
  const rounded = Math.round(absolute / 100) * 100
  return sign * rounded
}

/**
 * The tax on an income under a scale.
 *
 * The arithmetic is exact: the rate is in basis points and the product is
 * taken with integers, so a rupee is never lost to a floating-point
 * multiplication.
 */
export function taxOnIncome(income: Money, slabs: TaxSlab[]): Money {
  if (income <= 0) return 0
  for (const slab of slabs) {
    if (slab.to !== null && income > slab.to) continue
    const inBand = income - slab.from
    if (inBand <= 0) return slab.baseAmount
    const tax = (BigInt(inBand) * BigInt(slab.rateBps)) / BigInt(10_000)
    return slab.baseAmount + Number(tax)
  }
  return 0
}

/**
 * The tax for a year on an income, with the rebate, the surcharge and the
 * health and education cess.
 */
export function salaryTaxForYear(
  income: Money,
  parameters: SalaryTdsRuleParameters,
  regime: 'new' | 'old' = parameters.regime,
): Money {
  const scale = regime === 'old' ? parameters.oldRegime : parameters.newRegime
  if (income <= scale.basicExemption) return 0

  let tax = taxOnIncome(income, scale.slabs)

  // The rebate removes the tax entirely for an income up to its limit.
  if (income <= scale.rebateUpTo) tax = 0

  // The surcharge is on the tax, at the rate the income reaches.
  let surcharge = 0
  for (const band of parameters.surchargeRates) {
    if (income <= band.above) continue
    const rate = (BigInt(tax) * BigInt(band.rateBps)) / BigInt(10_000)
    surcharge = Math.max(surcharge, Number(rate))
  }

  // The cess is on the tax and the surcharge together.
  const cess = (BigInt(tax + surcharge) * BigInt(parameters.cessBps)) / BigInt(10_000)

  return roundToRupee(tax + surcharge + Number(cess))
}

/**
 * The deduction for one month, from the employee's year.
 *
 * The employer deducts the year's tax spread evenly over the pay periods.
 * A month in which the employee joined part way through, or a month that is
 * paid in arrears, uses the months actually paid in the year.
 */
export function monthlySalaryTds(
  annualTaxableIncome: Money,
  parameters: SalaryTdsRuleParameters,
  monthsPaid: number = parameters.monthsInYear,
  regime: 'new' | 'old' = parameters.regime,
): Money {
  if (monthsPaid <= 0) return 0
  const annual = salaryTaxForYear(annualTaxableIncome, parameters, regime)
  return roundToRupee(annual / monthsPaid)
}

/**
 * The employee's annual taxable income for the projection.
 *
 * The gross for the year, less the standard deduction, less the deductions
 * the employee has declared are allowed. The caller supplies the declared
 * deductions because they are the employee's claim and the employer's
 * record of it, and an application that guessed them would be wrong.
 */
export function annualTaxableIncome(
  annualGross: Money,
  standardDeduction: Money,
  declaredDeductions: Money,
): Money {
  return Math.max(0, annualGross - standardDeduction - declaredDeductions)
}

/**
 * The standard deduction of the regime the employee has chosen.
 */
export function standardDeductionFor(
  parameters: SalaryTdsRuleParameters,
  regime: 'new' | 'old',
): Money {
  return regime === 'old' ? parameters.oldRegime.standardDeduction : parameters.newRegime.standardDeduction
}
