/**
 * The payroll calculation.
 *
 * This is a **pure function**. It takes the employee's salary structure, the
 * attendance, the rules in force for the period and the period itself, and it
 * returns a snapshot. It reads nothing and writes nothing, and the same
 * inputs always produce the same figures.
 *
 * The rules are written down in `docs/payroll-accounting-policy.md` and the
 * evidence for them is in `docs/payroll-compliance-sources.md`. Neither this
 * module nor the documents may drift apart: when they disagree, the document
 * is corrected or the code is — never the other way round.
 */

import { monthlySalaryTds, roundToRupee } from '@/domain/payrollTax'
import {
  BUILT_IN_RULE_SETS,
  blockingRules,
  ruleInForce,
  wageBase,
  type RuleSetDefinition,
} from '@/domain/payrollRules'
import type {
  Employee,
  PayrollAccounts,
  PayrollAttendance,
  PayrollCalculation,
  PayrollRuleSet,
  PayrollRunState,
  SalaryComponent,
  SalaryStructure,
  StatutoryRuleVersion,
} from '@/domain/types'
import type { Money } from '@/lib/money'

export class PayrollError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayrollError'
  }
}

// ---------------------------------------------------------------------------
// The calculation
// ---------------------------------------------------------------------------

export interface PayrollCalculationInput {
  employee: Employee
  /** The structure version in force for the period. */
  structure: SalaryStructure
  components: SalaryComponent[]
  /** The attendance for the period. It may be absent, in which case the
   *  employee is paid for the whole period. */
  attendance: PayrollAttendance | null
  /** The rules in force. */
  rules: StatutoryRuleVersion[]
  /** The period, as `YYYY-MM`. */
  period: string
  periodStart: string
  periodEnd: string
  /** The date the salary is paid, which the tax rule is chosen by. */
  paymentDate: string
  /** The number of days in the period, for the daily rates. */
  daysInPeriod: number
  /** The months the employee is paid for in the year, for the tax spread. */
  monthsPaidInYear: number
  /** The employee's declared deductions for the year, for the tax projection. */
  declaredDeductions: Money
  /** The employee's projected annual gross, for the tax projection. */
  projectedAnnualGross: Money
}

export interface PayrollCalculationResult {
  calculation: PayrollCalculation
  /** The rules that were used, for the record. */
  ruleVersions: Array<{ ruleSet: PayrollRuleSet; versionId: string; source: string }>
  /** The rules that would block the run, if any. */
  blocked: Array<{ ruleSet: PayrollRuleSet; reason: string }>
}

/**
 * The days the employee is paid for, and the length of the period.
 *
 * The proportion is kept as whole days rather than a fraction, so that the
 * amount it scales is worked out with exact integer arithmetic. The policy
 * requires every amount to be an integer number of paise and forbids a
 * floating-point multiplication on money.
 */
function payableFactor(
  attendance: PayrollAttendance | null,
  daysInPeriod: number,
): { payableDays: number | null; daysInPeriod: number } {
  if (!attendance) return { payableDays: null, daysInPeriod }
  const payableDays = Math.max(0, attendance.payableDays)
  if (daysInPeriod <= 0) return { payableDays: 0, daysInPeriod: 0 }
  return { payableDays, daysInPeriod }
}

/**
 * A proportion of an amount, by whole days, with exact integer arithmetic.
 *
 * `payableDays` is null when there is no attendance record, which means the
 * whole amount is paid. Otherwise the amount is scaled by the payable days
 * over the days in the period, and rounded to the nearest minor unit, half
 * away from zero.
 *
 * The rounding and the division are done in integers. Scaling money by a
 * fraction such as 20/30 in floating point is the one thing the policy
 * forbids, and it is also where a one-minor-unit difference comes from.
 */
function prorate(
  amount: number,
  payableDays: number | null,
  daysInPeriod: number,
): number {
  if (payableDays === null) return Math.round(amount)
  if (daysInPeriod <= 0) return 0
  const days = payableDays >= daysInPeriod ? daysInPeriod : Math.max(0, payableDays)
  const base = BigInt(Math.round(amount))
  const total = BigInt(daysInPeriod)
  const negative = base < BigInt(0)
  const magnitude = negative ? -base : base
  const scaled = magnitude * BigInt(days) * BigInt(2) + total
  const rounded = scaled / (total * BigInt(2))
  return Number(negative ? -rounded : rounded)
}

/**
 * The attendance figures have to be whole days within the period.
 *
 * A negative or fractional figure is not a quantity of days, and a figure
 * larger than the period is not a number of days in it. Silently clamping
 * them would pay an amount nobody asked for, so they are refused with a
 * message that names the field.
 */
function validateAttendance(
  attendance: PayrollAttendance | null,
  daysInPeriod: number,
): void {
  if (!attendance) return
  const days: Array<[string, number]> = [
    ['payableDays', attendance.payableDays],
    ['lopDays', attendance.lopDays],
    ['extraDays', attendance.extraDays],
  ]
  for (const [field, value] of days) {
    if (!Number.isInteger(value)) {
      throw new PayrollError(
        `The attendance for ${attendance.employeeId} has a fractional ${field} (${value}). A number of days is whole.`,
      )
    }
    if (value < 0) {
      throw new PayrollError(
        `The attendance for ${attendance.employeeId} has a negative ${field} (${value}).`,
      )
    }
    if (value > daysInPeriod) {
      throw new PayrollError(
        `The attendance for ${attendance.employeeId} has ${field} of ${value}, which is more than the ${daysInPeriod} days in the period.`,
      )
    }
  }
  if (!Number.isInteger(attendance.otherDeductions) || attendance.otherDeductions < 0) {
    throw new PayrollError(
      `The attendance for ${attendance.employeeId} has other deductions of ${attendance.otherDeductions}, which is not an amount in whole minor units.`,
    )
  }
}

/**
 * The gross a structure produces for a whole period, ignoring attendance.
 *
 * Every earning and reimbursement component is included, each on its own
 * basis, so the projection the tax is worked out from is the same money the
 * run pays rather than a subset of it.
 */
export function projectedMonthlyGross(
  components: SalaryComponent[],
  daysInPeriod: number,
): Money {
  const ordered = [...components].sort((left, right) => left.position - right.position)
  const computed: Array<{
    component: SalaryComponent
    exact: number
    amount: number
  }> = []

  for (const component of ordered) {
    const exact = componentAmount(component, computed, daysInPeriod, daysInPeriod)
    computed.push({ component, exact, amount: roundToRupee(exact) })
  }

  return computed
    .filter(
      (entry) => entry.component.kind === 'earning' || entry.component.kind === 'reimbursement',
    )
    .reduce((sum, entry) => sum + entry.amount, 0)
}

/**
 * Compute one employee's pay for a period.
 *
 * The order is fixed and is the order the policy sets out: the earnings, the
 * employee's own contributions, the statutory deductions, the employer's
 * contributions, and then the net.
 */
export function calculatePayroll(
  input: PayrollCalculationInput,
): PayrollCalculationResult {
  const { employee, structure, components, attendance, rules } = input

  if (components.length === 0) {
    throw new PayrollError(
      `The salary structure for ${employee.name} has no components.`,
    )
  }

  // The rules that would block the run. A rule that is not in force is not
  // applied silently.
  const required: PayrollRuleSet[] = ['epf', 'esic', 'salary-tds']
  if (employee.professionalTaxJurisdiction) required.push('professional-tax')
  const blocked = blockingRules(rules, input.paymentDate, required)

  const { payableDays } = payableFactor(attendance, input.daysInPeriod)
  validateAttendance(attendance, input.daysInPeriod)

  // -- The earnings ------------------------------------------------------------
  const ordered = [...components].sort((left, right) => left.position - right.position)
  const computed: Array<{
    component: SalaryComponent
    exact: number
    amount: number
  }> = []

  for (const component of ordered) {
    const exact = componentAmount(component, computed, payableDays, input.daysInPeriod)
    computed.push({ component, exact, amount: roundToRupee(exact) })
  }

  const earningComponents = computed.filter(
    (entry) => entry.component.kind === 'earning' || entry.component.kind === 'reimbursement',
  )
  const grossEarnings = earningComponents.reduce((sum, entry) => sum + entry.amount, 0)
  const exactGrossEarnings = earningComponents.reduce((sum, entry) => sum + entry.exact, 0)

  const bases = computed.map((entry) => ({
    bases: entry.component.bases,
    amount: entry.amount,
  }))

  // -- The employee's own statutory contributions -----------------------------
  const employeeDeductions: Array<{ code: string; name: string; amount: Money }> = []

  const epfRule = ruleInForce(rules, 'epf', input.paymentDate)
  if (employee.isProvidentFundMember && epfRule && epfRule.parameters.kind === 'epf') {
    const parameters = epfRule.parameters
    const wages = Math.min(wageBase(bases, 'epf-wages'), parameters.wageCeiling)
    const amount = roundToRupee(
      Number((BigInt(wages) * BigInt(parameters.employeeRateBps)) / BigInt(10_000)),
    )
    employeeDeductions.push({ code: 'EPF', name: 'Provident fund', amount })
  }

  const esicRule = ruleInForce(rules, 'esic', input.paymentDate)
  if (employee.isStateInsuranceMember && esicRule && esicRule.parameters.kind === 'esic') {
    const parameters = esicRule.parameters
    const ceiling = employee.isPersonWithDisability
      ? parameters.disabilityWageCeiling
      : parameters.wageCeiling
    const wages = Math.min(esiWageBase(bases, grossEarnings), ceiling)
    // An employee whose average daily wage is up to the exemption pays no
    // employee share, but the employer still pays its own.
    const dailyWage = input.daysInPeriod > 0 ? wages / input.daysInPeriod : 0
    const exempt = dailyWage > 0 && dailyWage <= parameters.dailyWageExemption
    const amount = exempt
      ? 0
      : roundToRupee(
          Number((BigInt(wages) * BigInt(parameters.employeeRateBps)) / BigInt(10_000)),
        )
    employeeDeductions.push({ code: 'ESIC', name: 'State insurance', amount })
  }

  // The employee's other deductions: advances and recoveries.
  const otherDeductions = attendance?.otherDeductions ?? 0
  if (otherDeductions !== 0) {
    employeeDeductions.push({
      code: 'OTHER',
      name: 'Other deductions',
      amount: otherDeductions,
    })
  }

  const employeeDeductionTotal = employeeDeductions.reduce(
    (sum, entry) => sum + entry.amount,
    0,
  )

  // -- The statutory deductions ----------------------------------------------
  const statutoryDeductions: Array<{ code: string; name: string; amount: Money }> = []

  const ptRule = ruleInForce(rules, 'professional-tax', input.paymentDate)
  if (employee.professionalTaxJurisdiction && ptRule?.parameters.kind === 'professional-tax') {
    const parameters = ptRule.parameters
    if (parameters.jurisdiction === employee.professionalTaxJurisdiction) {
      const wages = wageBase(bases, 'professional-tax-wages')
      const amount = professionalTaxFor(wages, parameters.slabs)
      if (amount !== 0) {
        statutoryDeductions.push({
          code: 'PT',
          name: 'Professional tax',
          amount,
        })
      }
    }
  }

  const tdsRule = ruleInForce(rules, 'salary-tds', input.paymentDate)
  if (tdsRule?.parameters.kind === 'salary-tds') {
    const parameters = tdsRule.parameters
    // The regime the employee has chosen decides the scale, and it is
    // recorded with the run so that a later change never rewrites it.
    const regime = employee.taxRegime ?? parameters.regime
    const scale = regime === 'old' ? parameters.oldRegime : parameters.newRegime
    const annual = monthlySalaryTds(
      input.projectedAnnualGross - scale.standardDeduction - input.declaredDeductions,
      parameters,
      input.monthsPaidInYear,
      regime,
    )
    if (annual !== 0) {
      statutoryDeductions.push({
        code: 'TDS',
        name: `Tax deducted at source (${parameters.section})`,
        amount: annual,
      })
    }
  }

  const statutoryDeductionTotal = statutoryDeductions.reduce(
    (sum, entry) => sum + entry.amount,
    0,
  )

  // -- The employer's contributions -------------------------------------------
  const employerContributions: Array<{ code: string; name: string; amount: Money }> = []

  if (employee.isProvidentFundMember && epfRule?.parameters.kind === 'epf') {
    const parameters = epfRule.parameters
    const wages = Math.min(wageBase(bases, 'epf-wages'), parameters.wageCeiling)
    const amount = roundToRupee(
      Number((BigInt(wages) * BigInt(parameters.employerRateBps)) / BigInt(10_000)),
    )
    employerContributions.push({
      code: 'EPF',
      name: parameters.splitsToPension
        ? 'Provident fund and pension (employer)'
        : 'Provident fund (employer)',
      amount,
    })
  }

  if (employee.isStateInsuranceMember && esicRule?.parameters.kind === 'esic') {
    const parameters = esicRule.parameters
    const ceiling = employee.isPersonWithDisability
      ? parameters.disabilityWageCeiling
      : parameters.wageCeiling
    const wages = Math.min(esiWageBase(bases, grossEarnings), ceiling)
    const amount = roundToRupee(
      Number((BigInt(wages) * BigInt(parameters.employerRateBps)) / BigInt(10_000)),
    )
    employerContributions.push({
      code: 'ESIC',
      name: 'State insurance (employer)',
      amount,
    })
  }

  const employerContributionTotal = employerContributions.reduce(
    (sum, entry) => sum + entry.amount,
    0,
  )

  // -- The net ----------------------------------------------------------------
  const netPay = grossEarnings - employeeDeductionTotal - statutoryDeductionTotal
  if (netPay < 0) {
    throw new PayrollError(
      `The deductions for ${employee.name} are more than the earnings. ` +
        'The net pay cannot be negative.',
    )
  }

  const ruleVersions = required
    .map((ruleSet) => ruleInForce(rules, ruleSet, input.paymentDate))
    .filter((rule): rule is StatutoryRuleVersion => rule !== null)
    .map((rule) => ({ ruleSet: rule.ruleSet, versionId: rule.id, source: rule.source }))

  const calculation: PayrollCalculation = {
    employeeId: employee.id,
    employeeName: employee.name,
    employeeCode: employee.code,
    period: input.period,
    structureId: structure.id,
    structureVersion: structure.version,
    ruleVersions,
    components: computed.map((entry) => ({
      code: entry.component.code,
      name: entry.component.name,
      kind: entry.component.kind,
      amount: entry.amount,
      exactAmount: entry.exact,
    })),
    grossEarnings,
    exactGrossEarnings,
    employeeDeductions,
    employeeDeductionTotal,
    statutoryDeductions,
    statutoryDeductionTotal,
    employerContributions,
    employerContributionTotal,
    netPay,
    liability: netPay + employeeDeductionTotal + statutoryDeductionTotal + employerContributionTotal,
  }

  return { calculation, ruleVersions, blocked }
}

/**
 * The amount of a component.
 *
 * A fixed amount, a percentage of another component, or a rate for each day
 * of the period. The percentage is applied with exact integer arithmetic, and
 * so is the proration of a fixed or per-day amount.
 */
function componentAmount(
  component: SalaryComponent,
  computed: Array<{ component: SalaryComponent; exact: number; amount: number }>,
  payableDays: number | null,
  daysInPeriod: number,
): number {
  const calculation = component.calculation
  if (calculation.type === 'fixed') {
    return prorate(calculation.amount, payableDays, daysInPeriod)
  }
  if (calculation.type === 'per-day') {
    const days = daysInPeriod > 0 ? daysInPeriod : 1
    return prorate(calculation.rate * days, payableDays, daysInPeriod)
  }
  // A percentage of another component. The base is the rounded amount of the
  // component it names, so a percentage of a percentage does not drift.
  const base = computed.find((entry) => entry.component.code === calculation.of)
  if (!base) {
    throw new PayrollError(
      `The component ${component.code} is a percentage of ${calculation.of}, which is not in the structure.`,
    )
  }
  return Number(
    (BigInt(Math.round(base.amount)) * BigInt(calculation.rateBps)) / BigInt(10_000),
  )
}

/**
 * The wages the state insurance contribution is computed on.
 *
 * Wages are the basic, the dearness allowance and the retaining allowance.
 * House rent, conveyance and the like are left out — **unless the excluded
 * items come to more than half the total remuneration, in which case the
 * excess is added back**. That add-back is part of the rule, not an option,
 * so it is computed here rather than left to the company's configuration.
 */
export function esiWageBase(
  bases: Array<{ bases: string[]; amount: Money }>,
  gross: Money,
): Money {
  const declared = wageBase(bases, 'esic-wages')
  const excluded = bases
    .filter((entry) => entry.bases.includes('gross-earnings'))
    .filter((entry) => !entry.bases.includes('esic-wages'))
    .reduce((sum, entry) => sum + entry.amount, 0)
  if (excluded <= 0) return declared
  const half = Math.floor(gross / 2)
  if (excluded <= half) return declared
  return declared + (excluded - half)
}

/**
 * The professional tax for a month, from the schedule.
 */
export function professionalTaxFor(
  monthlyWages: Money,
  slabs: Array<{ upTo: Money | null; monthly: Money }>,
): Money {
  for (const slab of slabs) {
    if (slab.upTo === null || monthlyWages <= slab.upTo) return slab.monthly
  }
  return 0
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * The totals of a run, and the proof that it balances.
 */
export function summariseRun(
  calculations: PayrollCalculation[],
): {
  grossEarnings: Money
  employeeDeductions: Money
  statutoryDeductions: Money
  employerContributions: Money
  netPay: Money
  liability: Money
} {
  const sum = (pick: (calculation: PayrollCalculation) => Money): Money =>
    calculations.reduce((total, calculation) => total + pick(calculation), 0)

  const grossEarnings = sum((calculation) => calculation.grossEarnings)
  const employeeDeductions = sum((calculation) => calculation.employeeDeductionTotal)
  const statutoryDeductions = sum((calculation) => calculation.statutoryDeductionTotal)
  const employerContributions = sum((calculation) => calculation.employerContributionTotal)
  const netPay = sum((calculation) => calculation.netPay)

  return {
    grossEarnings,
    employeeDeductions,
    statutoryDeductions,
    employerContributions,
    netPay,
    // The liability the run creates is the net pay plus everything withheld
    // from it, plus what the employer owes.
    liability: netPay + employeeDeductions + statutoryDeductions + employerContributions,
  }
}

/**
 * The state of a run, derived from what has happened to it.
 */
export function deriveRunState(
  status: string,
  hasSnapshot: boolean,
  hasJournal: boolean,
  isFullyPaid: boolean,
): PayrollRunState {
  if (status === 'cancelled') return 'cancelled'
  if (status === 'reversed') return 'reversed'
  if (status === 'paid' || isFullyPaid) return 'paid'
  if (hasJournal) return 'posted'
  if (status === 'approved') return 'approved'
  if (hasSnapshot) return 'calculated'
  return 'draft'
}

// ---------------------------------------------------------------------------
// The journal
// ---------------------------------------------------------------------------

export interface PayrollJournalLine {
  ledgerId: string
  debit: Money
  credit: Money
  narration: string
}

export interface PayrollJournal {
  lines: PayrollJournalLine[]
  /** The totals, for the proof that it balances. */
  debit: Money
  credit: Money
}

/**
 * The journal a run posts.
 *
 * One debit for the cost of employment, and the liabilities it creates. The
 * earnings are not debited anywhere else, so the expense is posted once.
 */
export function buildPayrollJournal(
  calculations: PayrollCalculation[],
  accounts: PayrollAccounts,
  narration: string,
): PayrollJournal {
  const totals = summariseRun(calculations)
  if (totals.liability === 0) {
    throw new PayrollError('There is nothing to post: the run has no liability.')
  }

  const lines: PayrollJournalLine[] = [
    {
      ledgerId: accounts.salaryExpenseLedgerId,
      debit: totals.grossEarnings + totals.employerContributions,
      credit: 0,
      narration,
    },
    {
      ledgerId: accounts.netSalaryPayableLedgerId,
      debit: 0,
      credit: totals.netPay,
      narration,
    },
  ]

  if (totals.employeeDeductions !== 0) {
    lines.push({
      ledgerId: accounts.employeeDeductionsPayableLedgerId,
      debit: 0,
      credit: totals.employeeDeductions,
      narration,
    })
  }
  if (totals.statutoryDeductions !== 0) {
    lines.push({
      ledgerId: accounts.statutoryDeductionsPayableLedgerId,
      debit: 0,
      credit: totals.statutoryDeductions,
      narration,
    })
  }
  if (totals.employerContributions !== 0) {
    lines.push({
      ledgerId: accounts.employerContributionsPayableLedgerId,
      debit: 0,
      credit: totals.employerContributions,
      narration,
    })
  }

  const debit = lines.reduce((sum, line) => sum + line.debit, 0)
  const credit = lines.reduce((sum, line) => sum + line.credit, 0)
  if (debit !== credit) {
    throw new PayrollError(
      `The payroll journal does not balance: the debits are ${debit} and the credits are ${credit}.`,
    )
  }

  return { lines, debit, credit }
}

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

/**
 * Mask a tax number or an account number for display.
 *
 * The full value is never shown, never logged and never exported. A payroll
 * system that puts a full account number on a screen has made it a copy that
 * can be left behind.
 */
export function maskIdentifier(value: string | null | undefined): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (trimmed.length <= 4) return '•'.repeat(trimmed.length)
  return `${'•'.repeat(trimmed.length - 4)}${trimmed.slice(-4)}`
}

/** The rule sets this build ships, for the settings screen. */
export function builtInRuleSets(): RuleSetDefinition[] {
  return Object.values(BUILT_IN_RULE_SETS)
}
